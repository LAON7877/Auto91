// 繁體中文註釋
// Binance U本位永續 私有 WebSocket：listenKey 建立與心跳、接收帳戶/持倉/訂單事件

const axios = require('axios')
const crypto = require('crypto')
const WebSocket = require('ws')
const logger = require('../../utils/logger')
const { enqueueHourly } = require('../telegram')
const { ymd } = require('../tgFormat')
const { applyExternalAccountUpdate } = require('../accountMonitor')
const bus = require('../eventBus')
const Trade = require('../../models/Trade')
const { notifyFill } = require('../fillNotifier')
const User = require('../../models/User')
const DailyStats = require('../../models/DailyStats')
const Outbox = require('../../models/Outbox')

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

function sign(query, secret) {
  return crypto.createHmac('sha256', secret).update(query).digest('hex')
}

async function createListenKey(apiKey, apiSecret) {
  const timestamp = Date.now()
  const query = `timestamp=${timestamp}`
  const signature = sign(query, apiSecret)
  
  const response = await axios.post(
    'https://fapi.binance.com/fapi/v1/listenKey',
    {},
    {
      headers: { 'X-MBX-APIKEY': apiKey },
      params: { timestamp, signature }
    }
  )
  return response.data.listenKey
}

async function keepAliveListenKey(apiKey, apiSecret, listenKey) {
  const timestamp = Date.now()
  const query = `timestamp=${timestamp}&listenKey=${listenKey}`
  const signature = sign(query, apiSecret)
  
  await axios.put(
    'https://fapi.binance.com/fapi/v1/listenKey',
    {},
    {
      headers: { 'X-MBX-APIKEY': apiKey },
      params: { timestamp, signature, listenKey }
    }
  )
}

