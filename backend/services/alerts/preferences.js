// 繁體中文註釋
// 讀取每位使用者的通知偏好，帶記憶體快取

const User = require('../../models/User')
const { DEFAULT_PREFS } = require('./constants')

const CACHE = new Map()
const TTL_MS = 10 * 1000

function mergePrefs(userPrefs) {
  const base = JSON.parse(JSON.stringify(DEFAULT_PREFS))
  if (!userPrefs || typeof userPrefs !== 'object') return base
  const out = { ...base, ...userPrefs }
  if (userPrefs.thresholds) {
    out.thresholds = { ...base.thresholds, ...userPrefs.thresholds }
  }
  return out
}

async function getUserPrefs(userId) {
  const key = String(userId)
  const cached = CACHE.get(key)
  if (cached && (Date.now() - cached.ts < TTL_MS)) return cached.prefs
  const doc = await User.findById(key).select('tgPrefs').lean().catch(() => null)
  const prefs = mergePrefs(doc && doc.tgPrefs)
  CACHE.set(key, { ts: Date.now(), prefs })
  return prefs
}

// 清除指定用戶的緩存，確保設置更新後立即生效
function clearUserCache(userId) {
  const key = String(userId)
  CACHE.delete(key)
}

module.exports = { getUserPrefs, clearUserCache }









