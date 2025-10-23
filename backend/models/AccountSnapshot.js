// 繁體中文註釋
// 帳戶快取模型：持久化最新帳戶摘要與持倉，供熱啟動時回放

const mongoose = require('mongoose')

const AccountSnapshotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, unique: true },
  summary: { type: Object, default: {} },
  positions: { type: Array, default: [] },
  ts: { type: Date, default: Date.now },
}, { timestamps: true })

module.exports = mongoose.model('AccountSnapshot', AccountSnapshotSchema)






















