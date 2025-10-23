// 繁體中文註釋
// 交易資訊/歷史：記錄每位使用者的餘額、倉位、費用與 PnL

const mongoose = require('mongoose');

const TradeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    exchange: { type: String, enum: ['binance', 'okx'], required: true },
    orderId: { type: String, default: '' },
    pair: { type: String, required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    amount: { type: Number, required: true },
    price: { type: Number, required: true },
    status: { type: String, enum: ['submitted', 'partially_filled', 'filled', 'rejected'], default: 'submitted' },
    reason: { type: String, default: '' },

    // 資產快照（可擴充）
    walletBalance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
    marginBalance: { type: Number, default: 0 },
    unrealizedPnl: { type: Number, default: 0 },
    marginRatio: { type: Number, default: 0 },
    feePaid: { type: Number, default: 0 },
    leverageUsed: { type: Number, default: 0 },

    // 匯總期間數據（此處簡化為欄位，實務可獨立集合彙整）
    pnl1d: { type: Number, default: 0 },
    pnl7d: { type: Number, default: 0 },
    pnl30d: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Trade', TradeSchema);



