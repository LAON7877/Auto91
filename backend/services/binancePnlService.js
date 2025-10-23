// 繁體中文註釋
// Binance PnL 服務：以交易重算 1/7/30 與 fee，寫入快取，提供查詢

const ccxt = require('ccxt')
const User = require('../models/User')
const BinancePnlCache = require('../models/BinancePnlCache')
const { ymd } = require('./tgFormat')
const logger = require('../utils/logger')

function sinceMs(days) { return Date.now() - days * 24 * 60 * 60 * 1000 }

// 將各種幣安符號（含 BTC/USDT 與 BTC/USDT:USDT）正規化為 BTCUSDT
function normSym(s) {
  return String(s || '').toUpperCase().replace(':USDT', '').replace(/[^A-Z0-9]/g, '')
}

async function fetchTradesSegmentedBinance(client, symbol, days) {
  // 幣安 7 天限制：以 7 天為段，並以 endTime 限定上界；明確指定 type=future
  const out = []
  const want = normSym(symbol)
  const now = Date.now()
  const totalMs = days * 24 * 60 * 60 * 1000
  const segMs = 7 * 24 * 60 * 60 * 1000
  const startTs = now - totalMs
  const endTs = now
  const segments = Math.max(1, Math.ceil(totalMs / segMs))
  for (let i = 0; i < segments; i++) {
    const segStart = Math.min(startTs + i * segMs, endTs)
    const segEnd = Math.min(segStart + segMs, endTs)
    let sinceTs = segStart
    let safety = 0
    while (sinceTs < segEnd && safety < 20) {
      let batch = []
      try {
        // ccxt 會將 since 映射為 startTime；這裡同時提供 endTime 以界定上限
        batch = await client.fetchMyTrades(symbol, sinceTs, 500, { type: 'future', endTime: segEnd })
      } catch (_) { batch = [] }
      if (!Array.isArray(batch) || batch.length === 0) break
      const filtered = batch.filter(t => normSym(t.symbol) === want && Number(t.timestamp || 0) >= segStart && Number(t.timestamp || 0) <= segEnd)
      out.push(...filtered)
      const lastTs = Number(batch[batch.length - 1]?.timestamp || 0)
      if (!Number.isFinite(lastTs) || lastTs <= sinceTs) break
      sinceTs = lastTs + 1
      safety++
      if (batch.length < 500) break
    }
  }
  return out
}

// 抓取指定時間範圍（[startTs, endTs]）內的 funding（USDT 計價）
async function fetchFundingRangeBinance(client, symbol, startTs, endTs) {
  try {
    const sym = normSym(symbol)
    const out = []
    const limit = 1000
    let start = Number(startTs)
    let safety = 0
    while (start <= endTs && safety < 50) {
      let page = []
      try {
        // 直接使用 binance USD-M 期貨收入明細 API
        // incomeType=FUNDING_FEE 僅回傳資金費，symbol 使用 BTCUSDT 等無斜線格式
        page = await client.fapiPrivateGetIncome({ symbol: sym, incomeType: 'FUNDING_FEE', startTime: start, endTime: endTs, limit })
      } catch (_) { page = [] }
      if (!Array.isArray(page) || page.length === 0) break
      out.push(...page)
      const lastTs = Number(page[page.length - 1]?.time || page[page.length - 1]?.T || 0)
      if (!Number.isFinite(lastTs) || lastTs <= start) break
      start = lastTs + 1
      if (page.length < limit) break
      safety++
    }
    // 匯總為 USDT 值；Binance income 的 income 值已為 USDT（USD-M）
    let sum = 0
    for (const it of out) {
      try {
        const ts = Number(it.time || it.T || 0)
        const s = String(it.symbol || '').toUpperCase()
        if (ts < startTs || ts > endTs) continue
        if (String(s).toUpperCase() !== sym) continue
        const amt = Number(it.income || it.info?.income || 0)
        if (Number.isFinite(amt)) sum += amt
      } catch (_) {}
    }
    return sum
  } catch (_) { return 0 }
}

async function fetchFundingForDaysBinance(client, symbol, days) {
  const end = Date.now()
  const start = end - (days * 24 * 60 * 60 * 1000)
  return fetchFundingRangeBinance(client, symbol, start, end)
}

