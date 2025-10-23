// 繁體中文註釋
// WebSocket 監控中心：
// - 與交易所的實時連線（行情/帳戶/委託）建議在 tradeExecutor 中個別維護
// - 此檔提供前端 UI 訂閱的內部 WS Hub，將關鍵更新推送到前端

const WebSocket = require('ws');
const logger = require('../utils/logger');
const { getLastAccountMessages } = require('./accountMonitor');
const bus = require('./eventBus');
const User = require('../models/User');

const clients = new Set();

function initWebsocketHub(port) {
  const wss = new WebSocket.Server({ port });
  wss.on('connection', (ws) => {
    clients.add(ws);
    // 新連線時，立即補送最近一次帳戶更新，避免前端剛刷新頁面要等待輪詢
    try {
      (async () => {
        try {
          const lastMsgs = getLastAccountMessages();
          const userDocs = await User.find({}, '_id name uid createdAt');
          const idSet = new Set();
          const infoMap = new Map();
          for (const u of userDocs) {
            const id = String(u._id);
            idSet.add(id);
            infoMap.set(id, {
              displayName: u.name || u.uid || id,
              uid: u.uid,
              createdAt: u.createdAt || undefined,
            });
          }
          if (Array.isArray(lastMsgs)) {
            for (const m of lastMsgs) {
              const uid = String(m && m.userId || '');
              if (!idSet.has(uid)) continue; // 過濾已刪除使用者的殘留快照
              const info = infoMap.get(uid) || {};
              const patched = {
                ...m,
                displayName: info.displayName || m.displayName,
                uid: info.uid || m.uid,
                createdAt: info.createdAt || m.createdAt,
              };
              ws.send(JSON.stringify(patched));
            }
          }
        } catch (_) {}
      })();
    } catch (_) {}
    ws.on('close', () => clients.delete(ws));
  });
  wss.on('listening', () => logger.info(`WS Hub listening on ${port}`));
}

function broadcastToFrontend(payload) {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    try { ws.send(data); } catch (_) {}
  }
}

module.exports = { initWebsocketHub, broadcastToFrontend };

// 事件匯流層 → 前端廣播
bus.on('frontend:broadcast', (payload) => {
  try { broadcastToFrontend(payload) } catch (_) {}
});



