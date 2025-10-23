// 繁體中文註釋
// okxPnlService：抓取 OKX 成交/資金費、標準化並計算 1/7/30（自然日），寫入快取與提供查詢

const ccxt = require('ccxt')
const OkxPnlCache = require('../models/OkxPnlCache')
const User = require('../models/User')
const logger = require('../utils/logger')

function ymd(ts, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    const parts = fmt.formatToParts(new Date(ts))
    const y = parts.find(p => p.type === 'year')?.value
    const m = parts.find(p => p.type === 'month')?.value
    const d = parts.find(p => p.type === 'day')?.value
    return `${y}-${m}-${d}`
  } catch (_) { return new Date(ts).toISOString().slice(0,10) }
}

function tzStartOfDay(ts, tz) {
  try {
    const d = new Date(ts)
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    const parts = fmt.formatToParts(d)
    const y = Number(parts.find(p => p.type === 'year')?.value)
    const m = Number(parts.find(p => p.type === 'month')?.value) - 1
    const day = Number(parts.find(p => p.type === 'day')?.value)
    // 構造該時區當日 00:00 對應的 UTC 時間
    const z = new Date(Date.UTC(y, m, day, 0, 0, 0))
    // 補償時區偏移：以該 tz 的 00:00 為準
    const tzOffsetMs = new Date(z.toLocaleString('en-US', { timeZone: tz })).getTime() - z.getTime()
    return z.getTime() + tzOffsetMs
  } catch (_) { const d2 = new Date(ts); d2.setHours(0,0,0,0); return d2.getTime() }
}

function buildClient(user) {
  const creds = user.getDecryptedKeys()
  return new ccxt.okx({ apiKey: creds.apiKey, secret: creds.apiSecret, password: creds.apiPassphrase || undefined, enableRateLimit: true })
}

function sinceMs(days) { return Date.now() - days * 24 * 60 * 60 * 1000 }

// 將 OKX 符號正規化為 user.pair 口徑（BTC/USDT）
function normSym(s) {
  return String(s || '').replace(':USDT','').replace('-SWAP','').replace('-', '/').toUpperCase()
}

async function fetchTradesSegmentedOkx(client, symbolNorm, days) {
  const now = Date.now()
  // 滾動視窗：從現在往回 days*24h
  const start = now - days * 24 * 60 * 60 * 1000
  const segments = 6
  const segMs = Math.ceil((days * 24 * 60 * 60 * 1000) / segments)
  let all = []
  for (let i = 0; i < segments; i++) {
    const segStart = start + i * segMs
    const segEnd = Math.min(start + (i + 1) * segMs, now)
    let since = segStart
    let safety = 0
    do {
      let page = []
      try {
        page = await client.fetchMyTrades(undefined, since, 500, { instType: 'SWAP', until: Math.floor(segEnd) })
      } catch (_) { page = [] }
      if (!Array.isArray(page) || page.length === 0) break
      for (const t of page) {
        const ts = Number(t.timestamp || 0)
        if (ts >= segStart && ts <= segEnd && normSym(t.symbol) === symbolNorm) all.push(t)
      }
      const lastTs = Number(page[page.length - 1]?.timestamp || 0)
      since = lastTs + 1
      safety++
    } while (since < segEnd && safety < 10)
  }
  return all
}

async function fetchFundingSegmentedOkx(client, symbolNorm, days) {
  const now = Date.now()
  const start = now - days * 24 * 60 * 60 * 1000
  const segments = 6
  const segMs = Math.ceil((days * 24 * 60 * 60 * 1000) / segments)
  let sum = 0
  for (let i = 0; i < segments; i++) {
    const segStart = start + i * segMs
    const segEnd = Math.min(start + (i + 1) * segMs, now)
    let since = segStart
    let safety = 0
    do {
      let page = []
      try {
        // ccxt: fetchFundingHistory(symbol?, since?, limit?, params?)
        page = await client.fetchFundingHistory(undefined, since, 100, { instType: 'SWAP', until: Math.floor(segEnd) })
        if (!Array.isArray(page) || page.length === 0) break
        for (const f of page) {
          try {
            const ts = Number(f.timestamp || 0)
            const sym = normSym(f.symbol)
            if (ts >= segStart && ts <= segEnd && sym === symbolNorm) {
              const amt = Number(f.amount || f.info?.pnl || 0)
              if (Number.isFinite(amt)) sum += amt
            }
          } catch (_) {}
        }
        const lastTs = Number(page[page.length - 1]?.timestamp || 0)
        since = lastTs + 1
      } catch (_) { break }
      safety++
    } while (since < segEnd && safety < 10)
  }
  return sum
}

