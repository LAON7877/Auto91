// 繁體中文註釋
// 帳戶監控服務：週期性以 REST 查詢餘額/倉位，並推送至前端 WS Hub

const ccxt = require('ccxt');
const axios = require('axios');
const crypto = require('crypto');
const User = require('../models/User');
const logger = require('../utils/logger');
const bus = require('./eventBus');
const AccountSnapshot = require('../models/AccountSnapshot');
const Bottleneck = require('bottleneck');

// 使用者監控計時器 map
const userTimers = new Map();
const BALANCE_CACHE = new Map(); // userId -> last snapshot JSON
const LAST_MSG_CACHE = new Map(); // userId -> last broadcast message object
const SEQ_COUNTER = new Map(); // userId -> last seq number
const WS_ACTIVE = new Set();
const LAST_POLL_AT = new Map();
// 僅以私有 WS 更新錢包/餘額/持倉（停用 REST 回補與備援）
const WS_ONLY_MODE = true;
const HOT_START_CACHE = true; // 熱啟快取：啟動/新增用戶時先回放持久化的最新狀態
const BINANCE_COLD_SNAPSHOT = true; // 幣安單次冷啟快照：若需要即時首屏，允許啟動時抓一次簽名快照

// WS 成交增量 → 滾動視窗累加（24h/7d/30d）
const TRADE_LOGS = new Map(); // userId -> Array<{ ts, pnl, fee }>
const TRADE_LOGS_V2 = new Map(); // userId -> { dateKey: { tradeCount, feeSum, pnlSum, closedTrades: [] } }
const DailyStats = require('../models/DailyStats')
// 交易所 API 節流：全域與每交易所各一個 limiter，防 429/權重爆掉
const limiterGlobal = new Bottleneck({ minTime: 150, maxConcurrent: 2 });
const limiterByEx = new Map();
function getLimiter(ex) {
  if (!limiterByEx.has(ex)) limiterByEx.set(ex, new Bottleneck({ minTime: 200, maxConcurrent: 1 }));
  return limiterByEx.get(ex);
}
async function enqueueExchange(ex, fn) {
  const exLimiter = getLimiter(ex);
  return limiterGlobal.schedule(() => exLimiter.schedule(async () => {
    let attempt = 0;
    while (true) {
      try { return await fn(); }
      catch (e) {
        const msg = String(e && e.message || '');
        const retryAfter = Number(e?.response?.headers?.['retry-after'] || 0);
        const status = Number(e?.response?.status || 0);
        if (status === 429 || status === 418) {
          const backoff = retryAfter ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 15000);
          await new Promise(r => setTimeout(r, backoff));
          attempt++;
          continue;
        }
        throw e;
      }
    }
  }));
}

function recordRealizedDelta(userId, { ts, pnl, fee }) {
  const arr = TRADE_LOGS.get(userId) || [];
  arr.push({ ts: ts || Date.now(), pnl: Number(pnl || 0), fee: Number(fee || 0) });
  // 剪除 30 天以外
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const trimmed = arr.filter(x => x.ts >= cutoff);
  TRADE_LOGS.set(userId, trimmed);
  // V2：每日累積（僅計數與費用/損益總合；平倉清單由日結依倉位與成交補）
  try {
    const tz = process.env.TZ || 'UTC';
    const d = new Date(new Date(ts || Date.now()).toLocaleString('en-US', { timeZone: tz }));
    const dateKey = d.toISOString().slice(0,10);
    const byUser = TRADE_LOGS_V2.get(userId) || {};
  const day = byUser[dateKey] || { tradeCount: 0, feeSum: 0, pnlSum: 0, closedTrades: [] };
    day.feeSum += Number(fee || 0);
    day.pnlSum += Number(pnl || 0);
    byUser[dateKey] = day;
    TRADE_LOGS_V2.set(userId, byUser);
    // 同步到 DB（跨重啟準確）
    (async () => {
      try {
      await DailyStats.updateOne({ user: userId, date: dateKey }, {
        // 僅累加費用與損益；成交次數由 filled 事件統一定義計數
        $inc: { tradeCount: 0, feeSum: Number(fee || 0), pnlSum: Number(pnl || 0) },
        $setOnInsert: { closedTrades: [] }
      }, { upsert: true })
      } catch (_) {}
    })()
  } catch (_) {}
  return trimmed;
}

function sumWindow(entries, ms) {
  const since = Date.now() - ms;
  let pnl = 0, fee = 0;
  for (const e of entries) {
    if (e.ts >= since) { pnl += Number(e.pnl || 0); fee += Number(e.fee || 0); }
  }
  return { pnl, fee };
}

