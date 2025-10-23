// 繁體中文註釋
// 使用者模型：每位使用者擁有各自交易所與風控設定

const mongoose = require('mongoose');
const { encryptString, decryptString } = require('../utils/encrypt');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' }, // 自訂使用者名稱（前端顯示）
    exchange: { type: String, enum: ['binance', 'okx'], required: true },
    apiKeyEnc: { type: String, required: true }, // 加密保存
    apiSecretEnc: { type: String, required: true }, // 加密保存
    apiPassphraseEnc: { type: String, default: '' }, // OKX 需要（Binance 可空）
    uid: { type: String, required: true },
    pair: { type: String, enum: ['BTC/USDT', 'ETH/USDT'], required: true },
    marginMode: { type: String, enum: ['cross', 'isolated'], default: 'cross' },
    leverage: { type: Number, min: 1, max: 100, default: 10 },
    riskPercent: { type: Number, min: 1, max: 100, default: 10 },
    // 新增資金控制：保留資金、固定資金（單位：USDT）
    reservedFunds: { type: Number, min: 0, default: 0 },
    fixedFunds: { type: Number, min: 0, default: 0 },
    selectedTunnel: { type: mongoose.Schema.Types.ObjectId, ref: 'Tunnel', required: false },
    subscriptionEnd: { type: Date, default: null }, // 訂閱到期時間（為空代表不限制）
    enabled: { type: Boolean, default: true },
    // Telegram 通知：逗號分隔 chatId 或群組 id，留空則不發送
    telegramIds: { type: String, default: '' },
    // Telegram 通知偏好（每用戶）：未設定時由預設值覆蓋
    tgPrefs: { type: Object, default: {} },
  },
  { timestamps: true }
);

// 虛擬欄位或方法：取出明文
UserSchema.methods.getDecryptedKeys = function () {
  return {
    apiKey: decryptString(this.apiKeyEnc),
    apiSecret: decryptString(this.apiSecretEnc),
    apiPassphrase: this.apiPassphraseEnc ? decryptString(this.apiPassphraseEnc) : '',
  };
};

UserSchema.statics.encryptCredentials = function ({ apiKey, apiSecret, apiPassphrase }) {
  return {
    apiKeyEnc: encryptString(apiKey),
    apiSecretEnc: encryptString(apiSecret),
    apiPassphraseEnc: apiPassphrase ? encryptString(apiPassphrase) : '',
  };
};

module.exports = mongoose.model('User', UserSchema);


