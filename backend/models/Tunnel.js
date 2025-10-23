// 繁體中文註釋
// CF 通道模型：管理 PEM、TOKEN、URL 後綴與顯示之完整 URL

const mongoose = require('mongoose');

const TunnelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // 新版：分離證書與私鑰
    certPem: { type: String, required: true },
    keyPem: { type: String, required: true },
    // 舊版相容（若先前資料僅有單一 pem，建議後續以工具導入新版欄位）
    pem: { type: String, required: false },
    token: { type: String, required: true },
    urlSuffix: { type: String, required: true }, // 用於 /api/signal/:suffix 映射
    publicBaseUrl: { type: String, default: '' }, // 選填：CF 生成之公開 URL
    fullUrl: { type: String, default: '' }, // 顯示用途（publicBaseUrl + '/api/signal/' + urlSuffix）
  },
  { timestamps: true }
);

TunnelSchema.pre('save', function (next) {
  const suffixPath = `/api/signal/${this.urlSuffix}`;
  if (this.publicBaseUrl) {
    const base = this.publicBaseUrl.replace(/\/$/, '');
    this.fullUrl = `${base}${suffixPath}`;
  } else {
    // 若未設定公開 URL，提供相對路徑以方便前端組裝本機 URL
    this.fullUrl = suffixPath;
  }
  next();
});

module.exports = mongoose.model('Tunnel', TunnelSchema);



