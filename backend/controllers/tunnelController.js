// 繁體中文註釋
// 通道 CRUD 控制器

const fs = require('fs');
const path = require('path');
const Tunnel = require('../models/Tunnel');
const User = require('../models/User');
const bus = require('../services/eventBus');
const { restartTunnel, stopTunnel, stopByToken } = require('../services/cfTunnelManager');
const { isNonEmptyString } = require('../utils/validators');
const { bumpBySuffix, bumpByTunnelId } = require('../services/signalConfigVersion');

async function listTunnels(req, res, next) {
  try {
    const items = await Tunnel.find();
    res.json(items);
  } catch (err) { next(err); }
}

async function createTunnel(req, res, next) {
  try {
    const { name, certPem, keyPem, token, urlSuffix } = req.body;
    let { publicBaseUrl } = req.body;
    if (!isNonEmptyString(name) || !isNonEmptyString(certPem) || !isNonEmptyString(keyPem) || !isNonEmptyString(token) || !isNonEmptyString(urlSuffix)) {
      throw new Error('名稱、CERT.PEM、KEY.PEM、TOKEN、URL 後綴皆為必填');
    }
    // 允許使用者貼上帶有 @ 或空白的 URL，這裡做清理
    publicBaseUrl = (publicBaseUrl || '').trim().replace(/^@+/, '');
    const base = publicBaseUrl ? publicBaseUrl.replace(/\/$/, '') : '';
    const suffixPath = `/api/signal/${urlSuffix}`;
    const fullUrl = base ? `${base}${suffixPath}` : suffixPath;

    const item = await Tunnel.create({ name, certPem, keyPem, token, urlSuffix, publicBaseUrl: base, fullUrl });
    // 建立後嘗試啟動 CF 隧道
    try { await restartTunnel(item._id); } catch (_) {}
    try { bumpBySuffix(urlSuffix, 'tunnel_create') } catch (_) {}
    res.status(201).json(item);
  } catch (err) { next(err); }
}

async function updateTunnel(req, res, next) {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    const current = await Tunnel.findById(id);
    if (!current) return res.status(404).json({ error: '通道不存在' });

    // 清理 base URL 與重新計算 fullUrl
    const name = payload.name ?? current.name;
    const certPem = payload.certPem ?? current.certPem;
    const keyPem = payload.keyPem ?? current.keyPem;
    const token = payload.token ?? current.token;
    const urlSuffix = payload.urlSuffix ?? current.urlSuffix;
    let publicBaseUrl = (payload.publicBaseUrl ?? current.publicBaseUrl ?? '').trim().replace(/^@+/, '');
    const base = publicBaseUrl ? publicBaseUrl.replace(/\/$/, '') : '';
    const suffixPath = `/api/signal/${urlSuffix}`;
    const fullUrl = base ? `${base}${suffixPath}` : suffixPath;

    const item = await Tunnel.findByIdAndUpdate(
      id,
      { name, certPem, keyPem, token, urlSuffix, publicBaseUrl: base, fullUrl },
      { new: true }
    );
    try { await restartTunnel(item._id); } catch (_) {}
    try { bumpBySuffix(urlSuffix, 'tunnel_update') } catch (_) {}
    res.json(item);
  } catch (err) { next(err); }
}

async function deleteTunnel(req, res, next) {
  try {
    const { id } = req.params;
    // 先查資料以便關閉進程與清理檔案
    const doc = await Tunnel.findById(id);
    if (doc) {
      try {
        if (doc.token && doc.token.trim().length > 0) {
          // 若尚有其他相同 token 的通道存在，則不關閉共享的 cloudflared 進程
          const others = await Tunnel.countDocuments({ token: doc.token, _id: { $ne: doc._id } })
          if (others === 0) {
            await stopByToken(doc.token);
          }
        } else {
          // quick 模式僅關閉本通道對應進程
          await stopTunnel(id);
        }
      } catch (_) {}
    }
    await Tunnel.findByIdAndDelete(id);
    // 清理引用此通道的使用者：selectedTunnel 設為 null，避免殘留無效引用
    try { await User.updateMany({ selectedTunnel: id }, { $set: { selectedTunnel: null } }) } catch (_) {}
    // 清理 runtime 憑證資料夾
    try {
      const dir = path.resolve(process.cwd(), 'backend', 'runtime', 'tunnels', String(id));
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (_) {}
    try { bus.emit('frontend:broadcast', { type: 'tunnel_removed', tunnelId: String(id), ts: Date.now() }) } catch (_) {}
    try { await bumpByTunnelId(id, 'tunnel_delete') } catch (_) {}
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listTunnels, createTunnel, updateTunnel, deleteTunnel };



