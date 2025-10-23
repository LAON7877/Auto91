// 繁體中文註釋
// 帳戶摘要控制器：提供當前快取的帳戶更新，供前端初始化顯示

const { getLastAccountMessages, getLastAccountMessageByUser } = require('../services/accountMonitor');
const DailyStats = require('../models/DailyStats')
const { ymd } = require('../services/tgFormat')
const User = require('../models/User')
const { aggregateForUser } = require('../services/pnlAggregator')
const { getSummary: getOkxSummary } = require('../services/okxPnlService')

async function listSummaries(req, res, next) {
  try {
    const userId = req.query.userId
    if (userId) {
      const m = getLastAccountMessageByUser(userId)
      return res.json(m ? [{ ...m, createdAt: m.ts }] : [])
    }
    const msgs = (getLastAccountMessages() || []).map(x => ({ ...x, createdAt: x.ts }))
    res.json(msgs);
  } catch (err) { next(err); }
}

module.exports = { listSummaries };

// 以 DailyStats 匯總 1/7/30（不足時回 0），feePaid=當日 feeSum
async function getSummary(req, res, next) {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    const tz = process.env.TZ || 'Asia/Taipei'
    const today = ymd(Date.now(), tz)

    async function sumDays(days) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const sinceKey = ymd(since, tz)
      const docs = await DailyStats.find({ user: userId, date: { $gte: sinceKey, $lte: today } }).select('pnlSum feeSum').lean()
      let pnl = 0, fee = 0
      for (const d of (docs || [])) { pnl += Number(d.pnlSum || 0); fee += Number(d.feeSum || 0) }
      return { pnl, fee }
    }

  const d1 = await sumDays(1)
  const d7 = await sumDays(7)
  const d30 = await sumDays(30)
  let out = { feePaid: Number(d1.fee || 0), pnl1d: Number(d1.pnl || 0), pnl7d: Number(d7.pnl || 0), pnl30d: Number(d30.pnl || 0) }

  // OKX：一律改走新服務來源，確保口徑一致（移除舊覆寫）
  try {
    const u = await User.findById(userId).select('exchange')
    if (u && String(u.exchange || '').toLowerCase() === 'okx') {
      // 設置不快取標頭
      try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate') } catch (_) {}
      const s = await getOkxSummary(userId, { refresh: false })
      out = {
        feePaid: Number(s.feePaid || 0),
        pnl1d: Number(s.pnl1d || 0),
        pnl7d: Number(s.pnl7d || 0),
        pnl30d: Number(s.pnl30d || 0)
      }
    }
  } catch (_) {}
  return res.json(out)
  } catch (err) { next(err) }
}

module.exports.getSummary = getSummary


