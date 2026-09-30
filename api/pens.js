const fetch = require('node-fetch');
const cheerio = require('cheerio');

// ▼ 設定。数字を書き換えるだけで、全型番の上限価格が変わる
const PEN_CONFIG = {
  usdJpy: 150,        // 為替レート（手で更新する）
  feeRate: 0.17,      // 手数料率：eBay 11.5% + Promoted Listing 3% + Payoneer 2% + 予備 0.5%
  shippingJpy: 3500,  // 送料（FedEx・送料無料で出品する前提で自分が負担）
  profitRate: 0.2,    // 目標利益率（仕入れ値に対して20%以上残るものだけ出す）
  minBudget: 5000,    // これより安い出品は出さない（部品取り・訳あり品の除外）
  maxBudget: 40000,   // 仕入れ予算の上限（円）
};

// ▼ 監視する型番。eBayで売れた価格（ドル）を ebayUsd に書けば、上限価格は自動で決まる
//   mustWords : 内側の配列のどれか1つをタイトルに含むものだけ残す（型番違いを弾く）
//   excludeWords : タイトルに含まれていたら出さない
const PEN_MODELS = [
  {
    name: 'セーラー キングオブペン',
    query: 'セーラー キングオブペン 万年筆',
    mustWords: [['キングオブペン', 'KING OF PEN', 'キング・オブ・ペン']],
    excludeWords: ['ボールペン', 'ペンシル'],
    ebayUsd: 850, // 2026/9/30 売却（21K M、箱・保証書・コンバーター付き）
  },
  {
    name: 'セーラー 1911 14K',
    query: 'セーラー 万年筆 14K',
    mustWords: [['1911', 'プロフィット', 'PROFIT', 'プロフェッショナルギア']],
    excludeWords: ['21K', '21金', 'キングオブペン', 'ラージ', 'ボールペン', 'ペンシル'],
    ebayUsd: 139.99, // 2026/9/29 売却（14K H-MF、箱付き）
  },
];

// 全型番に共通の除外ワード（まとめ売り・部品・付属品だけの出品）
const COMMON_EXCLUDE = [
  'まとめ', '大量', 'セット売り', '本セット', 'ジャンク', '部品取り', 'ペン先なし',
  'キャップのみ', '軸のみ', '箱のみ', '空箱', 'インクのみ', '替芯',
];

const GOLD_PATTERNS = [
  { re: /(?:^|[^0-9])(14|18|21)\s*(?:K|金)/g, pick: m => m[1] + 'K' },
  { re: /K\s*(14|18|21)(?![0-9])/g, pick: m => m[1] + 'K' },
  { re: /(?:^|[^0-9])585(?![0-9])/g, pick: () => '14K' },
  { re: /(?:^|[^0-9])750(?![0-9])/g, pick: () => '18K' },
];

const ACCESSORIES = [
  { label: '箱', words: ['箱', 'ケース付'], deny: ['箱なし', '箱無し', '箱無', '箱欠'] },
  { label: '保証書', words: ['保証書'], deny: ['保証書なし', '保証書無し'] },
  { label: '説明書', words: ['説明書'], deny: ['説明書なし', '説明書無し'] },
  { label: 'コンバーター', words: ['コンバーター', 'コンバータ', 'CONVERTER'], deny: ['コンバーターなし', 'コンバーター無し'] },
];

const UNUSED_WORDS = ['未使用', '新品', 'デッドストック'];

// 全角・半角、大文字・小文字の違いをなくしてから比べる（「１４ｋ」→「14K」）
function norm(s) {
  return String(s || '').normalize('NFKC').toUpperCase();
}

function includesAny(text, words) {
  return words.some(w => text.includes(norm(w)));
}

function goldMarks(title) {
  const t = norm(title);
  const marks = new Set();
  for (const { re, pick } of GOLD_PATTERNS) {
    for (const m of t.matchAll(re)) marks.add(pick(m));
  }
  return ['14K', '18K', '21K'].filter(k => marks.has(k));
}

function accessories(title) {
  const t = norm(title);
  return ACCESSORIES
    .filter(a => includesAny(t, a.words) && !includesAny(t, a.deny))
    .map(a => a.label);
}

// eBayの売値から、手取りと上限価格を出す
function limitsFor(model) {
  const net = Math.round(
    model.ebayUsd * PEN_CONFIG.usdJpy * (1 - PEN_CONFIG.feeRate) - PEN_CONFIG.shippingJpy
  );
  const calcLimit = Math.floor(net / (1 + PEN_CONFIG.profitRate));
  return { net, calcLimit, limit: Math.min(calcLimit, PEN_CONFIG.maxBudget) };
}

// 除外・型番チェック。残すなら true
function matchesModel(title, model) {
  const t = norm(title);
  if (includesAny(t, COMMON_EXCLUDE)) return false;
  if (includesAny(t, model.excludeWords || [])) return false;
  for (const group of model.mustWords || []) {
    if (!includesAny(t, group)) return false;
  }
  return true;
}

