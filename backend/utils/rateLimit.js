// 繁體中文註釋
// 簡易速率限制（滑動視窗）：預設 60 req / 分鐘，key = apiKey 或 IP

const buckets = new Map(); // key -> { count, resetAt }

function rateLimit({ limit = 60, windowMs = 60 * 1000 } = {}) {
  return function (req, res, next) {
    try {
      const apiKey = req.headers['x-api-key'];
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const key = String(apiKey || ip);
      const now = Date.now();
      const b = buckets.get(key) || { count: 0, resetAt: now + windowMs };
      if (now > b.resetAt) { b.count = 0; b.resetAt = now + windowMs; }
      b.count += 1;
      buckets.set(key, b);
      if (b.count > limit) {
        const retryAfter = Math.ceil((b.resetAt - now) / 1000);
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({ error: 'too many requests', retryAfter });
      }
      return next();
    } catch (_) { return next(); }
  };
}

module.exports = { rateLimit };





















