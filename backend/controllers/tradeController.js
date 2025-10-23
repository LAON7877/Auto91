// 繁體中文註釋
// 交易查詢控制器（歷史查詢/當前簡表）

const Trade = require('../models/Trade');

async function listTrades(req, res, next) {
  try {
    const { userId } = req.query;
  const q = userId ? { user: userId } : {};
  // 僅保留部分成交/已成交，且只回前端 10 筆
  const items = await Trade.find({ ...q, status: { $in: ['partially_filled', 'filled'] } })
    .sort({ createdAt: -1 })
    .limit(10);
    res.json(items);
  } catch (err) { next(err); }
}

module.exports = { listTrades };



