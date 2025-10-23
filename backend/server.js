// 繁體中文註釋
// 伺服器進入點：載入環境、連線資料庫、啟動 HTTP 與 WebSocket 服務

require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const { connectMongo } = require('./config/db');
const { initWebsocketHub } = require('./services/websocketMonitor');
const { initMarketWsForExistingUsers } = require('./services/marketWs');
const { initAccountMonitorForExistingUsers } = require('./services/accountMonitor');
const { ensureRunningForAll } = require('./services/cfTunnelManager');
const { initPnlAggregator } = require('./services/pnlAggregator');
const { initSnapshotScheduler } = require('./services/snapshotScheduler');
const logger = require('./utils/logger');
const { warnEnv, ensureEnvTemplates } = require('./utils/startupChecks');
const { initMaintenance } = require('./services/maintenance');
const { startOutboxRunner } = require('./services/telegram');
const { initAlerts } = require('./services/alerts');
const { initOkxPnlService } = require('./services/okxPnlService');

const PORT = process.env.PORT || 5001;
const WS_PORT = process.env.WS_PORT || 5002;

// 全域錯誤護欄：避免未處理錯誤讓進程退出
process.on('unhandledRejection', (reason, p) => {
  try {
    logger.error('unhandledRejection', { reason: (reason && reason.stack) ? reason.stack : String(reason) })
  } catch (_) {}
});
process.on('uncaughtException', (err) => {
  try {
    logger.error('uncaughtException', { message: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : '' })
  } catch (_) {}
});

(async () => {
  try {
    ensureEnvTemplates();
    warnEnv();
    await connectMongo();
    const server = http.createServer(app);

    server.listen(PORT, () => {
      logger.info(`HTTP 伺服器已啟動於埠口 ${PORT}`);
    });

    // 啟動內部 WebSocket Hub，提供前端訂閱實時資料
    initWebsocketHub(WS_PORT);
    logger.info(`WebSocket Hub 已啟動於埠口 ${WS_PORT}`);

    // 啟動行情訂閱（根據已存在使用者設定）
    await initMarketWsForExistingUsers();
    await initAccountMonitorForExistingUsers();

    // 啟動所有已儲存的 CF 隧道（需要已安裝 cloudflared）
    await ensureRunningForAll();

    // 啟動批次快照排程器（每分鐘 5 位用戶）
    await initSnapshotScheduler({ batchSize: 5, intervalMs: 60000 });

    // 啟動損益回補聚合（基準 + 增量架構，避免重啟後視窗為 0）
    try { await initPnlAggregator(10 * 60 * 1000) } catch (_) {}

    // 啟動 OKX PnL 服務預熱與定時回補（單一權威來源）
    try { await initOkxPnlService(30 * 60 * 1000) } catch (_) {}

    // 啟動維護例行任務（每日清理交易/精簡 mongo 輸出檔）
    await initMaintenance();

    // 啟動 Telegram Outbox 服務（若未設定 BOT TOKEN 將自動跳過）
    try { startOutboxRunner(); } catch (_) {}

    // 初始化告警模組（偏好與事件處理）
    try { initAlerts(); } catch (_) {}
  } catch (err) {
    logger.error('伺服器啟動失敗', { message: err.message, stack: err.stack });
    // 若連線錯誤則關閉程序避免不穩定狀態
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
})();


