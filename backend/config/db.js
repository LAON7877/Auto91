// 繁體中文註釋
// MongoDB 連線設定

const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('缺少 MONGODB_URI 環境變數');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 15000,
  });
  logger.info('MongoDB 連線成功');
}

module.exports = { connectMongo };



