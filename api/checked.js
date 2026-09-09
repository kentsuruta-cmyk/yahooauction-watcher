const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCommand(...args) {
  const res = await fetch(`${UPSTASH_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const data = await res.json();
  return data.result;
}

// チェック済みの保存先キー。ヤフオクは従来どおり 'checked'、
// メルカリは 'mercari:' 接頭辞を付けた別キーに分けて保持する。
function keyFor(req) {
  const source = (req.query && req.query.source) || (req.body && req.body.source);
  return source === 'mercari' ? 'mercari:checked' : 'checked';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const members = await redisCommand('SMEMBERS', keyFor(req));
    return res.status(200).json({ checked: members || [] });
  }

  if (req.method === 'POST') {
    const { auctionId } = req.body;
    if (!auctionId) return res.status(400).json({ error: 'auctionId required' });
    await redisCommand('SADD', keyFor(req), auctionId);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { auctionId } = req.body;
    if (auctionId) {
      await redisCommand('SREM', keyFor(req), auctionId);
    } else {
      await redisCommand('DEL', keyFor(req));
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