function broadcastPnlSummary(user, logs) {
  const d1 = sumWindow(logs, 24 * 60 * 60 * 1000);
  const d7 = sumWindow(logs, 7 * 24 * 60 * 60 * 1000);
  const d30 = sumWindow(logs, 30 * 24 * 60 * 60 * 1000);
  const userId = user._id.toString();
  const prev = LAST_MSG_CACHE.get(userId) || {};
  const summary = { ...(prev.summary || {}) };
  summary.pnl1d = d1.pnl;
  summary.pnl7d = d7.pnl;
  summary.pnl30d = d30.pnl;
  summary.feePaid = d1.fee; // 本日手續費
  const msg = {
    ...(prev || {}),
    type: 'account_update',
    userId,
    displayName: user.name || user.uid || userId,
    uid: user.uid,
    exchange: user.exchange,
    pair: user.pair,
    summary,
    ts: Date.now(),
  };
  LAST_MSG_CACHE.set(userId, msg);
  try { bus.emit('frontend:broadcast', msg); } catch (_) {}
}

// 供外部（私有 WS 成交事件）直接寫入並即時廣播滾動 PnL/費用
function updateRealizedFromTrade(user, { ts, pnl, fee }) {
  const userId = user._id.toString();
  const logs = recordRealizedDelta(userId, { ts, pnl, fee });
  broadcastPnlSummary(user, logs);
}

async function coldStartSnapshotForUser(user) {
  try {
    const creds = user.getDecryptedKeys();
    let acc = null, pos = [];
    if (user.exchange === 'binance') {
      acc = await enqueueExchange('binance', () => binanceFuturesAccountRaw(creds));
      pos = await enqueueExchange('binance', () => binanceFuturesPositionsRaw(creds, user.pair));
    } else if (user.exchange === 'okx') {
      acc = await enqueueExchange('okx', () => okxAccountBalanceRaw(creds));
      pos = await enqueueExchange('okx', () => okxPositionsRaw(creds, user.pair));
    }
    if (!acc && (!Array.isArray(pos) || pos.length === 0)) return;
    const derived = deriveBalanceSummaryForExchange({ exchange: user.exchange, balances: acc });
    let walletBalance = derived.walletBalance ?? 0;
    let availableTransfer = derived.availableTransfer ?? walletBalance;
    let marginBalance = derived.marginBalance ?? walletBalance;
    let unrealizedSum = 0;
    for (const p of (pos || [])) unrealizedSum += Number(p.unrealizedPnl || 0);
    const msg = {
      type: 'account_update',
      userId: user._id.toString(),
      displayName: user.name || user.uid || user._id.toString(),
      uid: user.uid,
      exchange: user.exchange,
      pair: user.pair,
      createdAt: user.createdAt || undefined,
      balances: null,
      positions: Array.isArray(pos) ? pos : [],
      summary: {
        walletBalance,
        availableTransfer,
        marginBalance,
        unrealizedPnl: unrealizedSum,
        feePaid: 0,
        pnl1d: 0,
        pnl7d: 0,
        pnl30d: 0,
      },
      ts: Date.now(),
    };
    LAST_MSG_CACHE.set(user._id.toString(), msg);
    try { bus.emit('frontend:broadcast', msg); } catch (_) {}
    if (HOT_START_CACHE) {
      await AccountSnapshot.findOneAndUpdate(
        { user: user._id.toString() },
        { summary: msg.summary || {}, positions: msg.positions || [], ts: new Date() },
        { upsert: true, new: true }
      );
    }
  } catch (_) {}
}

function getLastSummary(userId) {
  const last = LAST_MSG_CACHE.get(userId);
  return last && last.summary ? { ...last.summary } : {};
}

function mergeSummary(prev, next) {
  const out = { ...prev };
  for (const [k, v] of Object.entries(next || {})) {
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) out[k] = v;
  }
  return out;
}

function mergePreferNonZero(prev, next) {
  const out = { ...prev };
  const src = next || {};
  for (const key of Object.keys(src)) {
    const incoming = Number(src[key]);
    if (Number.isFinite(incoming)) {
      // 若傳入值非 0，覆蓋；若是 0，保留先前非 0 值
      if (incoming !== 0) out[key] = incoming; else if (!Number.isFinite(Number(out[key]))) out[key] = 0;
    }
  }
  return out;
}

function nextSeq(userId) {
  const v = (SEQ_COUNTER.get(userId) || 0) + 1;
  SEQ_COUNTER.set(userId, v);
  return v;
}

