// 繁體中文註釋
// 持倉詳情：從 account_update 的 positions 抽取關鍵資訊（簡化）

import React from 'react'
import { wsConnect } from '../services/ws'

export default function PositionPanel({ wsMsg }) {
  const isUpdate = wsMsg && wsMsg.type === 'account_update'
  const userId = isUpdate ? String(wsMsg.userId || '') : ''
  const exchange = isUpdate ? String(wsMsg.exchange || '') : ''
  const pair = isUpdate ? String(wsMsg.pair || '') : ''

  const [items, setItems] = React.useState([])

  // 將 props 的持倉與現有狀態合併：保留非 0 的 entry/mark/liq/leverage
  React.useEffect(() => {
    if (!isUpdate) return
    const changed = Array.isArray(wsMsg.changedKeys) ? wsMsg.changedKeys : []
    const incoming = Array.isArray(wsMsg.positions) ? wsMsg.positions : null

    // 若此次帶有 positions 且皆為 0/flat，視為已平倉 → 立即清空
    if (Array.isArray(incoming)) {
      const nonZero = incoming.filter(p => Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0)) > 0 && String(p?.side || '').toLowerCase() !== 'flat')
      if (nonZero.length === 0) { setItems([]); return }

      // 不再與舊值合併，直接以當前非 0 持倉覆蓋（避免殘留）
      const mapped = nonZero.map(p => {
        // 盡量保留上一筆非 0 的 markPrice，避免被 0 覆蓋造成閃爍
        const old = (() => {
          try { return Array.isArray(items) ? items.find(x => String(x.symbol||'') === String(p.symbol||pair)) || {} : {} } catch (_) { return {} }
        })()
        const entry = Number(p.entryPrice || p.entry || 0)
        const mark = Number(p.markPrice)
        const liq = Number(p.liquidationPrice || 0)
        const lev = Number(p.leverage || 0)
        const symbol = p.symbol || pair
        const side = p.side || 'flat'
        const contracts = Number(p.contracts ?? p.contractsSize ?? 0)
        const markPrice = (Number.isFinite(mark) && mark !== 0) ? mark : (Number.isFinite(Number(old.markPrice)) && Number(old.markPrice) !== 0 ? Number(old.markPrice) : 0)
        const liquidationPrice = (Number.isFinite(liq) && liq > 0) ? liq : undefined
        const leverage = Number.isFinite(lev) && lev !== 0 ? lev : 0
        const qty = Math.abs(Number(contracts || 0))
        const sideTxt = String(side || '').toLowerCase()
        const has = qty > 0 && entry > 0 && markPrice > 0 && (sideTxt === 'long' || sideTxt === 'short')
        const derivedUnp = has ? ((sideTxt === 'short' ? (entry - markPrice) : (markPrice - entry)) * qty) : undefined
        const unrealizedPnl = (derivedUnp !== undefined) ? derivedUnp : Number(p.unrealizedPnl || 0)
        return {
          symbol,
          side,
          contracts,
          entryPrice: entry,
          markPrice,
          leverage,
          marginMode: p.marginMode || 'cross',
          liquidationPrice,
          unrealizedPnl,
        }
      })
      setItems(mapped)
      return
    }

    // 若此次未帶 positions，但 changedKeys 顯示有變更，清空（避免殘留）
    if (!incoming && changed.includes('positions')) { setItems([]); return }
  }, [isUpdate, wsMsg])

  // 保持 WS 為唯一更新來源：不再使用 REST 即時補槓桿

  // 已改為由父層 Dashboard 單點更新 markPrice；此處不再自行訂閱 ticker

  const fmt8 = (v) => Number(v || 0).toFixed(8)
  const fmt2 = (v) => Number(v || 0).toFixed(2)
  const fmtQtyDyn = (q) => {
    const n = Number(q || 0)
    const s = n.toFixed(4)
    const parts = s.split('.')
    if (parts.length < 2) return n.toFixed(2)
    const f = parts[1]
    if (f[3] !== '0') return n.toFixed(4)
    if (f[2] !== '0') return n.toFixed(3)
    return n.toFixed(2)
  }

  return (
    <div className="position-panel" style={{ marginTop: 16 }}>
      <h3>持倉狀態</h3>
      <table>
        <thead>
          <tr>
            <th>交易對</th>
            <th>持倉數量</th>
            <th>開倉價格</th>
            <th>標記價格</th>
            <th>強平價格</th>
            <th>未實現盈虧</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? (
            items.map((it, idx) => {
            const sideLabel = it.side === 'short' ? '空' : it.side === 'long' ? '多' : ''
            const badgeClass = it.side === 'short' ? 'badge badge-short' : it.side === 'long' ? 'badge badge-long' : 'badge'
            const rawSym = it.symbol || ''
            const pairText = rawSym.replace(':USDT','').replace('-SWAP','').replace('-', '').replace('/', '')
            const base = (rawSym.split('/')[0] || '').replace(':USDT','').replace('-SWAP','')
            const modeZh = it.marginMode === 'cross' ? '全倉' : '逐倉'
            const levText = it.leverage ? `${it.leverage}x` : ''
            return (
              <tr key={idx}>
                <td>
                  {sideLabel && <span className={badgeClass}>{sideLabel}</span>} {pairText} {modeZh}{levText ? levText : ''}
                </td>
                <td>
                  {fmtQtyDyn(it.contracts)} <span className="unit">{base}</span>
                  <div style={{ borderTop: '1px solid #222', margin: '4px 0' }} />
                  {fmt8(Math.abs(Number(it.contracts || 0)) * Number(it.markPrice || 0))} <span className="unit">USDT</span>
                </td>
                <td>{fmt2(it.entryPrice)} <span className="unit">USDT</span></td>
                <td>{fmt2(it.markPrice)} <span className="unit">USDT</span></td>
                <td>{(() => { const v = Number(it.liquidationPrice || 0); return v > 0 ? <span>{fmt2(v)} <span className="unit">USDT</span></span> : <span>-</span> })()}</td>
                <td>{(() => { const n = Number(it.unrealizedPnl || 0); if (n>0) return <span><span style={{color:'#00c853'}}>+ {fmt8(n)}</span> <span className="unit">USDT</span></span>; if (n<0) return <span><span style={{color:'#ff4d4f'}}>- {fmt8(Math.abs(n))}</span> <span className="unit">USDT</span></span>; return <span>{fmt8(0)} <span className="unit">USDT</span></span> })()}</td>
              </tr>
            )
            })
          ) : null}
        </tbody>
      </table>
    </div>
  )
}