function tzWeekRange(tz) {
  try {
    const d = new Date()
    // 取得當地時區的年月日與星期
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d)
    const y = Number(parts.find(p => p.type === 'year')?.value)
    const m = Number(parts.find(p => p.type === 'month')?.value) - 1
    const day = Number(parts.find(p => p.type === 'day')?.value)
    // 計算本週一（以 tz 為準）
    const cur = new Date(Date.UTC(y, m, day, 0, 0, 0))
    const tzOffsetMs = new Date(cur.toLocaleString('en-US', { timeZone: tz })).getTime() - cur.getTime()
    const localMidnight = new Date(cur.getTime() + tzOffsetMs)
    const dow = localMidnight.getDay() // 0 Sun ... 1 Mon
    const daysFromMon = (dow === 0 ? 6 : (dow - 1))
    const mondayLocal = new Date(localMidnight.getTime() - daysFromMon * 24 * 60 * 60 * 1000)
    // 週日結束時間：週一 + 6 天 + 23:59:59.999
    const sundayLocalEnd = new Date(mondayLocal.getTime() + 6 * 24 * 60 * 60 * 1000 + (24 * 60 * 60 * 1000 - 1))
    return { startTs: mondayLocal.getTime(), endTs: sundayLocalEnd.getTime() }
  } catch (_) {
    const now = new Date(); const dow = now.getDay(); const daysFromMon = (dow === 0 ? 6 : (dow - 1));
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysFromMon, 0, 0, 0, 0)
    const sundayEnd = new Date(monday.getTime() + (7 * 24 * 60 * 60 * 1000) - 1)
    return { startTs: monday.getTime(), endTs: sundayEnd.getTime() }
  }
}

async function fetchTradesRangeBinance(client, symbol, startTs, endTs) {
  const out = []
  const want = normSym(symbol)
  let sinceTs = Number(startTs)
  let safety = 0
  while (sinceTs <= endTs && safety < 50) {
    let batch = []
    try {
      batch = await client.fetchMyTrades(symbol, sinceTs, 500, { type: 'future', endTime: endTs })
    } catch (_) { batch = [] }
    if (!Array.isArray(batch) || batch.length === 0) break
    const filtered = batch.filter(t => normSym(t.symbol) === want && Number(t.timestamp || 0) >= startTs && Number(t.timestamp || 0) <= endTs)
    out.push(...filtered)
    const lastTs = Number(batch[batch.length - 1]?.timestamp || 0)
    if (!Number.isFinite(lastTs) || lastTs <= sinceTs) break
    sinceTs = lastTs + 1
    safety++
    if (batch.length < 500) break
  }
  return out
}

async function getWeeklySummary(userId, { tz = (process.env.TZ || 'Asia/Taipei') } = {}) {
  const user = await User.findById(userId)
  if (!user) throw new Error('user not found')
  if (String(user.exchange || '').toLowerCase() !== 'binance') throw new Error('not_binance')
  const creds = user.getDecryptedKeys()
  const client = new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
  const sym = String(user.pair || 'BTC/USDT')
  const { startTs, endTs } = tzWeekRange(tz)
  let trades = []
  try { trades = await fetchTradesRangeBinance(client, sym, startTs, endTs) } catch (_) { trades = [] }
  const hasTrade = Array.isArray(trades) && trades.length > 0
  const { realized, fee } = computePnLFromTrades(trades)
  let funding = 0
  try { funding = await fetchFundingRangeBinance(client, sym, startTs, endTs) } catch (_) { funding = 0 }
  // 週盈虧：一律計入 funding；即使無交易週也保留 funding 成分
  let pnlWeek = Number(realized) - Number(Math.abs(fee)) + Number(funding)
  const percent = Number(process.env.WEEKLY_COMMISSION_PERCENT || 0.1)
  const commission = Math.round(Number(pnlWeek || 0) * percent)
  return { pnlWeek, feeWeek: hasTrade ? Number(fee || 0) : 0, fundingWeek: Number(funding || 0), hasTradeWeek: !!hasTrade, realizedWeek: Number(realized || 0), commissionWeek: commission }
}

function computePnLFromTrades(trades) {
  let realized = 0
  let fee = 0
  for (const t of (Array.isArray(trades) ? trades : [])) {
    const info = t.info || {}
    // 手續費：ccxt 正常在 t.fee.cost；若無則回退 0
    if (t.fee && typeof t.fee.cost === 'number') fee += Number(t.fee.cost)
    // 已實現：優先 info.realizedPnl/realizedPNL/pnl/profit
    const keys = ['realizedPnl', 'realizedPNL', 'pnl', 'profit']
    for (const k of keys) {
      if (info[k] !== undefined && Number.isFinite(Number(info[k]))) { realized += Number(info[k]); break }
    }
  }
  return { realized, fee }
}

