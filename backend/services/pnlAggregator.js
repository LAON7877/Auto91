// 繁體中文註釋
// 成本/實現損益/區間 PnL 彙總器（REST）：
// - 以 ccxt 針對每位使用者的交易對，抓取近 1/7/30 天成交，彙總 fee 與 realized PnL
// - 週期性執行並透過 applyExternalAccountUpdate 推送到前端帳戶摘要

const ccxt = require('ccxt')
const User = require('../models/User')
const logger = require('../utils/logger')
const { applyExternalAccountUpdate } = require('./accountMonitor')
const DailyStats = require('../models/DailyStats')
const { ymd } = require('./tgFormat')

function buildClient(user) {
  const creds = user.getDecryptedKeys()
  if (user.exchange === 'binance') {
    return new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
  }
  if (user.exchange === 'okx') {
    return new ccxt.okx({ apiKey: creds.apiKey, secret: creds.apiSecret, password: creds.apiPassphrase || undefined, enableRateLimit: true })
  }
  throw new Error('unsupported exchange')
}

function sinceMs(days) { return Date.now() - days * 24 * 60 * 60 * 1000 }

async function fetchTradesSegmented(client, exchangeId, symbol, days) {
  const now = Date.now()
  const start = now - days * 24 * 60 * 60 * 1000
  const segments = 6
  const segMs = Math.ceil((days * 24 * 60 * 60 * 1000) / segments)
  let all = []
  for (let i = 0; i < segments; i++) {
    const segStart = start + i * segMs
    const segEnd = Math.min(start + (i + 1) * segMs, now)
    let since = segStart
    let safety = 0
    let lastTs = 0
    do {
      let page = []
      try {
        const params = {}
        // 嘗試提供 endTime/until 以縮小範圍（部分交易所支援）；OKX 加上合約型別
        if (exchangeId === 'binance') params.endTime = segEnd
        if (exchangeId === 'okx') { params.until = Math.floor(segEnd); params.instType = 'SWAP' }
        page = await client.fetchMyTrades(symbol, since, 500, params)
        // 若回傳為空，嘗試不帶 symbol（部分交易所需如此）再用 symbol 過濾
        if ((!Array.isArray(page) || page.length === 0)) {
          const pageAll = await client.fetchMyTrades(undefined, since, 500, params).catch(() => [])
          if (Array.isArray(pageAll) && pageAll.length) {
            const norm = (s) => (String(s || '').replace(':USDT','').replace('-SWAP','').replace('-', '/'))
            page = pageAll.filter(t => norm(t.symbol) === norm(symbol))
          }
        }
      } catch (e) {
        try { if (String(e && e.message || '').includes('429')) { const logger2 = require('../utils/logger'); logger2.metrics.markRest429() } } catch (_) {}
        page = []
      }
      if (!Array.isArray(page) || page.length === 0) break
      // 過濾出現在 segment 內的
      for (const t of page) {
        const ts = Number(t.timestamp || 0)
        if (ts >= segStart && ts <= segEnd) all.push(t)
      }
      // 推進 since，避免卡在同一頁
      lastTs = Number(page[page.length - 1]?.timestamp || 0)
      since = lastTs + 1
      safety++
    } while (since < segEnd && safety < 10)
  }
  return all
}

