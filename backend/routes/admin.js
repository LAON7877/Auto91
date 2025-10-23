// 繁體中文註釋
// 管理端：Telegram DLQ 重送

const express = require('express')
const router = express.Router()
const Outbox = require('../models/Outbox')
const User = require('../models/User')
const DailyStats = require('../models/DailyStats')
const { enqueueDaily, enqueueWindowed } = require('../services/telegram')
const { getLastAccountMessageByUser, coldStartSnapshotForUser } = require('../services/accountMonitor')
const { ymd } = require('../services/tgFormat')
const ccxt = require('ccxt')
const SystemConfig = require('../models/SystemConfig')

// GET /api/admin/telegram/outbox
// 需要 x-admin-key（由 app.js 中介層保護 for non-GET; 這裡僅查詢，因此不強制）
// query: { status?: 'queued'|'sent'|'failed', chatId?: string, userId?: string, dedupeKey?: string, limit?: number, since?: ts, until?: ts }
router.get('/telegram/outbox', async (req, res, next) => {
  try {
    const { status, chatId, userId, dedupeKey, limit, since, until } = req.query || {}
    const q = {}
    if (status && ['queued','sent','failed'].includes(String(status))) q.status = String(status)
    if (chatId) q.chatId = String(chatId)
    if (dedupeKey) q.dedupeKey = String(dedupeKey)
    // 若提供 userId，簡化查詢：以 dedupeKey 前綴匹配 fill/daily/windowed 任一類型
    if (userId) q.dedupeKey = new RegExp(`:${String(userId)}(?:$|:)`)
    if (since || until) {
      q.createdAt = {}
      if (since) q.createdAt.$gte = new Date(Number(since) || since)
      if (until) q.createdAt.$lte = new Date(Number(until) || until)
    }
    const lim = Math.max(1, Math.min(Number(limit || 50), 200))
    const docs = await Outbox.find(q).sort({ createdAt: -1 }).limit(lim).lean()
    const out = docs.map(d => ({
      id: String(d._id),
      status: d.status,
      chatId: d.chatId,
      dedupeKey: d.dedupeKey,
      attempts: d.attempts,
      nextAttemptAt: d.nextAttemptAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      preview: String(d.text || '').slice(0, 160)
    }))
    return res.json({ ok: true, count: out.length, items: out })
  } catch (err) { next(err) }
})

