// 繁體中文註釋
// Cloudflare Tunnel 管理：使用 token 與 PEM（cert/key）在本機啟動 cloudflared
// - 需求：已安裝 cloudflared，可從 PATH 或指定 CLOUDFLARED_PATH 或現有 Auto91 目錄尋找
// - 策略：每個 Tunnel 一個子行程，啟動時把 certPem/keyPem 寫入臨時檔 origin.pem（cert+key）
// - 目標：將外部流量反向代理到 http://localhost:5001

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Tunnel = require('../models/Tunnel');
const logger = require('../utils/logger');

// 單進程策略：
// - token 模式：以 token 為 key，確保同一組 token 只有一個 cloudflared 進程
// - quick 模式（無 token）：以 tunnelId 為 key（每筆各一個進程）
const tokenProcesses = new Map(); // token -> { child, workDir }
const quickProcesses = new Map(); // tunnelId -> { child, workDir }

// 連線穩定性與回退機制（每個 token 或 tunnelId 追蹤）
// - 預設使用 HTTP/2（TCP），錯誤累積達門檻後回退至 QUIC（UDP）
// - 只單向回退，不自動再升級，避免震盪
const fallbackState = new Map(); // key -> { protocolOverride: 'http2'|'quic'|'' , errTimestamps: number[] }

function getUniqueKey(tunnelDoc) {
  if (tunnelDoc.token && tunnelDoc.token.trim().length > 0) return `token:${tunnelDoc.token}`;
  return `id:${tunnelDoc._id.toString()}`;
}

function getConfiguredProtocol() {
  const p = String(process.env.CF_PROTOCOL || 'http2').toLowerCase();
  return (p === 'http2' || p === 'quic') ? p : 'http2';
}

function getEffectiveProtocol(tunnelDoc) {
  const base = getConfiguredProtocol();
  const key = getUniqueKey(tunnelDoc);
  const st = fallbackState.get(key);
  if (st && st.protocolOverride) return st.protocolOverride;
  return base;
}

function getHaConnections() {
  const v = Number(process.env.CF_HA_CONNECTIONS || 8);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 64) : 8;
}

function getFailParams() {
  const threshold = Number(process.env.CF_FAIL_THRESHOLD || 5);
  const windowMs = Number(process.env.CF_FAIL_WINDOW_MS || 60000);
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 5,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000,
  };
}

function recordFailure(key) {
  const st = fallbackState.get(key) || { protocolOverride: '', errTimestamps: [] };
  const now = Date.now();
  st.errTimestamps.push(now);
  const { windowMs } = getFailParams();
  const cutoff = now - windowMs;
  st.errTimestamps = st.errTimestamps.filter(t => t >= cutoff);
  fallbackState.set(key, st);
}

function shouldFallbackToQuic(key, effectiveProtocol) {
  if (effectiveProtocol !== 'http2') return false;
  const st = fallbackState.get(key);
  if (!st) return false;
  const { threshold } = getFailParams();
  return st.errTimestamps.length >= threshold;
}

function getCloudflaredPath() {
  if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
    return process.env.CLOUDFLARED_PATH;
  }
  // 專案建議位置：backend/bin/cloudflared.exe（請將執行檔置於此）
  const projectBin = path.resolve(process.cwd(), 'backend', 'bin', 'cloudflared.exe');
  if (fs.existsSync(projectBin)) return projectBin;
  // 回退：使用 PATH 中的 cloudflared
  return 'cloudflared';
}

