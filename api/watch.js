// メルカリのオークション出品を「終了間際に知らせてほしいもの」として登録・解除する。
// 実際の監視と通知は api/watch-check.js（GitHub Actions から5分おきに叩かれる）が行う。
const { readAll, writeEntry, removeEntry, clearAll } = require('../lib/watch-store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ watch: await readAll() });
    }

    if (req.method === 'POST') {
      const { id, url, title, model, maxPrice } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });

      const limit = Number(maxPrice);
      if (!limit || limit <= 0) return res.status(400).json({ error: 'maxPrice required' });

      const prev = (await readAll())[id] || {};

      const entry = {
        id,
        url: url || prev.url || `https://jp.mercari.com/item/${id}`,
        title: title || prev.title || '',
        model: model || prev.model || '',
        maxPrice: limit,
        addedAt: prev.addedAt || Math.floor(Date.now() / 1000),
        // 上限を入れ直したら通知履歴もリセットする（新しい条件で通知し直す）
        notified: prev.maxPrice === limit ? prev.notified || [] : [],
      };

      await writeEntry(id, entry);
      return res.status(200).json({ ok: true, entry });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (id) {
        await removeEntry(id);
      } else {
        await clearAll();
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
