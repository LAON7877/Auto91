// 繁體中文註釋
// 週結固化結果：便於追溯與對帳

const mongoose = require('mongoose')

const WeeklyStatsSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  weekStart: { type: String, required: true, index: true }, // YYYY-MM-DD（週一）
  weekEnd: { type: String, required: true },                // YYYY-MM-DD（週日）
  pnlWeek: { type: Number, default: 0 },
  commissionWeek: { type: Number, default: 0 },
  realizedWeek: { type: Number, default: 0 },
  feeWeek: { type: Number, default: 0 },
  fundingWeek: { type: Number, default: 0 },
}, { timestamps: true })

WeeklyStatsSchema.index({ user: 1, weekStart: 1 }, { unique: true })

module.exports = mongoose.model('WeeklyStats', WeeklyStatsSchema)