function connectUserStream(user, creds) {
  let ws
  let keepTimer
  let listenKey
  let connectAttempt = 0
  let heartbeatTimeout
  let staleTimer
  let lastSeenAt = 0

  async function start() {
    try {
      connectAttempt++
      listenKey = await createListenKey(creds.apiKey, creds.apiSecret)
      ws = new WebSocket(`wss://fstream.binance.com/ws/${listenKey}`)
      
      ws.on('open', () => {
        logger.info('[BinancePrivate] 已連線 user stream')
        lastSeenAt = Date.now()
        // 啟動心跳與閒置偵測
        try { clearTimeout(heartbeatTimeout) } catch (_) {}
        try { clearTimeout(staleTimer) } catch (_) {}
        const doPing = () => {
          try { if (ws && ws.readyState === WebSocket.OPEN) ws.ping() } catch (_) {}
          try { clearTimeout(heartbeatTimeout) } catch (_) {}
          heartbeatTimeout = setTimeout(() => {
            try { ws && ws.close(1000, 'heartbeat-timeout') } catch (_) {}
          }, 8000)
          try { clearTimeout(staleTimer) } catch (_) {}
          staleTimer = setTimeout(() => {
            const age = Date.now() - lastSeenAt
            if (age > 35000) {
              logger.warn('[BinancePrivate] 偵測到閒置過久，主動重連', { ageMs: age })
              try { ws && ws.close(1000, 'stale-connection') } catch (_) {}
            }
          }, 12000)
        }
        doPing()
        setInterval(doPing, 25000)
        // 若為重連成功，發送系統告警（改走 alerts:system，尊重偏好）
        if (connectAttempt > 1) {
          try {
            try { const logger = require('../../utils/logger'); logger.metrics.markWsReconnect('binance') } catch (_) {}
            const bus = require('../eventBus')
            bus.emit('alerts:system', { user, text: '✅ Binance 私有WS已重連' })
          } catch (_) {}
        } else {
          // 進程剛啟動的第一次連線：若 5 分鐘內曾經 close，亦視為重連並通知
          ;(async () => {
            try {
              const userId = String(user._id)
              const since = new Date(Date.now() - 5 * 60 * 1000)
              const regex = new RegExp(`^win:.*:${userId}:ws-close:binance$`)
              const recent = await Outbox.findOne({ dedupeKey: { $regex: regex }, createdAt: { $gte: since } }).lean()
              if (recent) {
                const bus = require('../eventBus')
                bus.emit('alerts:system', { user, text: '✅ Binance 私有WS已重連' })
              }
            } catch (_) {}
          })()
        }

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
      
      keepTimer = setInterval(() => {
        keepAliveListenKey(creds.apiKey, creds.apiSecret, listenKey).catch(() => {})
      }, 30 * 60 * 1000)
      
      ws.on('pong', () => { lastSeenAt = Date.now(); try { clearTimeout(heartbeatTimeout) } catch (_) {} })
      ws.on('message', (buf) => {
        try {
          lastSeenAt = Date.now()
          const msg = JSON.parse(buf.toString())
          
          if (msg.e === 'ACCOUNT_UPDATE') {
            const summary = {}
            const positions = []
            
            if (msg.a && msg.a.B) {
              for (const b of msg.a.B) {
                if (b.a === 'USDT') {
                  const walletBalance = Number(b.wb || 0)
                  const availableTransfer = Number(b.cw || 0)
                  if (Number.isFinite(walletBalance)) summary.walletBalance = walletBalance
                  if (Number.isFinite(availableTransfer)) summary.availableTransfer = availableTransfer
                  break
                }
              }
            }
            
            if (msg.a && msg.a.P) {
              for (const p of msg.a.P) {
                const symbol = user.pair || (p.s ? `${p.s.replace('USDT', '')}/USDT` : '')
                const amt = Number(p.pa || 0)
                if (amt !== 0) {
                  positions.push({
                    symbol,
                    side: amt > 0 ? 'long' : 'short',
                    contracts: Math.abs(amt),
                    entryPrice: Number(p.ep || 0),
                    markPrice: Number(p.mp || 0),
                    unrealizedPnl: Number(p.up || 0),
                    leverage: Number(user.leverage || 0)
                  })
                } else {
                  positions.push({ symbol, side: 'flat', contracts: 0 })
                }
              }
            }
            
            applyExternalAccountUpdate(user, { summary, positions })
          }
          
          if (msg.e === 'ORDER_TRADE_UPDATE') {
            (async () => {
              try {
                const o = msg.o || {}
                const symbol = o.s
                const side = (o.S || '').toLowerCase() // BUY/SELL
                // 成交數量：完全成交用累計 o.z；部分成交事件可用 o.l
                const isFilled = (o.X || '').toLowerCase() === 'filled'
                const amount = Number(isFilled ? (o.z || 0) : (o.l || 0))
                const price = Number(o.L || o.ap || o.p || 0)
                const status = (o.X || '').toLowerCase() // NEW, FILLED, PARTIALLY_FILLED, CANCELED
                const reduceOnly = o.R // 關鍵：reduceOnly 字段明確指示開/平倉意圖
                const realized = Number(o.rp || 0) // Binance 回報實現盈虧（USDT）
                const mappedSide = side === 'buy' ? 'buy' : 'sell'
                
                // 僅處理完全成交的訂單
                if (status !== 'filled') return
                
                const userId = user._id.toString()
                const orderId = String(o.i || o.c || '')
                
                // WS 層面去重：防止交易所重複發送相同成交事件
                if (isOrderProcessed(userId, orderId)) return
                
                const symbolNorm = user.pair || (() => {
                  const s = String(symbol || '')
                  if (s.includes('/')) return s
                  if (s.toUpperCase().endsWith('USDT')) return `${s.slice(0, -4)}/USDT`
                  return s
                })()
                
                // 建立交易記錄
                try {
                  await Trade.create({
                    user: user._id,
                    exchange: 'binance',
                    pair: symbolNorm,
                    side: mappedSide,
                    amount,
                    price,
                    status: 'filled',
                    orderId: String(o.i || '')
                  })
                } catch (tradeErr) {
                  logger.warn('[BinancePrivate] Trade 記錄創建失敗', { error: tradeErr.message })
                }
                
                // 更新 DailyStats（僅更新計數/費用，不再寫入 closedTrades）
                try {
                  const tz = process.env.TZ || 'Asia/Taipei'
                  const today = ymd(Date.now(), tz)
                  await DailyStats.findOneAndUpdate(
                    { user: user._id, date: today },
                    { $inc: { tradeCount: 1, feeSum: Number(o.n || 0) } },
                    { upsert: true }
                  )
                  try {
                    const { invalidateUserCaches } = require('../accountMonitor')
                    invalidateUserCaches(user._id.toString())
                  } catch (_) {}
                } catch (statsErr) {
                  logger.warn('[BinancePrivate] DailyStats 更新失敗', { error: statsErr.message })
                }
                
                // 發送 Telegram 通知（使用 reduceOnly 明確判斷開/平倉）
                const ts = Number(o.T) || Date.now()

                // 即時滾動聚合（供前端秒更本日/7/30日盈虧與費用）
                try {
                  const { updateRealizedFromTrade } = require('../accountMonitor')
                  const pnl = Number(o.rp || 0)
                  const fee = Number(o.n || 0)
                  updateRealizedFromTrade(user, { ts, pnl, fee })
                } catch (_) {}
                
                // TG 通知去重檢查
                if (isTgNotificationSent(userId, orderId)) return
                
                try {
                  await notifyFill(user, { 
                    exchange: 'binance', 
                    symbol: symbolNorm, 
                    side: mappedSide, 
                    amount, 
                    price, 
                    ts, 
                    orderId, 
                    reduceOnly,
                    realized: Number.isFinite(Number(o.rp)) ? Number(o.rp) : undefined
                  })
                } catch (err) {
                  logger.error('[BinancePrivate] TG 通知發送失敗', { orderId, error: err.message })
                }
              } catch (err) {
                logger.error('[BinancePrivate] ORDER_TRADE_UPDATE 處理失敗', {
                  userId: user._id.toString(),
                  orderId: String(o.i || o.c || ''),
                  error: err.message,
                  stack: err.stack
                })
              }
              
              // 成交後即時刷新餘額（REST 補位）
              try { 
                const { coldStartSnapshotForUser } = require('../accountMonitor')
                setTimeout(() => coldStartSnapshotForUser(user).catch(() => {}), 80) 
              } catch (_) {}
            })()
          }
        } catch (_) {}
      })
      
      ws.on('close', () => {
        logger.warn('[BinancePrivate] 連線關閉，將重試')
        clearInterval(keepTimer)
        try { clearTimeout(heartbeatTimeout) } catch (_) {}
        try { clearTimeout(staleTimer) } catch (_) {}
        setTimeout(start, 5000)
        try {
          const bus = require('../eventBus')
          bus.emit('alerts:system', { user, text: '🚨 Binance 私有WS關閉' })
        } catch (_) {}
      })
      
      ws.on('error', () => {})
    } catch (e) {
      logger.warn('[BinancePrivate] 建立連線失敗，將重試', { message: e.message })
      setTimeout(start, 10000)
    }
  }

  start()
}

module.exports = { connectUserStream }