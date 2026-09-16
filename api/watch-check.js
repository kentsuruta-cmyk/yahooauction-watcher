// 監視中のメルカリオークションを見に行き、終了間際になったら通知する。
// GitHub Actions（.github/workflows/auction-watch.yml）から5分おきに叩かれる想定。
//
// メルカリには代理入札（上限を預けて自動で競る仕組み）が無く、入札の取り消しもできない。
// なので「自動で入札する」のではなく「終了前に必ず気付ける」ところまでを機械の仕事にしている。
const { fetchItem, normalizeAuction } = require('../lib/mercari-client');
const { readAll, writeEntry, removeEntry } = require('../lib/watch-store');

// 残り何分の時点で通知するか。cron が5分間隔なので、実際は少し手前で飛ぶ。
const THRESHOLDS = [60, 15, 5];

const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;
const CHECK_TOKEN = process.env.WATCH_CHECK_TOKEN;

function yen(n) {
  return '¥' + Number(n || 0).toLocaleString('ja-JP');
}

// 終了予定時刻を日本時間で「9/17 20:56」の形にする
function jst(epochSec) {
  if (!epochSec) return '不明';
  const d = new Date(epochSec * 1000);
  const p = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return p;
}

// Discord / Slack / ntfy のどれでも同じ呼び方で飛ばせるようにする
async function notify(text) {
  if (!WEBHOOK_URL) return { sent: false, reason: 'NOTIFY_WEBHOOK_URL not set' };

  let init;
  if (WEBHOOK_URL.includes('ntfy.sh')) {
    init = { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text };
  } else {
    // Discord は content、Slack は text を読む。両方入れておけばどちらでも通る
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, text }),
    };
  }

  const res = await fetch(WEBHOOK_URL, init);
  if (!res.ok) {
    const body = await res.text();
    return { sent: false, reason: `${res.status}: ${body.slice(0, 200)}` };
  }
  return { sent: true };
}

function buildMessage(kind, entry, auction, minutesLeft) {
  const head = {
    soon: `🔔 終了まで約${minutesLeft}分`,
    over: '🚫 上限超過（監視を解除しました）',
    ended: '🏁 終了しました（監視を解除しました）',
  }[kind];

  const lines = [
    `${head}${entry.model ? ' ｜ ' + entry.model : ''}`,
    entry.title,
    `現在 ${yen(auction.highestBid)} / 上限 ${yen(entry.maxPrice)}（入札 ${auction.totalBids}件）`,
    `終了予定 ${jst(auction.endTime)}`,
    entry.url,
  ];

  if (kind === 'soon') {
    lines.push('※終了間際の入札で終了予定時刻は延長されます');
  }
  return lines.join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const query = req.query || {};

  // トークンを設定している場合だけ認証する（未設定なら誰でも叩けるが、実害のない読み取り処理）
  if (CHECK_TOKEN && query.token !== CHECK_TOKEN && req.headers['x-watch-token'] !== CHECK_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // ?dry=1 … 通知を飛ばさずに判定結果だけ返す（動作確認用）
  const dryRun = query.dry === '1' || query.dry === 'true';

  try {
    const watch = await readAll();
    const ids = Object.keys(watch);
    const now = Math.floor(Date.now() / 1000);
    const report = [];

    for (const id of ids) {
      const entry = watch[id];
      try {
        const item = await fetchItem(id);
        const auction = normalizeAuction(item);

        // オークションではない（通常出品に戻った・取得できない）なら監視から外す
        if (!auction) {
          if (!dryRun) await removeEntry(id);
          report.push({ id, action: 'removed', reason: 'not-an-auction' });
          continue;
        }

        const minutesLeft = auction.endTime ? Math.round((auction.endTime - now) / 60) : null;
        const sold = item.status !== 'on_sale' || !auction.isOngoing;
        const overLimit = auction.highestBid > entry.maxPrice;

        let kind = null;
        if (sold) kind = 'ended';
        else if (overLimit) kind = 'over';
        else if (minutesLeft !== null) {
          // まだ通知していない中で、いま該当する一番小さいしきい値を選ぶ
          const hit = THRESHOLDS.filter(
            (t) => minutesLeft <= t && !(entry.notified || []).includes(t)
          );
          if (hit.length) kind = 'soon';
        }

        if (!kind) {
          report.push({ id, action: 'watching', minutesLeft, price: auction.highestBid });
          continue;
        }

        const threshold =
          kind === 'soon'
            ? Math.min(...THRESHOLDS.filter((t) => minutesLeft <= t && !(entry.notified || []).includes(t)))
            : null;

        const message = buildMessage(kind, entry, auction, minutesLeft);
        const sendResult = dryRun ? { sent: false, reason: 'dry-run' } : await notify(message);

        if (!dryRun) {
          if (kind === 'soon') {
            // 通知済みのしきい値を記録する（同じ枠で二度鳴らさない）
            const notified = (entry.notified || []).concat(
              THRESHOLDS.filter((t) => minutesLeft <= t)
            );
            await writeEntry(id, Object.assign({}, entry, { notified: Array.from(new Set(notified)) }));
          } else {
            // 終了・上限超過はもう追わない
            await removeEntry(id);
          }
        }

        report.push({
          id,
          action: kind,
          minutesLeft,
          price: auction.highestBid,
          threshold,
          notify: sendResult,
          message: dryRun ? message : undefined,
        });
      } catch (e) {
        report.push({ id, action: 'error', error: e.message });
      }
    }

    return res.status(200).json({
      checkedAt: new Date().toISOString(),
      watching: ids.length,
      dryRun,
      webhookConfigured: !!WEBHOOK_URL,
      report,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
