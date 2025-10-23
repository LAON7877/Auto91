// 繁體中文註釋
// 簡易 Metrics 面板：讀取 /api/metrics（需 x-admin-key）

import React from 'react'
import { api } from '../services/api'

export default function Metrics({ variant = 'panel' }) {
  const [data, setData] = React.useState(null)
  const adminKey = import.meta.env?.VITE_ADMIN_KEY || ''
  const [now, setNow] = React.useState(Date.now())

  React.useEffect(() => {
    let timer
    const fetchOnce = async () => {
      try {
        const res = await api.get('/metrics', { headers: adminKey ? { 'x-admin-key': adminKey } : {} })
        setData(res.data)
      } catch (_) {}
    }
    fetchOnce()
    timer = setInterval(fetchOnce, 10000)
    return () => { try { clearInterval(timer) } catch (_) {} }
  }, [adminKey])

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const d = new Date(now)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const MM = String(d.getMinutes()).padStart(2, '0')
  const SS = String(d.getSeconds()).padStart(2, '0')
  const timeStr = `${yyyy}/${mm}/${dd} ${HH}:${MM}:${SS}`

  if (variant === 'inline') {
    return (
      <div style={{ fontSize: 16, color: '#999', textAlign: 'right', lineHeight: 1.2 }}>
        <div>{timeStr}</div>
        <span title="近24小時內被交易所限流（HTTP 429/418）的總次數。變高＝頻率太密/併發過高，需要調整限流或分流。">
          429: {data?.orders429 ?? 0}
        </span>
        {' '}｜{' '}
        <span title="近24小時內下單延遲的第95百分位（毫秒）。95% 低於此值、5% 高於此值。上升代表尾延遲變差（排隊、重試或交易所回應變慢）。">
          p95: {data?.p95Ms ?? 0}ms
        </span>
        {' '}｜{' '}
        <span title="近24小時內被統計的下單延遲筆數（用於計算 p95 的樣本量）。樣本越多，p95 越穩定。">
          n={data?.count ?? 0}
        </span>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>系統指標</h2>
      <div>429 次數：{data?.orders429 ?? 0}</div>
      <div>下單延遲 P95（毫秒）：{data?.p95Ms ?? 0}</div>
      <div>樣本數：{data?.count ?? 0}</div>
    </div>
  )
}