function deriveBalanceSummaryForExchange({ exchange, balances }) {
  const summary = { walletBalance: undefined, availableTransfer: undefined, marginBalance: undefined };
  try {
    if (exchange === 'binance') {
      // ccxt futures balance usually in balances.total/free.USDT
      const t = (balances && (balances.total?.USDT ?? balances?.USDT?.total)) ?? undefined;
      const f = (balances && (balances.free?.USDT ?? balances?.USDT?.free)) ?? undefined;
      if (Number.isFinite(Number(t))) summary.walletBalance = Number(t);
      if (Number.isFinite(Number(f))) summary.availableTransfer = Number(f);
      // fallback to info assets
      if ((!summary.walletBalance || !summary.availableTransfer) && balances?.info) {
        const info = balances.info;
        const assets = info.assets || info;
        const arr = Array.isArray(assets) ? assets : [];
        const usdt = arr.find(a => (a.asset || a.ccy || '').toUpperCase() === 'USDT');
        if (usdt) {
          const wb = Number(usdt.walletBalance || usdt.wb || usdt.balance || 0);
          const cw = Number(usdt.crossWalletBalance || usdt.cw || usdt.availableBalance || 0);
          if (Number.isFinite(wb)) summary.walletBalance = wb;
          if (Number.isFinite(cw)) summary.availableTransfer = cw;
        }
      }
      if (summary.walletBalance !== undefined && summary.availableTransfer === undefined) summary.availableTransfer = summary.walletBalance;
      if (summary.walletBalance !== undefined) summary.marginBalance = summary.walletBalance;
    } else if (exchange === 'okx') {
      // okx unified account likely packs in balances.info.data[0].details
      if (balances?.info) {
        const info = balances.info;
        const data = info.data || info;
        const arr = Array.isArray(data) ? data : [];
        const first = arr[0] || {};
        const details = first.details || [];
        const usdt = details.find(d => (d.ccy || '').toUpperCase() === 'USDT') || {};
        const eq = Number(usdt.eq || first.totalEq || 0);
        const avail = Number(usdt.availBal || 0);
        const cash = Number(usdt.cashBal || 0);
        if (Number.isFinite(eq)) summary.walletBalance = eq;
        if (Number.isFinite(avail)) summary.availableTransfer = avail;
        if (Number.isFinite(cash)) summary.marginBalance = cash;
      }
      // ccxt normalized
      const t = (balances && (balances.total?.USDT ?? balances?.USDT?.total)) ?? undefined;
      const f = (balances && (balances.free?.USDT ?? balances?.USDT?.free)) ?? undefined;
      if (summary.walletBalance === undefined && Number.isFinite(Number(t))) summary.walletBalance = Number(t);
      if (summary.availableTransfer === undefined && Number.isFinite(Number(f))) summary.availableTransfer = Number(f);
      if (summary.marginBalance === undefined && summary.walletBalance !== undefined) summary.marginBalance = summary.walletBalance;
    }
  } catch (_) {}
  return summary;
}

function buildClient(user) {
  const creds = user.getDecryptedKeys();
  if (user.exchange === 'binance') {
    return new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true });
  }
  if (user.exchange === 'okx') {
    return new ccxt.okx({ apiKey: creds.apiKey, secret: creds.apiSecret, password: creds.apiPassphrase || undefined, enableRateLimit: true });
  }
  throw new Error('不支援的交易所');
}

async function fetchBalanceWithRetry(exchange, tries = 4, delayMs = 2000) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const bal = await exchange.fetchBalance();
      // 若拿到非空結構即返回
      if (bal && (Object.keys(bal.free || {}).length || Object.keys(bal.total || {}).length || bal.info)) return bal;
      last = bal;
    } catch (e) { last = null; }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return last;
}

async function fetchPositionsSafe(exchange, pair) {
  try { if (exchange.fetchPositions) return await exchange.fetchPositions([pair]); } catch (_) {}
  return [];
}

// 公有端點補標記價格
async function fetchMarkPrice(exchangeId, symbol) {
  try {
    if (exchangeId === 'binance') {
      const sym = (symbol || '').replace('/', '');
      const res = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { params: { symbol: sym } });
      const mp = Number(res.data?.markPrice || 0);
      if (Number.isFinite(mp) && mp > 0) return mp;
    } else if (exchangeId === 'okx') {
      const instId = (symbol || '').includes('-') ? symbol : ((symbol || '').replace('/', '-') + '-SWAP');
      const res = await axios.get('https://www.okx.com/api/v5/public/mark-price', { params: { instType: 'SWAP', instId } });
      const d = Array.isArray(res.data?.data) ? res.data.data[0] : null;
      const mp = Number(d?.markPx || 0);
      if (Number.isFinite(mp) && mp > 0) return mp;
    }
  } catch (_) {}
  return 0;
}

