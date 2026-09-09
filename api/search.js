const fetch = require('node-fetch');
const cheerio = require('cheerio');

const MODELS = [
  {
    name: 'ゲームボーイ（DMG）',
    query: 'ゲームボーイ DMG 本体 -ジャンク -動作未確認',
    excludeWords: ['カラー', 'ポケット', 'アドバンス', 'GBC', 'GBA', 'ソフト', 'カセット', 'ロム', 'ROM', 'ゲームソフト'],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'ゲームボーイカラー',
    query: 'ゲームボーイカラー 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'ゲームボーイポケット',
    query: 'ゲームボーイポケット 本体 -ジャンク -動作未確認',
    excludeWords: [],
    // 中古のみ・総額6200円以上は対象外。
    // ジャンクの上限を書いていないのは意図的で、ジャンク判定（「現状品」「傷あり」表記を含む）は
    // 価格に関わらず「対象外」として除外される。
    priceLimits: { '中古': 6199 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  // ▼ アドバンス系はジャンクも仕入れ対象なので除外しない（上限価格で絞る）
  {
    name: 'ゲームボーイアドバンス',
    query: 'ゲームボーイアドバンス 本体',
    excludeWords: ['SP'],
    // 総額（落札価格＋送料）で 中古 7200円まで / ジャンク 6200円まで
    // ※下限はメルカリ側のみ。ヤフオクは入札で価格が上がるので現在価格に下限をかけない
    priceLimits: { '中古': 7200, 'ジャンク': 6200 },
  },
  {
    name: 'ゲームボーイアドバンスSP',
    query: 'ゲームボーイアドバンスSP 本体',
    excludeWords: [],
    priceLimits: { '中古': 10500, 'ジャンク': 9500 },
  },
  {
    name: 'DS',
    query: 'ニンテンドーDS 本体 -ジャンク -動作未確認',
    excludeWords: ['Lite', 'DSi', 'LL'],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DS Lite',
    query: 'DS Lite 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DSi',
    query: 'DSi 本体 -ジャンク -動作未確認',
    excludeWords: ['LL'],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DSi LL',
    query: 'DSi LL 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: '3DS',
    query: '3DS 本体 -ジャンク -動作未確認',
    excludeWords: ['LL'],
    // 総額（落札価格＋送料）で11000円まで
    priceLimits: { '中古': 11000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: '3DS LL',
    query: '3DS LL 本体 -ジャンク -動作未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で18000円まで
    priceLimits: { '中古': 18000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 1000',
    query: 'PSP-1000 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 2000',
    query: 'PSP-2000 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 3000',
    query: 'PSP-3000 本体 -ジャンク -動作未確認',
    excludeWords: [],
    priceLimits: null,
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
];

const JUNK_WORDS = ['ジャンク', '動作未確認', '不動品', '動作不良', '現状品', '傷あり'];
const WORKING_WORDS = ['動作品', '動作確認済', '完動品'];

// excludeJunk: true のモデルで、タイトルに含まれていたら除外するワード。
// 検索クエリ側の -ジャンク -動作未確認 で大半は落ちるが、取りこぼしの保険として二重に弾く。
// ※「現状品」「傷あり」は動作不良を意味しないため、ここには入れていない（ジャンク表示は残る）
const NG_WORDS = ['ジャンク', '動作未確認', '不動品', '動作不良'];

// 商品の状態(istatus): 1=未使用 2=中古（すべて） 3=未使用に近い 4=目立った傷や汚れなし
//                      5=やや傷や汚れあり 6=傷や汚れあり 7=全体的に状態が悪い
// ※ 2 は「中古すべて」なので 6・7 も含んでしまう。状態を絞りたいモデルでは 2 を使わない
const SEARCH_TYPES = [
  { status: 'ジャンク', istatus: '3,4,5' },
  { status: '中古', istatus: '2,3' },
];

function parseEndTime(endTimeText) {
  if (!endTimeText) return null;
  const now = new Date();

  const daysMatch = endTimeText.match(/残り(\d+)日/);
  const hoursMatch = endTimeText.match(/残り(\d+)時間/);
  const minutesMatch = endTimeText.match(/残り(\d+)分/);

  if (daysMatch || hoursMatch || minutesMatch) {
    return new Date(now.getTime() + 1000);
  }

  if (endTimeText.includes('終了') || endTimeText.includes('落札')) {
    return new Date(0);
  }

  const dateMatch = endTimeText.match(/(\d+)月(\d+)日\s*(\d+):(\d+)/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1]) - 1;
    const day = parseInt(dateMatch[2]);
    const hour = parseInt(dateMatch[3]);
    const min = parseInt(dateMatch[4]);
    const year = now.getFullYear();
    const endDate = new Date(year, month, day, hour, min);
    if (endDate < now) endDate.setFullYear(year + 1);
    return endDate;
  }

  return null;
}

// 送料を計算する（円）
function calcShipping(postageText) {
  if (!postageText) return { amount: 1000, note: '送料不明（仮1000円）' };
  const text = postageText.trim();

  if (text.includes('無料')) return { amount: 0, note: '送料無料' };
  if (text.includes('着払い')) return { amount: 1000, note: '着払い（仮1000円）' };

  // 具体的な金額が入っている場合（例: 「送料：750円」）
  const numMatch = text.match(/([0-9,]+)\s*円/);
  if (numMatch) {
    const amount = parseInt(numMatch[1].replace(/,/g, ''));
    return { amount, note: `送料${amount}円` };
  }

  // それ以外は不明として仮1000円
  return { amount: 1000, note: '送料不明（仮1000円）' };
}

// 消費税を計算し、最終価格を算出
function calcFinalPrice(priceText, taxLabel) {
  const price = parseInt((priceText || '0').replace(/[^0-9]/g, '')) || 0;
  let taxMultiplier = 1; // デフォルトは税込（個人出品扱い）

  if (taxLabel) {
    if (taxLabel.includes('消費税別')) taxMultiplier = 1.10;
    else if (taxLabel.includes('消費税0円') || taxLabel.includes('消費税込')) taxMultiplier = 1;
  }

  return Math.round(price * taxMultiplier);
}

async function searchYahooAuction(query, istatus) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(query)}&istatus=${istatus}&order=time&f=0x2&ei=UTF-8&tab_ex=commerce`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.9',
    }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const items = [];

  $('li.Product').each((_, el) => {
    const title = $(el).find('.Product__title').text().trim();
    const link = $(el).find('a.Product__titleLink').attr('href') || '';
    // 1出品に .Product__priceValue が複数（現在・即決）あるため .first() で現在価格のみ取る
    // （.text() のままだと「9,000円9,000円」が連結され 90009000 円になる）
    const priceText = $(el).find('.Product__priceValue').first().text().trim();
    const endTimeText = $(el).find('.Product__time').text().trim();
    const postageText = $(el).find('.Product__postage').text().trim();
    const priceLabel = $(el).find('.Product__priceValue').first().parent().text();
    const isStore = priceLabel.includes('税込') || priceLabel.includes('消費税') || $(el).find('.Product__store').length > 0;

    if (!title || !link) return;

    const endTime = parseEndTime(endTimeText);
    const now = new Date();
    if (endTime && endTime <= now) return;
    if (endTimeText.includes('終了') || endTimeText.includes('落札済み')) return;

    items.push({
      title,
      link,
      priceText,
      endTime: endTimeText,
      postageText: postageText || '',
      isStore,
      taxLabel: priceLabel,
    });
  });

  return items;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const results = [];
    const seen = new Set();

    for (const model of MODELS) {
      for (const searchType of (model.searchTypes || SEARCH_TYPES)) {
        try {
          const items = await searchYahooAuction(model.query, searchType.istatus);
          for (const item of items) {
            if (seen.has(item.link)) continue;

            const ngWords = model.excludeJunk
              ? model.excludeWords.concat(NG_WORDS)
              : model.excludeWords;
            const excluded = ngWords.some(w =>
              item.title.toLowerCase().includes(w.toLowerCase())
            );
            if (excluded) continue;

            seen.add(item.link);

            const status = (() => {
              if (WORKING_WORDS.some(w => item.title.includes(w))) return '中古';
              if (JUNK_WORDS.some(w => item.title.includes(w))) return 'ジャンク';
              // ジャンクを除外しているモデルは、どの検索枠で拾ったかに関わらず中古扱い
              // （旧実装はジャンク枠でヒットしただけの正常な出品まで「ジャンク」表示にしていた）
              if (model.excludeJunk) return '中古';
              return searchType.status;
            })();

            const basePrice = calcFinalPrice(item.priceText, item.taxLabel);
            const shipping = calcShipping(item.postageText);
            const finalPrice = basePrice + shipping.amount;

            // 上限価格チェック
            if (model.priceLimits) {
              const limit = model.priceLimits[status];
              if (limit === undefined) continue; // この状態は対象外
              if (finalPrice > limit) continue; // 上限超過
            }

            // 下限価格チェック（その状態の下限が未設定なら下限なし）
            // ※現状ヤフオク側で priceMins を使っているモデルは無い（入札で価格が上がるため）。
            //   必要になったら MODELS に priceMins を書けばそのまま効く
            if (model.priceMins) {
              const min = model.priceMins[status];
              if (min !== undefined && finalPrice < min) continue; // 下限未満
            }

            results.push({
              model: model.name,
              title: item.title,
              link: item.link,
              price: basePrice,
              finalPrice,
              shippingNote: shipping.note,
              endTime: item.endTime,
              status,
              postage: item.postageText || '送料不明',
              isStore: item.isStore,
              priceLimit: model.priceLimits ? model.priceLimits[status] : null,
            });
          }
        } catch (e) {
          console.error(`Error for ${model.query} / istatus=${searchType.istatus}:`, e.message);
        }
      }
    }

    return res.status(200).json({ items: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
