// 繁體中文註釋
// OKX 私有 WebSocket（帳戶/持倉）：簽名與訂閱

const WebSocket = require('ws')
const crypto = require('crypto')
const logger = require('../../utils/logger')
const ccxt = require('ccxt')
const { ymd } = require('../tgFormat')
const { applyExternalAccountUpdate } = require('../accountMonitor')
const bus = require('../eventBus')
const Trade = require('../../models/Trade')
const { notifyFill } = require('../fillNotifier')
const { enqueueHourly } = require('../telegram')
const User = require('../../models/User')
const DailyStats = require('../../models/DailyStats')
const Outbox = require('../../models/Outbox')

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// WS 層面去重：防止交易所重複發送相同成交事件
const PROCESSED_ORDERS = new Map() // userId -> Set<orderId>
// TG 通知去重：1分鐘內相同單號不重複發送
const TG_NOTIFICATION_CACHE = new Map() // userId:orderId -> timestamp

function isOrderProcessed(userId, orderId) {
  const userSet = PROCESSED_ORDERS.get(userId) || new Set()
  if (userSet.has(orderId)) return true
  userSet.add(orderId)
  PROCESSED_ORDERS.set(userId, userSet)
  // 清理超過 1 小時的記錄
  setTimeout(() => {
    const currentSet = PROCESSED_ORDERS.get(userId)
    if (currentSet) currentSet.delete(orderId)
  }, 60 * 60 * 1000)
  return false
}

function isTgNotificationSent(userId, orderId) {
  const key = `${userId}:${orderId}`
  const lastSent = TG_NOTIFICATION_CACHE.get(key)
  const now = Date.now()
  
  if (lastSent && (now - lastSent) < 60 * 1000) {
    // 1分鐘內已發送過
    return true
  }
  
  // 記錄發送時間
  TG_NOTIFICATION_CACHE.set(key, now)
  
  // 清理超過 5 分鐘的記錄
  setTimeout(() => {
    TG_NOTIFICATION_CACHE.delete(key)
  }, 5 * 60 * 1000)
  
  return false
}

// 全域狀態：時間同步
let OKX_TIME_OFFSET_MS = 0
let OKX_TIME_LAST_SYNC_TS = 0
let OKX_TIME_INFLIGHT = null

async function syncOkxTime(options = {}) {
  const { force = false } = options
  const now = Date.now()
  const minInterval = Number(process.env.OKX_TIME_RESYNC_MS || 60000) // 預設 60 秒內不重複打
  if (!force && (now - OKX_TIME_LAST_SYNC_TS) < minInterval) {
    return OKX_TIME_OFFSET_MS
  }
  if (OKX_TIME_INFLIGHT) {
    try { return await OKX_TIME_INFLIGHT } catch (_) { return OKX_TIME_OFFSET_MS }
  }
  const axios = require('axios')
  OKX_TIME_INFLIGHT = (async () => {
    try {
      const response = await axios.get('https://www.okx.com/api/v5/public/time')
      const serverTime = Number(response.data.data[0].ts)
      const localTime = Date.now()
      OKX_TIME_OFFSET_MS = serverTime - localTime
      OKX_TIME_LAST_SYNC_TS = Date.now()
      logger.info('[OKXPrivate] 同步伺服器時間', { offsetMs: OKX_TIME_OFFSET_MS })
    } catch (e) {
      // 429 或暫時性失敗：沿用舊 offset，不中斷流程
      logger.warn('[OKXPrivate] 時間同步失敗', { error: e.message })
    } finally {
      const v = OKX_TIME_OFFSET_MS
      OKX_TIME_INFLIGHT = null
      return v
    }
  })()
  try { return await OKX_TIME_INFLIGHT } catch (_) { return OKX_TIME_OFFSET_MS }
}

function sign(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest('base64')
}

