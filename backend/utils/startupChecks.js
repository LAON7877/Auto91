// 繁體中文註釋
// 啟動時檢查關鍵環境變數並警告

const logger = require('./logger');
const fs = require('fs');
const path = require('path');

function ensureEnvKey(key, defaultValue) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
      if (!new RegExp(`^${key}=`, 'm').test(content)) {
        fs.appendFileSync(envPath, `\n${key}=${defaultValue !== undefined ? String(defaultValue) : ''}\n`);
      }
    } else {
      fs.writeFileSync(envPath, `${key}=${defaultValue !== undefined ? String(defaultValue) : ''}\n`);
    }
  } catch (_) {}
}

function ensureEnvTemplates() {
  try {
    // Backend .env
    const backendEnvPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(backendEnvPath)) {
      const backendTemplate = [
        '# 自動建立：請先填寫 ENCRYPTION_KEY（32位元 base64）後重啟',
        '',
        '# 服務',
        'PORT=5257',
        'WS_PORT=7877',
        'TZ=Asia/Taipei',
        '',
        '# 資料庫',
        'MONGODB_URI=mongodb://127.0.0.1:27017/auto91_tradebot',
        '',
        '# 前端白名單（你的網域）',
        'ALLOWED_ORIGINS=請更換成你的域名,http://localhost:5173',
        '',
        '# 管理端金鑰（選填，用於受保護端點）',
        '# 產生方式：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
        'ENCRYPTION_KEY=t6nEqOw/DiDYe2UO2tWBq0he6+PkU6jsLhWJ8gLjvCo=',
        'ADMIN_KEY=',
        '',
        '# 訊號驗證（簽章可選）',
        'SIGNAL_API_KEYS=tv-key-1',
        'SIGNAL_SECRET=',
        '# 後端未設 SIGNAL_API_KEYS：不用 apiKey 也能送訊號。',
        '# 後端有設 SIGNAL_API_KEYS：必須用帶 apiKey 的 URL 才能送訊號',
        '',
        '# Cloudflared 自動重啟',
        'CF_AUTORESTART=true',
        'CF_RESTART_DELAY_MS=5000',
        'CLOUDFLARED_PATH=',
        '',
        '# 訊號分發併發度（避免一次打爆交易所）',
        'SIGNAL_DISPATCH_CONCURRENCY=20',
        '',
        '# 冪等時間窗（毫秒）與指標視窗（毫秒）',
        'IDEM_TTL_MS=300000',
        'METRICS_WINDOW_MS=86400000',
        '',
        '# 維護',
        'TRADE_TTL_DAYS=90',
        'LOG_TRIM_MB=50',
        'LOG_TRIM_KEEP_MB=5',
        '',
        '# Telegram Bot（留空則停用通知）',
        'TELEGRAM_BOT_TOKEN=請更換成你的BotToken',
        '',
        '# 週盈虧抽傭（新增）',
        'WEEKLY_COMMISSION_PERCENT=0.1         # 抽傭比例（10%）',
        'WEEKLY_COMMISSION_TG_IDS=             # 逗號分隔 chatId；空=不發送',
        '',
        '',
        '# 進階選項（可選）',
        'OKX_OB_DIFF_USDT=5                    # OKX 本日計算 vs DailyStats 觀測差異閾值',
        'EQ_RECONCILE_THRESHOLD=3              # 1/7/30 連續相等的告警門檻次數',
        'REDIS_LOCK_URL=                       # 分散式鎖：有 Redis 才需要',
        'REDIS_LOCK_TTL_MS=5000                # 分散式鎖 TTL(ms)',
        'FLIP_WAIT_ITERS=20                    # 下單翻轉等待迭代次數',
        'FLIP_WAIT_SLEEP_MS=250                # 每次等待毫秒數',
        'BINANCE_CLOSE_TRIGGER_OFFSET_RATIO=0.002 # 幣安關單觸發價偏移比',
        '',
        '# 壓測腳本（可選）',
        'TARGET=                               # signalLoadTest.js 目標 URL',
        'API_KEY=',
        'CONC=',
        'COUNT=',
        '',
        ''
      ].join('\n');
      fs.writeFileSync(backendEnvPath, backendTemplate);
      logger.info('已建立預設 backend/.env 樣板');
    }
  } catch (_) {}
  try {
    // Frontend .env
    const frontendEnvPath = path.join(__dirname, '..', '..', 'frontend', '.env');
    if (!fs.existsSync(frontendEnvPath)) {
      const frontendTemplate = [
        '# 前端環境變數',
        '',
        '# WebSocket 連線（擇一設定即可）',
        '# VITE_WS_URL=ws://你的域名或IP:埠號',
        'VITE_WS_PORT=7877',
        '',
        '# 管理端金鑰（與後端 ADMIN_KEY 相同；留空則不帶）',
        'VITE_ADMIN_KEY=',
        '',
        '# 用於「通道列表-含 apiKey 複製」按鈕（選填）',
        'VITE_SIGNAL_API_KEY=tv-key-1',
        '',
        '# 可選：若未來需要自訂 API Gateway，再開啟',
        '# VITE_API_BASE=/api',
        '',
        '# 可選：完整 WS URL（與 VITE_WS_PORT 擇一）',
        '# VITE_WS_URL=ws://你的域名或IP:埠號',
        '',
        '# 顯示名稱（可選）',
        'VITE_APP_NAME=Auto91',
        '',
        ''
      ].join('\n');
      fs.writeFileSync(frontendEnvPath, frontendTemplate);
      logger.info('已建立預設 frontend/.env 樣板');
    }
  } catch (_) {}
}

function warnEnv() {
  try {
    if (!process.env.MONGODB_URI) logger.warn('未設定 MONGODB_URI');
    const ek = process.env.ENCRYPTION_KEY || '';
    if (!ek) logger.warn('未設定 ENCRYPTION_KEY（API 憑證將無法解密）');
    const ao = (process.env.ALLOWED_ORIGINS || '').trim();
    if (!ao) logger.warn('ALLOWED_ORIGINS 未設定，CORS 可能過於寬鬆或無法跨域');
    if (!process.env.PORT) logger.info('PORT 未設定，使用預設 5001');
    const sk = (process.env.SIGNAL_API_KEYS || '').trim();
    const ss = (process.env.SIGNAL_SECRET || '').trim();
    if (!sk && !ss) logger.warn('訊號驗證為開放模式（未設定 SIGNAL_API_KEYS/SIGNAL_SECRET）');
    // Telegram Bot Token：若缺失，補上 .env 空行，並提示
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      ensureEnvKey('TELEGRAM_BOT_TOKEN', '');
      logger.warn('未設定 TELEGRAM_BOT_TOKEN（Telegram 通知將停用）');
    }
    if (!process.env.TZ) {
      ensureEnvKey('TZ', 'Asia/Taipei');
      logger.info('已在 .env 生成預設時區 TZ=Asia/Taipei');
    }
  } catch (_) {}
}

module.exports = { warnEnv, ensureEnvKey, ensureEnvTemplates };







