// 繁體中文註釋
// 全域系統設定（單一文件）：週報相關設定

const mongoose = require('mongoose')

const WeeklySchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  percent: { type: Number, default: 0.1 }, // 0~1，例如 0.1 = 10%
  tgIds: { type: [String], default: [] },   // Telegram chatId 陣列
  tz: { type: String, default: 'Asia/Taipei' },
}, { _id: false })

const SystemConfigSchema = new mongoose.Schema({
  weekly: { type: WeeklySchema, default: () => ({}) },
}, { timestamps: true })

// 單例：僅存一筆
SystemConfigSchema.statics.getSingleton = async function getSingleton() {
  const Model = this
  let doc = await Model.findOne().lean()
  if (!doc) {
    doc = await Model.create({})
  }
  return await Model.findById(doc._id)
}

module.exports = mongoose.model('SystemConfig', SystemConfigSchema)