async function fillPositionDerivedPrices(user, exchange, positions) {
  if (!Array.isArray(positions) || positions.length === 0) return positions || [];
  const out = [];
  for (const p of positions) {
    const clone = { ...p };
    // 標記價格缺值 → 公有端點補價
    const hasMark = Number.isFinite(Number(clone.markPrice)) && Number(clone.markPrice) > 0;
    if (!hasMark && clone.symbol) {
      const mp = await fetchMarkPrice(user.exchange, clone.symbol).catch(() => 0);
      if (Number.isFinite(mp) && mp > 0) clone.markPrice = mp;
    }
    // 強平價格缺值 → 再抓一次 REST positions 匹配補上
    const hasLiq = Number.isFinite(Number(clone.liquidationPrice)) && Number(clone.liquidationPrice) > 0;
    if (!hasLiq) {
      try {
        const fresh = await fetchPositionsSafe(exchange, user.pair);
        const hit = (fresh || []).find(x => (x.symbol || '').toUpperCase() === (clone.symbol || '').toUpperCase());
        if (hit && Number.isFinite(Number(hit.liquidationPrice)) && Number(hit.liquidationPrice) > 0) clone.liquidationPrice = Number(hit.liquidationPrice);
      } catch (_) {}
    }
    out.push(clone);
  }
  return out;
}

async function binanceFuturesAccountRaw(creds) {
  try {
    const ts = Date.now();
    const recv = 60000;
    const query = `timestamp=${ts}&recvWindow=${recv}`;
    const sig = crypto.createHmac('sha256', creds.apiSecret).update(query).digest('hex');
    const url = `https://fapi.binance.com/fapi/v2/account?${query}&signature=${sig}`;
    const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': creds.apiKey } });
    return { info: res.data };
  } catch (_) { return null; }
}

async function okxAccountBalanceRaw(creds) {
  try {
    const method = 'GET';
    const requestPath = '/api/v5/account/balance';
    const ts = new Date().toISOString();
    const prehash = ts + method + requestPath;
    const sign = crypto.createHmac('sha256', creds.apiSecret).update(prehash).digest('base64');
    const url = `https://www.okx.com${requestPath}`;
    const res = await axios.get(url, {
      headers: {
        'OK-ACCESS-KEY': creds.apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': creds.apiPassphrase || '',
      }
    });
    return { info: res.data };
  } catch (_) { return null; }
}

async function binanceFuturesPositionsRaw(creds, pair) {
  try {
    const ts = Date.now();
    const recv = 60000;
    const query = `timestamp=${ts}&recvWindow=${recv}`;
    const sig = crypto.createHmac('sha256', creds.apiSecret).update(query).digest('hex');
    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${query}&signature=${sig}`;
    const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': creds.apiKey } });
    const arr = Array.isArray(res.data) ? res.data : [];
    const sym = String(pair || '').replace('/', '');
    const out = [];
    for (const r of arr) {
      if (String(r.symbol) !== sym) continue;
      const amt = Number(r.positionAmt || 0);
      const side = amt > 0 ? 'long' : amt < 0 ? 'short' : 'flat';
      out.push({
        symbol: pair,
        side,
        contracts: Math.abs(amt),
        entryPrice: Number(r.entryPrice || 0),
        markPrice: Number(r.markPrice || 0),
        leverage: Number(r.leverage || 0),
        marginMode: (r.marginType || 'cross').toLowerCase(),
        liquidationPrice: Number(r.liquidationPrice || 0),
        unrealizedPnl: Number(r.unRealizedProfit || 0),
      });
    }
    return out;
  } catch (_) { return []; }
}

async function okxPositionsRaw(creds, pair) {
  try {
    const method = 'GET';
    const requestPath = '/api/v5/account/positions?instType=SWAP';
    const ts = new Date().toISOString();
    const prehash = ts + method + requestPath;
    const sign = crypto.createHmac('sha256', creds.apiSecret).update(prehash).digest('base64');
    const url = `https://www.okx.com${requestPath}`;
    const res = await axios.get(url, {
      headers: {
        'OK-ACCESS-KEY': creds.apiKey,
        'OK-ACCESS-SIGN': sign,
        'OK-ACCESS-TIMESTAMP': ts,
        'OK-ACCESS-PASSPHRASE': creds.apiPassphrase || '',
      }
    });
    const data = Array.isArray(res.data?.data) ? res.data.data : [];
    const instIdWanted = (pair || '').replace('/', '-') + '-SWAP';
    const out = [];
    for (const r of data) {
      if (String(r.instId) !== instIdWanted) continue;
      const amt = Number(r.pos || 0);
      const side = amt > 0 ? 'long' : amt < 0 ? 'short' : 'flat';
      out.push({
        symbol: pair,
        side,
        contracts: Math.abs(amt) / 100, // OKX 回報以張數，系統統一顯示需 /100
        contractsScaled: true,
        entryPrice: Number(r.avgPx || 0),
        markPrice: Number(r.markPx || 0),
        leverage: Number(r.lever || 0),
        marginMode: (r.mgnMode || 'cross').toLowerCase(),
        liquidationPrice: Number(r.liqPx || 0),
        unrealizedPnl: Number(r.upl || 0),
      });
    }
    return out;
  } catch (_) { return []; }
}

