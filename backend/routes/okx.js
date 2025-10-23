// 繁體中文註釋
// OKX 專用 PnL 查詢路由

const express = require('express')
const router = express.Router()
const { getSummary, getWeeklySummary } = require('../services/okxPnlService')

router.get('/summary', async (req, res, next) => {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    // 設置不快取標頭，避免瀏覽器/中介緩存
    try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate') } catch (_) {}
    // 支援 refresh=1 強制重算；否則使用內部控頻
    const refresh = String(req.query.refresh || '0') === '1'
    const debug = String(req.query.debug || '0') === '1'
    const data = await getSummary(userId, { refresh, debug })
    res.json(data)
  } catch (err) { next(err) }
})

module.exports = router

// 曆週（週一00:00 ~ 週日23:59）摘要：含 funding，計算週抽傭
router.get('/weekly', async (req, res, next) => {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    try { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate') } catch (_) {}
    const data = await getWeeklySummary(userId)
    res.json(data)
  } catch (err) { next(err) }
})



