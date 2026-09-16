// メルカリ内部APIの共通クライアント。
// api/mercari.js（検索）と api/watch-check.js（監視中オークションの再取得）から使う。
const crypto = require('crypto');

const ITEM_GET_ENDPOINT = 'https://api.mercari.jp/items/get';

const COMMON_HEADERS = {
  'X-Platform': 'web',
  Accept: '*/*',
  'Accept-Language': 'ja,en;q=0.9',
  Origin: 'https://jp.mercari.com',
  Referer: 'https://jp.mercari.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
};

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// メルカリ内部APIは DPoP（RFC 9449）ヘッダーが必須。
// 使い捨ての ES256(P-256) 鍵ペアをリクエストごとに生成し、公開鍵を jwk としてヘッダーに載せて自己署名する。
function createDpopToken(url, method) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });

  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y },
  };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method,
    uuid: crypto.randomUUID(),
  };

  const signingInput = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  // ES256 は R||S の生署名（IEEE P1363）。DER のままだと 401 になる
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return signingInput + '.' + base64url(signature);
}

// 商品1件の現在状態を取得する。
// ※ include_auction だけでは auction_info が返らず、include_product_page_component も一緒に
//   渡して初めて付いてくる（2026-09-16 実測）。片方でも欠けると終了予定時刻が取れない。
async function fetchItem(itemId) {
  const url =
    `${ITEM_GET_ENDPOINT}?id=${encodeURIComponent(itemId)}` +
    '&include_item_attributes=true&include_product_page_component=true&include_auction=true';

  const res = await fetch(url, {
    headers: Object.assign({ DPoP: createDpopToken(ITEM_GET_ENDPOINT, 'GET') }, COMMON_HEADERS),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`mercari items/get ${res.status}: ${text.slice(0, 200)}`);

  const json = JSON.parse(text);
  return json.data || json;
}

// auction_info の中身（2026-09-16 実測）:
//   { id, start_time, expected_end_time, total_bids, initial_price, highest_bid,
//     state: 'STATE_ONGOING' ほか, auction_type: 'AUCTION_TYPE_NORMAL' }
// 終了予定時刻は延長で後ろにずれるため、毎回取り直す前提で扱う。
function normalizeAuction(item) {
  const info = item && item.auction_info;
  if (!info) return null;
  return {
    auctionId: info.id || '',
    startTime: Number(info.start_time) || null,
    endTime: Number(info.expected_end_time) || null,
    totalBids: Number(info.total_bids) || 0,
    initialPrice: Number(info.initial_price) || null,
    highestBid: Number(info.highest_bid) || Number(item.price) || 0,
    state: info.state || '',
    isOngoing: info.state === 'STATE_ONGOING',
  };
}

module.exports = { createDpopToken, fetchItem, normalizeAuction, COMMON_HEADERS };
