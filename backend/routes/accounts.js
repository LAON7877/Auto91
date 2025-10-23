// 繁體中文註釋
// 帳戶同步：一次性 REST 強制同步（餘額/持倉 + PnL/費用回補），並廣播至前端

const express = require('express')
const router = express.Router()
const User = require('../models/User')
const { coldStartSnapshotForUser, getLastAccountMessageByUser } = require('../services/accountMonitor')
const { getSummary } = require('../controllers/accountController')
const { aggregateForUser } = require('../services/pnlAggregator')

router.post('/sync', async (req, res, next) => {
  try {
    const { userId } = req.body || {}
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    const user = await User.findById(userId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    await coldStartSnapshotForUser(user)
    try { await aggregateForUser(user) } catch (_) {}
    const payload = getLastAccountMessageByUser(user._id.toString()) || null
    return res.json({ ok: true, payload })
  } catch (err) { next(err) }
})

module.exports = router

// 匯總 1/7/30 與當日手續費
router.get('/summary', getSummary)


