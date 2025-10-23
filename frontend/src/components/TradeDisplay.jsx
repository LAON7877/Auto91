// 繁體中文註釋
// 交易資訊顯示：接收 WS 訊息並即時呈現（本地化顯示）

import React, { useEffect, useState } from 'react'
import { api } from '../services/api'

export default function TradeDisplay({ wsMsg, selectedUserId }) {
  const [trades, setTrades] = useState([])
  const [users, setUsers] = useState([])

  async function refresh() {
    const [tRes, uRes] = await Promise.all([
      api.get('/trades', { params: selectedUserId ? { userId: selectedUserId } : {} }),
      api.get('/users')
    ])
    // 僅顯示部分成交/已成交，最多 10 筆
    const filtered = (Array.isArray(tRes.data) ? tRes.data : [])
      .filter(t => t.status === 'partially_filled' || t.status === 'filled')
      .slice(0, 10)
    setTrades(filtered)
    setUsers(uRes.data)
  }

  useEffect(() => { refresh() }, [selectedUserId])

  useEffect(() => {
    if (!wsMsg) return
    if (wsMsg.type === 'order_update') {
      refresh()
    }
  }, [wsMsg])

  function mapExchange(ex) {
    const s = String(ex || '').toLowerCase()
    if (s === 'binance') return '幣安'
    if (s === 'okx') return '歐易'
    return String(ex || '')
  }
  function mapSide(side) {
    const s = String(side || '').toLowerCase()
    if (s === 'buy') return 'Buy'
    if (s === 'sell') return 'Sell'
    return s ? (s.charAt(0).toUpperCase() + s.slice(1)) : ''
  }
  function mapPair(pair) {
    const s = String(pair || '')
    return s.replace('/', '')
  }
  function mapStatus(status) {
    const s = String(status || '').toLowerCase()
    if (s === 'filled') return '已成交'
    if (s === 'partially_filled') return '部分成交'
    return status
  }

  return (
    <div className="trade-display">
      <h3>交易紀錄</h3>
      <table>
        <thead>
          <tr>
            <th>交易時間</th>
            <th>訂單號</th>
            <th>用戶名</th>
            <th>交易所</th>
            <th>交易對</th>
            <th>方向</th>
            <th>數量</th>
            <th>價格</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(t => {
            const u = users.find(x => x._id === t.user)
            const orderId = t.orderId || t._id
            const userText = u ? `${u.name || u.uid}｜${u.uid}` : t.user
            return (
              <tr key={t._id}>
                <td>{new Date(t.createdAt).toLocaleString()}</td>
                <td>{orderId}</td>
                <td>{userText}</td>
                <td>{mapExchange(t.exchange)}</td>
                <td>{mapPair(t.pair)}</td>
                <td>{mapSide(t.side)}</td>
                <td>{t.amount}</td>
                <td>{t.price}</td>
                <td>{mapStatus(t.status)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