async function pollUserAccount(user) {
  try {
    if (WS_ONLY_MODE) return; // 預設：完全依賴私有 WS，不做任何 REST 輪詢
    const exchange = buildClient(user);
    const creds = user.getDecryptedKeys();
    const userId = user._id.toString();
    // 若私有 WS 活躍，僅每 10 分鐘做一次低頻校正
    const lastAt = LAST_POLL_AT.get(userId) || 0;
    if (WS_ACTIVE.has(userId) && (Date.now() - lastAt) < (10 * 60 * 1000)) {
      return;
    }
    // 初始化用 REST 抓一次（含重試與 fallback）
    let balances = await fetchBalanceWithRetry(exchange, 5, 2000);
    let positions = await fetchPositionsSafe(exchange, user.pair);
    if (!Array.isArray(positions) || positions.length === 0) {
      // 以原生端點回補持倉
      if (user.exchange === 'binance') positions = await binanceFuturesPositionsRaw(creds, user.pair);
      if (user.exchange === 'okx') positions = await okxPositionsRaw(creds, user.pair);
    }
    // 補齊標記價格/強平價格
    positions = await fillPositionDerivedPrices(user, exchange, positions);
    // 槓桿缺值時，回退到使用者設定的槓桿倍數
    try {
      positions = (positions || []).map(p => ({
        ...p,
        leverage: Number(p.leverage || user.leverage || 0),
      }));
    } catch (_) {}
    // 嘗試萃取 USDT 餘額摘要
    let usdtTotal = 0;
    let usdtFree = 0;
    try {
      usdtTotal = balances?.total?.USDT ?? balances?.USDT?.total ?? 0;
      usdtFree = balances?.free?.USDT ?? balances?.USDT?.free ?? 0;
      if ((!usdtTotal && !usdtFree) && balances?.info) {
        const info = balances.info;
        const data = info.data || info;
        const arr = Array.isArray(data) ? data : [];
        const usdtRow = arr.find((r) => (r.ccy || r.asset || '').toUpperCase?.() === 'USDT');
        if (usdtRow) {
          // OKX 可能字段 totalEq / cashBal；Binance U本位資產可能為 availableBalance 等
          const totalEq = Number(usdtRow.totalEq || usdtRow.eq || usdtRow.balance || 0);
          const cashBal = Number(usdtRow.cashBal || usdtRow.available || usdtRow.availableBalance || 0);
          if (Number.isFinite(totalEq)) usdtTotal = totalEq;
          if (Number.isFinite(cashBal)) usdtFree = cashBal;
        }
      }
    } catch (_) {}

    // 匯總未實現損益與保證金推估
    let unrealizedSum = 0;
    let marginUsed = 0;
    try {
      for (const p of (Array.isArray(positions) ? positions : [])) {
        const side = (p.side || '').toLowerCase();
        const qty = Math.abs(Number(p.contracts ?? p.contractsSize ?? 0));
        const entry = Number(p.entryPrice || p.entry || 0);
        const lev = Number(p.leverage || user.leverage || 1);
        const unp = Number(p.unrealizedPnl || 0);
        if (Number.isFinite(unp)) unrealizedSum += unp;
        if (qty && entry && lev) marginUsed += (qty * entry) / lev;
      }
    } catch (_) {}

    // 以特化映射優先，若取不到再回退先前推估（usdtTotal/free）
    const prevSummary = getLastSummary(user._id.toString());
    let derived = deriveBalanceSummaryForExchange({ exchange: user.exchange, balances });
    let walletBalance = derived.walletBalance;
    let availableTransfer = derived.availableTransfer;
    let marginBalance = derived.marginBalance;
    if (walletBalance === undefined) walletBalance = usdtTotal;
    if (availableTransfer === undefined) availableTransfer = usdtFree;
    if (marginBalance === undefined) marginBalance = walletBalance;

    // 若仍取不到有效值（或皆為 0），直接打交易所原生快照端點作為最終回補
    const needRawFallback = (!Number(walletBalance) && !Number(availableTransfer)) || (walletBalance === undefined && availableTransfer === undefined);
    if (needRawFallback) {
      let raw = null;
      if (user.exchange === 'binance') raw = await binanceFuturesAccountRaw(creds);
      if (user.exchange === 'okx') raw = await okxAccountBalanceRaw(creds);
      if (raw) {
        balances = raw;
        derived = deriveBalanceSummaryForExchange({ exchange: user.exchange, balances });
        walletBalance = derived.walletBalance ?? walletBalance;
        availableTransfer = derived.availableTransfer ?? availableTransfer;
        marginBalance = derived.marginBalance ?? marginBalance;
        if (marginBalance === undefined && walletBalance !== undefined) marginBalance = walletBalance;
      }
    }
    // 允許 0 覆蓋：避免開/平倉後 WS 帶來的 0 被舊值攔下
    const feePaid = 0; // 需由交易回報或歷史統計獲得，這裡暫不提供
    const pnl1d = 0, pnl7d = 0, pnl30d = 0; // 需以歷史成交計算，這裡暫置 0

    const snapshot = { balances, positions, summary: { usdtTotal, usdtFree } };
    const last = BALANCE_CACHE.get(user._id.toString());
    const snapStr = JSON.stringify(snapshot);
    if (!last || last !== snapStr) {
      BALANCE_CACHE.set(user._id.toString(), snapStr);
      const changedKeys = ['walletBalance','availableTransfer','marginBalance','unrealizedPnl'];
      if (Array.isArray(positions) && positions.length > 0) changedKeys.push('positions');
      const msg = {
        type: 'account_update',
        userId: userId,
        displayName: user.name || user.uid || user._id.toString(),
        uid: user.uid,
        exchange: user.exchange,
        pair: user.pair,
        createdAt: user.createdAt || undefined,
        balances,
        // 若 positions 為空，保留上一筆持倉（避免瞬時回空導致前端消失）
        positions: (Array.isArray(positions) && positions.length > 0) ? positions : (LAST_MSG_CACHE.get(userId)?.positions || []),
        summary: {
          usdtTotal,
          usdtFree,
          walletBalance,
          availableTransfer,
          marginBalance,
          unrealizedPnl: unrealizedSum,
          feePaid,
          pnl1d,
          pnl7d,
          pnl30d,
        },
        changedKeys,
        seq: nextSeq(userId),
        ts: Date.now(),
      };
      LAST_MSG_CACHE.set(user._id.toString(), msg);
      try { bus.emit('frontend:broadcast', msg); } catch (e) { logger.warn('broadcast emit 失敗', { message: e.message }); }
    }
    LAST_POLL_AT.set(userId, Date.now());
  } catch (e) {
    logger.warn('帳戶監控失敗', { userId: user?._id?.toString?.(), message: e.message });
  }
}

