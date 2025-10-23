// 繁體中文註釋
// 市場行情 WebSocket 訂閱（Binance 永續/OKX 永續）：依使用者配置自動訂閱，並將最新價格推送給前端 WS Hub

const WebSocket = require('ws');
const User = require('../models/User');
const logger = require('../utils/logger');
const { broadcastToFrontend } = require('./websocketMonitor');
const priceCache = require('../utils/priceCache');

// 訂閱索引：key = `${exchange}:${symbolKey}`
const subscriptions = new Map();
// 用戶訂閱記錄：userId -> { exchange, pair } 用於檢測變更
const userSubscriptions = new Map();

function symbolKeyForUser(user) {
  return `${user.exchange}:${user.pair}`;
}

function toBinanceStreamSymbol(pair) {
  // 'BTC/USDT' -> 'btcusdt'
  return pair.replace('/', '').toLowerCase();
}

function toOkxInstId(pair) {
  // 'BTC/USDT' -> 'BTC-USDT-SWAP' (永續)
  return pair.replace('/', '-') + '-SWAP';
}

// OKX 公開頻道心跳封裝：原生 ping + 應用層 { op: 'ping' }
function attachOkxPublicHeartbeat(ws, instId) {
  let heartbeatTimeout;
  let heartbeatInterval;
  let staleTimer;
  let lastSeenAt = 0;

  function clearAllTimers() {
    try { clearTimeout(heartbeatTimeout); } catch (_) {}
    try { clearTimeout(staleTimer); } catch (_) {}
    try { clearInterval(heartbeatInterval); } catch (_) {}
    heartbeatTimeout = undefined;
    staleTimer = undefined;
    heartbeatInterval = undefined;
  }

  function start() {
    clearAllTimers();
    const doPing = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.ping(); } catch (_) {}
      try { ws.send(JSON.stringify({ op: 'ping' })); } catch (_) {}
      try { clearTimeout(heartbeatTimeout); } catch (_) {}
      heartbeatTimeout = setTimeout(() => {
        try { ws.close(1000, 'heartbeat-timeout'); } catch (_) {}
      }, 10000);
      try { clearTimeout(staleTimer); } catch (_) {}
      staleTimer = setTimeout(() => {
        const age = Date.now() - lastSeenAt;
        if (age > 40000) {
          logger.warn(`[OKX] Public 閒置過久，主動重連 ${instId}`, { ageMs: age });
          try { ws.close(1000, 'stale-connection'); } catch (_) {}
        }
      }, 15000);
    };
    doPing();
    heartbeatInterval = setInterval(doPing, 25000);
  }

  // 自動處理 ping/pong 與觸發點
  ws.on('pong', () => { lastSeenAt = Date.now(); try { clearTimeout(heartbeatTimeout); } catch (_) {} });
  ws.on('ping', () => { lastSeenAt = Date.now(); try { ws.pong(); } catch (_) {} });

  return {
    onOpen: () => { lastSeenAt = Date.now(); start(); },
    onMessageTouch: () => { lastSeenAt = Date.now(); try { clearTimeout(heartbeatTimeout); } catch (_) {} },
    onCloseOrError: () => { clearAllTimers(); },
  };
}

function ensureBinanceTicker(pair) {
  const stream = toBinanceStreamSymbol(pair);
  const url = `wss://fstream.binance.com/ws/${stream}@ticker`;
  const ws = new WebSocket(url);

  ws.on('open', () => logger.info(`[Binance] Ticker 已連線 ${pair}`));
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const last = Number(data.c);
      if (!Number.isFinite(last)) return;
      priceCache.set('binance', pair, last);
      broadcastToFrontend({ type: 'ticker', exchange: 'binance', pair, price: last, ts: Date.now() });
    } catch (_) {}
  });
  ws.on('close', () => {
    logger.warn(`[Binance] Ticker 連線關閉 ${pair}`);
    try { subscriptions.delete(`binance:${pair}`); } catch (_) {}
    setTimeout(() => ensureSubscriptionForPair('binance', pair), 3000);
  });
  ws.on('error', (e) => logger.error(`[Binance] Ticker 錯誤 ${pair}`, { message: e.message }));
  return ws;
}

function ensureOkxTicker(pair) {
  const url = 'wss://ws.okx.com:8443/ws/v5/public';
  const ws = new WebSocket(url);
  const instId = toOkxInstId(pair);
  const hb = attachOkxPublicHeartbeat(ws, instId);
  ws.on('open', () => {
    logger.info(`[OKX] Ticker 已連線 ${instId}`);
    const sub = { op: 'subscribe', args: [{ channel: 'tickers', instId }] };
    ws.send(JSON.stringify(sub));
    hb.onOpen();
  });
  ws.on('message', (raw) => {
    try {
      hb.onMessageTouch();
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'subscribe') return;
      if (!msg.data || !Array.isArray(msg.data)) return;
      const d = msg.data[0];
      const last = Number(d.last);
      if (!Number.isFinite(last)) return;
      priceCache.set('okx', pair, last);
      broadcastToFrontend({ type: 'ticker', exchange: 'okx', pair, price: last, ts: Date.now() });
    } catch (_) {}
  });
  ws.on('close', () => {
    logger.warn(`[OKX] Ticker 連線關閉 ${instId}`);
    hb.onCloseOrError();
    try { subscriptions.delete(`okx:${pair}`); } catch (_) {}
    setTimeout(() => ensureSubscriptionForPair('okx', pair), 3000);
  });
  ws.on('error', (e) => { hb.onCloseOrError(); logger.error(`[OKX] Ticker 錯誤 ${instId}`, { message: e.message }); });
  return ws;
}

