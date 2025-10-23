// 繁體中文註釋
// 訊號配置版本：以通道後綴（suffix）為作用域的版本號
// - 目的：當用戶通道/訂閱/啟用狀態變更時，立刻使去重鍵失效，允許新配置即時生效

const Tunnel = require('../models/Tunnel')
const logger = require('../utils/logger')

// key: suffix -> { v: number, ts: number }
const SUFFIX_VERSIONS = new Map()

function getVersionForSuffix(suffix) {
  const key = String(suffix || '')
  if (!key) return 1
  const rec = SUFFIX_VERSIONS.get(key)
  if (!rec) return 1
  return Number(rec.v || 1) || 1
}

function bumpBySuffix(suffix, reason) {
  try {
    const key = String(suffix || '')
    if (!key) return
    const prev = getVersionForSuffix(key)
    const next = prev + 1
    SUFFIX_VERSIONS.set(key, { v: next, ts: Date.now() })
    try { logger.info('[SignalCfgVersion] bump', { suffix: key, prev, next, reason: reason || '' }) } catch (_) {}
  } catch (_) {}
}

async function bumpByTunnelId(tunnelId, reason) {
  try {
    const t = await Tunnel.findById(tunnelId).select('urlSuffix').lean()
    if (t && t.urlSuffix) bumpBySuffix(String(t.urlSuffix), reason || 'tunnelId')
  } catch (e) {
    try { logger.warn('[SignalCfgVersion] bumpByTunnelId 失敗', { tunnelId: String(tunnelId || ''), message: e.message }) } catch (_) {}
  }
}

module.exports = { getVersionForSuffix, bumpBySuffix, bumpByTunnelId }


