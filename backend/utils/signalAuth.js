// 繁體中文註釋
// 訊號驗證與冪等：HMAC 簽章 + API-Key + 內存冪等去重（TTL）

const crypto = require('crypto');
const logger = require('./logger');
const { getVersionForSuffix } = require('../services/signalConfigVersion');

const IDEM_CACHE = new Map(); // key -> expiresAt
const IDEM_TTL_MS = Number(process.env.IDEM_TTL_MS || (5 * 60 * 1000)); // 預設 5 分鐘，可環境變數覆蓋

function cleanupIdem() {
  const now = Date.now();
  for (const [k, v] of IDEM_CACHE.entries()) {
    if (v <= now) IDEM_CACHE.delete(k);
  }
}

function verifySignalAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey || (req.body && req.body.apiKey);
    const sig = req.headers['x-signature'] || req.query.signature || (req.body && req.body.signature);
    const ts = req.headers['x-timestamp'] || req.query.ts || (req.body && req.body.ts);
    const secret = process.env.SIGNAL_SECRET || '';
    const allow = String(process.env.SIGNAL_API_KEYS || '').split(',').map(x => x.trim()).filter(Boolean);

    if (!secret && allow.length === 0) {
      // 若未配置，允許通過（開發模式）；建議生產務必配置
      return next();
    }

    if (allow.length > 0 && !allow.includes(apiKey)) {
      return res.status(401).json({ error: 'invalid api key' });
    }

    if (secret) {
      const payload = req.rawBody || JSON.stringify(req.body || {});
      const base = `${apiKey || ''}.${ts || ''}.${payload}`;
      const hmac = crypto.createHmac('sha256', secret).update(base).digest('hex');
      if (!sig || sig !== hmac) return res.status(401).json({ error: 'invalid signature' });
      // 重放保護（可選：檢查時間窗口）
      if (ts && Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) {
        return res.status(401).json({ error: 'stale timestamp' });
      }
    }

    return next();
  } catch (e) {
    logger.warn('verifySignalAuth 失敗', { message: e.message });
    return res.status(401).json({ error: 'unauthorized' });
  }
}

function ensureIdempotent(req, res, next) {
  try {
    const body = req.body || {};
    const baseId = String(body.id || body.tradeId || body.signal_id || '');
    // 以通道後綴作為作用域，避免跨通道互相去重；若無則退回到 userScope 或 broadcast
    const routeSuffix = (req && req.params && req.params.suffix) ? String(req.params.suffix) : '';
    const queryScope = (req && req.query && req.query.userScope) ? String(req.query.userScope) : '';
    const bodyScope = String(body.userScope || '');
    const scope = routeSuffix || queryScope || bodyScope || 'broadcast';
    // 注入配置版本：當通道配置（用戶路由）變化時，版本會遞增，避免舊鍵造成的「看似不生效」
    const cfgVersion = getVersionForSuffix(routeSuffix);
    const idemKey = `${scope}:${cfgVersion}:${baseId}`;
    cleanupIdem();
    if (baseId && IDEM_CACHE.has(idemKey)) {
      return res.status(200).json({ ok: true, duplicate: true, scope, cfgVersion });
    }
    if (baseId) IDEM_CACHE.set(idemKey, Date.now() + IDEM_TTL_MS);
    return next();
  } catch (e) {
    return next();
  }
}

module.exports = { verifySignalAuth, ensureIdempotent };


