// 繁體中文註釋
// 使用者編輯彈窗（不要求再次輸入金鑰）

import React, { useState } from 'react'
import Select from 'react-select'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { api } from '../services/api'

export default function UserEditModal({ tunnels, user, onClose }) {
  const [name, setName] = useState(user.name || '')
  const [exchange, setExchange] = useState(user.exchange)
  const [editKeys, setEditKeys] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [apiPassphrase, setApiPassphrase] = useState('')
  const [uid, setUid] = useState(user.uid)
  const [pair, setPair] = useState(user.pair)
  const [marginMode, setMarginMode] = useState(user.marginMode)
  const [leverage, setLeverage] = useState(user.leverage)
  const [riskPercent, setRiskPercent] = useState(user.riskPercent)
  const [reservedFunds, setReservedFunds] = useState(Number(user.reservedFunds || 0))
  const [fixedFunds, setFixedFunds] = useState(Number(user.fixedFunds || 0))
  const [selectedTunnel, setSelectedTunnel] = useState(user.selectedTunnel ? { value: user.selectedTunnel._id, label: user.selectedTunnel.name } : { value: null, label: '無' })
  const [subscriptionEnd, setSubscriptionEnd] = useState(user.subscriptionEnd ? new Date(user.subscriptionEnd) : null)
  const [telegramIds, setTelegramIds] = useState(user.telegramIds || '')
  const [tgPrefs, setTgPrefs] = useState(() => {
    const p = user.tgPrefs || {}
    return {
      fills: p.fills !== undefined ? p.fills : true,
      daily: p.daily !== undefined ? p.daily : true,
      acctPos: p.acctPos !== undefined ? p.acctPos : true,
      riskOps: p.riskOps !== undefined ? p.riskOps : false,
    }
  })
  const [err, setErr] = useState('')

  const selectStyles = {
    control: (base) => ({ ...base, background: '#ffffff', color: '#000000', borderColor: '#2a2a2a' }),
    menu: (base) => ({ ...base, background: '#ffffff', color: '#000000' }),
    option: (base, state) => ({ ...base, background: state.isFocused ? '#f0f0f0' : '#ffffff', color: '#000000' }),
    singleValue: (base) => ({ ...base, color: '#000000' }),
    placeholder: (base) => ({ ...base, color: '#666666' }),
    input: (base) => ({ ...base, color: '#000000' })
  }

  const tunnelOptions = [
    { value: null, label: '無' },
    ...tunnels.map(t => ({ value: t._id, label: `${t.name} (${t.urlSuffix})` }))
  ]

  async function submit() {
    setErr('')
    try {
      const lev = Number(leverage)
      const risk = Number(riskPercent)
      if (!(lev >= 1 && lev <= 100)) throw new Error('槓桿需為 1-100')
      if (!(risk > 0 && risk <= 100)) throw new Error('風險需為 1-100')
      const rf = Number(reservedFunds || 0)
      const ff = Number(fixedFunds || 0)
      if (!(rf >= 0)) throw new Error('保留資金需為 >= 0')
      if (!(ff >= 0)) throw new Error('固定資金需為 >= 0')
      const payload = {
        name,
        exchange,
        uid,
        pair,
        marginMode,
        leverage: lev,
        riskPercent: risk,
        reservedFunds: rf,
        fixedFunds: ff,
        selectedTunnel: selectedTunnel?.value || null,
        subscriptionEnd: subscriptionEnd ? subscriptionEnd.toISOString() : null,
        telegramIds
      }

      if (editKeys) {
        const key = String(apiKey || '').trim()
        const sec = String(apiSecret || '').trim()
        const pph = String(apiPassphrase || '').trim()
        if (!key || !sec) throw new Error('API Key/Secret 不得為空')
        payload.apiKey = key
        payload.apiSecret = sec
        if (String(exchange).toLowerCase() === 'okx') payload.apiPassphrase = pph
      }

      const adminKey = (import.meta?.env?.VITE_ADMIN_KEY || '').trim()
      const headers = adminKey ? { 'x-admin-key': adminKey } : {}
      await api.put(`/users/${user._id}`, payload, { headers })
      // 儲存通知偏好（分開 PATCH，避免影響既有更新流程）
      try { await api.patch(`/users/${user._id}/tg-prefs`, { tgPrefs }, { headers }) } catch (_) {}
      onClose()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="modal">
      <div className="modal-body">
        <h3>編輯使用者</h3>
        {err && <div className="error">{err}</div>}
        <div className="grid">
          <label>自訂名稱</label>
          <input value={name} onChange={e => setName(e.target.value)} />

          <label>交易所</label>
          <select value={exchange} onChange={e => setExchange(e.target.value)}>
            <option value="binance">Binance</option>
            <option value="okx">OKX</option>
          </select>

          <label>UID</label>
          <input value={uid} onChange={e => setUid(e.target.value)} />

          <label>交易對</label>
          <select value={pair} onChange={e => setPair(e.target.value)}>
            <option value="BTC/USDT">BTCUSDT</option>
            <option value="ETH/USDT">ETHUSDT</option>
          </select>

          <label>保證金模式</label>
          <select value={marginMode} onChange={e => setMarginMode(e.target.value)}>
            <option value="cross">全倉</option>
            <option value="isolated">逐倉</option>
          </select>

          <label>槓桿倍數(x)</label>
          <input type="number" value={leverage} onChange={e => setLeverage(e.target.value)} />

          <label>頭寸比例(%)</label>
          <input type="number" value={riskPercent} onChange={e => setRiskPercent(e.target.value)} />

          <div style={{ gridColumn: '1 / span 2', border: '1px solid #333', borderRadius: 8, padding: 12, background: '#0f0f0f', marginTop: 8 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold' }}>編輯 API 金鑰（選用）</div>
              <label style={{ display:'flex', alignItems:'center', gap:8, color:'#ddd', fontSize: 14, cursor:'pointer' }}>
                <input type="checkbox" checked={editKeys} onChange={e => setEditKeys(e.target.checked)} />
                <span style={{ writingMode:'vertical-rl', textOrientation:'upright', lineHeight: 1, whiteSpace:'nowrap' }}>啟用</span>
              </label>
            </div>
            {editKeys && (
              <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap: 8, alignItems:'center' }}>
                <label>API Key</label>
                <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="新的 API Key" />
                <label>API Secret</label>
                <input value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="新的 API Secret" />
                {String(exchange).toLowerCase() === 'okx' && <>
                  <label>API Passphrase</label>
                  <input value={apiPassphrase} onChange={e => setApiPassphrase(e.target.value)} placeholder="OKX Passphrase（如有）" />
                </>}
                <div style={{ gridColumn:'1 / span 2', color:'#aaa', fontSize:12, marginTop: 4 }}>
                  僅在勾選「啟用」時才會更新金鑰；未勾選則保留原金鑰不變。
                </div>
              </div>
            )}
          </div>

          <label>訂閱到期</label>
          <DatePicker selected={subscriptionEnd} onChange={setSubscriptionEnd} dateFormat="yyyy/MM/dd" isClearable placeholderText="選擇日期（留空則為永久期限）" />

          <label>訊號通道</label>
          <Select styles={selectStyles} options={tunnelOptions} value={selectedTunnel} onChange={setSelectedTunnel} />

          <label>保留資金</label>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <input type="number" value={reservedFunds} onChange={e => setReservedFunds(e.target.value)} min={0} />
            <span style={{ color:'#666' }}>USDT</span>
          </div>

          <label>固定資金</label>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <input type="number" value={fixedFunds} onChange={e => setFixedFunds(e.target.value)} min={0} />
            <span style={{ color:'#666' }}>USDT</span>
          </div>

          <div style={{ gridColumn: '1 / span 2', border: '1px solid #333', borderRadius: 8, padding: 12, background: '#111', marginTop: 8 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 'bold' }}>Telegram 通知</div>
              <div style={{ fontSize: 12, color: '#aaa' }}>未填 chat Id 則不發送</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap: 8, alignItems:'center', marginBottom: 8 }}>
              <label style={{ color:'#ddd' }}>Chat ID</label>
              <input value={telegramIds} onChange={e => setTelegramIds(e.target.value)} placeholder="例如：12345678,-100987654321（可多個，逗號分隔）" />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', border:'1px solid #444', borderRadius:8, background:'#0f0f0f', fontSize:14, lineHeight:'20px', color:'#ddd', cursor:'pointer' }}>
                <input style={{ width:16, height:16 }} type="checkbox" checked={tgPrefs.fills} onChange={e => setTgPrefs(prev => ({ ...prev, fills: e.target.checked }))} />
                <span>成交通知</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', border:'1px solid #444', borderRadius:8, background:'#0f0f0f', fontSize:14, lineHeight:'20px', color:'#ddd', cursor:'pointer' }}>
                <input style={{ width:16, height:16 }} type="checkbox" checked={tgPrefs.daily} onChange={e => setTgPrefs(prev => ({ ...prev, daily: e.target.checked }))} />
                <span>日結通知</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', border:'1px solid #444', borderRadius:8, background:'#0f0f0f', fontSize:14, lineHeight:'20px', color:'#ddd', cursor:'pointer' }}>
                <input style={{ width:16, height:16 }} type="checkbox" checked={tgPrefs.acctPos} onChange={e => setTgPrefs(prev => ({ ...prev, acctPos: e.target.checked }))} />
                <span>風控告警</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', border:'1px solid #444', borderRadius:8, background:'#0f0f0f', fontSize:14, lineHeight:'20px', color:'#ddd', cursor:'pointer' }}>
                <input style={{ width:16, height:16 }} type="checkbox" checked={tgPrefs.riskOps} onChange={e => setTgPrefs(prev => ({ ...prev, riskOps: e.target.checked }))} />
                <span>系統告警</span>
              </label>
            </div>
          </div>
        </div>

        <div className="actions">
          <button onClick={submit}>儲存</button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  )
}



