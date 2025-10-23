// 繁體中文註釋
// 日結交易總覽：依 userId 與日期回傳 DailyStats（含 closedTrades/費用/損益）

const DailyStats = require('../models/DailyStats')

function dateKeyFromTz(ts, tz) {
  try {
    const d = new Date(new Date(ts || Date.now()).toLocaleString('en-US', { timeZone: tz || 'UTC' }))
    return d.toISOString().slice(0, 10)
  } catch (_) { return new Date().toISOString().slice(0, 10) }
}

async function getDaily(req, res, next) {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    const tz = process.env.TZ || 'Asia/Taipei'
    const key = String(req.query.date || '').trim() || dateKeyFromTz(Date.now(), tz)
    const rec = await DailyStats.findOne({ user: userId, date: key })
    if (!rec) return res.json({ user: userId, date: key, tradeCount: 0, feeSum: 0, pnlSum: 0, closedTrades: [] })
    return res.json({
      user: String(rec.user),
      date: rec.date,
      tradeCount: Number(rec.tradeCount || 0),
      feeSum: Number(rec.feeSum || 0),
      pnlSum: Number(rec.pnlSum || 0),
      closedTrades: Array.isArray(rec.closedTrades) ? rec.closedTrades : []
    })
  } catch (err) { next(err) }
}

module.exports = { getDaily }




