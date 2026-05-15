const fetch = require('node-fetch');
const xml2js = require('xml2js');

const MODELS = [
  {
    name: 'ゲームボーイカラー',
    keywords: ['ゲームボーイカラー', 'GBC'],
    suffix: '本体',
    junkOk: true,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: [],
  },
  {
    name: 'ゲームボーイポケット',
    keywords: ['ゲームボーイポケット', 'GBP'],
    suffix: '本体',
    junkOk: true,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: [],
  },
  {
    name: 'ゲームボーイアドバンス',
    keywords: ['ゲームボーイアドバンス', 'GBA'],
    suffix: '本体',
    junkOk: true,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['SP', 'アドバンスSP'],
  },
  {
    name: 'ゲームボーイアドバンスSP',
    keywords: ['ゲームボーイアドバンス SP', 'GBA SP'],
    suffix: '本体',
    junkOk: true,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: [],
  },
  {
    name: 'DS',
    keywords: ['初代DS', 'ニンテンドーDS'],
    suffix: '本体',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['Lite', 'DSi', 'LL'],
  },
  {
    name: 'DS Lite',
    keywords: ['DS Lite', 'DSLite'],
    suffix: '本体',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['ヤケ', '黄ばみ', '黄変'],
  },
  {
    name: 'DSi',
    keywords: ['DSi'],
    suffix: '本体',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['LL'],
  },
  {
    name: 'DSi LL',
    keywords: ['DSi LL', 'DSiLL'],
    suffix: '本体',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: [],
  },
  {
    name: '3DS',
    keywords: ['3DS'],
    suffix: '本体',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['LL'],
  },
  {
    name: '3DS LL',
    keywords: ['3DS LL', '3DSLL'],
    suffix: '本体',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: [],
  },
  {
    name: 'PSP 1000',
    keywords: ['PSP1000', 'PSP-1000', 'PSP 1000'],
    suffix: '',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['ヤケ', '黄ばみ', '黄変'],
  },
  {
    name: 'PSP 2000',
    keywords: ['PSP2000', 'PSP-2000', 'PSP 2000'],
    suffix: '',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['ヤケ', '黄ばみ', '黄変'],
  },
  {
    name: 'PSP 3000',
    keywords: ['PSP3000', 'PSP-3000', 'PSP 3000'],
    suffix: '',
    junkOk: false,
    junkWords: ['ジャンク', '動作未確認', '不動品', '動作不良'],
    usedWords: ['動作品', '稼働品', '動作確認済', '動作確認済み'],
    excludeWords: ['ヤケ', '黄ばみ', '黄変'],
  },
];

function judgeItem(title, description, model) {
  const text = (title + ' ' + (description || '')).toLowerCase();

  // Check exclude words
  for (const word of model.excludeWords) {
    if (text.includes(word.toLowerCase())) return null;
  }

  // Check junk
  const isJunk = model.junkWords.some(w => text.includes(w.toLowerCase()));
  if (isJunk && !model.junkOk) return null;
  if (isJunk) return 'ジャンク';

  // Check used
  const isUsed = model.usedWords.some(w => text.includes(w.toLowerCase()));
  if (isUsed) return '中古';

  return '要確認';
}

async function fetchRSS(keyword) {
  const url = `https://auctions.yahoo.co.jp/rss/search?p=${encodeURIComponent(keyword)}&auccat=0&va=${encodeURIComponent(keyword)}&vo=&ve=&fixed=0&new=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const xml = await res.text();
  const parsed = await xml2js.parseStringPromise(xml);
  const items = parsed?.rss?.channel?.[0]?.item || [];
  return items;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const results = [];
    const seen = new Set();

    for (const model of MODELS) {
      for (const keyword of model.keywords) {
        const query = model.suffix ? `${keyword} ${model.suffix}` : keyword;
        try {
          const items = await fetchRSS(query);
          for (const item of items) {
            const title = item.title?.[0] || '';
            const link = item.link?.[0] || '';
            const price = item['auction:current_price']?.[0] || item['auc:currentprice']?.[0] || '不明';
            const endTime = item['auction:end_time']?.[0] || item['auc:endtime']?.[0] || '';
            const description = item.description?.[0] || '';

            if (seen.has(link)) continue;
            seen.add(link);

            const status = judgeItem(title, description, model);
            if (status === null) continue;

            results.push({
              model: model.name,
              title,
              link,
              price,
              endTime,
              status,
            });
          }
        } catch (e) {
          console.error(`RSS fetch error for ${query}:`, e.message);
        }
      }
    }

    return res.status(200).json({ items: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