// GET /api/admin/daily/preview?userId=...
// Binance：三餘額只取原生 assets；1/7/30 與 fee 用交易重算服務；OKX 不變
router.get('/daily/preview', async (req, res, next) => {
  try {
    const userId = String(req.query.userId || '').trim()
    if (!userId) return res.status(400).json({ error: 'userId is required' })
    const u = await User.findById(userId)
    if (!u) return res.status(404).json({ error: 'user not found' })

    const TZ = process.env.TZ || 'Asia/Taipei'
    const dateKey = ymd(Date.now(), TZ)
    await coldStartSnapshotForUser(u).catch(() => {})
    const last = getLastAccountMessageByUser(u._id.toString()) || {}
    const s = last.summary || {}

    // 成交次數
    let tradeCount = 0
    try {
      const rec = await DailyStats.findOne({ user: u._id, date: dateKey }).select('tradeCount').lean()
      tradeCount = Number(rec?.tradeCount || 0)
    } catch (_) {}

    // 視窗 PnL 與 fee
    let feePaid = 0, pnl1d = 0, pnl7d = 0, pnl30d = 0
    try {
      const ex = String(u.exchange||'').toLowerCase()
      if (ex === 'binance') {
        const { getSummary: getBinanceSummary } = require('../services/binancePnlService')
        const bs = await getBinanceSummary(u._id, { refresh: true })
        feePaid = Number(bs.feePaid||0); pnl1d = Number(bs.pnl1d||0); pnl7d = Number(bs.pnl7d||0); pnl30d = Number(bs.pnl30d||0)
      } else if (ex === 'okx') {
        const { getSummary: getOkxSummary } = require('../services/okxPnlService')
        const os = await getOkxSummary(u._id, { refresh: true })
        feePaid = Number(os.feePaid||0); pnl1d = Number(os.pnl1d||0); pnl7d = Number(os.pnl7d||0); pnl30d = Number(os.pnl30d||0)
      }
    } catch (_) {}

    // 餘額三欄位
    let walletBalance = 0, availableTransfer = 0, marginBalance = 0
    try {
      const ex = String(u.exchange||'').toLowerCase()
      if (ex === 'binance') {
        const creds = u.getDecryptedKeys()
        const client = new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
        const bal = await client.fetchBalance()
        const assets = bal?.info?.assets || bal?.info
        const arr = Array.isArray(assets) ? assets : []
        const usdt = arr.find(a => (a.asset || a.ccy || '').toUpperCase() === 'USDT')
        if (usdt) {
          const wb = Number(usdt.walletBalance || usdt.wb || usdt.balance || 0)
          const av = Number(usdt.availableBalance || usdt.available || usdt.crossWalletBalance || usdt.cw || 0)
          if (Number.isFinite(wb)) walletBalance = wb
          if (Number.isFinite(av)) availableTransfer = av
        }
        // 估算佔用
        try {
          const positions = Array.isArray(last.positions) ? last.positions : []
          let marginUsed = 0
          for (const p of positions) {
            const qty = Math.abs(Number(p.contracts ?? 0))
            const entry = Number(p.entryPrice || 0)
            const lev = Math.max(1, Number(p.leverage || u.leverage || 1))
            if (qty > 0 && entry > 0) marginUsed += (qty * entry) / lev
          }
          marginBalance = Math.max(0, Number(walletBalance || 0) - Number(marginUsed || 0))
        } catch (_) {}
      } else {
        walletBalance = Number(s.walletBalance || 0)
        availableTransfer = Number(s.availableTransfer || 0)
        marginBalance = Number(s.marginBalance || 0)
      }
    } catch (_) {}

    return res.json({
      userId: String(u._id),
      exchange: u.exchange,
      tradeCount,
      walletBalance,
      availableTransfer,
      marginBalance,
      feePaid,
      pnl1d,
      pnl7d,
      pnl30d,
    })
  } catch (err) { next(err) }
})

// POST /api/admin/telegram/dlq-retry
// 需要 x-admin-key（由 app.js 中介層保護）
// body: { chatId?: string, ids?: string[], since?: string|number, until?: string|number, limit?: number, dryRun?: boolean }
router.post('/telegram/dlq-retry', async (req, res, next) => {
  try {
    const { chatId, ids, since, until, limit, dryRun } = req.body || {}
    const q = { status: 'failed' }
    if (chatId) q.chatId = String(chatId)
    if (Array.isArray(ids) && ids.length) q._id = { $in: ids }
    if (since || until) {
      q.updatedAt = {}
      if (since) q.updatedAt.$gte = new Date(Number(since) || since)
      if (until) q.updatedAt.$lte = new Date(Number(until) || until)
    }
    const lim = Math.max(1, Math.min(Number(limit || 100), 2000))
    const docs = await Outbox.find(q).sort({ updatedAt: 1 }).limit(lim)
    if (dryRun) return res.json({ ok: true, matched: docs.length, sample: docs.slice(0, Math.min(5, docs.length)).map(d => ({ id: d._id.toString(), chatId: d.chatId, dedupeKey: d.dedupeKey })) })
    const idsToUpdate = docs.map(d => d._id)
    if (!idsToUpdate.length) return res.json({ ok: true, requeued: 0 })
    const r = await Outbox.updateMany({ _id: { $in: idsToUpdate } }, { $set: { status: 'queued', nextAttemptAt: new Date(), attempts: 0 } })
    return res.json({ ok: true, requeued: r.modifiedCount || 0 })
  } catch (err) { next(err) }
})

module.exports = router

// 系統設定：GET/PUT /api/admin/config
router.get('/config', async (req, res, next) => {
  try {
    const doc = await SystemConfig.getSingleton()
    return res.json({ weekly: doc.weekly })
  } catch (err) { next(err) }
})

