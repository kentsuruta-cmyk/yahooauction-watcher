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

// LINE（Messaging API のプッシュ通知）。LINE Notify は2025年3月に終了したため、公式アカウントから自分に送る。
//   LINE_CHANNEL_ACCESS_TOKEN … LINE Developers のチャネルアクセストークン（長期）
//   LINE_USER_ID              … 送り先（自分）のユーザーID（U から始まる33文字）
const LINE_TOKEN = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
const LINE_TO = String(process.env.LINE_USER_ID || '').trim();
const lineConfigured = !!(LINE_TOKEN && LINE_TO);

async function notifyLine(text) {
  if (!lineConfigured) return { sent: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID not set' };
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    // LINE の1通は5000文字まで
    body: JSON.stringify({ to: LINE_TO, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { sent: false, reason: `LINE ${res.status}: ${body.slice(0, 200)}` };
  }
  return { sent: true };
}

module.exports = { notify, notifyLine, webhookConfigured: !!WEBHOOK_URL, lineConfigured };