// 市場快取：取得合約 contractSize 以正確換算張數→資產數量
const OKX_MARKETS_CACHE = { client: null, markets: null, lastTs: 0 }
async function getOkxContractSize(symbolLike) {
  try {
    const now = Date.now()
    if (!OKX_MARKETS_CACHE.client) OKX_MARKETS_CACHE.client = new ccxt.okx({ enableRateLimit: true })
    if (!OKX_MARKETS_CACHE.markets || (now - OKX_MARKETS_CACHE.lastTs) > 5 * 60 * 1000) {
      OKX_MARKETS_CACHE.markets = await OKX_MARKETS_CACHE.client.loadMarkets()
      OKX_MARKETS_CACHE.lastTs = now
    }
    const markets = OKX_MARKETS_CACHE.markets || {}
    // 嘗試直接命中；否則用 base/quote 尋找 SWAP
    const direct = markets[symbolLike]
    if (direct && Number(direct.contractSize)) return Number(direct.contractSize)
    const base = String(symbolLike || '').split('/')[0]
    const quote = String(symbolLike || '').split('/')[1]
    for (const k of Object.keys(markets)) {
      const m = markets[k]
      if (m && m.swap && String(m.base) === base && String(m.quote) === quote && Number(m.contractSize)) {
        return Number(m.contractSize)
      }
    }
  } catch (_) {}
  return NaN
}

function currentHourKey(tz) {
  const d = new Date()
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(d)
    const o = {}; for (const p of parts) o[p.type] = p.value
    return `${o.year}-${o.month}-${o.day}-${o.hour}`
  } catch (_) { return d.toISOString().slice(0,13) }
}