function computePnLFromTrades(trades) {
  let sumFee = 0
  let directSum = 0
  let directHits = 0
  for (const t of trades) {
    // 手續費：轉為 USDT 累加
    try {
      if (t.fee && typeof t.fee.cost === 'number') {
        const cost = Number(t.fee.cost)
        const feeCcy = String(t.fee.currency || 'USDT').toUpperCase()
        const symbol = normSym(t.symbol)
        const [base, quote] = symbol.includes('/') ? symbol.split('/') : [symbol, 'USDT']
        const px = Number(t.price || (t.cost/(t.amount||1)) || 0)
        let feeUsdt = 0
        if (feeCcy === 'USDT' || feeCcy === 'USD' || feeCcy === String(quote || '').toUpperCase()) {
          feeUsdt = cost
        } else if (feeCcy === String(base || '').toUpperCase()) {
          feeUsdt = Number.isFinite(px) && px > 0 ? (cost * px) : 0
        } else {
          // 其他幣別（例如合約計價幣），缺有效轉換時保守忽略，避免誤差放大
          feeUsdt = 0
        }
        sumFee += feeUsdt
      }
    } catch (_) {}
    // 若交易本身帶有已實現損益，優先採信
    const info = t.info || {}
    const keys = ['realizedPnl', 'realizedPNL', 'pnl', 'profit']
    for (const k of keys) {
      if (info[k] !== undefined && Number.isFinite(Number(info[k]))) {
        directSum += Number(info[k])
        directHits += 1
        break
      }
    }
  }
  let backfill = 0
  try {
    const sorted = [...trades].sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0))
    let posQty = 0 // >0 long, <0 short（以基礎資產數量）
    let avgPx = 0
    for (const t of sorted) {
      const side = String(t.side||'').toLowerCase() // buy/sell
      const price = Number(t.price||t.cost/(t.amount||1)||0)
      // 嘗試以 ctVal/ctValCcy 修正：若 amount 為「張」，轉換為基礎幣數量
      const ctVal = Number(t.info?.ctVal || t.info?.contractSize || 0)
      const sym = normSym(t.symbol)
      const parts = sym.includes('/') ? sym.split('/') : [sym, 'USDT']
      const baseSym = String(parts[0] || '').toUpperCase()
      const quoteSym = String(parts[1] || '').toUpperCase()
      const ctValCcyRaw = String(t.info?.ctValCcy || '').toUpperCase() // 可能是實際幣別，如 'BTC' 或 'USDT'
      const rawContracts = Math.abs(Number(t.amount||0))
      let qty = Math.abs(Number(t.amount||0))
      if (Number.isFinite(ctVal) && ctVal > 0) {
        if (ctValCcyRaw === baseSym) {
          // 面值是基礎幣，例如 0.01 BTC
          qty = rawContracts * ctVal
        } else if (ctValCcyRaw === quoteSym || ctValCcyRaw === 'USDT' || ctValCcyRaw === 'USD') {
          // 面值是報價幣/美元，例如 100 USDT：換算成基礎幣
          qty = (Number.isFinite(price) && price > 0) ? ((rawContracts * ctVal) / price) : rawContracts
        } else {
          // 未知標示：保守以基礎幣面值處理
          qty = rawContracts * ctVal
        }
      } else {
        // 無 ctVal：嘗試以 cost/price 近似基礎幣數量
        const cost = Number(t.cost || 0)
        if (Number.isFinite(cost) && Number.isFinite(price) && price > 0) {
          qty = Math.abs(cost) / price
        }
      }
      if (!Number.isFinite(price) || !Number.isFinite(qty) || qty<=0) continue
      if (side === 'buy') {
        if (posQty < 0) {
          const closeQty = Math.min(qty, Math.abs(posQty))
          backfill += (avgPx - price) * closeQty // 平空
          posQty += closeQty
          const remain = qty - closeQty
          if (remain > 0) {
            const total = posQty + remain
            avgPx = ((Math.max(posQty,0)*avgPx) + (remain*price)) / Math.max(total, remain)
            posQty += remain
          }
        } else {
          const total = posQty + qty
          avgPx = total ? ((posQty*avgPx)+(qty*price))/total : price
          posQty = total
        }
      } else {
        if (posQty > 0) {
          const closeQty = Math.min(qty, Math.abs(posQty))
          backfill += (price - avgPx) * closeQty // 平多
          posQty -= closeQty
          const remain = qty - closeQty
          if (remain > 0) {
            const totalShort = Math.abs(posQty) + remain
            avgPx = ((Math.abs(posQty)*avgPx) + (remain*price)) / Math.max(totalShort, remain)
            posQty -= remain
          }
        } else {
          const totalShort = Math.abs(posQty) + qty
          avgPx = totalShort ? ((Math.abs(posQty)*avgPx)+(qty*price))/totalShort : price
          posQty -= qty
        }
      }
    }
  } catch (_) {}
  const realized = (directHits > 0) ? directSum : backfill
  return { realized, fee: sumFee }
}