router.put('/config', async (req, res, next) => {
  try {
    const body = req.body || {}
    const incoming = body.weekly || {}
    const out = {}
    if (incoming.enabled !== undefined) out.enabled = !!incoming.enabled
    if (incoming.percent !== undefined) {
      const p = Number(incoming.percent)
      if (!Number.isFinite(p) || p < 0 || p > 1) return res.status(400).json({ error: 'percent must be 0~1' })
      out.percent = p
    }
    if (incoming.tgIds !== undefined) {
      const raw = Array.isArray(incoming.tgIds) ? incoming.tgIds : String(incoming.tgIds || '').split(',')
      const arr = raw.map(s => String(s).trim()).filter(Boolean)
      out.tgIds = arr
    }
    if (incoming.tz !== undefined) {
      const tz = String(incoming.tz || '').trim() || 'Asia/Taipei'
      out.tz = tz
    }
    const doc = await SystemConfig.getSingleton()
    doc.weekly = { ...doc.weekly.toObject(), ...out }
    await doc.save()
    return res.json({ ok: true, weekly: doc.weekly })
  } catch (err) { next(err) }
})

// 觸發日結：POST /api/admin/daily/trigger
// 需要 x-admin-key；body: { userId?: string|string[], dryRun?: boolean }
router.post('/daily/trigger', async (req, res, next) => {
  try {
    const { userId, dryRun, force } = req.body || {}
    const users = Array.isArray(userId) && userId.length
      ? await User.find({ _id: { $in: userId } })
      : (userId ? await User.find({ _id: userId }) : await User.find({ enabled: true }))

    const TZ = process.env.TZ || 'Asia/Taipei'
    const dateKey = ymd(Date.now(), TZ)
    const dateText = String(dateKey).replace(/-/g, '/')

    let sent = 0
    for (const u of users) {
      try {
        // 先執行當下 REST 冷啟快照，確保使用最新數據
        await coldStartSnapshotForUser(u)
        const last = getLastAccountMessageByUser(u._id.toString()) || {}
        const s = last.summary || {}
        // 成交次數來自 DailyStats
        let tradeCount = 0
        try {
          const rec = await DailyStats.findOne({ user: u._id, date: dateKey }).select('tradeCount').lean()
          tradeCount = Number(rec?.tradeCount || 0)
        } catch (_) {}

        // 視窗 PnL 與 fee（依交易所來源）：Binance/OKX 皆以服務重算（refresh=1）以確保即時
        let feePaid = Number(s.feePaid || 0)
        let pnl1d = Number(s.pnl1d || 0)
        let pnl7d = Number(s.pnl7d || 0)
        let pnl30d = Number(s.pnl30d || 0)
        try {
          const ex = String(u.exchange||'').toLowerCase()
          if (ex === 'binance') {
            const { getSummary: getBinanceSummary } = require('../services/binancePnlService')
            const bs = await getBinanceSummary(u._id, { refresh: true })
            feePaid = Number(bs.feePaid||0); pnl1d = Number(bs.pnl1d||0); pnl7d = Number(bs.pnl7d||0); pnl30d = Number(bs.pnl30d||0)
          } else if (ex === 'okx') {
            const { getSummary: getOkxSummary } = require('../services/okxPnlService')
            const os = await getOkxSummary(u._id, { refresh: true })
            feePaid = Number(os.feePaid||0); pnl1d = Number(os.pnl1d||0); pnl7d = Number(os.pnl7d||0); pnl30d = Number(os.pnl30d||0)
          }
        } catch (_) {}

        // 餘額三欄位：Binance 僅讀原生 assets；OKX 維持 s 快取值
        let walletBalance = Number(s.walletBalance || 0)
        let availableTransfer = Number(s.availableTransfer || 0)
        let marginBalance = Number(s.marginBalance || 0)
        try {
          const ex = String(u.exchange||'').toLowerCase()
          if (ex === 'binance') {
            const creds = u.getDecryptedKeys()
            const client = new ccxt.binance({ apiKey: creds.apiKey, secret: creds.apiSecret, options: { defaultType: 'future' }, enableRateLimit: true })
            const bal = await client.fetchBalance()
            const assets = bal?.info?.assets || bal?.info
            const arr = Array.isArray(assets) ? assets : []
            const usdt = arr.find(a => (a.asset || a.ccy || '').toUpperCase() === 'USDT')
            walletBalance = 0; availableTransfer = 0; marginBalance = 0
            if (usdt) {
              const wb = Number(usdt.walletBalance || usdt.wb || usdt.balance || 0)
              const av = Number(usdt.availableBalance || usdt.available || usdt.crossWalletBalance || usdt.cw || 0)
              if (Number.isFinite(wb)) walletBalance = wb
              if (Number.isFinite(av)) availableTransfer = av
            }
            // 估算佔用 = sum(qty*entry/lev)；保證金餘額 = 錢包 − 佔用
            try {
              const positions = Array.isArray(last.positions) ? last.positions : []
              let marginUsed = 0
              for (const p of positions) {
                const qty = Math.abs(Number(p.contracts ?? 0))
                const entry = Number(p.entryPrice || 0)
                const lev = Math.max(1, Number(p.leverage || u.leverage || 1))
                if (qty > 0 && entry > 0) marginUsed += (qty * entry) / lev
              }
              marginBalance = Math.max(0, Number(walletBalance || 0) - Number(marginUsed || 0))
            } catch (_) {}
          }
        } catch (_) {}

        const lines = [
          `📊 交易結算（${dateText}）`,
          `═════帳戶狀態═════`,
          `成交次數：${tradeCount} 次`,
          `錢包餘額：${Number(walletBalance||0).toFixed(2)} USDT`,
          `可供轉帳：${Number(availableTransfer||0).toFixed(2)} USDT`,
          `保證金餘額：${Number(marginBalance||0).toFixed(2)} USDT`,
          `交易手續費：${Number(feePaid||0).toFixed(2)} USDT`,
          `本日盈虧：${Number(pnl1d||0).toFixed(2)} USDT`,
          `7日盈虧：${Number(pnl7d||0).toFixed(2)} USDT`,
          `30日盈虧：${Number(pnl30d||0).toFixed(2)} USDT`,
          `═════持倉狀態═════`,
          (() => {
            try {
              const arr = Array.isArray(last.positions) ? last.positions : []
              const nz = arr.find(x => Math.abs(Number(x?.contracts ?? x?.contractsSize ?? 0)) > 0)
              if (!nz) return '❌ 無持倉部位'
              const side = String(nz.side||'').toLowerCase()==='long'?'多單':(String(nz.side||'').toLowerCase()==='short'?'空單':'—')
              const base = String(nz.symbol||'').split('/')[0]||''
              const qty = Number(nz.contracts||0).toFixed(4)
              const entry = Number(nz.entryPrice||0).toLocaleString(undefined,{maximumFractionDigits:0})
              const mark = Number(nz.markPrice||0).toLocaleString(undefined,{maximumFractionDigits:0})
              const unp = Number(nz.unrealizedPnl||0)
              const sign = unp>0?'+':(unp<0?'-':'')
              return `${side}｜${qty} ${base}｜${entry} USDT｜${mark} USDT\n未實現盈虧 ${sign}${Math.abs(unp).toFixed(2)} USDT`
            } catch (_) { return '❌ 無持倉部位' }
          })()
        ]

        if (!dryRun) {
          const ids = String(u.telegramIds || '').split(',').map(s => s.trim()).filter(Boolean)
          if (ids.length) {
            if (force === true) {
              const hh = new Date().toISOString().slice(11,13)
              const mm = new Date().toISOString().slice(14,16)
              const ss = new Date().toISOString().slice(17,19)
              const windowKey = `${dateKey}-${hh}:${mm}:${ss}`
              await enqueueWindowed({ chatIds: ids, text: lines.join('\n'), userId: String(u._id), windowKey, scopeKey: 'manual-daily' })
            } else {
              await enqueueDaily({ chatIds: ids, text: lines.join('\n'), dateKey, userId: u._id })
            }
          }
          sent++
        }
      } catch (_) {}
    }
    return res.json({ ok: true, processed: users.length, sent, dryRun: !!dryRun, force: !!force })
  } catch (err) { next(err) }
})




