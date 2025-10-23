
// 繁體中文註釋
// Telegram 發送服務：佇列拉取、節流、重試、DLQ

const axios = require('axios')
const Bottleneck = require('bottleneck')
const Outbox = require('../models/Outbox')
const logger = require('../utils/logger')

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : ''

const limiterGlobal = new Bottleneck({ minTime: 80, maxConcurrent: 1 })
const limiterByChat = new Map()
function getChatLimiter(chatId) {
  const key = String(chatId)
  if (!limiterByChat.has(key)) limiterByChat.set(key, new Bottleneck({ minTime: 500, maxConcurrent: 1 }))
  return limiterByChat.get(key)
}

function getRetryDelay(attempt) { return Math.min(60000, 500 * Math.pow(2, attempt)) }

async function sendMessage(chatId, text, parseMode) {
  if (!API_BASE) throw new Error('telegram_disabled')
  const url = `${API_BASE}/sendMessage`
  const payload = { chat_id: chatId, text, parse_mode: parseMode || 'HTML', disable_web_page_preview: true }
  const res = await axios.post(url, payload)
  return res.data
}

async function processOne(doc) {
  const chatLimiter = getChatLimiter(doc.chatId)
  return limiterGlobal.schedule(() => chatLimiter.schedule(async () => {
    try {
      await sendMessage(doc.chatId, doc.text, doc.parseMode)
      await Outbox.findByIdAndUpdate(doc._id, { status: 'sent' })
    } catch (e) {
      const tgRetry = Number(e?.response?.data?.parameters?.retry_after || 0)
      const attempts = (doc.attempts || 0) + 1
      const delay = tgRetry ? (tgRetry * 1000) : getRetryDelay(attempts)
      const next = new Date(Date.now() + delay)
      const status = attempts >= 5 ? 'failed' : 'queued'
      await Outbox.findByIdAndUpdate(doc._id, { status, attempts, nextAttemptAt: next })
      if (status === 'failed') logger.warn('Telegram 發送失敗，移入 DLQ', { id: String(doc._id), chatId: doc.chatId, message: e.message })
    }
  }))
}

let runner = null
function startOutboxRunner() {
  if (runner || !API_BASE) return
  runner = setInterval(async () => {
    try {
      // 使用 findOneAndUpdate 原子性地標記為處理中，避免並發重複處理
      const batch = []
      for (let i = 0; i < 20; i++) {
        const doc = await Outbox.findOneAndUpdate(
          { status: 'queued', nextAttemptAt: { $lte: new Date() } },
          { status: 'processing' },
          { sort: { createdAt: 1 }, new: true }
        )
        if (!doc) break
        batch.push(doc)
      }
      
      for (const doc of batch) {
        processOne(doc).catch(() => {})
      }
    } catch (_) {}
  }, 800)
  logger.info('Telegram 服務已啟動')
}

function dedupeKeyFill({ userId, orderId }) { return `fill:${userId}:${orderId}` }
async function enqueueFill({ chatIds, text, userId, orderId }) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) return
  const key = dedupeKeyFill({ userId, orderId })
  for (const c of chatIds) {
    const filter = { channel: 'telegram', chatId: String(c), dedupeKey: key }
    const doc = { channel: 'telegram', chatId: String(c), text, parseMode: 'HTML', status: 'queued', attempts: 0, nextAttemptAt: new Date(), dedupeKey: key }
    try {
      // 使用 findOneAndUpdate 搭配 upsert，確保原子性操作
      await Outbox.findOneAndUpdate(filter, { $setOnInsert: doc }, { upsert: true, new: true })
    } catch (e) {
      // 若命中唯一鍵衝突（11000），視為已入佇列，忽略
      if (e && (String(e.code) === '11000' || e.code === 11000)) continue
      throw e
    }
  }
}

function jitterMs(ms) { return ms + Math.floor(Math.random() * 120000) }
async function enqueueDaily({ chatIds, text, dateKey, userId }) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) return
  const key = userId ? `daily:${dateKey}:${String(userId)}` : `daily:${dateKey}`
  for (const c of chatIds) {
    await Outbox.updateOne({ channel: 'telegram', chatId: String(c), dedupeKey: key }, {
      $setOnInsert: { channel: 'telegram', chatId: String(c), text, parseMode: 'HTML', status: 'queued', attempts: 0, nextAttemptAt: new Date(Date.now() + jitterMs(0)), dedupeKey: key }
    }, { upsert: true })
  }
}

module.exports = { startOutboxRunner, enqueueFill, enqueueDaily }

// 每小時去重發送（例如風控告警）。
// hourKey 建議格式：YYYY-MM-DD-HH（時區自行處理）；scopeKey 用於區分不同類型或標的（如 pnl:BTC、liq:ETH、margin 等）。
async function enqueueHourly({ chatIds, text, hourKey, userId, scopeKey }) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) return
  const key = userId ? `hourly:${hourKey}:${String(userId)}:${String(scopeKey||'default')}` : `hourly:${hourKey}:${String(scopeKey||'default')}`
  for (const c of chatIds) {
    await Outbox.updateOne({ channel: 'telegram', chatId: String(c), dedupeKey: key }, {
      $setOnInsert: { channel: 'telegram', chatId: String(c), text, parseMode: 'HTML', status: 'queued', attempts: 0, nextAttemptAt: new Date(), dedupeKey: key }
    }, { upsert: true })
  }
}

module.exports.enqueueHourly = enqueueHourly

// 可變時間視窗去重（分鐘粒度）。windowKey 例：YYYY-MM-DD-HH:mm（每 N 分生成一次）
async function enqueueWindowed({ chatIds, text, userId, windowKey, scopeKey }) {
  if (!Array.isArray(chatIds) || chatIds.length === 0) return
  const key = userId ? `win:${windowKey}:${String(userId)}:${String(scopeKey||'default')}` : `win:${windowKey}:${String(scopeKey||'default')}`
  for (const c of chatIds) {
    await Outbox.updateOne({ channel: 'telegram', chatId: String(c), dedupeKey: key }, {
      $setOnInsert: { channel: 'telegram', chatId: String(c), text, parseMode: 'HTML', status: 'queued', attempts: 0, nextAttemptAt: new Date(), dedupeKey: key }
    }, { upsert: true })
  }
}

module.exports.enqueueWindowed = enqueueWindowed