function ensureAccountMonitorForUser(user, intervalMs = 8000) {
  const key = user._id.toString();
  if (userTimers.has(key)) return;
  const timer = setInterval(() => pollUserAccount(user), intervalMs);
  userTimers.set(key, timer);
  // 立即推送一次，讓前端在儲存後立刻看到數據
  pollUserAccount(user);
}

async function initAccountMonitorForExistingUsers() {
  const users = await User.find({ enabled: true });
  // 僅初始化監控計時器（若 WS-only，輪詢會直接 return）
  for (const u of users) ensureAccountMonitorForUser(u);

  // 啟動私有 WS（重啟時需重新連線）；不廣播任何快照，避免混流
  try {
    const { connectUserStream: connectBinancePrivate } = require('./wsPrivate/binancePrivate');
    const { connectPrivate: connectOkxPrivate } = require('./wsPrivate/okxPrivate');
    for (const u of users) {
      try {
        const creds = u.getDecryptedKeys();
        if (u.exchange === 'binance') connectBinancePrivate(u, creds);
        if (u.exchange === 'okx') connectOkxPrivate(u, creds);
      } catch (_) {}
    }
  } catch (_) {}

  // 啟動後回放上次快照：讓總覽/帳戶面板首屏即有資料（不依賴外部 API）
  try {
    for (const u of users) {
      try {
        const snap = await AccountSnapshot.findOne({ user: u._id });
        if (snap && snap.summary) {
          // 加入輕微隨機延遲避免同時廣播造成尖峰
          const jitter = 100 + Math.floor(Math.random() * 700);
          setTimeout(() => {
            try { module.exports.applyExternalAccountUpdate(u, { summary: snap.summary, positions: snap.positions || [] }); } catch (_) {}
          }, jitter);
        }
      } catch (_) {}
    }
  } catch (_) {}

  logger.info(`帳戶監控初始化完成，正在監控 ${userTimers.size} 位使用者`);
}