// 送料を計算する（円）。api/search.js と同じ考え方
function calcShipping(postageText) {
  if (!postageText) return { amount: 1000, note: '送料不明（仮1000円）' };
  const text = postageText.trim();
  if (text.includes('無料')) return { amount: 0, note: '送料無料' };
  if (text.includes('着払い')) return { amount: 1000, note: '着払い（仮1000円）' };
  const numMatch = text.match(/([0-9,]+)\s*円/);
  if (numMatch) {
    const amount = parseInt(numMatch[1].replace(/,/g, ''), 10);
    return { amount, note: `送料${amount}円` };
  }
  return { amount: 1000, note: '送料不明（仮1000円）' };
}

function calcFinalPrice(priceText, taxLabel) {
  const price = parseInt((priceText || '0').replace(/[^0-9]/g, ''), 10) || 0;
  const taxMultiplier = taxLabel && taxLabel.includes('消費税別') ? 1.10 : 1;
  return Math.round(price * taxMultiplier);
}

// 状態（istatus）では絞らない。万年筆は「現状品」でもペン先が無事なことが多いため
async function searchYahooAuction(query) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(query)}&order=time&f=0x2&ei=UTF-8&tab_ex=commerce`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  return parseSearchHtml(await res.text());
}

function parseSearchHtml(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('li.Product').each((_, el) => {
    const title = $(el).find('.Product__title').text().trim();
    const link = $(el).find('a.Product__titleLink').attr('href') || '';
    const priceText = $(el).find('.Product__priceValue').first().text().trim();
    const endTimeText = $(el).find('.Product__time').text().trim();
    const postageText = $(el).find('.Product__postage').text().trim();
    const priceLabel = $(el).find('.Product__priceValue').first().parent().text();
    const isStore = priceLabel.includes('税込') || priceLabel.includes('消費税') || $(el).find('.Product__store').length > 0;
    const labelTexts = $(el).find('.Product__label').map((_, l) => $(l).text().trim()).get();
    const isAuction = labelTexts.includes('現在') || !!endTimeText;
    const bidCount = parseInt(($(el).find('.Product__bid').first().text().match(/\d+/) || [])[0], 10);
    const buyNowText = labelTexts.includes('即決')
      ? $(el).find('.Product__priceValue').eq(1).text().trim()
      : '';

    if (!title || !link) return;
    if (endTimeText.includes('終了') || endTimeText.includes('落札済み')) return;

    items.push({
      title, link, priceText, endTime: endTimeText, postageText, isStore,
      taxLabel: priceLabel, isAuction,
      bidCount: Number.isNaN(bidCount) ? null : bidCount,
      buyNowText,
    });
  });
  return items;
}

// 1件の出品を判定して、表示用の形にする。対象外なら null
function evaluate(item, model) {
  if (!matchesModel(item.title, model)) return null;

  const { net, calcLimit, limit } = limitsFor(model);
  const basePrice = calcFinalPrice(item.priceText, item.taxLabel);
  const shipping = calcShipping(item.postageText);
  const finalPrice = basePrice + shipping.amount;

  if (finalPrice < PEN_CONFIG.minBudget) return null;
  if (finalPrice > limit) return null;

  const isUnused = includesAny(norm(item.title), UNUSED_WORDS);
  return {
    model: model.name,
    title: item.title,
    link: item.link,
    price: basePrice,
    finalPrice,
    shippingNote: shipping.note,
    postage: item.postageText || '送料不明',
    endTime: item.endTime,
    status: isUnused ? '未使用' : '中古',
    isStore: item.isStore,
    isAuction: item.isAuction,
    bidCount: item.bidCount,
    buyNowPrice: item.buyNowText
      ? parseInt(item.buyNowText.replace(/[^0-9]/g, ''), 10) || null
      : null,
    goldMarks: goldMarks(item.title),
    accessories: accessories(item.title),
    isUnused,
    ebayUsd: model.ebayUsd,
    netJpy: net,
    calcLimit,
    priceLimit: limit,
    expectedProfit: net - finalPrice,
  };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const results = [];
    const seen = new Set();
    for (const model of PEN_MODELS) {
      try {
        const items = await searchYahooAuction(model.query);
        for (const item of items) {
          if (seen.has(item.link)) continue;
          const row = evaluate(item, model);
          if (!row) continue;
          seen.add(item.link);
          results.push(row);
        }
      } catch (e) {
        console.error(`Error for ${model.query}:`, e.message);
      }
    }
    results.sort((a, b) => b.expectedProfit - a.expectedProfit);
    return res.status(200).json({
      items: results,
      config: PEN_CONFIG,
      models: PEN_MODELS.map(m => ({ name: m.name, ebayUsd: m.ebayUsd, ...limitsFor(m) })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
// テスト用（Vercel の動作には影響しない）
module.exports._test = { norm, goldMarks, accessories, limitsFor, matchesModel, evaluate, parseSearchHtml, PEN_MODELS, PEN_CONFIG };
