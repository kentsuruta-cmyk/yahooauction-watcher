// 「終了間際に知らせてほしいメルカリのオークション」の保存先。
// api/watch.js（登録・解除）と api/watch-check.js（監視）の両方から使う。
//
// Upstash Redis のハッシュ 'mercari:watch'（field = 商品ID, value = JSON）。
// api/checked.js と同じ Upstash の環境変数をそのまま使う。
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const WATCH_KEY = 'mercari:watch';

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

// HGETALL は [field1, value1, field2, value2, ...] のフラットな配列で返る
async function readAll() {
  const flat = (await redisCommand('HGETALL', WATCH_KEY)) || [];
  const out = {};
  for (let i = 0; i < flat.length; i += 2) {
    try {
      out[flat[i]] = JSON.parse(flat[i + 1]);
    } catch (e) {
      // 壊れたエントリは無視する（次の保存で上書きされる）
    }
  }
  return out;
}

async function writeEntry(id, entry) {
  await redisCommand('HSET', WATCH_KEY, id, JSON.stringify(entry));
}

async function removeEntry(id) {
  await redisCommand('HDEL', WATCH_KEY, id);
}

async function clearAll() {
  await redisCommand('DEL', WATCH_KEY);
}

module.exports = { WATCH_KEY, redisCommand, readAll, writeEntry, removeEntry, clearAll };