// 範例：OKX 公開成交頻道（trades）
function ensureOkxTrades(pair) {
  const url = 'wss://ws.okx.com:8443/ws/v5/public';
  const ws = new WebSocket(url);
  const instId = toOkxInstId(pair);
  const key = `okx:trades:${pair}`;
  const hb = attachOkxPublicHeartbeat(ws, instId);

  ws.on('open', () => {
    logger.info(`[OKX] Trades 已連線 ${instId}`);
    const sub = { op: 'subscribe', args: [{ channel: 'trades', instId }] };
    ws.send(JSON.stringify(sub));
    hb.onOpen();
  });
  ws.on('message', (raw) => {
    try {
      hb.onMessageTouch();
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'subscribe') return;
      if (!msg.data || !Array.isArray(msg.data)) return;
      // 逐筆廣播（模板：前端可依需求處理）
      for (const d of msg.data) {
        const price = Number(d.px || d.price || d.last);
        const size = Number(d.sz || d.size || 0);
        const ts = Number(d.ts) || Date.now();
        if (!Number.isFinite(price)) continue;
        broadcastToFrontend({ type: 'trade', exchange: 'okx', pair, price, size, ts });
      }
    } catch (_) {}
  });
  ws.on('close', () => {
    logger.warn(`[OKX] Trades 連線關閉 ${instId}`);
    hb.onCloseOrError();
    try { subscriptions.delete(key); } catch (_) {}
    setTimeout(() => ensureOkxTrades(pair), 3000);
  });
  ws.on('error', (e) => { hb.onCloseOrError(); logger.error(`[OKX] Trades 錯誤 ${instId}`, { message: e.message }); });

  subscriptions.set(key, ws);
  return ws;
}

function ensureSubscriptionForPair(exchange, pair) {
  const key = `${exchange}:${pair}`;
  if (subscriptions.has(key)) return; // 已存在

  const ws = exchange === 'binance' ? ensureBinanceTicker(pair) : ensureOkxTicker(pair);
  subscriptions.set(key, ws);
}

// 清理不再需要的訂閱（當沒有用戶使用該交易對時）
function cleanupUnusedSubscriptions() {
  const activePairs = new Set();
  for (const [userId, sub] of userSubscriptions.entries()) {
    const key = `${sub.exchange}:${sub.pair}`;
    activePairs.add(key);
  }
  
  for (const [key, ws] of subscriptions.entries()) {
    if (!activePairs.has(key)) {
      try {
        ws.close();
        subscriptions.delete(key);
        logger.info(`清理未使用的行情訂閱: ${key}`);
      } catch (_) {}
    }
  }
}

async function ensureSubscriptionForUser(user) {
  try {
    if (!user?.enabled) return;
    
    const userId = user._id?.toString();
    if (!userId) return;
    
    const currentSub = userSubscriptions.get(userId);
    const newSub = { exchange: user.exchange, pair: user.pair };
    
    // 檢查是否需要重新訂閱（交易對或交易所變更）
    if (currentSub && (currentSub.exchange !== newSub.exchange || currentSub.pair !== newSub.pair)) {
      logger.info(`用戶交易對變更，重新訂閱行情`, { 
        userId, 
        old: currentSub, 
        new: newSub 
      });
    }
    
    // 更新用戶訂閱記錄
    userSubscriptions.set(userId, newSub);
    
    // 確保新的交易對已訂閱
    ensureSubscriptionForPair(user.exchange, user.pair);
    
    // 清理不再需要的訂閱
    cleanupUnusedSubscriptions();
  } catch (e) {
    logger.error('建立行情訂閱失敗', { userId: user?._id?.toString?.(), message: e.message });
  }
}

async function initMarketWsForExistingUsers() {
  const users = await User.find({ enabled: true });
  for (const u of users) await ensureSubscriptionForUser(u);
  logger.info(`行情 WS 初始化完成，已訂閱 ${subscriptions.size} 個來源`);
}

// 清理指定用戶的訂閱記錄（用戶刪除時調用）
function removeUserSubscription(userId) {
  userSubscriptions.delete(userId);
  cleanupUnusedSubscriptions();
}

module.exports = { ensureSubscriptionForUser, initMarketWsForExistingUsers, removeUserSubscription };




