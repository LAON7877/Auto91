// 繁體中文註釋
// OKX PnL 快取：保存最近一次即時計算的 1/7/30 與費用（保留 40 天）

const mongoose = require('mongoose')

const OkxPnlCacheSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  date: { type: String, index: true }, // YYYY-MM-DD（自然日/TZ）
  // 最近一次即時計算結果（逐日彙整），供前端/日結直接取用
  fee1d: { type: Number, default: 0 },
  fee7d: { type: Number, default: 0 },
  fee30d: { type: Number, default: 0 },
  pnl1d: { type: Number, default: 0 },
  pnl7d: { type: Number, default: 0 },
  pnl30d: { type: Number, default: 0 },
  // 是否於該時間窗內有成交（無成交則前端需顯示 0）
  hasTrade1d: { type: Boolean, default: false },
  hasTrade7d: { type: Boolean, default: false },
  hasTrade30d: { type: Boolean, default: false },
}, { timestamps: true })

OkxPnlCacheSchema.index({ user: 1, date: 1 }, { unique: true })
OkxPnlCacheSchema.index({ updatedAt: -1 })

module.exports = mongoose.model('OkxPnlCache', OkxPnlCacheSchema)