async function computeAndCache(userId) {
  const tz = process.env.TZ || 'Asia/Taipei'
  const user = await User.findById(userId)
  if (!user) throw new Error('user not found')
  if (String(user.exchange || '').toLowerCase() !== 'binance') throw new Error('not_binance')
  const creds = user.getDecryptedKeys()
  const client = new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
  const sym = String(user.pair || 'BTC/USDT')

  const windows = [
    { key: 'pnl1d', feeKey: 'fee1d', days: 1, hasKey: 'hasTrade1d' },
    { key: 'pnl7d', feeKey: 'fee7d', days: 7, hasKey: 'hasTrade7d' },
    { key: 'pnl30d', feeKey: 'fee30d', days: 30, hasKey: 'hasTrade30d' },
  ]
  const out = { fee1d: 0, fee7d: 0, fee30d: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0, hasTrade1d: false, hasTrade7d: false, hasTrade30d: false }

  for (const w of windows) {
    let trades = []
    try { trades = await fetchTradesSegmentedBinance(client, sym, w.days) } catch (_) { trades = [] }
    const hasTrade = Array.isArray(trades) && trades.length > 0
    const { realized, fee } = computePnLFromTrades(trades)
    // 口徑更新：1/7/30 = 交易實現損益 − 手續費 + 資金費（與 OKX 一致）
    let funding = 0
    try { funding = await fetchFundingForDaysBinance(client, sym, w.days) } catch (_) { funding = 0 }
    let pnlNet = Number(realized) - Number(Math.abs(fee)) + Number(funding)
    if (!hasTrade) pnlNet = 0
    out[w.key] = pnlNet
    out[w.feeKey] = hasTrade ? fee : 0
    out[w.hasKey] = !!hasTrade
  }

  const today = ymd(Date.now(), tz)
  await BinancePnlCache.findOneAndUpdate(
    { user: user._id, date: today },
    { $set: { ...out, date: today } },
    { upsert: true, new: true }
  )
  return out
}

const LAST_COMPUTE_AT = new Map() // userId -> ts

async function computeWindows(userId) {
  const user = await User.findById(userId)
  if (!user) throw new Error('user not found')
  if (String(user.exchange || '').toLowerCase() !== 'binance') throw new Error('not_binance')
  const creds = user.getDecryptedKeys()
  const client = new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
  const sym = String(user.pair || 'BTC/USDT')
  const windows = [
    { key: '1d', days: 1 },
    { key: '7d', days: 7 },
    { key: '30d', days: 30 },
  ]
  const out = {}
  for (const w of windows) {
    let trades = []
    try { trades = await fetchTradesSegmentedBinance(client, sym, w.days) } catch (_) { trades = [] }
    const hasTrade = Array.isArray(trades) && trades.length > 0
    const { realized, fee } = computePnLFromTrades(trades)
    let pnlNet = Number(realized) - Number(Math.abs(fee))
    if (!hasTrade) pnlNet = 0
    out[`realized${w.key}`] = Number(realized || 0)
    out[`fee${w.key}`] = hasTrade ? Number(fee || 0) : 0
    out[`pnl${w.key}`] = Number(pnlNet || 0)
    out[`hasTrade${w.key}`] = !!hasTrade
    out[`tradesCount${w.key}`] = Array.isArray(trades) ? trades.length : 0
  }
  return out
}

async function getSummary(userId, { refresh = false, debug = false } = {}) {
  const tz = process.env.TZ || 'Asia/Taipei'
  const today = ymd(Date.now(), tz)
  // 與 OKX 對齊：優先取當日快取，退而求其次取最新 updatedAt
  let doc = await BinancePnlCache.findOne({ user: userId, date: today }).sort({ updatedAt: -1 })
  const now = Date.now()
  const last = Number(LAST_COMPUTE_AT.get(String(userId)) || 0)
  const allowRecompute = (now - last) >= 30000
  if (!doc || refresh || allowRecompute) {
    try { await computeAndCache(userId); LAST_COMPUTE_AT.set(String(userId), now) } catch (_) {}
    doc = await BinancePnlCache.findOne({ user: userId, date: today }).sort({ updatedAt: -1 })
  }
  const o = doc ? doc.toObject() : { fee1d: 0, fee7d: 0, fee30d: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0 }
  const base = {
    feePaid: Number(o.fee1d || 0),
    pnl1d: Number(o.pnl1d || 0),
    pnl7d: Number(o.pnl7d || 0),
    pnl30d: Number(o.pnl30d || 0),
    hasTrade1d: !!o.hasTrade1d,
    hasTrade7d: !!o.hasTrade7d,
    hasTrade30d: !!o.hasTrade30d,
  }
  if (!debug) return base
  try {
    const det = await computeWindows(userId)
    return { ...base,
      realized1d: det.realized1d, realized7d: det.realized7d, realized30d: det.realized30d,
      fee1d: det.fee1d, fee7d: det.fee7d, fee30d: det.fee30d,
      tradesCount1d: det.tradesCount1d, tradesCount7d: det.tradesCount7d, tradesCount30d: det.tradesCount30d,
    }
  } catch (_) { return base }
}

async function cleanupOld(days = 40) {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    await BinancePnlCache.deleteMany({ createdAt: { $lt: cutoff } })
  } catch (_) {}
}

module.exports = { getSummary, computeAndCache, cleanupOld, getWeeklySummary }



