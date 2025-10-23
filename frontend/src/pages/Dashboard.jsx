// 繁體中文註釋
// 儀表板：左側為通道/使用者/交易清單，右側為即時資訊

import React, { useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar'
import SystemSettings from './SystemSettings'
import TradeDisplay from '../components/TradeDisplay'
import AccountPanel from '../components/AccountPanel'
import PositionPanel from '../components/PositionPanel'
import OverviewPanel from '../components/OverviewPanel'
import { wsConnect } from '../services/ws'
import { subscribePrices, getPrice } from '../services/priceStore'
import Metrics from './Metrics'
import { api } from '../services/api'

export default function Dashboard() {
  const [wsMsg, setWsMsg] = useState(null)
  const [accountMsg, setAccountMsg] = useState(null)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [overviewMode, setOverviewMode] = useState(true)
  const [settingsMode, setSettingsMode] = useState(false)
  const viewCacheRef = React.useRef(new Map())
  const cacheMetaRef = React.useRef({ ts: 0 })
  const selectedRef = React.useRef(null)

  function storageKey(userId) { return `userViewCache:${userId}` }
  function saveCache(userId, payload) {
    try {
      const id = String(userId)
      viewCacheRef.current.set(id, payload)
      const wrapped = { ts: Date.now(), data: payload }
      localStorage.setItem(storageKey(id), JSON.stringify(wrapped))
      cacheMetaRef.current.ts = wrapped.ts // 以最後一次更新時間作為共用新鮮度
    } catch (_) {}
  }
  function sanitizeForSwitch(payload) {
    try {
      const out = { ...(payload || {}) }
      if (Array.isArray(out.positions)) {
        out.positions = out.positions.map(p => ({ ...p, markPrice: undefined }))
      }
      return out
    } catch (_) { return payload }
  }
  function loadCache() {
    try {
      // 不再讀取全域快取，一律採 per-user 鍵
      viewCacheRef.current = new Map()
      cacheMetaRef.current.ts = 0
      // 一次性清理舊鍵（向後相容）
      try { localStorage.removeItem('userViewCache') } catch (_) {}
      try { localStorage.removeItem('userFieldCache') } catch (_) {}
    } catch (_) {}
  }

  useEffect(() => { loadCache() }, [])

  // 避免舊請求/舊 WS 覆蓋目前選中用戶的畫面
  const isCurrentUser = React.useCallback((id) => {
    return String(id) === String(selectedRef.current)
  }, [])
  const setIfCurrent = React.useCallback((id, payload) => {
    if (String(id) === String(selectedRef.current)) {
      setAccountMsg(payload)
    }
  }, [])

  useEffect(() => {
    if (!selectedUserId) return
    selectedRef.current = String(selectedUserId)
    // 僅在 summaries 已回填後再連接 WS，避免競態覆蓋
    let connected = false
    let ws
    const connect = () => {
      if (connected) return
      connected = true
      ws = wsConnect((ev) => {
        try {
          const msg = JSON.parse(ev.data)
          // ticker 改由共享 priceStore
          if (msg && msg.type === 'account_update' && String(msg.userId) === String(selectedRef.current)) {
            // 只 merge changedKeys，避免空值覆蓋與欄位抖動
            setAccountMsg(prev => {
              const base = prev || {}
              const out = { ...base }
              const keys = Array.isArray(msg.changedKeys) ? msg.changedKeys : Object.keys(msg.summary || {})
              // 若帶有 positions，與既有資料合併：保留非 0 的 entry/mark/liq/leverage；未帶則沿用上一筆
              if (Array.isArray(msg.positions) && msg.positions.length > 0) {
                const prevPos = Array.isArray(base.positions) ? base.positions : []
                const prevMap = new Map()
                for (const p of prevPos) { if (p && p.symbol) prevMap.set(String(p.symbol).toUpperCase(), p) }
                out.positions = msg.positions.map(p => {
                  const old = prevMap.get(String(p.symbol || '').toUpperCase()) || {}
                  const entry = Number(p.entryPrice)
                  const mark = Number(p.markPrice)
                  const liq = Number(p.liquidationPrice)
                  const lev = Number(p.leverage)
                  return {
                    ...old,
                    ...p,
                    entryPrice: (Number.isFinite(entry) && entry !== 0) ? entry : old.entryPrice,
                    // 標記價格以 ticker 為主：若舊值存在（多半由 ticker 寫入），優先保留，避免被較舊的帳戶更新覆蓋
                    markPrice: (Number.isFinite(old.markPrice) && old.markPrice !== 0) ? old.markPrice : ((Number.isFinite(mark) && mark !== 0) ? mark : old.markPrice),
                    liquidationPrice: (Number.isFinite(liq) && liq !== 0) ? liq : old.liquidationPrice,
                    leverage: Number.isFinite(lev) && lev !== 0 ? lev : (old.leverage || out.leverage || 0),
                  }
                })
              } else if (Array.isArray(base.positions) && base.positions.length > 0) {
                out.positions = base.positions
              }
              if (msg.summary) {
                out.summary = { ...(base.summary || {}) }
                for (const [k, v] of Object.entries(msg.summary)) {
                  if (k === 'positions' || v === undefined) continue
                  if (k === 'walletBalance' || k === 'availableTransfer' || k === 'marginBalance') {
                    out.summary[k] = v
                    continue
                  }
                  const curr = Number(out.summary[k] || 0)
                  const incoming = Number(v)
                  if (!Number.isFinite(incoming)) { out.summary[k] = v; continue }
                  if (incoming !== 0 || curr === 0) out.summary[k] = v
                }
              }
              // 若具備資料，補算 summary 未實現盈虧（與總覽一致）
              try {
                const posArr = Array.isArray(out.positions) ? out.positions : []
                const sumUnp = posArr.reduce((acc, p) => {
                  const qty = Math.abs(Number(p.contracts ?? 0))
                  const entry = Number(p.entryPrice || 0)
                  const mark = Number(p.markPrice || 0)
                  const side = String(p.side || '').toLowerCase()
                  const has = qty > 0 && entry > 0 && mark > 0 && (side === 'long' || side === 'short')
                  const unp = has ? ((side === 'short' ? (entry - mark) : (mark - entry)) * qty) : Number(p.unrealizedPnl || 0)
                  return acc + (Number.isFinite(unp) ? unp : 0)
                }, 0)
                if (!out.summary) out.summary = {}
                out.summary.unrealizedPnl = sumUnp
              } catch (_) {}
              // 保持標頭與基本欄位
              out.type = 'account_update'
              out.userId = msg.userId
              out.displayName = msg.displayName || out.displayName
              out.uid = msg.uid || out.uid
              out.exchange = msg.exchange || out.exchange
              out.pair = msg.pair || out.pair
              out.seq = msg.seq || out.seq
              out.ts = msg.ts || Date.now()
              saveCache(msg.userId, out)
              return out
            })
          }
        } catch (_) {}
      })
      // 訂閱共享 priceStore：統一刷新當前選中用戶的 positions 標記價格
      const off = subscribePrices(() => {
        try {
          setAccountMsg(prev => {
            const base = prev || {}
            if (!base || !base.userId || String(base.userId) !== String(selectedRef.current)) return base
            const ex = String(base.exchange || '').toLowerCase()
            const pair = String(base.pair || '')
            const price = getPrice(ex, pair)
            if (!Array.isArray(base.positions) || base.positions.length === 0 || !Number.isFinite(Number(price)) || Number(price) === 0) return base
            const norm = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
            const pairNorm = norm(pair)
            const updatedPos = base.positions.map(p => {
              const sym = String(p?.symbol || '')
              if (!p || norm(sym) !== pairNorm) return p
              const qty = Math.abs(Number(p.contracts ?? 0))
              const entry = Number(p.entryPrice || 0)
              const side = String(p.side || '').toLowerCase()
              const has = qty > 0 && entry > 0 && (side === 'long' || side === 'short')
              const unp = has ? ((side === 'short' ? (entry - price) : (price - entry)) * qty) : p.unrealizedPnl
              return { ...p, markPrice: Number(price), unrealizedPnl: unp }
            })
            const unrealizedSum = updatedPos.reduce((acc, p) => acc + Number(p.unrealizedPnl || 0), 0)
            const out = { ...base, positions: updatedPos, summary: { ...(base.summary || {}), unrealizedPnl: unrealizedSum } }
            saveCache(base.userId, out)
            return out
          })
        } catch (_) {}
      })
    }
    // 等待 summaries 回填完成（最多 2 秒）
    let waited = 0
    const timer = setInterval(() => {
      if (accountMsg && accountMsg.userId === selectedUserId) { clearInterval(timer); connect() }
      waited += 200
      if (waited >= 2000) { clearInterval(timer); connect() }
    }, 200)
    return () => { try { clearInterval(timer) } catch (_) {}; try { off && off() } catch (_) {}; try { ws && ws.closeSafely ? ws.closeSafely() : ws.close() } catch (_) {} }
  }, [selectedUserId, accountMsg])

  // 幫手：嘗試多次抓取 summaries 以確保首屏有資料
  async function fetchSummaryFor(userId, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        const sRes = await api.get(`/trades/summaries?userId=${userId}`)
        const list = Array.isArray(sRes.data) ? sRes.data : []
        const m = list[0]
        if (m) { setIfCurrent(userId, m); saveCache(userId, m); return }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 700))
    }
  }

  async function doSync(userId) {
    try {
      const syncRes = await api.post('/accounts/sync', { userId })
      if (syncRes?.data) {
        const payload = syncRes.data.payload || syncRes.data
        if (payload) {
          // 若補位返回空持倉，保留當前畫面的持倉，避免閃為空
          const merged = (() => {
            try {
              const curr = (String(selectedRef.current) === String(userId)) ? accountMsg : null
              if (Array.isArray(payload.positions) && payload.positions.length === 0 && curr && Array.isArray(curr.positions) && curr.positions.length > 0) {
                return { ...payload, positions: curr.positions }
              }
            } catch (_) {}
            return payload
          })()
          setIfCurrent(userId, merged)
          saveCache(userId, merged)
          return
        }
      }
      await fetchSummaryFor(userId)
    } catch (_) {
      await fetchSummaryFor(userId)
    }
  }

  // 初始化：先抓用戶，鎖定第一位；先渲染快取，無快取時等待 WS，超時再 REST 補一次
  useEffect(() => {
    (async () => {
      try {
        if (!selectedUserId) {
          const uRes = await api.get('/users')
          const users = Array.isArray(uRes.data) ? uRes.data : []
          // 初啟顯示用戶總覽，不自動選用戶
          // 可在使用者點擊後再載入個別用戶資料
        } else {
          // 切換後也先渲染快取；無快取時等待 WS 2 秒後再補一次 REST
          const cachedRaw = localStorage.getItem(storageKey(String(selectedUserId)))
          const cached = (() => { try { return cachedRaw ? (JSON.parse(cachedRaw).data) : null } catch (_) { return null } })()
          if (cached) setIfCurrent(selectedUserId, sanitizeForSwitch(cached))
          const needPositionsFallback = !cached || !Array.isArray(cached.positions) || cached.positions.length === 0
          if (needPositionsFallback) {
            setTimeout(() => {
              if (String(selectedRef.current) !== String(selectedUserId)) return
              const hasNow = accountMsg && String(accountMsg.userId) === String(selectedUserId)
              const hasPos = hasNow && Array.isArray(accountMsg.positions) && accountMsg.positions.length > 0
              if (!hasPos) doSync(selectedUserId)
            }, 2000)
          }
        }
      } catch (_) {}
    })()
  }, [selectedUserId])

  async function handleSelectUser(userId) {
    // 切換用戶：先顯示本地快取畫面，再背景等待 WS；無快取時 2 秒後觸發一次 REST 補首屏
    setWsMsg(null)
    setOverviewMode(false)
    setSettingsMode(false)
    setSelectedUserId(userId)
    selectedRef.current = String(userId)
    const cachedRaw = localStorage.getItem(storageKey(String(userId)))
    const cached = (() => { try { return cachedRaw ? (JSON.parse(cachedRaw).data) : null } catch (_) { return null } })()
    if (cached) setIfCurrent(userId, sanitizeForSwitch(cached))
    try {
      // 先嘗試抓取後端快取摘要（包含最新 feePaid 滾動值），優先於 /users
      try {
        const sRes = await api.get(`/trades/summaries?userId=${userId}`)
        const list = Array.isArray(sRes.data) ? sRes.data : []
        const m = list[0]
        if (m) setIfCurrent(userId, sanitizeForSwitch(m))
      } catch (_) {}
      // 先用 /users 補上標頭資訊
      const uRes = await api.get('/users')
      const users = Array.isArray(uRes.data) ? uRes.data : []
      const u = users.find(x => x._id === userId)
      if (u) setIfCurrent(userId, sanitizeForSwitch({ ...(viewCacheRef.current.get(String(userId)) || {}), type: 'account_update', userId, displayName: u.name || u.uid, uid: u.uid }))
      // 若快取時間過舊（>60s），排程一次後台補位以刷新過期資料（Edge 容易長留快取）
      const ageMs = Date.now() - Number(cacheMetaRef.current.ts || 0)
      if (!Number.isFinite(ageMs) || ageMs > 60000) {
        setTimeout(() => {
          if (String(selectedRef.current) !== String(userId)) return
          doSync(userId)
        }, 200)
      } else if (!cached) {
        // 僅在無快取時：等待 WS 最多 2 秒，若仍無資料才補一次 REST
        setTimeout(() => {
          if (String(selectedRef.current) !== String(userId)) return
          const hasNow = accountMsg && String(accountMsg.userId) === String(userId)
          if (!hasNow) doSync(userId)
        }, 2000)
      }
    } catch (_) {}
  }

  return (
    <div className="dashboard">
      <Sidebar onSelectUser={handleSelectUser} onSelectOverview={() => { setSettingsMode(false); setOverviewMode(true) }} onSelectSettings={() => { setOverviewMode(false); setSettingsMode(true) }} />
      <div className="content">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>交易監控</h2>
          <Metrics variant="inline" />
        </div>
        {settingsMode ? (
          <SystemSettings />
        ) : overviewMode ? (
          <OverviewPanel onSelectUser={(id) => handleSelectUser(id)} />
        ) : (
          <>
            <AccountPanel wsMsg={accountMsg} />
            <PositionPanel wsMsg={accountMsg} />
            <TradeDisplay wsMsg={wsMsg} selectedUserId={selectedUserId} />
          </>
        )}
      </div>
    </div>
  )
}