async function computeAndCache(userId) {
  const tz = process.env.TZ || 'Asia/Taipei'
  const user = await User.findById(userId)
  if (!user) throw new Error('user not found')
  if (String(user.exchange||'').toLowerCase() !== 'okx') throw new Error('not_okx')
  const client = buildClient(user)
  const sym = String(user.pair || 'BTC/USDT').toUpperCase()

  const windows = [
    { key: 'pnl1d', feeKey: 'fee1d', days: 1, hasKey: 'hasTrade1d' },
    { key: 'pnl7d', feeKey: 'fee7d', days: 7, hasKey: 'hasTrade7d' },
    { key: 'pnl30d', feeKey: 'fee30d', days: 30, hasKey: 'hasTrade30d' },
  ]
  const out = { fee1d: 0, fee7d: 0, fee30d: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0, hasTrade1d: false, hasTrade7d: false, hasTrade30d: false }

  for (const w of windows) {
    let trades = []
    try {
      trades = await fetchTradesSegmentedOkx(client, sym, w.days)
    } catch (_) { trades = [] }
    const hasTrade = Array.isArray(trades) && trades.length > 0
    const { realized, fee } = computePnLFromTrades(trades)
    let funding = 0
    try { funding = await fetchFundingSegmentedOkx(client, sym, w.days) } catch (_) { funding = 0 }
    // 統一口徑：1/7/30 = 交易實現損益 − 手續費 + 資金費
    let pnlNet = Number(realized) - Number(Math.abs(fee)) + Number(funding)
    // 需求：若該視窗無交易，顯示 0（忽略 funding）
    if (!hasTrade) { pnlNet = 0 }
    out[w.key] = pnlNet
    out[w.feeKey] = hasTrade ? fee : 0
    out[w.hasKey] = !!hasTrade
  }

  const today = ymd(Date.now(), process.env.TZ || 'Asia/Taipei')
  await OkxPnlCache.findOneAndUpdate(
    { user: user._id, date: today },
    { $set: { ...out, date: today } },
    { upsert: true, new: true }
  )
  // 觀測：與今日 DailyStats 簡單差異記錄
  try {
    const DailyStats = require('../models/DailyStats')
    const rec = await DailyStats.findOne({ user: user._id, date: today }).select('feeSum pnlSum').lean()
    if (rec) {
      const diffFee = Math.abs(Number(out.fee1d||0) - Number(rec.feeSum||0))
      const diffPnl = Math.abs(Number(out.pnl1d||0) - Number(rec.pnlSum||0))
      const th = Number(process.env.OKX_OB_DIFF_USDT || 5)
      if (diffFee > th || diffPnl > th) {
        logger.warn('okx_pnl_observe_diff', { userId: String(user._id), fee1d_calc: out.fee1d, fee1d_daily: rec.feeSum, pnl1d_calc: out.pnl1d, pnl1d_daily: rec.pnlSum })
      }
    }
  } catch (_) {}
  return out
}

