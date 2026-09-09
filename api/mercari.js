// ─────────────────────────────────────────────────────────────────────────────
// メルカリ新着監視 API
//
// ヤフオク版（api/search.js）の MODELS 定義・価格上限ロジック・ジャンク判定を踏襲したメルカリ版。
// ※MODELS はヤフオク版からのコピー。抽出条件を変えるときは api/search.js と揃えること。
//
// ヤフオクとの違い:
//   1) メルカリには「ジャンク」というカテゴリが無い → 状態は itemConditionId(1〜6) で絞り、
//      ジャンクかどうかは商品名のワードで判定する（＝検索は1モデル1回で済む）
//   2) shippingPayerId=2（送料込み＝出品者負担）に限定 → 表示価格がそのまま総額になる
//   3) キーワードが商品説明にもマッチしてソフトが混ざるため、機種ごとの「本体」カテゴリに限定する
//   4) メルカリ内部APIは DPoP ヘッダー必須 → 使い捨ての ES256 鍵ペアを都度生成して署名する
//
// デバッグ:
//   /api/mercari?raw=1            … 先頭モデルの生JSONをそのまま返す
//   /api/mercari?model=DS         … 単体モデルだけ実行
//   /api/mercari?raw=1&model=DS   … 単体モデルの生JSON
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const MERCARI_ENDPOINT = 'https://api.mercari.jp/v2/entities:search';

