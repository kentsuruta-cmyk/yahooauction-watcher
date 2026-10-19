// ゲームボーイアドバンスSP の新着通知（LINE）。GitHub Actions から5分おきに叩かれる。
//
// 1. ヤフオク・メルカリで、画面と同じ条件（上限価格など）で GBA SP を探す
// 2. いますぐ買えるもの（定額・即決価格あり）だけを残す。オークションは値段が決まらないので対象外
// 3. 初めて見る出品だけ、商品ページの説明文を読みに行く
// 4. 説明文とタイトルに「基盤なし」などの語が無ければ、LINE に通知する
//
// 購入は自動では行わない（ヤフオク・メルカリとも購入の公式APIが無く、ログインした状態の自動操作は
// 規約違反になりうるため）。通知のリンクから、自分で開いて買う。
//
//   GET /api/sp-alert          … 確認して通知する
//   GET /api/sp-alert?dry=1    … 通知せず、判定結果だけ返す（見た記録も付けない）
//   GET /api/sp-alert?test=1   … LINE にテストメッセージを1通送る
const yahooSearch = require('./search');
const mercariHandler = require('./mercari');
const { fetchItem } = require('../lib/mercari-client');
const { notify, notifyLine, lineConfigured } = require('../lib/notify');
const { redisCommand } = require('../lib/watch-store');

const MODEL = 'ゲームボーイアドバンスSP';
const CHECK_TOKEN = process.env.WATCH_CHECK_TOKEN;
const SEEN_KEY = 'spalert:seen';          // Set: 見たことのある出品（リンク）
const SEEN_TTL_SEC = 60 * 24 * 60 * 60;   // 60日で忘れる（Set ごと延長し続ける）
const MAX_NOTIFY_PER_RUN = 5;             // 1回に送る通知の上限（残りは次の回に回す）

// 説明文・タイトルにこの語があれば通知しない（「基盤」と「基板」の表記ゆれも含める）
const NG_DESC_WORDS = [
  '基盤なし', '基盤無し', '基盤欠品', '基盤無', '基板なし', '基板無し', '基板欠品', '基板無',
  '中身なし', '中身無し', '外装のみ', 'シェルのみ', 'ガワのみ', 'ハウジングのみ', '部品取り',
];

function norm(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ''); }
function ngWordIn(text) {
  const t = norm(text);
  return NG_DESC_WORDS.find((w) => t.includes(norm(w))) || null;
}
function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

// 別のAPIの処理を、この中からそのまま呼ぶ（画面と同じ条件で絞った結果を使うため）
function callHandler(handler, query) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) {
        if (this.statusCode >= 400) reject(new Error(body.error || 'HTTP ' + this.statusCode));
        else resolve(body);
        return this;
      },
    };
    Promise.resolve(handler({ query, headers: {} }, res)).catch(reject);
  });
}

