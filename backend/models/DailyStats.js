// 繁體中文註釋
// 每日交易統計（持久化）：避免重啟遺失，保留 90 天

const mongoose = require('mongoose')

const ClosedTradeSchema = new mongoose.Schema({
  side: { type: String, enum: ['long','short'], default: 'long' },
  qty: { type: Number, default: 0 },
  openPrice: { type: Number, default: 0 },
  closePrice: { type: Number, default: 0 },
  realized: { type: Number, default: 0 },
  symbol: { type: String, default: '' },
}, { _id: false })

const DailyStatsSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  date: { type: String, index: true }, // YYYY-MM-DD（以 TIMEZONE 計算）
  tradeCount: { type: Number, default: 0 },
  feeSum: { type: Number, default: 0 },
  pnlSum: { type: Number, default: 0 },
  closedTrades: { type: [ClosedTradeSchema], default: [] },
}, { timestamps: true })

DailyStatsSchema.index({ user: 1, date: 1 }, { unique: true })

module.exports = mongoose.model('DailyStats', DailyStatsSchema)




