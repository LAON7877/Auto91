// 繁體中文註釋
// Telegram 發送 Outbox：佇列、重試、DLQ

const mongoose = require('mongoose')

const OutboxSchema = new mongoose.Schema({
  channel: { type: String, default: 'telegram' },
  chatId: { type: String, required: true },
  text: { type: String, required: true },
  parseMode: { type: String, default: 'HTML' },
  status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: () => new Date() },
  dedupeKey: { type: String, default: '' },
}, { timestamps: true })

OutboxSchema.index({ status: 1, nextAttemptAt: 1 })
// 唯一複合索引：根絕併發插入重複訊息（資料庫層級保證）
OutboxSchema.index({ channel: 1, chatId: 1, dedupeKey: 1 }, { unique: true })

module.exports = mongoose.model('Outbox', OutboxSchema)




