// 繁體中文註釋
// 應用核心初始化：Express 應用、基本中介層、安全與日誌

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger');

const apiRoutes = require('./routes');

const app = express();

// 安全與通用中介層
app.use(helmet());

// 嚴格 CORS 白名單（以環境變數 ALLOWED_ORIGINS 逗號分隔）
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// 捕捉 raw body 供簽章驗證
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => {
    try { req.rawBody = buf.toString('utf8'); } catch (_) { req.rawBody = ''; }
  }
}));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(morgan('combined', { stream: logger.stream }));

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'auto91-tradebot-backend' });
});

// 管理端金鑰保護：非 GET 要求需帶 x-admin-key
app.use((req, res, next) => {
  try {
    if (req.method === 'GET') return next();
    // 訊號路由已獨立驗證，略過
    if (req.path.startsWith('/api/signal')) return next();
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) return next();
    if (req.headers['x-admin-key'] !== adminKey) return res.status(401).json({ error: 'admin key required' });
    return next();
  } catch (_) { return next(); }
});

// API 路由
app.use('/api', apiRoutes);

// 全域錯誤處理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('全域錯誤捕捉', { message: err.message, stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || '伺服器內部錯誤' });
});

module.exports = app;