function ensureWorkDir(tunnelId) {
  const dir = path.resolve(process.cwd(), 'backend', 'runtime', 'tunnels', String(tunnelId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeOriginPem(dir, certPem, keyPem) {
  const originPath = path.join(dir, 'origin.pem');
  const combined = `${certPem}\n${keyPem}`;
  fs.writeFileSync(originPath, combined, { encoding: 'utf8' });
  return originPath;
}

function getLocalOriginUrl() {
  const port = process.env.PORT || 5001;
  return `http://localhost:${port}`;
}

async function startTunnel(tunnelDoc) {
  const tunnelId = tunnelDoc._id.toString();
  const cfPath = getCloudflaredPath();
  const workDir = ensureWorkDir(tunnelId);
  let args = [];
  let mode = 'quick';
  const key = getUniqueKey(tunnelDoc);

  // 協定與連線設定
  const effectiveProtocol = getEffectiveProtocol(tunnelDoc); // http2 | quic
  const ha = getHaConnections();

  if (tunnelDoc.token && tunnelDoc.token.trim().length > 0) {
    // Token 模式（命名隧道）。若提供 cert/key，寫入 origin.pem 增強相容性
    // 注意：cloudflared token 模式不需要也不接受 --origincert，此處不再傳遞
    if ((tunnelDoc.certPem && tunnelDoc.keyPem)) {
      // 僅將憑證寫入本地以便未來可能用於 YAML 模式，但不傳 flag
      writeOriginPem(workDir, tunnelDoc.certPem, tunnelDoc.keyPem);
    }
    // 若此 token 已有進程，則不重複啟動
    if (tokenProcesses.has(tunnelDoc.token)) {
      logger.info('Cloudflared 已在運行（token 單進程）', { token: tunnelDoc.token.slice(0, 6) + '...' });
      return;
    }
    args = [ 'tunnel', '--no-autoupdate', '--ha-connections', String(ha), '--protocol', effectiveProtocol, 'run', '--token', tunnelDoc.token, '--url', getLocalOriginUrl() ];
    mode = 'token';
  } else {
    // Quick Tunnel：會回傳 trycloudflare.com 的隨機網址
    args = [ 'tunnel', '--no-autoupdate', '--ha-connections', String(ha), '--protocol', effectiveProtocol, '--url', getLocalOriginUrl() ];
    mode = 'quick';
  }

  logger.info('啟動 Cloudflared', { tunnelId, cfPath, mode, protocol: effectiveProtocol, haConnections: ha, args });
  const child = spawn(cfPath, args, {
    cwd: workDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  child.stdout.on('data', (buf) => {
    const line = buf.toString();
    logger.info('[cloudflared]', { tunnelId, line: line.trim() });
    // 嘗試擷取 URL（僅 quick 模式保證輸出）
    if (mode === 'quick') {
      const match = line.match(/https?:\/\/[\w.-]+trycloudflare\.com\/?/i) || line.match(/https?:\/\/[\w.-]+\.[\w.-]+\/[\w\-\._~:?#\[\]@!$&'()*+,;=%]*?/i);
      if (match && match[0]) {
        const base = match[0].replace(/\/$/, '');
        const suffixPath = `/api/signal/${tunnelDoc.urlSuffix}`;
        const newFull = `${base}${suffixPath}`;
        // 更新資料庫中的 publicBaseUrl/fullUrl
        Tunnel.findByIdAndUpdate(tunnelId, { publicBaseUrl: base, fullUrl: newFull }, { new: true }).catch(() => {});
      }
    }
  });
  child.stderr.on('data', (buf) => {
    const line = buf.toString();
    logger.warn('[cloudflared][stderr]', { tunnelId, line: line.trim() });
    // 遇到錯誤輸出，累積計數並視情況回退到 QUIC
    try {
      recordFailure(key);
      const eff = effectiveProtocol;
      if (shouldFallbackToQuic(key, eff)) {
        const st = fallbackState.get(key) || { protocolOverride: '', errTimestamps: [] };
        if (st.protocolOverride !== 'quic') {
          st.protocolOverride = 'quic';
          fallbackState.set(key, st);
          logger.warn('偵測重複錯誤，將於重啟後回退至 QUIC', { key, tunnelId });
        }
      }
    } catch (_) {}
  });
  child.on('error', (err) => {
    logger.error('Cloudflared 進程錯誤', { tunnelId, message: err.message });
    try { recordFailure(key); } catch (_) {}
  });
  child.on('exit', (code) => {
    logger.warn('Cloudflared 進程結束', { tunnelId, code, mode });
    try {
      if (mode === 'token' && tunnelDoc.token) {
        tokenProcesses.delete(tunnelDoc.token);
      }
      // 無論任何模式，移除 quick 索引（若不存在不影響）
      quickProcesses.delete(tunnelId);
      // 可選自動重啟
      const auto = String(process.env.CF_AUTORESTART || 'true').toLowerCase() === 'true';
      if (auto) {
        const delay = Number(process.env.CF_RESTART_DELAY_MS || 5000);
        setTimeout(() => {
          Tunnel.findById(tunnelId).then(doc => { if (doc) startTunnel(doc).catch(() => {}); }).catch(() => {});
        }, delay);
      }
    } catch (_) {}
  });

  if (mode === 'token') {
    tokenProcesses.set(tunnelDoc.token, { child, workDir });
  } else {
    quickProcesses.set(tunnelId, { child, workDir });
  }
}

async function stopTunnel(tunnelId) {
  const proc = quickProcesses.get(String(tunnelId));
  if (!proc) return;
  try { proc.child.kill('SIGTERM'); } catch (_) {}
  quickProcesses.delete(String(tunnelId));
}

async function stopByToken(token) {
  const proc = tokenProcesses.get(String(token));
  if (!proc) return;
  try { proc.child.kill('SIGTERM'); } catch (_) {}
  tokenProcesses.delete(String(token));
}

async function restartTunnel(tunnelId) {
  const doc = await Tunnel.findById(tunnelId);
  if (!doc) throw new Error('隧道不存在');
  if (doc.token && doc.token.trim().length > 0) {
    await stopByToken(doc.token);
    await startTunnel(doc);
  } else {
    await stopTunnel(tunnelId);
    await startTunnel(doc);
  }
}

async function ensureRunningForAll() {
  const items = await Tunnel.find();
  // 先處理 token 模式（去重），確保同 token 只啟動一個進程
  const tokenSet = new Set(items.filter(t => t.token && t.token.trim().length > 0).map(t => t.token));
  for (const token of tokenSet) {
    try {
      if (!tokenProcesses.has(token)) {
        // 找到任意一筆同 token 的紀錄啟動即可
        const doc = items.find(t => t.token === token);
        if (doc) await startTunnel(doc);
      }
    } catch (e) {
      logger.error('啟動隧道失敗(token)', { token: token.slice(0, 6) + '...', message: e.message });
    }
  }
  // 再處理 quick 模式（每筆各自一個進程）
  for (const t of items.filter(t => !t.token || t.token.trim().length === 0)) {
    try {
      if (!quickProcesses.has(t._id.toString())) await startTunnel(t);
    } catch (e) {
      logger.error('啟動隧道失敗(quick)', { tunnelId: t._id.toString(), message: e.message });
    }
  }
}

async function restartByToken(token) {
  await stopByToken(token);
  // 需找到任一同 token 的紀錄
  const doc = await Tunnel.findOne({ token });
  if (doc) await startTunnel(doc);
}

module.exports = { startTunnel, stopTunnel, stopByToken, restartTunnel, restartByToken, ensureRunningForAll };


