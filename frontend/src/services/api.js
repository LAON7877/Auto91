import axios from 'axios'

export const api = axios.create({
  baseURL: '/api'
})

// 取得 OKX 1/7/30 統一口徑摘要
export async function getOkxSummary(userId) {
  const res = await api.get(`/okx/summary?userId=${encodeURIComponent(userId)}`)
  return res.data || { feePaid: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0 }
}

// 取得 Binance 1/7/30 摘要（與 OKX 一致口徑；不加 refresh）
export async function getBinanceSummary(userId) {
  const res = await api.get(`/binance/summary?userId=${encodeURIComponent(userId)}`)
  return res.data || { feePaid: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0 }
}

export async function getWeeklySummary(userId, exchange) {
  const ex = String(exchange || '').toLowerCase()
  if (ex === 'okx') {
    const res = await api.get(`/okx/weekly?userId=${encodeURIComponent(userId)}`)
    return res.data || { pnlWeek: 0, commissionWeek: 0 }
  }
  if (ex === 'binance') {
    const res = await api.get(`/binance/weekly?userId=${encodeURIComponent(userId)}`)
    return res.data || { pnlWeek: 0, commissionWeek: 0 }
  }
  return { pnlWeek: 0, commissionWeek: 0 }
}

// 系統設定（管理）
export async function getAdminConfig() {
  const res = await api.get('/admin/config', { headers: { 'Cache-Control': 'no-cache' } })
  return res.data || { weekly: { enabled: true, percent: 0.1, tgIds: [], tz: 'Asia/Taipei' } }
}

export async function updateAdminConfig(payload) {
  const adminKey = (import.meta?.env?.VITE_ADMIN_KEY || '').trim()
  const headers = adminKey ? { 'x-admin-key': adminKey } : {}
  const res = await api.put('/admin/config', payload, { headers })
  return res.data || { ok: true }
}

// 取得單日彙總（日結）：依 userId 與日期（YYYY-MM-DD）；若未提供日期，後端取當日
export async function getDaily(userId, date) {
  const q = [`userId=${encodeURIComponent(userId)}`]
  if (date) q.push(`date=${encodeURIComponent(date)}`)
  const res = await api.get(`/daily?${q.join('&')}`)
  return res.data || { tradeCount: 0, feeSum: 0, pnlSum: 0, closedTrades: [] }
}























