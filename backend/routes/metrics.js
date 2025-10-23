// 繁體中文註釋
// 管理端 metrics：僅回傳簡易指標

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// 僅允許帶 x-admin-key（若有設定）
router.get('/', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const snap = logger.metrics && logger.metrics.snapshot ? logger.metrics.snapshot() : { orders429: 0, count: 0, p95Ms: 0 };
    res.json(snap);
  } catch (_) {
    res.json({ orders429: 0, count: 0, p95Ms: 0 });
  }
});

module.exports = router;


