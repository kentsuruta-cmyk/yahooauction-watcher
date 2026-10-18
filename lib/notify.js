// 通知の送り先（Discord / Slack / ntfy の Webhook URL）は環境変数 NOTIFY_WEBHOOK_URL。
// api/watch-check.js（オークション終了通知）と api/health.js（死活チェック）から使う。
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;

// Discord / Slack / ntfy のどれでも同じ呼び方で飛ばせるようにする
async function notify(text) {
  if (!WEBHOOK_URL) return { sent: false, reason: 'NOTIFY_WEBHOOK_URL not set' };

  let init;
  if (WEBHOOK_URL.includes('ntfy.sh')) {
    init = { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text };
  } else {
    // Discord は content、Slack は text を読む
    const isSlack = WEBHOOK_URL.includes('hooks.slack.com');
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isSlack ? { text } : { content: text }),
    };
  }

  const res = await fetch(WEBHOOK_URL, init);
  if (!res.ok) {
    const body = await res.text();
    return { sent: false, reason: `${res.status}: ${body.slice(0, 200)}` };
  }
  return { sent: true };
}

module.exports = { notify, webhookConfigured: !!WEBHOOK_URL };