const LAST_COMPUTE_AT = new Map() // userId -> ts

async function computeWindows(userId) {
  const user = await User.findById(userId)
  if (!user) throw new Error('user not found')
  if (String(user.exchange||'').toLowerCase() !== 'okx') throw new Error('not_okx')
  const client = buildClient(user)
  const sym = String(user.pair || 'BTC/USDT').toUpperCase()
  const windows = [
    { key: '1d', days: 1 },
    { key: '7d', days: 7 },
    { key: '30d', days: 30 },
  ]
  const out = {}
  for (const w of windows) {
    let trades = []
    try { trades = await fetchTradesSegmentedOkx(client, sym, w.days) } catch (_) { trades = [] }
    const hasTrade = Array.isArray(trades) && trades.length > 0
    const { realized, fee } = computePnLFromTrades(trades)
    let funding = 0
    try { funding = await fetchFundingSegmentedOkx(client, sym, w.days) } catch (_) { funding = 0 }
    let pnlNet = Number(realized) - Number(Math.abs(fee)) + Number(funding)
    if (!hasTrade) { pnlNet = 0 }
    out[`realized${w.key}`] = Number(realized || 0)
    out[`fee${w.key}`] = hasTrade ? Number(fee || 0) : 0
    out[`funding${w.key}`] = Number(funding || 0)
    out[`pnl${w.key}`] = Number(pnlNet || 0)
    out[`hasTrade${w.key}`] = !!hasTrade
    out[`tradesCount${w.key}`] = Array.isArray(trades) ? trades.length : 0
  }
  return out
}