// 説明文の候補の文字を、__NEXT_DATA__ の中から探す（ヤフオクのページ構造に強く依存しないよう、名前で探す）
function findText(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return '';
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (keys.includes(k) && typeof v === 'string' && v.length > 10) return v;
  }
  for (const k of Object.keys(obj)) {
    const found = findText(obj[k], keys, depth + 1);
    if (found) return found;
  }
  return '';
}
function stripHtml(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

// ヤフオクの商品ページの説明文。読めなかったら、ページ全体の文字で判定する
async function yahooDescription(link) {
  const res = await fetch(link, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`ヤフオクの商品ページが HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const text = findText(JSON.parse(m[1]), ['description', 'itemDescription', 'descriptionHtml', 'body']);
      if (text) return { text: stripHtml(text), whole: false };
    } catch (e) { /* 読めなければ下でページ全体を使う */ }
  }
  return { text: stripHtml(html), whole: true };
}

async function mercariDescription(link) {
  const id = link.split('/').pop();
  const item = await fetchItem(id);
  if (item.status && item.status !== 'on_sale') return { text: '', soldOut: true };
  return { text: String(item.description || ''), whole: false };
}

// いますぐ買える値段（送料込み）。買えないもの（オークションだけの出品）は null
function buyNowTotal(item, source) {
  if (source === 'mercari') return item.isAuction ? null : item.finalPrice;
  if (!item.isAuction) return item.finalPrice; // 定額（フリマ）出品
  if (item.buyNowPrice) return item.buyNowPrice + (item.finalPrice - item.price); // 即決価格＋送料
  return null;
}

function message(c) {
  return [
    `🎮 GBA SP 新着（${c.sourceLabel}）`,
    c.title,
    `${yen(c.total)}（送料込み・上限 ${yen(c.limit)}）${c.status ? '｜' + c.status : ''}`,
    c.descNote,
    c.link,
    '※買う前に写真と説明文を必ず確認してください',
  ].filter(Boolean).join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const query = req.query || {};
  if (CHECK_TOKEN && query.token !== CHECK_TOKEN && req.headers['x-watch-token'] !== CHECK_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const send = (text) => (lineConfigured ? notifyLine(text) : notify(text));

  if (query.test === '1') {
    const result = await send('✅ 通知テスト\nGBA SP の新着通知はここに届きます。');
    return res.status(200).json({ test: true, lineConfigured, result });
  }
  const dryRun = query.dry === '1';

  try {
    const [y, m] = await Promise.allSettled([
      callHandler(yahooSearch, { model: MODEL }),
      callHandler(mercariHandler, { model: MODEL }),
    ]);
    const errors = [];
    const candidates = [];
    const add = (r, source, sourceLabel) => {
      if (r.status === 'rejected') { errors.push(`${sourceLabel}: ${r.reason.message}`); return; }
      for (const it of r.value.items || []) {
        const total = buyNowTotal(it, source);
        if (total == null || (it.priceLimit && total > it.priceLimit)) continue;
        candidates.push({ source, sourceLabel, title: it.title, link: it.link, total, limit: it.priceLimit, status: it.status });
      }
    };
    add(y, 'yahoo', 'ヤフオク');
    add(m, 'mercari', 'メルカリ');

    const seenList = (await redisCommand('SMEMBERS', SEEN_KEY)) || [];
    const seen = new Set(seenList);
    const fresh = candidates.filter((c) => !seen.has(c.link));
    const report = [];
    let sent = 0;

    for (const c of fresh) {
      if (sent >= MAX_NOTIFY_PER_RUN) { report.push({ link: c.link, action: 'next-run' }); continue; }
      let verdict;
      const titleNg = ngWordIn(c.title);
      if (titleNg) verdict = { action: 'skip', reason: `タイトルに「${titleNg}」` };
      else {
        try {
          const d = c.source === 'mercari' ? await mercariDescription(c.link) : await yahooDescription(c.link);
          if (d.soldOut) verdict = { action: 'skip', reason: '売り切れ' };
          else {
            const ng = ngWordIn(d.text);
            if (ng) verdict = { action: 'skip', reason: `説明文に「${ng}」` };
            else {
              c.descNote = d.whole ? '説明文：「基盤なし」なし（ページ全体で確認）' : '説明文：「基盤なし」なし';
              verdict = { action: 'notify' };
            }
          }
        } catch (e) {
          // 説明文が読めなかったときも、見逃さないよう注意書き付きで知らせる
          c.descNote = '⚠ 説明文を読めませんでした（自分で確認してください）';
          verdict = { action: 'notify', warn: e.message };
        }
      }
      if (verdict.action === 'notify') {
        const result = dryRun ? { sent: false, reason: 'dry-run' } : await send(message(c));
        if (!dryRun && !result.sent) { report.push({ link: c.link, action: 'notify-failed', result }); continue; } // 次の回にもう一度送る
        sent++;
        report.push({ link: c.link, title: c.title, total: c.total, action: 'notified', result, message: dryRun ? message(c) : undefined, warn: verdict.warn });
      } else {
        report.push({ link: c.link, title: c.title, action: 'skipped', reason: verdict.reason });
      }
      if (!dryRun) await redisCommand('SADD', SEEN_KEY, c.link);
    }
    if (!dryRun && fresh.length) await redisCommand('EXPIRE', SEEN_KEY, SEEN_TTL_SEC);

    return res.status(200).json({
      checkedAt: new Date().toISOString(), dryRun, lineConfigured,
      candidates: candidates.length, fresh: fresh.length, notified: sent, errors, report,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports._test = { ngWordIn, buyNowTotal, findText };
