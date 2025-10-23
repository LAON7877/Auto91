// 繁體中文註釋
// 使用者新增/設定表單

import React, { useState } from 'react'
import Select from 'react-select'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { api } from '../services/api'

export default function UserForm({ tunnels, onClose }) {
  const [name, setName] = useState('')
  const [exchange, setExchange] = useState('binance')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [apiPassphrase, setApiPassphrase] = useState('')
  const [uid, setUid] = useState('')
  const [pair, setPair] = useState('BTC/USDT')
  const [marginMode, setMarginMode] = useState('cross')
  const [leverage, setLeverage] = useState(10)
  const [riskPercent, setRiskPercent] = useState(10)
  const [reservedFunds, setReservedFunds] = useState(0)
  const [fixedFunds, setFixedFunds] = useState(0)
  const [selectedTunnel, setSelectedTunnel] = useState({ value: null, label: '無' })
  const [subscriptionEnd, setSubscriptionEnd] = useState(null)
  const [telegramIds, setTelegramIds] = useState('')
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
      if (!apiKey || !apiSecret || !uid) throw new Error('請填寫 API 與 UID')
      const rf = Number(reservedFunds || 0)
      const ff = Number(fixedFunds || 0)
      if (!(rf >= 0)) throw new Error('保留資金需為 >= 0')
      if (!(ff >= 0)) throw new Error('固定資金需為 >= 0')
      await api.post('/users', {
        name,
        exchange,
        apiKey,
        apiSecret,
        apiPassphrase: exchange === 'okx' ? apiPassphrase : '',
        uid,
        pair,
        marginMode,
        leverage: lev,
        riskPercent: risk,
        reservedFunds: rf,
        fixedFunds: ff,
        selectedTunnel: selectedTunnel?.value || null,
        subscriptionEnd: subscriptionEnd ? subscriptionEnd.toISOString() : null,
        telegramIds,
        tgPrefs: { fills: true, daily: true, acctPos: true, riskOps: false }
      })
      onClose()
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="modal">
      <div className="modal-body">
        <h3>新增使用者</h3>
        {err && <div className="error">{err}</div>}
        <div className="grid">
          <label>自訂名稱</label>
          <input value={name} onChange={e => setName(e.target.value)} />
          <label>交易所</label>
          <select value={exchange} onChange={e => setExchange(e.target.value)}>
            <option value="binance">Binance</option>
            <option value="okx">OKX</option>
          </select>

          <label>API Key</label>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} />

          <label>API Secret</label>
          <input value={apiSecret} onChange={e => setApiSecret(e.target.value)} />

          {exchange === 'okx' && <>
            <label>API Passphrase</label>
            <input value={apiPassphrase} onChange={e => setApiPassphrase(e.target.value)} />
          </>}

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

          <label>訂閱時間</label>
          <DatePicker selected={subscriptionEnd} onChange={setSubscriptionEnd} dateFormat="yyyy/MM/dd" isClearable placeholderText="選擇日期（留空則為永久期限）" />

          <label>訊號通道</label>
          <Select styles={selectStyles} options={tunnelOptions} value={selectedTunnel} onChange={setSelectedTunnel} placeholder={'無'} />

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


