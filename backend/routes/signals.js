// 繁體中文註釋
// 信號入口：TradingView 透過 CF Tunnel POST 至此端點（可含 URL 後綴）

const express = require('express');
const router = express.Router();
const { handleSignal } = require('../services/signalParser');
const { verifySignalAuth, ensureIdempotent } = require('../utils/signalAuth');
const { rateLimit } = require('../utils/rateLimit');
const logger = require('../utils/logger');

// 支援 /api/signal 與 /api/signal/:suffix
router.post('/', rateLimit({ limit: 120, windowMs: 60 * 1000 }), verifySignalAuth, ensureIdempotent, async (req, res, next) => {
  try {
    const fastAck = String(req.query.ack || req.headers['x-fast-ack'] || '').toLowerCase() === 'fast' || String(req.headers['x-fast-ack'] || '').toLowerCase() === '1';
    if (fastAck) {
      // 立即回應，背景處理
      res.status(202).json({ ok: true, accepted: true });
      setImmediate(() => {
        handleSignal({ body: req.body, suffix: null }).catch(err => {
          try { logger.error('fast-ack 處理信號失敗(/)', { message: err.message }); } catch (_) {}
        });
      });
      return;
    }
    const result = await handleSignal({ body: req.body, suffix: null });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:suffix', rateLimit({ limit: 120, windowMs: 60 * 1000 }), verifySignalAuth, ensureIdempotent, async (req, res, next) => {
  try {
    const { suffix } = req.params;
    const fastAck = String(req.query.ack || req.headers['x-fast-ack'] || '').toLowerCase() === 'fast' || String(req.headers['x-fast-ack'] || '').toLowerCase() === '1';
    if (fastAck) {
      res.status(202).json({ ok: true, accepted: true, suffix });
      setImmediate(() => {
        handleSignal({ body: req.body, suffix }).catch(err => {
          try { logger.error('fast-ack 處理信號失敗(:suffix)', { suffix, message: err.message }); } catch (_) {}
        });
      });
      return;
    }
    const result = await handleSignal({ body: req.body, suffix });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;