function tzWeekRange(tz) {
  try {
    const d = new Date()
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
    const y = Number(parts.find(p => p.type === 'year')?.value)
    const m = Number(parts.find(p => p.type === 'month')?.value) - 1
    const day = Number(parts.find(p => p.type === 'day')?.value)
    const cur = new Date(Date.UTC(y, m, day, 0, 0, 0))
    const tzOffsetMs = new Date(cur.toLocaleString('en-US', { timeZone: tz })).getTime() - cur.getTime()
    const localMidnight = new Date(cur.getTime() + tzOffsetMs)
    const dow = localMidnight.getDay()
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

async function fetchTradesRangeOkx(client, symbolNorm, startTs, endTs) {
  let all = []
  let since = startTs
  let safety = 0
  do {
    let page = []
    try { page = await client.fetchMyTrades(undefined, since, 500, { instType: 'SWAP', until: Math.floor(endTs) }) } catch (_) { page = [] }
    if (!Array.isArray(page) || page.length === 0) break
    for (const t of page) {
      const ts = Number(t.timestamp || 0)
      if (ts >= startTs && ts <= endTs && normSym(t.symbol) === symbolNorm) all.push(t)
    }
    const lastTs = Number(page[page.length - 1]?.timestamp || 0)
    since = lastTs + 1
    safety++
  } while (since < endTs && safety < 10)
  return all
}

async function getWeeklySummary(userId, { tz = (process.env.TZ || 'Asia/Taipei') } = {}) {
  const user = await User.findById(userId)
  if (!user) throw new Error('user not found')
  if (String(user.exchange||'').toLowerCase() !== 'okx') throw new Error('not_okx')
  const client = buildClient(user)
  const sym = String(user.pair || 'BTC/USDT').toUpperCase()
  const { startTs, endTs } = tzWeekRange(tz)
  let trades = []
  try { trades = await fetchTradesRangeOkx(client, sym, startTs, endTs) } catch (_) { trades = [] }
  const hasTrade = Array.isArray(trades) && trades.length > 0
  const { realized, fee } = computePnLFromTrades(trades)
  let funding = 0
  try { funding = await fetchFundingSegmentedOkx(client, sym, (endTs - startTs)/(24*60*60*1000)) } catch (_) { funding = 0 }
  // 週盈虧：一律計入 funding；即使無交易週也保留 funding 成分
  let pnlWeek = Number(realized) - Number(Math.abs(fee)) + Number(funding)
  const percent = Number(process.env.WEEKLY_COMMISSION_PERCENT || 0.1)
  const commission = Math.round(Number(pnlWeek || 0) * percent)
  return { pnlWeek, feeWeek: hasTrade ? Number(fee || 0) : 0, fundingWeek: Number(funding || 0), hasTradeWeek: !!hasTrade, realizedWeek: Number(realized || 0), commissionWeek: commission }
}

async function getSummary(userId, { refresh = false, debug = false } = {}) {
  const tz = process.env.TZ || 'Asia/Taipei'
  const today = ymd(Date.now(), tz)
  // 重要：鎖定當日快取或取最新更新，避免拿到舊紀錄導致 0
  let doc = await OkxPnlCache.findOne({ user: userId, date: today }).sort({ updatedAt: -1 })
  const now = Date.now()
  const last = Number(LAST_COMPUTE_AT.get(String(userId)) || 0)
  const allowRecompute = (now - last) >= 30000 // 每用戶至少 30 秒才允許重算一次

  if (!doc || refresh || allowRecompute) {
    try {
      await computeAndCache(userId)
      LAST_COMPUTE_AT.set(String(userId), now)
    } catch (e) {
      logger.warn('okx compute fail', { userId: String(userId), message: String(e?.message||e) })
    }
    // 重新讀取「今日」或最新的快取
    doc = await OkxPnlCache.findOne({ user: userId, date: today }).sort({ updatedAt: -1 })
  }
  const o = doc ? doc.toObject() : { fee1d: 0, fee7d: 0, fee30d: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0, hasTrade1d: false, hasTrade7d: false, hasTrade30d: false }
  const base = {
    feePaid: Number(o.fee1d||0),
    pnl1d: Number(o.pnl1d||0),
    pnl7d: Number(o.pnl7d||0),
    pnl30d: Number(o.pnl30d||0),
    hasTrade1d: !!o.hasTrade1d,
    hasTrade7d: !!o.hasTrade7d,
    hasTrade30d: !!o.hasTrade30d,
  }
  if (!debug) return base
  // 附帶詳細拆解（不寫入 DB）
  try {
    const det = await computeWindows(userId)
    return { ...base,
      realized1d: det.realized1d, realized7d: det.realized7d, realized30d: det.realized30d,
      fee1d: det.fee1d, fee7d: det.fee7d, fee30d: det.fee30d,
      funding1d: det.funding1d, funding7d: det.funding7d, funding30d: det.funding30d,
      tradesCount1d: det.tradesCount1d, tradesCount7d: det.tradesCount7d, tradesCount30d: det.tradesCount30d,
    }
  } catch (_) { return base }
}

// 簡單保留期清理：>40 天未更新的快取刪除
async function cleanupOld(days = 40) {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    await OkxPnlCache.deleteMany({ updatedAt: { $lt: since } })
  } catch (_) {}
}

async function initOkxPnlService(intervalMs = 30 * 60 * 1000) {
  try {
    const users = await User.find({ enabled: true, exchange: 'okx' }).select('_id').lean()
    for (const u of users) {
      try { await computeAndCache(u._id) } catch (_) {}
    }
  } catch (_) {}
  // 週期性預熱計算與保留期清理
  setInterval(async () => {
    try {
      const users = await User.find({ enabled: true, exchange: 'okx' }).select('_id').lean()
      for (const u of users) {
        try { await computeAndCache(u._id) } catch (_) {}
      }
      await cleanupOld(40)
    } catch (_) {}
  }, intervalMs)
}

module.exports = { computeAndCache, getSummary, cleanupOld, initOkxPnlService, getWeeklySummary }


