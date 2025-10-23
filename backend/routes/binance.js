// 繁體中文註釋
// Binance 專用：PnL 視窗摘要（交易重算快取）

const express = require('express')
const router = express.Router()
const { getSummary, /* added export below */ getWeeklySummary } = require('../services/binancePnlService')

router.get('/summary', async (req, res, next) => {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    // 與 OKX 對齊：支援 refresh=1 強制重算，並關閉快取
    try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate') } catch (_) {}
    const refresh = String(req.query.refresh || '0') === '1'
    const debug = String(req.query.debug || '0') === '1'
    const s = await getSummary(userId, { refresh, debug })
    return res.json(s)
  } catch (err) { next(err) }
})

// 曆週（週一00:00 ~ 週日23:59）摘要：含 funding，計算週抽傭
router.get('/weekly', async (req, res, next) => {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate') } catch (_) {}
    const data = await getWeeklySummary(userId)
    return res.json(data)
  } catch (err) { next(err) }
})

module.exports = router



