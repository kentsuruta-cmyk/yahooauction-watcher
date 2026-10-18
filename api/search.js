
const MODELS = [
  {
    name: 'ゲームボーイ（DMG）',
    query: 'ゲームボーイ DMG 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: ['カラー', 'ポケット', 'アドバンス', 'GBC', 'GBA', 'ソフト', 'カセット', 'ロム', 'ROM', 'ゲームソフト'],
    // 総額（落札価格＋送料）で6000円まで
    priceLimits: { '中古': 6000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'ゲームボーイカラー',
    query: 'ゲームボーイカラー 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で3800円まで
    priceLimits: { '中古': 3800 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'ゲームボーイポケット',
    query: 'ゲームボーイポケット 本体 -ジャンク -動作未確認 -通電未確認',
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
    // 総額（落札価格＋送料）で9800円まで。下限なし（入札で価格が上がるため）
    priceLimits: { '中古': 9800, 'ジャンク': 9800 },
  },
  {
    name: 'DS',
    query: 'ニンテンドーDS 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: ['Lite', 'DSi', 'LL'],
    // 総額（落札価格＋送料）で3800円まで
    priceLimits: { '中古': 3800 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DS Lite',
    query: 'DS Lite 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で4500円まで
    priceLimits: { '中古': 4500 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DSi',
    query: 'DSi 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: ['LL'],
    // 総額（落札価格＋送料）で3600円まで
    priceLimits: { '中古': 3600 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'DSi LL',
    query: 'DSi LL 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で7700円まで
    priceLimits: { '中古': 7700 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: '3DS',
    query: '3DS 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: ['LL'],
    // 総額（落札価格＋送料）で11000円まで
    priceLimits: { '中古': 11000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: '3DS LL',
    query: '3DS LL 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で18000円まで
    priceLimits: { '中古': 18000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 1000',
    query: 'PSP-1000 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で6000円まで
    priceLimits: { '中古': 6000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 2000',
    query: 'PSP-2000 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で8000円まで
    priceLimits: { '中古': 8000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
  {
    name: 'PSP 3000',
    query: 'PSP-3000 本体 -ジャンク -動作未確認 -通電未確認',
    excludeWords: [],
    // 総額（落札価格＋送料）で9000円まで
    priceLimits: { '中古': 9000 },
    excludeJunk: true,
    // 状態は「やや傷や汚れあり」まで（6:傷や汚れあり / 7:全体的に状態が悪い は除外）
    searchTypes: [{ status: '中古', istatus: '3,4,5' }],
  },
];

const JUNK_WORDS = ['ジャンク', '動作未確認', '通電未確認', '不動品', '動作不良', '現状品', '傷あり'];
const WORKING_WORDS = ['動作品', '動作確認済', '完動品'];

// excludeJunk: true のモデルで、タイトルに含まれていたら除外するワード。
// 検索クエリ側の -ジャンク -動作未確認 -通電未確認 で大半は落ちるが、取りこぼしの保険として二重に弾く。
// ※「現状品」「傷あり」は動作不良を意味しないため、ここには入れていない（ジャンク表示は残る）
const NG_WORDS = ['ジャンク', '動作未確認', '通電未確認', '不動品', '動作不良'];

// 商品の状態(istatus): 1=未使用 2=中古（すべて） 3=未使用に近い 4=目立った傷や汚れなし
//                      5=やや傷や汚れあり 6=傷や汚れあり 7=全体的に状態が悪い
// ※ 2 は「中古すべて」なので 6・7 も含んでしまう。状態を絞りたいモデルでは 2 を使わない
const SEARCH_TYPES = [
  { status: 'ジャンク', istatus: '3,4,5' },
  { status: '中古', istatus: '2,3' },
];

// 送料（円）と表示用の文言。検索結果JSONの送料欄から決める
// （2026-10-18 に画面の「＋送料720円」「送料未定」表示と突き合わせて確認）
function shippingOf(item) {
  if (item.isFreeShipping) return { amount: 0, note: '送料無料', postage: '送料無料' };
  const fee = Number(item.currentPriceShippingFee);
  if (item.hasShippingFee && Number.isFinite(fee) && item.currentPriceShippingFee !== null) {
    return { amount: fee, note: `送料${fee}円`, postage: `送料${fee.toLocaleString('ja-JP')}円` };
  }
  if (item.shippingFeeSetTiming === 'ARRIVAL') return { amount: 1000, note: '着払い（仮1000円）', postage: '着払い' };
  return { amount: 1000, note: '送料不明（仮1000円）', postage: '送料未定' };
}

// ヤフオクのページ構造が変わって読めなくなったときに投げるエラー。
// 「0件でした」と区別して、画面と死活チェックに原因をそのまま出すために分けている
class YahooLayoutError extends Error {}

async function searchYahooAuction(query, istatus) {
  const url = `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(query)}&istatus=${istatus}&ei=UTF-8`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    }
  });
  // ブロック時のエラーページ（HTTP 500）を「0件」と取り違えないよう、失敗は失敗として上げる
  if (!res.ok) throw new Error(`ヤフオクがHTTP ${res.status}を返しました（一時的なブロックの可能性）`);
  const html = await res.text();

  // 2026-10 のリニューアルで検索ページは Next.js 製になり、一覧はブラウザ側で描画されるようになった
  // （HTMLに li.Product などの要素はもう無い）。代わりに埋め込みの __NEXT_DATA__ に
  // 出品データがそのまま入っているので、CSSクラスではなくこのJSONを読む。
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new YahooLayoutError('ヤフオクの検索ページに __NEXT_DATA__ が見つかりません（ページ構造が変わった可能性）');
  let listing;
  try {
    listing = JSON.parse(m[1]).props.pageProps.initialState.search.items.listing;
  } catch (e) {
    throw new YahooLayoutError(`ヤフオクの検索データの形が変わりました（${e.message}）`);
  }
  if (!listing || !Array.isArray(listing.items)) {
    throw new YahooLayoutError('ヤフオクの検索データに出品一覧（listing.items）がありません（ページ構造が変わった可能性）');
  }

  const items = [];
  for (const it of listing.items) {
    if (!it || !it.auctionId || !it.title) continue;
    // 終了時刻（ISO・日本時間）。これを正として終了済みを落とす
    const endAt = it.endTime ? Date.parse(it.endTime) || null : null;
    if (endAt && endAt <= Date.now()) continue;
    const seller = it.seller || {};
    items.push({
      title: it.title,
      link: `https://auctions.yahoo.co.jp/jp/auction/${it.auctionId}`,
      // price は画面の「現在 ◯円」と同じ（ストアは税込）
      price: Number(it.price) || 0,
      endAt,
      shipping: shippingOf(it),
      isStore: !!seller.isStore,
      isAuction: !it.isFixedPrice,
      bidCount: Number.isFinite(it.bidCount) ? it.bidCount : null,
      buyNowPrice: Number(it.buyNowPrice) || null,
    });
  }
  return { items, total: listing.totalResultsAvailable };
}

// 1回の検索で全機種を回す。失敗した検索は errors に積み、画面に原因を出せるようにする
async function collect() {
  const results = [];
  const errors = [];
  const seen = new Set();
  let searches = 0;
  for (const model of MODELS) {
    for (const searchType of (model.searchTypes || SEARCH_TYPES)) {
      searches++;
      try {
        const { items } = await searchYahooAuction(model.query, searchType.istatus);
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
          const basePrice = item.price;
          const shipping = item.shipping;
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
            endTime: '',
            // 終了時刻（epochミリ秒）。画面側で残り時間を刻み、終了した行を自動で消すのに使う
            endAt: item.endAt,
            status,
            postage: shipping.postage,
            isStore: item.isStore,
            isAuction: item.isAuction,
            bidCount: item.bidCount,
            buyNowPrice: item.buyNowPrice,
            priceLimit: model.priceLimits ? model.priceLimits[status] : null,
          });
        }
      } catch (e) {
        console.error(`Error for ${model.query} / istatus=${searchType.istatus}:`, e.message);
        errors.push({ model: model.name, istatus: searchType.istatus, message: e.message, layout: e instanceof YahooLayoutError });
      }
    }
  }
  return { results, errors, searches };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // 毎回かならず取り直す（ブラウザやCDNに古い一覧を持たせない）
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const { results, errors, searches } = await collect();
    // 全滅は「0件」ではなく故障として返す（以前はページ構造の変更で0件のまま気付けなかった）
    if (errors.length === searches) {
      return res.status(502).json({ error: `ヤフオクの検索がすべて失敗しました: ${errors[0].message}`, errors });
    }
    return res.status(200).json({ items: results, errors, fetchedAt: Date.now() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports.searchYahooAuction = searchYahooAuction;