// 各モデルの categories は、メルカリの「本体」カテゴリID（2026-09-09 に items/get で実測）。
//   メルカリのキーワード検索は商品説明にもマッチするため、「◯◯ 本体」で検索してもソフト・周辺機器・
//   攻略本が大量に混ざる（ヤフオクではこの問題は起きない）。本体カテゴリに限定して機種違いごと弾く。
//   カテゴリ絞りをやめたい場合は該当モデルの categories を消せば全カテゴリ横断になる。
const MODELS = [
  {
    name: 'ゲームボーイ（DMG）',
    categories: [7181], // 本体(ゲームボーイ)
    query: 'ゲームボーイ DMG 本体 -ジャンク -動作未確認',
    excludeWords: ['カラー', 'ポケット', 'アドバンス', 'GBC', 'GBA', 'ソフト', 'カセット', 'ロム', 'ROM', 'ゲームソフト'],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'ゲームボーイカラー',
    categories: [8908], // 本体(カラー)
    query: 'ゲームボーイカラー 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'ゲームボーイポケット',
    categories: [8907], // 本体(ポケット)
    query: 'ゲームボーイポケット 本体 -ジャンク -動作未確認',
    excludeWords: [],
    // 中古のみ・総額6200円以上は対象外。
    // ジャンクの上限を書いていないのは意図的で、ジャンク判定（「現状品」「傷あり」表記を含む）は
    // 価格に関わらず「対象外」として除外される。
    priceLimits: { '中古': 6199 },
    // 下限価格（メルカリのみ。ヤフオク側には無い設定）。4000円未満は対象外
    priceMins: { '中古': 4000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  // ▼ アドバンス系はジャンクも仕入れ対象なので除外しない（上限価格で絞る）
  {
    name: 'ゲームボーイアドバンス',
    categories: [7174], // 本体(アドバンス)
    query: 'ゲームボーイアドバンス 本体',
    excludeWords: ['SP'],
    // 総額（送料込み）で 中古 5500〜7200円 / ジャンク 5000〜6200円
    priceLimits: { '中古': 7200, 'ジャンク': 6200 },
    priceMins: { '中古': 5500, 'ジャンク': 5000 },
  },
  {
    name: 'ゲームボーイアドバンスSP',
    categories: [8904], // 本体(SP)
    query: 'ゲームボーイアドバンスSP 本体',
    excludeWords: [],
    priceLimits: { '中古': 10500, 'ジャンク': 9500 },
  },
  {
    name: 'DS',
    categories: [7050], // 本体(DS)
    query: 'ニンテンドーDS 本体 -ジャンク -動作未確認',
    excludeWords: ['Lite', 'DSi', 'LL'],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DS Lite',
    categories: [8899], // 本体(DS Lite)
    query: 'DS Lite 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DSi',
    categories: [8898], // 本体(DS i) ※DSi/DSi LL 共通
    query: 'DSi 本体 -ジャンク -動作未確認',
    excludeWords: ['LL'],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DSi LL',
    categories: [8898], // 本体(DS i) ※DSi/DSi LL 共通
    query: 'DSi LL 本体 -ジャンク -動作未確認',
    excludeWords: [],
    // 総額（送料込み）で7700円まで
    priceLimits: { '中古': 7700 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: '3DS',
    categories: [7022, 8885], // 本体(3DS) / 本体(New 3DS)
    query: '3DS 本体 -ジャンク -動作未確認',
    excludeWords: ['LL'],
    // 総額（送料込み）で 9500〜11000円
    priceLimits: { '中古': 11000 },
    priceMins: { '中古': 9500 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: '3DS LL',
    categories: [7038, 8882], // 本体(3DS LL) / 本体(New 3DS LL)
    query: '3DS LL 本体 -ジャンク -動作未確認',
    excludeWords: [],
    // 総額（送料込み）で 15000〜18000円
    priceLimits: { '中古': 18000 },
    priceMins: { '中古': 15000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 1000',
    categories: [7076], // 本体(PSP)
    query: 'PSP-1000 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 2000',
    categories: [7076], // 本体(PSP)
    query: 'PSP-2000 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 3000',
    categories: [7076], // 本体(PSP)
    query: 'PSP-3000 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（メルカリの itemConditionId 2〜4）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
];

const JUNK_WORDS = ['ジャンク', '動作未確認', '不動品', '動作不良', '現状品', '傷あり'];
const WORKING_WORDS = ['動作品', '動作確認済', '完動品'];
const NG_WORDS = ['ジャンク', '動作未確認', '不動品', '動作不良'];

// メルカリ専用の除外ワード（全モデル共通）。
// 出品者がカテゴリを間違えて「本体」カテゴリに空箱や説明書だけを出しているケースを弾く。
const MERCARI_NG_WORDS = ['空箱', '箱のみ', '説明書のみ', '取説のみ', 'ケースのみ', '外箱のみ'];

// ヤフオク版と同じデフォルト検索枠（ジャンク枠 + 中古枠）
const SEARCH_TYPES = [
  { status: 'ジャンク', istatus: '3,4,5' },
  { status: '中古', istatus: '2,3' },
];

// メルカリの商品の状態(itemConditionId)
const MERCARI_CONDITIONS = {
  1: '新品、未使用',
  2: '未使用に近い',
  3: '目立った傷や汚れなし',
  4: 'やや傷や汚れあり',
  5: '傷や汚れあり',
  6: '全体的に状態が悪い',
};

// ヤフオクの istatus → メルカリの itemConditionId 対応
//   ヤフオク: 1=未使用 2=中古(すべて) 3=未使用に近い 4=目立った傷や汚れなし
//            5=やや傷や汚れあり 6=傷や汚れあり 7=全体的に状態が悪い
//   ※ヤフオクの 2 は「中古すべて」なので、メルカリでは未使用を除く 2〜6 に展開する
const ISTATUS_TO_CONDITION = {
  '1': [1],
  '2': [2, 3, 4, 5, 6],
  '3': [2],
  '4': [3],
  '5': [4],
  '6': [5],
  '7': [6],
};

// モデルの searchTypes（無ければデフォルト枠）から、検索に使う itemConditionId を組み立てる。
// メルカリはジャンクをカテゴリで持たないため、全枠の状態をひとつに合成して1回だけ検索する。
function conditionsFor(model) {
  const set = new Set();
  for (const searchType of (model.searchTypes || SEARCH_TYPES)) {
    for (const istatus of searchType.istatus.split(',')) {
      for (const id of (ISTATUS_TO_CONDITION[istatus.trim()] || [])) set.add(id);
    }
  }
  return Array.from(set).sort();
}

// 検索リクエストに載せる下限価格。状態別に下限が違う場合は、いちばん低い方に合わせる
// （リクエスト側で絞りすぎないようにし、状態ごとの厳密な判定は取得後に行う）
function priceMinFor(model) {
  if (!model.priceMins) return 0;
  const mins = Object.values(model.priceMins);
  return mins.length ? Math.min(...mins) : 0;
}

// ヤフオク用クエリの「-ワード」（マイナス検索）を、メルカリの excludeKeyword 側へ振り分ける
function splitQuery(model) {
  const keywords = [];
  const excludes = [];
  for (const token of model.query.split(/\s+/)) {
    if (token.startsWith('-') && token.length > 1) excludes.push(token.slice(1));
    else if (token) keywords.push(token);
  }
  return { keyword: keywords.join(' '), excludeKeyword: excludes.join(' ') };
}

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

async function searchMercari(keyword, excludeKeyword, conditions, categories, priceMin) {
  const body = {
    userId: '',
    pageSize: 120,
    pageToken: '',
    searchSessionId: crypto.randomUUID(),
    indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
    thumbnailTypes: [],
    searchCondition: {
      keyword,
      excludeKeyword,
      sort: 'SORT_CREATED_TIME',
      order: 'ORDER_DESC',
      status: ['STATUS_ON_SALE'],
      sizeId: [],
      categoryId: categories || [],
      brandId: [],
      sellerId: [],
      priceMin: priceMin || 0,
      priceMax: 0,
      itemConditionId: conditions,
      // 2 = 送料込み（出品者負担）。これに限定することで表示価格＝総額が確定する
      shippingPayerId: [2],
      shippingFromArea: [],
      shippingMethod: [],
      colorId: [],
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
      shopIds: [],
    },
    defaultDatasets: ['DATASET_TYPE_MERCARI', 'DATASET_TYPE_BEYOND'],
    serviceFrom: 'suruga',
    withItemBrand: true,
    withItemSize: false,
    withItemPromotions: true,
    withItemSizes: true,
    withShopname: false,
    useDynamicAttribute: true,
    withSuggestedItems: true,
    withOfferPricePromotion: true,
    withProductSuggest: true,
    withParentProducts: false,
    withProductArticles: false,
    withSearchConditionId: false,
  };

  const res = await fetch(MERCARI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DPoP': createDpopToken(MERCARI_ENDPOINT, 'POST'),
      'X-Platform': 'web',
      'Accept': '*/*',
      'Accept-Language': 'ja,en;q=0.9',
      'Origin': 'https://jp.mercari.com',
      'Referer': 'https://jp.mercari.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`mercari ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function itemUrl(item) {
  // メルカリShops（BEYOND）の商品は /shops/product/ 配下
  if (item.itemType === 'ITEM_TYPE_BEYOND' || item.itemType === 'ITEM_TYPE_MERCARI_SHOPS') {
    return `https://jp.mercari.com/shops/product/${item.id}`;
  }
  return `https://jp.mercari.com/item/${item.id}`;
}

// ヤフオクの「残り時間」列に合わせて、出品からの経過時間を返す。
// フロント側の並び替え（toMinutes 昇順）にそのまま乗り、新着順で並ぶ。
function relativeTime(created) {
  const createdSec = Number(created);
  if (!createdSec) return '';
  const sec = Math.floor(Date.now() / 1000) - createdSec;
  if (sec < 60) return '1分以内';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  return `${Math.floor(hour / 24)}日前`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const query = req.query || {};
  const modelName = query.model;
  const isRaw = query.raw === '1' || query.raw === 'true';

  try {
    let targets = MODELS;
    if (modelName) {
      targets = MODELS.filter(m => m.name === modelName);
      if (targets.length === 0) {
        return res.status(400).json({
          error: `unknown model: ${modelName}`,
          available: MODELS.map(m => m.name),
        });
      }
    }

    // ?raw=1 … 加工前のレスポンスをそのまま返す（モデル未指定なら先頭モデル）
    if (isRaw) {
      const model = targets[0];
      const { keyword, excludeKeyword } = splitQuery(model);
      const conditions = conditionsFor(model);
      const data = await searchMercari(keyword, excludeKeyword, conditions, model.categories, priceMinFor(model));
      return res.status(200).json({
        model: model.name,
        request: { keyword, excludeKeyword, itemConditionId: conditions, shippingPayerId: [2], categoryId: model.categories || [], priceMin: priceMinFor(model) },
        response: data,
      });
    }

    const results = [];
    const seen = new Set();

    for (const model of targets) {
      try {
        const { keyword, excludeKeyword } = splitQuery(model);
        const data = await searchMercari(keyword, excludeKeyword, conditionsFor(model), model.categories, priceMinFor(model));

        for (const item of (data.items || [])) {
          const link = itemUrl(item);
          if (seen.has(link)) continue;

          const title = item.name || '';
          if (!title) continue;

          const ngWords = (model.excludeJunk
            ? model.excludeWords.concat(NG_WORDS)
            : model.excludeWords).concat(MERCARI_NG_WORDS);
          const excluded = ngWords.some(w => title.toLowerCase().includes(w.toLowerCase()));
          if (excluded) continue;

          seen.add(link);

          const status = (() => {
            if (WORKING_WORDS.some(w => title.includes(w))) return '中古';
            if (JUNK_WORDS.some(w => title.includes(w))) return 'ジャンク';
            // メルカリはジャンク枠が無いので、ワードが無ければ中古扱い
            return '中古';
          })();

          // shippingPayerId=2（送料込み）に限定して検索しているため、表示価格がそのまま総額
          const price = Number(item.price) || 0;
          const finalPrice = price;

          if (model.priceLimits) {
            const limit = model.priceLimits[status];
            if (limit === undefined) continue; // この状態は対象外
            if (finalPrice > limit) continue;  // 上限超過
          }

          // 下限価格チェック（その状態の下限が未設定なら下限なし）
          if (model.priceMins) {
            const min = model.priceMins[status];
            if (min !== undefined && finalPrice < min) continue; // 下限未満
          }

          const conditionId = Number(item.itemConditionId) || null;

          results.push({
            model: model.name,
            title,
            link,
            price,
            finalPrice,
            shippingNote: '送料込み',
            endTime: relativeTime(item.created),
            created: Number(item.created) || null,
            status,
            condition: conditionId ? MERCARI_CONDITIONS[conditionId] : '',
            postage: '送料込み',
            isStore: true, // メルカリの表示価格は常に税込
            priceLimit: model.priceLimits ? model.priceLimits[status] : null,
          });
        }
      } catch (e) {
        console.error(`Error for ${model.name}:`, e.message);
      }
    }

    // 新着順（出品が新しい順）で返す
    results.sort((a, b) => (b.created || 0) - (a.created || 0));

    return res.status(200).json({ items: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
