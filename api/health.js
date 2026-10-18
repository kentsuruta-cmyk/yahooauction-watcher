// 死活チェック。ヤフオク・メルカリ・Upstash Redis がそれぞれ「ちゃんと結果を返すか」を確かめる。
// 外部サイトの仕様変更（2026-10 のヤフオク検索ページ刷新など）で黙って0件になるのを早く見つけるためのもの。
//
//   GET /api/health           … 結果をJSONで返すだけ（正常 200 / 異常 503）
//   GET /api/health?notify=1  … 状態が変わったとき（正常→異常、異常→正常）だけ NOTIFY_WEBHOOK_URL に通知する
//
// Vercel の cron（vercel.json）から1日1回 ?notify=1 で叩かれる。
// 前回の状態は Redis の 'health:last' に置き、壊れている間に毎回同じ通知が飛ばないようにしている。
const { searchYahooAuction } = require('./search');
const { searchMercari } = require('./mercari');
const { notify, webhookConfigured } = require('../lib/notify');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const STATE_KEY = 'health:last';

async function redis(...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('UPSTASH_REDIS_REST_URL / TOKEN が未設定');
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Upstash ${res.status}: ${data.error || '応答が不正'}`);
  return data.result;
}

// 1件でも出品が取れれば正常。どの検索も「必ず何かしら出品がある」ゆるい条件にしてある
const CHECKS = {
  yahoo: async () => {
    const { items } = await searchYahooAuction('ゲームボーイアドバンス 本体', '3,4,5');
    if (!items.length) throw new Error('ヤフオクの検索結果が0件（ページ構造が変わった可能性）');
    return `${items.length}件`;
  },
  mercari: async () => {
    // 7174 = ゲームボーイアドバンス本体カテゴリ、3 = 目立った傷や汚れなし
    const data = await searchMercari('ゲームボーイアドバンス', '', [3], [7174], 0, 0);
    const n = (data.items || []).length;
    if (!n) throw new Error('メルカリの検索結果が0件（APIの仕様が変わった可能性）');
    return `${n}件`;
  },
  redis: async () => {
    const pong = await redis('PING');
    if (pong !== 'PONG') throw new Error(`PING の応答が ${pong}`);
    return 'PONG';
  },
};

const LABELS = { yahoo: 'ヤフオク', mercari: 'メルカリ', redis: 'チェック済み保存（Upstash Redis）' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const query = req.query || {};

  const entries = await Promise.all(Object.entries(CHECKS).map(async ([name, fn]) => {
    const started = Date.now();
    try {
      return [name, { ok: true, detail: await fn(), ms: Date.now() - started }];
    } catch (e) {
      return [name, { ok: false, error: e.message, ms: Date.now() - started }];
    }
  }));
  const checks = Object.fromEntries(entries);
  const ok = Object.values(checks).every(c => c.ok);
  const failing = Object.keys(checks).filter(k => !checks[k].ok).sort().join(',');

  let notified = null;
  if (query.notify === '1') {
    let last = null;
    try { last = await redis('GET', STATE_KEY); } catch (e) { /* Redis が落ちていても通知はする */ }
    if (last !== failing) {
      const text = ok
        ? '✅ 仕入れ監視ツール: 復旧しました（ヤフオク・メルカリとも正常）'
        : '⚠ 仕入れ監視ツールの死活チェックで異常\n' +
          Object.keys(checks).filter(k => !checks[k].ok).map(k => `・${LABELS[k]}: ${checks[k].error}`).join('\n') +
          '\nhttps://yahooauction-watcher.vercel.app/api/health';
      // 初回（記録なし）で正常なら通知しない
      notified = (last === null && ok) ? { sent: false, reason: 'first run' } : await notify(text);
      try { await redis('SET', STATE_KEY, failing); } catch (e) { /* 次回また通知されるだけ */ }
    } else {
      notified = { sent: false, reason: 'unchanged' };
    }
  }

  return res.status(ok ? 200 : 503).json({ ok, checks, webhookConfigured, notified, checkedAt: Date.now() });
};
