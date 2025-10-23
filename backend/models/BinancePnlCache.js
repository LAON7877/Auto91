// 繁體中文註釋
// Binance 1/7/30 日損益/手續費快取（專供日結/儀表使用）

const mongoose = require('mongoose')

const BinancePnlCacheSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  date: { type: String, required: true }, // ymd，如 2025-10-09
  // 視窗損益（不含 funding；依需求可擴充）
  pnl1d: { type: Number, default: 0 },
  pnl7d: { type: Number, default: 0 },
  pnl30d: { type: Number, default: 0 },
  // 視窗手續費（總和，為正數或負數依實際回傳；顯示時採數值）
  fee1d: { type: Number, default: 0 },
  fee7d: { type: Number, default: 0 },
  fee30d: { type: Number, default: 0 },
  hasTrade1d: { type: Boolean, default: false },
  hasTrade7d: { type: Boolean, default: false },
  hasTrade30d: { type: Boolean, default: false },
}, { timestamps: true })

BinancePnlCacheSchema.index({ user: 1, date: 1 }, { unique: true })

module.exports = mongoose.model('BinancePnlCache', BinancePnlCacheSchema)