function getLastAccountMessages() {
  try {
    return Array.from(LAST_MSG_CACHE.values());
  } catch (_) { return []; }
}

module.exports = { ensureAccountMonitorForUser, initAccountMonitorForExistingUsers, getLastAccountMessages };
module.exports.getLastAccountMessageByUser = function(userId) { return LAST_MSG_CACHE.get(String(userId)); };
// 允許私有 WS 推播直接套用帳戶摘要，避免等待輪詢
module.exports.applyExternalAccountUpdate = function applyExternalAccountUpdate(user, { summary, positions }) {
  try {
    const userId = user._id.toString();
    WS_ACTIVE.add(userId);
    const balances = null; // 私有 WS 多半不含完整餘額結構，僅用 summary
    const prev = LAST_MSG_CACHE.get(userId);
    const prevSummary = prev && prev.summary ? prev.summary : {};
    // 允許 0 覆蓋：WS 帶來的最新值（包含 0）應直接覆蓋，避免可用/保證金卡住
    // 對 1/7/30 與 feePaid 使用非 0 優先的合併，避免 0 洗掉已有數值
    const mergedSummary = (() => {
      const m = mergeSummary(prevSummary, summary)
      try {
        const prefer = (a,b) => (Number.isFinite(Number(b)) && Number(b) !== 0) ? Number(b) : (Number.isFinite(Number(a)) ? Number(a) : 0)
        m.pnl1d = prefer(prevSummary.pnl1d, summary?.pnl1d)
        m.pnl7d = prefer(prevSummary.pnl7d, summary?.pnl7d)
        m.pnl30d = prefer(prevSummary.pnl30d, summary?.pnl30d)
        m.feePaid = prefer(prevSummary.feePaid, summary?.feePaid)
      } catch (_) {}
      return m
    })();
    // 合併持倉：若新持倉缺少標記價格或強平價格，沿用上一筆
    let mergedPositions = (Array.isArray(positions) && positions.length === 0) ? undefined : positions;
    try {
      const prevPos = Array.isArray(prev?.positions) ? prev.positions : [];
      const prevMap = new Map();
      for (const p of prevPos) {
        if (p && p.symbol) prevMap.set(p.symbol, p);
      }
      if (Array.isArray(positions) && positions.length > 0) {
        mergedPositions = positions.map(p => {
          const old = prevMap.get(p.symbol) || {};
          const markPrice = Number(p.markPrice);
          const liquidationPrice = Number(p.liquidationPrice);
          return {
            ...old,
            ...p,
            markPrice: Number.isFinite(markPrice) && markPrice !== 0 ? markPrice : (Number.isFinite(Number(old.markPrice)) ? Number(old.markPrice) : undefined),
            liquidationPrice: Number.isFinite(liquidationPrice) && liquidationPrice !== 0 ? liquidationPrice : (Number.isFinite(Number(old.liquidationPrice)) ? Number(old.liquidationPrice) : undefined),
            leverage: Number(p.leverage || old.leverage || user.leverage || 0),
          };
        });
      }
    } catch (_) {}
    // 即時計算未實現盈虧（特別針對 OKX，避免回跳與延遲），以最新 mergedPositions 匯總
    try {
      if (Array.isArray(mergedPositions)) {
        let unpSum = 0;
        for (const p of mergedPositions) {
          const v = Number(p && p.unrealizedPnl);
          if (Number.isFinite(v)) unpSum += v;
        }
        mergedSummary.unrealizedPnl = unpSum;
      }
    } catch (_) {}
    // 若仍缺失，嘗試以公有端點補上標記價格（不額外請求強平，避免過度頻率）
    try {
      const exchange = buildClient(user);
      // 外部推播處非 async，避免頂層 await，改用立即函式處理後再行廣播下一輪時更新
      (async () => {
        const filled = await fillPositionDerivedPrices(user, exchange, mergedPositions || []);
        // 穩定化 displayName：優先使用先前廣播的 displayName（若與當前候選不同），避免舊資料回退
        const candidateName = (user.name || user.uid || userId);
        const stableDisplayName = (prev && prev.displayName && prev.displayName !== candidateName) ? prev.displayName : candidateName;
        const msg2 = {
          type: 'account_update',
          userId,
          displayName: stableDisplayName,
          uid: user.uid,
          exchange: user.exchange,
          pair: user.pair,
          createdAt: user.createdAt || undefined,
          balances: null,
          positions: filled,
          summary: mergedSummary,
          ts: Date.now(),
        };
        LAST_MSG_CACHE.set(userId, msg2);
        try { bus.emit('frontend:broadcast', msg2); } catch (_) {}
      })();
    } catch (_) {}
    const changedKeys2 = [];
    if (summary && typeof summary === 'object') changedKeys2.push(...Object.keys(summary));
    if (Array.isArray(positions)) changedKeys2.push('positions');
    // 穩定化 displayName：優先使用先前廣播的 displayName（若與當前候選不同），避免舊資料回退
    const candidateName = (user.name || user.uid || userId);
    const stableDisplayName = (prev && prev.displayName && prev.displayName !== candidateName) ? prev.displayName : candidateName;
    const msg = {
      type: 'account_update',
      userId,
      displayName: stableDisplayName,
      uid: user.uid,
      exchange: user.exchange,
      pair: user.pair,
      createdAt: user.createdAt || undefined,
      balances,
      positions: mergedPositions || (prev?.positions || []),
      summary: mergedSummary,
      changedKeys: changedKeys2,
      seq: nextSeq(userId),
      ts: Date.now(),
    };
    LAST_MSG_CACHE.set(userId, msg);
    try { bus.emit('frontend:broadcast', msg); } catch (e) { logger.warn('broadcast emit 失敗', { message: e.message }); }

    // 若有新的成交增量，推送 PnL/手續費滾動合計
    try {
      const logs = TRADE_LOGS.get(userId);
      if (logs && logs.length) broadcastPnlSummary(user, logs);
    } catch (_) {}

    // 持久化帳戶快照（供熱啟回放）
    (async () => {
      try {
        if (HOT_START_CACHE) {
          await AccountSnapshot.findOneAndUpdate(
            { user: userId },
            { summary: msg.summary || {}, positions: msg.positions || [], ts: new Date() },
            { upsert: true, new: true }
          );
        }
      } catch (_) {}
    })();
  } catch (e) {
    logger.warn('套用外部帳戶更新失敗', { message: e.message });
  }
};