function connectPrivate(user, creds) {
  const url = 'wss://ws.okx.com:8443/ws/v5/private'
  let ws
  let heartbeatTimeout
  let heartbeatInterval
  let staleTimer
  let connecting = false
  let connectionId = 0
  let lastSeenAt = 0
  // 每個連線個體自己的重連狀態（避免全域風暴）
  const reconnectState = { attempt: 0, maxDelay: 5 * 60 * 1000 }

  function scheduleReconnect(reason) {
    reconnectState.attempt++
    let base = Math.min(1000 * Math.pow(2, reconnectState.attempt - 1), reconnectState.maxDelay)
    const isDnsFail = /ENOTFOUND|dns/i.test(String(reason || ''))
    if (isDnsFail) base = Math.min(3000, base)
    const jitter = Math.floor(base * (0.8 + Math.random() * 0.4))
    const delayMs = Math.min(jitter, reconnectState.maxDelay)
    logger.warn('[OKXPrivate] 連線關閉/錯誤，排程重連', { userId: String(user._id || ''), attempt: reconnectState.attempt, delayMs, reason })
    setTimeout(() => { try { connect() } catch (_) {} }, delayMs)
  }

  function clearAllTimers() {
    try { clearTimeout(heartbeatTimeout) } catch (_) {}
    try { clearInterval(heartbeatInterval) } catch (_) {}
    try { clearTimeout(staleTimer) } catch (_) {}
    heartbeatTimeout = undefined
    heartbeatInterval = undefined
    staleTimer = undefined
  }

  async function connect() {
    try {
      if (connecting) return
      connecting = true
      // 啟動分流：避免同時大量連線與 time-sync
      try { await sleep(100 + Math.floor(Math.random() * 600)) } catch (_) {}
      await syncOkxTime()
      
      const myId = ++connectionId
      ws = new WebSocket(url, { handshakeTimeout: 10000 })
      const isStale = () => myId !== connectionId
      const cleanup = () => {
        clearAllTimers()
        try { ws && ws.removeAllListeners && ws.removeAllListeners() } catch (_) {}
        connecting = false
      }
      
      ws.on('open', () => {
        if (isStale()) return
        reconnectState.attempt = 0
        logger.info('[OKXPrivate] 已連線，準備登入')
        lastSeenAt = Date.now()
        // 若為重連成功，發送系統告警（改走 alerts:system，尊重偏好）
        try {
          if (connectionId > 1) {
            try { const logger = require('../../utils/logger'); logger.metrics.markWsReconnect('okx') } catch (_) {}
            const bus = require('../eventBus')
            bus.emit('alerts:system', { user, text: '✅ OKX 私有WS已重連' })
          } else {
            // 進程剛啟動的第一次連線：若 5 分鐘內曾經 close，亦視為重連並通知
            ;(async () => {
              try {
                const userId = String(user._id)
                const since = new Date(Date.now() - 5 * 60 * 1000)
                const regex = new RegExp(`^win:.*:${userId}:ws-close:okx$`)
                const recent = await Outbox.findOne({ dedupeKey: { $regex: regex }, createdAt: { $gte: since } }).lean()
                if (recent) {
                  const bus = require('../eventBus')
                  bus.emit('alerts:system', { user, text: '✅ OKX 私有WS已重連' })
                }
              } catch (_) {}
            })()
          }
        } catch (_) {}
        
        const timestamp = ((Date.now() + OKX_TIME_OFFSET_MS) / 1000).toFixed(3)
        const method = 'GET'
        const requestPath = '/users/self/verify'
        const body = ''
        const message = timestamp + method + requestPath + body
        const signature = sign(message, creds.apiSecret)
        
        
        const loginMsg = {
          op: 'login',
          args: [{
            apiKey: creds.apiKey,
            passphrase: creds.apiPassphrase,
            timestamp: timestamp,
            sign: signature
          }]
        }
        
        ws.send(JSON.stringify(loginMsg))
        
        // 啟動心跳（同時使用原生 ping 與 OKX 應用層 ping）
        const startHeartbeat = () => {
          // 先清一次，避免重複計時器
          clearAllTimers()
          const doPing = () => {
            if (isStale() || !ws || ws.readyState !== WebSocket.OPEN) return
            try { ws.ping() } catch (_) {}
            try { ws.send(JSON.stringify({ op: 'ping' })) } catch (_) {}
            try { clearTimeout(heartbeatTimeout) } catch (_) {}
            heartbeatTimeout = setTimeout(() => {
              if (isStale()) return
              logger.warn('[OKXPrivate] 心跳逾時，終止連線')
              try { ws.close(1000, 'heartbeat-timeout') } catch (_) {}
              try { setTimeout(() => { try { ws.terminate() } catch (_) {} }, 1500) } catch (_) {}
            }, 8000)
            try { clearTimeout(staleTimer) } catch (_) {}
            staleTimer = setTimeout(() => {
              if (isStale()) return
              const age = Date.now() - lastSeenAt
              if (age > 35000) {
                logger.warn('[OKXPrivate] 偵測到連線閒置過久，主動重連', { ageMs: age })
                try { ws.close(1000, 'stale-connection') } catch (_) {}
              }
            }, 12000)
          }
          // 立即 ping 一次，之後每 25 秒
          doPing()
          heartbeatInterval = setInterval(doPing, 25000)
        }
        startHeartbeat()
        // 重連後立即回補：冷啟快照 + 近1/7/30聚合
        ;(async () => {
          try {
            const { coldStartSnapshotForUser } = require('../accountMonitor')
            const { aggregateForUser } = require('../pnlAggregator')
            await coldStartSnapshotForUser(user)
            await aggregateForUser(user)
          } catch (_) {}
        })()
      })

      ws.on('pong', () => {
        if (isStale()) return
        lastSeenAt = Date.now()
        try { clearTimeout(heartbeatTimeout) } catch (_) {}
      })

      ws.on('ping', () => {
        if (isStale()) return
        lastSeenAt = Date.now()
        try { ws.pong() } catch (_) {}
      })

      ws.on('message', (buf) => {
        try {
          if (isStale()) return
          lastSeenAt = Date.now()
          try { clearTimeout(heartbeatTimeout) } catch (_) {}
          const msg = JSON.parse(buf.toString())
          
          if (msg.event === 'login') {
            if (msg.code === '0') {
              logger.info('[OKXPrivate] 登入成功，訂閱頻道')
              ws.send(JSON.stringify({
                op: 'subscribe',
                args: [
                  { channel: 'account' },
                  { channel: 'positions', instType: 'SWAP' },
                  { channel: 'orders', instType: 'SWAP' }
                ]
              }))
              // 登入成功後，非阻塞地執行一次冷啟快照，縮短首屏空窗
              try {
                const { coldStartSnapshotForUser } = require('../accountMonitor')
                setTimeout(() => { try { coldStartSnapshotForUser(user) } catch (_) {} }, 200 + Math.floor(Math.random()*800))
              } catch (_) {}
            } else {
              logger.error('[OKXPrivate] 登入失敗', { code: msg.code, msg: msg.msg, userId: String(user._id || ''), email: user.email || undefined })
            }
            return
          }

          // 帳戶更新
          if (msg.arg && msg.arg.channel === 'account' && Array.isArray(msg.data)) {
            const summary = {}
            for (const acc of msg.data) {
              if (acc.ccy === 'USDT') {
                const walletBalance = Number(acc.eq || 0)
                const availableTransfer = Number(acc.availEq || 0)
                if (Number.isFinite(walletBalance)) summary.walletBalance = walletBalance
                if (Number.isFinite(availableTransfer)) summary.availableTransfer = availableTransfer
                break
              }
            }
            applyExternalAccountUpdate(user, { summary })
          }

          // 持倉更新
          if (msg.arg && msg.arg.channel === 'positions' && Array.isArray(msg.data)) {
            (async () => {
              try {
                const positions = []
                for (const r of msg.data) {
                  const symbol = user.pair || ((r.instId || '').split('-').slice(0,2).join('/'))
                  const amt = Number(r.pos || 0)
                  if (amt !== 0) {
                    let baseQty = Math.abs(amt)
                    try {
                      const cs = await getOkxContractSize(symbol)
                      if (Number.isFinite(cs) && cs > 0) baseQty = baseQty * cs
                    } catch (_) {}
                    positions.push({
                      symbol,
                      side: amt > 0 ? 'long' : 'short',
                      contracts: baseQty, // 統一以基礎資產數量表示
                      contractsScaled: true,
                      entryPrice: Number(r.avgPx || 0),
                      markPrice: Number(r.markPx || 0),
                      unrealizedPnl: Number(r.upl || 0),
                      leverage: Number(r.lever || user.leverage || 0),
                      liquidationPrice: Number(r.liqPx || 0)
                    })
                  } else {
                    positions.push({ symbol, side: 'flat', contracts: 0 })
                  }
                }
                applyExternalAccountUpdate(user, { positions })
              } catch (_) {}
            })()
          }

          // 訂單/成交事件
          if (msg.arg && msg.arg.channel === 'orders' && Array.isArray(msg.data)) {
            (async () => {
              try {
                for (const o of msg.data) {
                  const symbol = user.pair || ((o.instId || '').split('-').slice(0,2).join('/'))
                  const sideRaw = (o.side || '').toLowerCase() // buy/sell
                  const mappedSide = sideRaw === 'buy' ? 'buy' : 'sell'
                  // OKX 成交回報數量為張數；換算為基礎資產數量 = contracts * contractSize
                  let amount = Number(o.fillSz || o.accFillSz || o.sz || 0)
                  try {
                    const cs = await getOkxContractSize(symbol)
                    if (Number.isFinite(cs) && cs > 0) amount = amount * cs
                  } catch (_) {}
                  const price = Number(o.fillPx || o.avgPx || o.px || 0)
                  const state = (o.state || '').toLowerCase() // live, canceled, filled, partially_filled
                  const reduceOnlyRaw = o.reduceOnly // 關鍵：reduceOnly 字段明確指示開/平倉意圖
                  const reduceOnly = (typeof reduceOnlyRaw === 'boolean') ? reduceOnlyRaw : (String(reduceOnlyRaw).toLowerCase() === 'true')
                  const realized = Number(o.pnl || 0) // 若 OKX 回報含 pnl，直接使用

                  logger.info('[OKXPrivate] 收到成交事件', {
                    userId: user._id.toString(),
                    orderId: String(o.ordId || ''),
                    state,
                    side: mappedSide,
                    amount,
                    price,
                    reduceOnly
                  })

                  // 僅處理完全成交的訂單
                  if (state !== 'filled') {
                    logger.info('[OKXPrivate] 跳過非完全成交', { state })
                    continue
                  }
                  
                  const userId = user._id.toString()
                  const orderId = String(o.ordId || '')
                  
                  // WS 層面去重：防止交易所重複發送相同成交事件
                  if (isOrderProcessed(userId, orderId)) continue
                  
                  // 建立交易記錄
                  await Trade.create({
                    user: user._id,
                    exchange: 'okx',
                    pair: symbol,
                    side: mappedSide,
                    amount,
                    price,
                    status: 'filled',
                    orderId
                  })
                  
                  // 更新 DailyStats（使用 TZ 對齊的日期鍵；不再寫入 closedTrades）
                  const tz = process.env.TZ || 'Asia/Taipei'
                  const today = ymd(Date.now(), tz)
                  await DailyStats.findOneAndUpdate(
                    { user: user._id, date: today },
                    { $inc: { tradeCount: 1, feeSum: Number(o.fee || 0) } },
                    { upsert: true }
                  )
                  try {
                    const { invalidateUserCaches } = require('../accountMonitor')
                    invalidateUserCaches(user._id.toString())
                  } catch (_) {}
                  
                  // 發送 Telegram 通知（使用 reduceOnly 明確判斷開/平倉）
                  const ts = Number(o.uTime || o.fillTime) || Date.now()

                  // 即時滾動聚合（供前端秒更本日/7/30日盈虧與費用）
                  try {
                    const { updateRealizedFromTrade } = require('../accountMonitor')
                    // OKX 訂單回報可能不帶實現盈虧；平倉時計算 realized 後餵入增量
                    let realizedPnl = Number(o.pnl || 0)
                    if (reduceOnly === true) {
                      try {
                        const { getLastAccountMessageByUser } = require('../accountMonitor')
                        const last = getLastAccountMessageByUser(user._id.toString()) || {}
                        const p = (Array.isArray(last.positions) ? last.positions : []).find(x => 
                          String(x.symbol||'').toUpperCase() === String(symbol||'').toUpperCase()
                        )
                        const { computeCloseRealizedPnl } = require('../pnlCalculator')
                        realizedPnl = computeCloseRealizedPnl({
                          positionSide: mappedSide === 'buy' ? 'short' : 'long',
                          entryPrice: Number(p?.entryPrice || 0),
                          fillPrice: Number(price || 0),
                          quantity: Number(amount || 0),
                          includeFees: false
                        })
                      } catch (_) {}
                    }
                    const fee = Number(o.fee || 0)
                    updateRealizedFromTrade(user, { ts, pnl: Number(realizedPnl || 0), fee })
                  } catch (_) {}
                  
                  // TG 通知去重檢查
                  if (isTgNotificationSent(userId, orderId)) {
                    logger.info('[OKXPrivate] TG 通知已發送過，跳過', { orderId })
                    continue
                  }
                  
                  try {
                    await notifyFill(user, { 
                      exchange: 'okx', 
                      symbol, 
                      side: mappedSide, 
                      amount, 
                      price, 
                      ts, 
                      orderId, 
                      reduceOnly,
                      realized: Number.isFinite(Number(o.pnl)) ? Number(o.pnl) : undefined
                    })
                    logger.info('[OKXPrivate] TG 通知發送完成', { orderId })
                  } catch (err) {
                    logger.error('[OKXPrivate] TG 通知發送失敗', { orderId, error: err.message })
                  }
                  // 成交後即時刷新餘額/持倉（REST 補位），行為與幣安一致
                  try {
                    const { coldStartSnapshotForUser } = require('../accountMonitor')
                    setTimeout(() => coldStartSnapshotForUser(user).catch(() => {}), 80)
                  } catch (_) {}
                }
              } catch (_) {}
            })()
          }
        } catch (_) {}
      })

      ws.on('close', (code, reason) => {
        if (isStale()) return
        clearAllTimers()
        cleanup()
        scheduleReconnect(`close:${code}:${reason}`)
        try {
          const { getUserPrefs } = require('../alerts/preferences')
          const prefs = getUserPrefs(user._id)
          // system alerts 依偏好在 alerts/index.js 處理；這裡只發事件
          const txt = `🚨 OKX 私有WS關閉 code=${code}`
          const bus = require('../eventBus')
          bus.emit('alerts:system', { user, text: txt })
        } catch (_) {}
      })

      ws.on('error', (err) => {
        if (isStale()) return
        logger.warn('[OKXPrivate] WebSocket 錯誤', { error: err.message })
        try { ws.close() } catch (_) {}
        try {
          const txt = `🚨 OKX 私有WS錯誤 ${err.message}`
          const bus = require('../eventBus')
          bus.emit('alerts:system', { user, text: txt })
        } catch (_) {}
      })

    } catch (e) {
      logger.warn('[OKXPrivate] 連線失敗', { error: e.message })
      scheduleReconnect(`error:${e.message}`)
    }
  }

  connect()
}

module.exports = { connectPrivate }