async function aggregateForUser(user) {
  const client = buildClient(user)
  const symbol = user.pair
  const windows = [
    { key: 'pnl1d', feeKey: 'fee1d', days: 1 },
    { key: 'pnl7d', feeKey: 'fee7d', days: 7 },
    { key: 'pnl30d', feeKey: 'fee30d', days: 30 },
  ]
  const result = { feePaid: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0, fee1d: 0, fee7d: 0, fee30d: 0 }

  // 盡力以 ccxt 的 fetchMyTrades；若不支援或受限，忽略錯誤（保留 0）
  for (const w of windows) {
    try {
      // 30d 需要分段/翻頁
      let trades = []
      try {
        trades = await fetchTradesSegmented(client, client.id, symbol, w.days)
      } catch (_) {
        // 回退：不帶 symbol 再過濾，OKX/部分交換所需
        const params = {}
        if (client.id === 'okx') params.instType = 'SWAP'
        const all = await client.fetchMyTrades(undefined, sinceMs(w.days), 500, params).catch(() => [])
        if (Array.isArray(all) && all.length) {
          const norm = (s) => (String(s || '').replace(':USDT','').replace('-SWAP','').replace('-', '/'))
          trades = all.filter(t => norm(t.symbol) === norm(symbol))
        } else {
          trades = []
        }
      }

      // 聚合：費用與 PnL（含回補）
      let sumPnl = 0
      let sumFee = 0
      for (const t of trades) {
        if (t.fee && typeof t.fee.cost === 'number') sumFee += t.fee.cost
      }
      // 先嘗試直接讀 realized PnL 欄位
      let directPnl = 0
      for (const t of trades) {
        const info = t.info || {}
        const keys = ['realizedPnl', 'realizedPNL', 'pnl', 'profit']
        let used = false
        for (const k of keys) { if (info[k] !== undefined && Number.isFinite(Number(info[k]))) { directPnl += Number(info[k]); used = true; break } }
      }

      // 若直接 PnL 不足，回補：按交易時間排序做倉位簿，僅在減倉時計入實現
      let backfillPnl = 0
      try {
        const sorted = [...trades].sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))
        let posQty = 0 // >0 long, <0 short（基礎資產數量）
        let avgPx = 0
        for (const t of sorted) {
          const side = String(t.side||'').toLowerCase() // buy/sell
          const price = Number(t.price||t.cost/(t.amount||1)||0)
          const qty = Math.abs(Number(t.amount||0))
          if (!Number.isFinite(price) || !Number.isFinite(qty) || qty<=0) continue
          // 減倉部分帶來實現 PnL
          if (side === 'buy') {
            if (posQty < 0) {
              const closeQty = Math.min(qty, Math.abs(posQty))
              // 平空：open(avgPx) - close(price)
              backfillPnl += (avgPx - price) * closeQty
              posQty += closeQty // towards zero
              const remain = qty - closeQty
              if (remain > 0) {
                // 轉為加多
                const total = posQty + remain
                avgPx = ((Math.max(posQty,0)*avgPx) + (remain*price)) / Math.max(total, remain)
                posQty += remain
              }
            } else {
              // 加多
              const total = posQty + qty
              avgPx = total ? ((posQty*avgPx)+(qty*price))/total : price
              posQty = total
            }
          } else {
            // sell
            if (posQty > 0) {
              const closeQty = Math.min(qty, Math.abs(posQty))
              // 平多：close(price) - open(avgPx)
              backfillPnl += (price - avgPx) * closeQty
              posQty -= closeQty
              const remain = qty - closeQty
              if (remain > 0) {
                // 轉為加空
                const totalShort = Math.abs(posQty) + remain
                avgPx = ((Math.abs(posQty)*avgPx) + (remain*price)) / Math.max(totalShort, remain)
                posQty -= remain
              }
            } else {
              // 加空
              const totalShort = Math.abs(posQty) + qty
              avgPx = totalShort ? ((Math.abs(posQty)*avgPx)+(qty*price))/totalShort : price
              posQty -= qty
            }
          }
        }
      } catch (_) {}

      sumPnl = directPnl || backfillPnl
      result[w.key] = sumPnl
      result[w.feeKey] = sumFee
      logger.metrics.markReconcileSuccess()
    } catch (e) {
      logger.warn('PnL 聚合失敗', { userId: user._id.toString(), message: e.message, window: w.key })
      try { logger.metrics.markReconcileFail() } catch (_) {}
    }
  }

  // 監控補救：若 1/7/30 連續相等 N 次（且非全 0），觸發全量對帳告警
  try {
    const EQ_N = Number(process.env.EQ_RECONCILE_THRESHOLD || 3)
    if (!global.__EQ_MEMO) global.__EQ_MEMO = new Map()
    const same = (Number(result.pnl1d||0) === Number(result.pnl7d||0) && Number(result.pnl7d||0) === Number(result.pnl30d||0) && Number(result.pnl1d||0) !== 0)
    const key = user._id.toString()
    const prev = global.__EQ_MEMO.get(key) || 0
    const next = same ? prev + 1 : 0
    global.__EQ_MEMO.set(key, next)
    if (same && next >= EQ_N) {
      const logger2 = require('../utils/logger')
      logger2.warn('偵測到 1/7/30 PnL 連續相等，觸發補救對帳', { userId: key, streak: next })
      logger2.metrics.markReconcileFail()
      global.__EQ_MEMO.set(key, 0)
    }
  } catch (_) {}

  // 推送
  // 當天手續費顯示為 feePaid
  result.feePaid = result.fee1d
  applyExternalAccountUpdate(user, { summary: result })

  // 將 1 日聚合更新寫入 DailyStats，供跨重啟精準統計
  try {
    const dateKey = ymd(Date.now(), process.env.TZ || 'UTC')
    await DailyStats.updateOne({ user: user._id, date: dateKey }, {
      $set: { },
      $inc: { tradeCount: 0 },
      $setOnInsert: { closedTrades: [] },
      $max: {},
      $min: {},
      $set: { feeSum: Number(result.fee1d || 0), pnlSum: Number(result.pnl1d || 0) }
    }, { upsert: true })
  } catch (_) {}
}

let __baselineWatermark = new Map() // userId -> { ts, pnl1d, pnl7d, pnl30d, fee1d }
let timer = null
async function initPnlAggregator(intervalMs = 5 * 60 * 1000) {
  if (timer) return
  const User = require('../models/User')
  async function runOnce() {
    try {
      const users = await User.find({ enabled: true }).lean()
      for (const u of users) {
        try {
          // 移除 OKX 舊覆寫：OKX 由 okxPnlService 負責
          if (String(u.exchange || '').toLowerCase() === 'okx') continue
          await aggregateForUser(u)
          __baselineWatermark.set(String(u._id), { ts: Date.now() })
        } catch (_) {}
      }
    } catch (_) {}
  }
  // 啟動時先跑一次，之後定時回補
  runOnce().catch(()=>{})
  timer = setInterval(() => runOnce().catch(()=>{}), intervalMs)
}

module.exports = { initPnlAggregator }

// 額外導出單次聚合（供啟動時回補）
module.exports.aggregateForUser = aggregateForUser