// 徹底移除指定使用者的監控與快取，並廣播移除事件（供前端從總覽刪行）
module.exports.removeUserFromMonitor = async function removeUserFromMonitor(userId) {
  try {
    const key = String(userId)
    try {
      const t = userTimers.get(key)
      if (t) { clearInterval(t); userTimers.delete(key) }
    } catch (_) {}
    try { BALANCE_CACHE.delete(key) } catch (_) {}
    try { LAST_MSG_CACHE.delete(key) } catch (_) {}
    try { SEQ_COUNTER.delete(key) } catch (_) {}
    try { WS_ACTIVE.delete(key) } catch (_) {}
    try { LAST_POLL_AT.delete(key) } catch (_) {}
    try {
      await AccountSnapshot.deleteOne({ user: key })
    } catch (_) {}
    try { bus.emit('frontend:broadcast', { type: 'user_removed', userId: key, ts: Date.now() }) } catch (_) {}
  } catch (_) {}
}

// 暴露增量累加與冷啟接口
module.exports.recordRealizedDelta = function(userId, payload) { return recordRealizedDelta(userId, payload); };
module.exports.broadcastPnlSummary = broadcastPnlSummary;
module.exports.coldStartSnapshotForUser = coldStartSnapshotForUser;
module.exports.updateRealizedFromTrade = updateRealizedFromTrade;
module.exports.getLastAccountMessageByUser = function(userId) { return LAST_MSG_CACHE.get(userId); };
// 依 userId 失效相關快取（供平倉/日結更新後呼叫）
module.exports.invalidateUserCaches = function invalidateUserCaches(userId) {
  try {
    const key = String(userId)
    try { LAST_MSG_CACHE.delete(key) } catch (_) {}
    try { BALANCE_CACHE.delete(key) } catch (_) {}
    try { SEQ_COUNTER.delete(key) } catch (_) {}
  } catch (_) {}
}
// 暴露清除單一使用者所有快取（供測試/清理使用）
module.exports.__unsafe_clearUserCache = function(userId) {
  const key = String(userId)
  try { BALANCE_CACHE.delete(key) } catch (_) {}
  try { LAST_MSG_CACHE.delete(key) } catch (_) {}
  try { SEQ_COUNTER.delete(key) } catch (_) {}
  try { WS_ACTIVE.delete(key) } catch (_) {}
  try { LAST_POLL_AT.delete(key) } catch (_) {}
}



