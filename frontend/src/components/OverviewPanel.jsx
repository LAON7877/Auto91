// 繁體中文註釋
// 總覽面板（WS-only）：訂閱內部 WS Hub，匯總所有使用者的重要帳戶/持倉摘要

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { wsConnect } from '../services/ws'
import { subscribePrices, getPrice } from '../services/priceStore'
import { getOkxSummary } from '../services/api'

function number(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return n
}

function fmt(n, digits = 2) {
  const v = number(n)
  if (!Number.isFinite(v)) return '-'
  return v.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export default function OverviewPanel({ onSelectUser }) {
  const [rows, setRows] = useState([])
  const cacheRef = useRef(new Map()) // userId -> latest payload
  const debouncingRef = useRef(null)
  const wsRef = useRef(null)
  const allowIdsRef = useRef(new Set())
  const createdAtRef = useRef(new Map()) // userId -> createdAt
  // 移除 REST 回補：總覽改為與獨立用戶一致，僅用 WS 即時值
  const [sortBy, setSortBy] = useState('createdAt') // 'createdAt' | 'name' | 'exchange' | 'pair' | numeric keys
  const [sortAsc, setSortAsc] = useState(true)
  const sortByRef = useRef('createdAt')
  const sortAscRef = useRef(true)

  async function refreshAllowIds() {
    try {
      const resp = await fetch('/api/users', { headers: { 'Cache-Control': 'no-cache' } })
      const data = await resp.json()
      const ids = new Set((Array.isArray(data) ? data : []).map(u => String(u._id)))
      allowIdsRef.current = ids
      try {
        const map = new Map()
        for (const u of (Array.isArray(data) ? data : [])) {
          map.set(String(u._id), u.createdAt ? new Date(u.createdAt).toISOString() : undefined)
        }
        createdAtRef.current = map
      } catch (_) {}
    } catch (_) {}
  }

  function getCreatedTs(row) {
    try {
      const ca = row.createdAt || createdAtRef.current.get(String(row.userId)) || 0
      const t = Number(new Date(ca || 0).getTime()) || 0
      return t
    } catch (_) { return 0 }
  }

  function number(v) { const n = Number(v); return Number.isFinite(n) ? n : 0 }

  function pickFirstPos(row) {
    try {
      const arr = Array.isArray(row.positions) ? row.positions : []
      if (!arr.length) return null
      const norm = (x) => String(x || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      const wanted = norm(row.pair)
      const hit = arr.find(p => norm(p?.symbol) === wanted)
      return hit || arr[0] || null
    } catch (_) { return null }
  }

  function sortRowsInPlace(arr) {
    const curSortBy = sortByRef.current
    const curSortAsc = sortAscRef.current
    const byName = (a, b) => {
      const na = String(a.displayName || a.uid || a.userId)
      const nb = String(b.displayName || b.uid || b.userId)
      const cmp = na.localeCompare(nb)
      if (cmp !== 0) return curSortAsc ? cmp : -cmp
      const ta = getCreatedTs(a), tb = getCreatedTs(b)
      return ta - tb
    }
    const byExchange = (a, b) => {
      const ea = String(a.exchange || '').toUpperCase()
      const eb = String(b.exchange || '').toUpperCase()
      const cmp = ea.localeCompare(eb)
      if (cmp !== 0) return curSortAsc ? cmp : -cmp
      const ta = getCreatedTs(a), tb = getCreatedTs(b)
      return ta - tb
    }
    const byPair = (a, b) => {
      const pa = String(a.pair || '').replace('/', '')
      const pb = String(b.pair || '').replace('/', '')
      const cmp = pa.localeCompare(pb)
      if (cmp !== 0) return curSortAsc ? cmp : -cmp
      const ta = getCreatedTs(a), tb = getCreatedTs(b)
      return ta - tb
    }
    const byNum = (getVal) => (a, b) => {
      const va = Number(getVal(a) || 0)
      const vb = Number(getVal(b) || 0)
      if (va !== vb) return curSortAsc ? (va - vb) : (vb - va)
      const ta = getCreatedTs(a), tb = getCreatedTs(b)
      return ta - tb
    }
    const getWallet = (r) => r?.summary?.walletBalance
    const getAvail = (r) => r?.summary?.availableTransfer
    const getMargin = (r) => r?.summary?.marginBalance
    const getFee = (r) => r?.summary?.feePaid
    const getPnl1d = (r) => r?.summary?.pnl1d
    const getQty = (r) => { const p = (Array.isArray(r.positions)?r.positions:[])[0]; return p ? Math.abs(Number(p.contracts ?? p.contractsSize ?? 0)) : 0 }
    const getEntry = (r) => { const p = (Array.isArray(r.positions)?r.positions:[])[0]; return p ? Number(p.entryPrice || p.entry || 0) : 0 }
    const getMark = (r) => { const p = (Array.isArray(r.positions)?r.positions:[])[0]; return p ? Number(p.markPrice || 0) : 0 }
    const getLiq  = (r) => { const p = (Array.isArray(r.positions)?r.positions:[])[0]; return p ? Number(p.liquidationPrice || 0) : 0 }
    const getUnp  = (r) => { const p = (Array.isArray(r.positions)?r.positions:[])[0]; if (!p) return 0; const q = Math.abs(Number(p.contracts ?? 0)); const e = Number(p.entryPrice||0); const m = Number(p.markPrice||0); const s = String(p.side||'').toLowerCase(); const has = q>0&&e>0&&m>0&&(s==='long'||s==='short'); return has ? ((s==='short'?(e-m):(m-e))*q) : Number(p.unrealizedPnl||0) }

    switch (curSortBy) {
      case 'name': arr.sort(byName); break
      case 'exchange': arr.sort(byExchange); break
      case 'pair': arr.sort(byPair); break
      case 'wallet': arr.sort(byNum(getWallet)); break
      case 'available': arr.sort(byNum(getAvail)); break
      case 'margin': arr.sort(byNum(getMargin)); break
      case 'fee': arr.sort(byNum(getFee)); break
      case 'pnl1d': arr.sort(byNum(getPnl1d)); break
      case 'qty': arr.sort(byNum(getQty)); break
      case 'entry': arr.sort(byNum(getEntry)); break
      case 'mark': arr.sort(byNum(getMark)); break
      case 'liq': arr.sort(byNum(getLiq)); break
      case 'unp': arr.sort(byNum(getUnp)); break
      case 'createdAt':
      default:
        arr.sort((a, b) => {
          const ta = getCreatedTs(a), tb = getCreatedTs(b)
          const diff = ta - tb
          return curSortAsc ? diff : -diff
        })
        break
    }
  }

  function onClickSort(key) {
    const isSame = (sortByRef.current === key)
    const nextAsc = isSame ? !sortAscRef.current : true
    sortByRef.current = key
    sortAscRef.current = nextAsc
    setSortBy(key)
    setSortAsc(nextAsc)
    setRows(prev => {
      const next = Array.isArray(prev) ? [...prev] : []
      sortRowsInPlace(next)
      return next
    })
  }

  useEffect(() => { sortByRef.current = sortBy }, [sortBy])
  useEffect(() => { sortAscRef.current = sortAsc }, [sortAsc])

  useEffect(() => {
    // 建立 WS：僅處理帳戶/使用者事件；ticker 改由共享 priceStore
    refreshAllowIds()
    wsRef.current = wsConnect((ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (!msg) return
        // 即時用戶名稱更新
        if (msg.type === 'user_updated') {
          const uid = String(msg.userId || '')
          if (uid) {
            const prev = cacheRef.current.get(uid) || {}
            const updated = { ...prev, displayName: msg.displayName || prev.displayName, uid: msg.uid || prev.uid }
            cacheRef.current.set(uid, updated)
            const arr = Array.from(cacheRef.current.values())
            sortRowsInPlace(arr)
            setRows(arr)
          }
          return
        }
        // 刪除使用者事件：清理本地快取並刷新列表
        if (msg.type === 'user_removed') {
          const uid = String(msg.userId || '')
          if (uid) {
            cacheRef.current.delete(uid)
            allowIdsRef.current.delete(uid)
            const arr = Array.from(cacheRef.current.values())
            sortRowsInPlace(arr)
            setRows(arr)
          }
          return
        }
        // 刪除通道事件：只需刷新（避免顯示指向已刪除通道的名稱/按鈕）
        if (msg.type === 'tunnel_removed') {
          const arr = Array.from(cacheRef.current.values())
          sortRowsInPlace(arr)
          setRows(arr)
          return
        }
        // ticker 由 priceStore 處理
        if (msg.type !== 'account_update') return
        const uid = String(msg.userId)
        if (!allowIdsRef.current.has(uid)) { refreshAllowIds(); return }
        const prev = cacheRef.current.get(uid)
        // 合併策略：
        // - positions：若本次無或為空，沿用上一筆；若有，按 symbol 合併並保留先前非 0 的 mark/liq
        // - summary：預設仍用非 0 覆蓋；但對 OKX 的 feePaid/pnl1d/pnl7d/pnl30d 由 REST 覆蓋，不在此合併
        let mergedPositions = undefined
        try {
          const hasIncoming = Array.isArray(msg.positions)
          const norm = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
          const wanted = norm(msg.pair)
          const incomingAll = hasIncoming ? (msg.positions || []) : []
          const incomingForPair = incomingAll.filter(p => norm(p?.symbol) === wanted)
          const nonZeroForPair = incomingForPair.filter(p => Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0)) > 0)
          if (hasIncoming) {
            if (incomingForPair.length > 0 && nonZeroForPair.length === 0) {
              // 僅當明確收到「該交易對為 0 持倉」時，才清除此交易對的現有持倉
              const prevOthers = (prev && Array.isArray(prev.positions)) ? prev.positions.filter(p => norm(p?.symbol) !== wanted) : []
              mergedPositions = prevOthers
            } else if (nonZeroForPair.length > 0) {
              const prevMap = new Map()
              const prevArr = (prev && Array.isArray(prev.positions)) ? prev.positions : []
              for (const p of prevArr) { if (p && p.symbol) prevMap.set(String(p.symbol).toUpperCase(), p) }
              const updatedForPair = nonZeroForPair.map(p => {
                const old = prevMap.get(String(p.symbol || '').toUpperCase()) || {}
                const mark = Number(p.markPrice)
                const liq = Number(p.liquidationPrice)
                return {
                  ...old,
                  ...p,
                  markPrice: (Number.isFinite(mark) && mark !== 0) ? mark : old.markPrice,
                  liquidationPrice: (Number.isFinite(liq) && liq !== 0) ? liq : old.liquidationPrice,
                  leverage: Number(p.leverage || old.leverage || 0),
                }
              })
              const others = prevArr.filter(p => norm(p?.symbol) !== wanted)
              mergedPositions = [...others, ...updatedForPair]
            } else {
              // 這次沒有帶到該交易對 → 保留先前持倉
              mergedPositions = prev?.positions
            }
          } else if (prev) {
            mergedPositions = prev.positions
          }
        } catch (_) {}

  function mergeSummary(prevSum = {}, nextSum = {}, isOkxRow = false) {
          const out = { ...prevSum }
          for (const [k, v] of Object.entries(nextSum || {})) {
            if (v === undefined || v === null) continue
      if (k === 'walletBalance' || k === 'availableTransfer' || k === 'marginBalance') { out[k] = v; continue }
      // 僅對 OKX：四欄交由 REST 覆蓋，跳過 WS 合併；Binance 仍允許 WS 覆蓋
      if (isOkxRow && (k === 'feePaid' || k === 'pnl1d' || k === 'pnl7d' || k === 'pnl30d')) continue
            const incoming = Number(v)
            const curr = Number(out[k])
            if (Number.isFinite(incoming)) {
              if (incoming !== 0 || !Number.isFinite(curr) || curr === 0) out[k] = incoming
            } else {
              out[k] = v
            }
          }
          return out
        }

        const isOkxRow = String(msg.exchange || '').toLowerCase() === 'okx'
        const merged = {
          ...(prev || {}),
          ...msg,
          positions: mergedPositions,
          summary: mergeSummary(prev?.summary || {}, msg.summary || {}, isOkxRow),
        }
        // 若先前收到 user_updated 已改變了 displayName，維持最新名稱不被回退
        if (prev && prev.displayName && merged.displayName && prev.displayName !== merged.displayName) {
          merged.displayName = prev.displayName
        }
        if (!merged.createdAt) {
          const ca = createdAtRef.current.get(uid)
          if (ca) merged.createdAt = ca
        }
        cacheRef.current.set(uid, merged)
        // 針對 OKX 用戶，去抖後拉取 /okx/summary 覆蓋 1/7/30 與 feePaid（權威覆蓋）
        try {
          const ex = String(merged.exchange || '').toLowerCase()
          if (ex === 'okx') {
            if (debouncingRef.current) clearTimeout(debouncingRef.current)
            debouncingRef.current = setTimeout(async () => {
              try {
                const data = await getOkxSummary(uid)
                const prev2 = cacheRef.current.get(uid) || merged
                const merged2 = { ...prev2, summary: { ...(prev2.summary||{}), feePaid: Number(data.feePaid||0), pnl1d: Number(data.pnl1d||0), pnl7d: Number(data.pnl7d||0), pnl30d: Number(data.pnl30d||0) } }
                cacheRef.current.set(uid, merged2)
                const arr2 = Array.from(cacheRef.current.values())
                sortRowsInPlace(arr2)
                setRows(arr2)
              } catch (_) {}
            }, 300)
          }
        } catch (_) {}
        // 去抖合併渲染，避免大量用戶造成重繪風暴
        if (!debouncingRef.current) {
            debouncingRef.current = setTimeout(() => {
            debouncingRef.current = null
            const arr = Array.from(cacheRef.current.values())
            sortRowsInPlace(arr)
            setRows(arr)
          }, 200)
        }
      } catch (_) {}
    })
    return () => { try { wsRef.current && wsRef.current.closeSafely ? wsRef.current.closeSafely() : wsRef.current?.close() } catch (_) {} }
  }, [])

  // 60s 保底：對目前可見行中的 OKX 用戶批次刷新 /okx/summary（錯開發送）
  useEffect(() => {
    const pendingRef = { set: new Set() }
    async function doBatch() {
      try {
        if (typeof document !== 'undefined' && document.hidden) return
        const list = Array.isArray(rows) ? rows.slice(0, 50) : []
        let delay = 0
        for (const r of list) {
          try {
            const ex = String(r.exchange || '').toLowerCase()
            if (ex !== 'okx') continue
            const uid = String(r.userId || '')
            if (!uid || pendingRef.set.has(uid)) continue
            pendingRef.set.add(uid)
            await new Promise(res => setTimeout(res, delay))
            const data = await getOkxSummary(uid).catch(() => null)
            if (data) {
              const prev = cacheRef.current.get(uid) || r
              cacheRef.current.set(uid, { ...prev, summary: { ...(prev.summary||{}), feePaid: data.feePaid, pnl1d: data.pnl1d, pnl7d: data.pnl7d, pnl30d: data.pnl30d } })
              const arr = Array.from(cacheRef.current.values())
              sortRowsInPlace(arr)
              setRows(arr)
            }
          } catch (_) {}
          finally { pendingRef.set.delete(String(r.userId || '')) }
          delay += 50
        }
      } catch (_) {}
    }
    const timer = setInterval(doBatch, 60000)
    // 當頁面重新可見時立即執行一次
    function onVis() { if (!document.hidden) doBatch() }
    try { document.addEventListener('visibilitychange', onVis) } catch (_) {}
    return () => { try { clearInterval(timer) } catch (_) {} try { document.removeEventListener('visibilitychange', onVis) } catch (_) {} }
  }, [rows])

  // 移除定時 REST 回補（保持 WS-only）

  // 共享 priceStore：統一刷新 positions 的 markPrice
  useEffect(() => {
    const off = subscribePrices(() => {
      try {
        const entries = Array.from(cacheRef.current.entries())
        let touched = false
        for (const [uid, row] of entries) {
          if (!row) continue
          const ex = String(row.exchange || '').toLowerCase()
          const pair = String(row.pair || '')
          const px = getPrice(ex, pair)
          if (!Number.isFinite(Number(px)) || Number(px) === 0) continue
          if (!Array.isArray(row.positions) || row.positions.length === 0) continue
          const updated = row.positions.map(p => {
            if (String(p.symbol || '').toUpperCase() !== String(pair || '').toUpperCase()) return p
            return { ...p, markPrice: Number(px) || p.markPrice }
          })
          cacheRef.current.set(uid, { ...row, positions: updated })
          touched = true
        }
        if (touched && !debouncingRef.current) {
          debouncingRef.current = setTimeout(() => {
            debouncingRef.current = null
            const arr = Array.from(cacheRef.current.values())
            sortRowsInPlace(arr)
            setRows(arr)
          }, 150)
        }
      } catch (_) {}
    })
    return () => { try { off && off() } catch (_) {} }
  }, [])

  const table = useMemo(() => {
    return (
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-body" style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}><span onClick={() => onClickSort('name')} style={{ cursor: 'pointer' }}>用戶名</span></th>
                <th style={th}><span onClick={() => onClickSort('exchange')} style={{ cursor: 'pointer' }}>交易所</span></th>
                <th style={th}><span onClick={() => onClickSort('pair')} style={{ cursor: 'pointer' }}>交易對</span></th>
                <th style={thRight}><span onClick={() => onClickSort('wallet')} style={{ cursor: 'pointer' }}>錢包餘額</span></th>
                <th style={thRight}><span onClick={() => onClickSort('available')} style={{ cursor: 'pointer' }}>可供轉賬</span></th>
                <th style={thRight}><span onClick={() => onClickSort('margin')} style={{ cursor: 'pointer' }}>保證金餘額</span></th>
                <th style={thRight}><span onClick={() => onClickSort('fee')} style={{ cursor: 'pointer' }}>本日手續費</span></th>
                <th style={thRight}><span onClick={() => onClickSort('pnl1d')} style={{ cursor: 'pointer' }}>本日盈虧</span></th>
                <th style={thRight}><span onClick={() => onClickSort('qty')} style={{ cursor: 'pointer' }}>持倉數量</span></th>
                <th style={thRight}><span onClick={() => onClickSort('entry')} style={{ cursor: 'pointer' }}>開倉價格</span></th>
                <th style={thRight}><span onClick={() => onClickSort('mark')} style={{ cursor: 'pointer' }}>標記價格</span></th>
                <th style={thRight}><span onClick={() => onClickSort('liq')} style={{ cursor: 'pointer' }}>強平價格</span></th>
                <th style={thRight}><span onClick={() => onClickSort('unp')} style={{ cursor: 'pointer' }}>未實現盈虧</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const s = m.summary || {}
                // 以單一持倉（若有）做簡表顯示；有多筆可合併或只取第一筆
                const pickFirstPos = () => {
                  const arr = Array.isArray(m.positions) ? m.positions : []
                  if (!arr.length) return null
                  const norm = (x) => String(x || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                  const wanted = norm(m.pair)
                  const hit = arr.find(p => norm(p?.symbol) === wanted)
                  return hit || arr[0] || null
                }
                const firstPos = pickFirstPos()
                const qty = firstPos ? number(firstPos.contracts) : 0
                const entry = firstPos ? number(firstPos.entryPrice) : 0
                const mark = firstPos ? number(firstPos.markPrice) : 0
                const liqPx = firstPos ? number(firstPos.liquidationPrice) : 0
                // 以 ticker 推動：若持倉資料齊全，使用 (mark-entry)*qty 即時計算未實現盈虧
                const sideTxt = (firstPos && String(firstPos.side || '').toLowerCase()) || 'flat'
                const hasDerived = qty > 0 && entry > 0 && mark > 0 && (sideTxt === 'long' || sideTxt === 'short')
                const unpDerived = hasDerived ? ((sideTxt === 'short' ? (entry - mark) : (mark - entry)) * qty) : null
                const unp = (hasDerived ? unpDerived : 0)
                const posArr = Array.isArray(m.positions) ? m.positions : []
                const hasPositionsNow = posArr.some(p => Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0)) > 0)
                const unpAll = (() => {
                  try {
                    let sum = 0
                    for (const p of posArr) {
                      const q = Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0))
                      const e = Number(p?.entryPrice || p?.entry || 0)
                      const mk = Number(p?.markPrice || 0)
                      const sd = String(p?.side || '').toLowerCase()
                      if (q > 0 && e > 0 && mk > 0 && (sd === 'long' || sd === 'short')) {
                        sum += (sd === 'short' ? (e - mk) : (mk - e)) * q
                      }
                    }
                    return sum
                  } catch (_) { return 0 }
                })()
                const walletNum = Number(s.walletBalance || 0)
                const marginUsedEst = (() => {
                  try {
                    let sum = 0
                    for (const p of posArr) {
                      const q = Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0))
                      const e = Number(p?.entryPrice || p?.entry || 0)
                      const lv = Math.max(1, Number(p?.leverage || 1))
                      if (q && e && lv) sum += (q * e) / lv
                    }
                    return sum
                  } catch (_) { return 0 }
                })()
                const pnl1dRealized = number(s.pnl1d)
                const wallet = Number.isFinite(walletNum) ? walletNum.toFixed(2) : '-'
                const availDerived = Math.max(0, walletNum + unpAll - marginUsedEst)
                const availSafe = Number.isFinite(availDerived) ? availDerived : 0
                const marginDerived = (walletNum + unpAll)
                const marginSafe = Number.isFinite(marginDerived) ? marginDerived : 0
                const avail = hasPositionsNow ? availSafe.toFixed(2) : (Number.isFinite(Number(s.availableTransfer)) ? number(s.availableTransfer).toFixed(2) : '0.00')
                const margin = hasPositionsNow ? marginSafe.toFixed(2) : (Number.isFinite(Number(s.marginBalance)) ? number(s.marginBalance).toFixed(2) : '0.00')
                const feePaid = Number.isFinite(Number(s.feePaid)) ? number(s.feePaid).toFixed(2) : '0.00'
                // 動態小數：預設 2 位；第 4 位非 0 → 4 位；否則第 3 位非 0 → 3 位
                const frac = (() => {
                  const s = qty.toFixed(4)
                  const parts = s.split('.')
                  if (parts.length < 2) return 2
                  const f = parts[1]
                  if (f[3] !== '0') return 4
                  if (f[2] !== '0') return 3
                  return 2
                })()
                const qtyTxt = (qty > 0 ? qty.toFixed(frac) : '-')
                const entryTxt = (entry > 0 ? entry.toFixed(2) : '-')
                const markTxt = (mark > 0 ? mark.toFixed(2) : '-')
                const liqTxt = (liqPx > 0 ? liqPx.toFixed(2) : '-')
                const pairTxt = String(m.pair || '').replace('/', '')
                const baseUnit = (() => {
                  const raw = String(m.pair || '')
                  if (raw.includes('/')) return raw.split('/')[0]
                  if (raw.includes('-')) return raw.split('-')[0]
                  // 退化處理：嘗試去除常見報價幣後綴
                  return raw.replace('USDT','').replace('USD','')
                })()
                // 總覽視圖：僅顯示 24h 內已實現盈虧（不含未實現）
                const pnl1dDisplay = pnl1dRealized
                const pnl1dAbs = Math.abs(pnl1dRealized).toFixed(2)
                const unpAbs = Math.abs(unp).toFixed(2)
                const pnl1dColor = pnl1dRealized > 0 ? '#00c853' : pnl1dRealized < 0 ? '#ff4d4f' : undefined
                const unpColor = unp > 0 ? '#00c853' : unp < 0 ? '#ff4d4f' : undefined
                return (
                  <tr key={m.userId}>
                    <td style={td}><span style={{ color: '#3ae5ff', cursor: 'pointer' }} onClick={() => onSelectUser && onSelectUser(m.userId)}>{m.displayName || m.uid || m.userId}</span></td>
                    <td style={td}>{(() => { const s = String(m.exchange || '').toLowerCase(); if (s === 'binance') return '幣安'; if (s === 'okx') return '歐易'; return String(m.exchange || ''); })()}</td>
                    <td style={td}>{pairTxt || '-'}</td>
                    <td style={tdRight}>{wallet} <span className="unit">USDT</span></td>
                    <td style={tdRight}>{avail} <span className="unit">USDT</span></td>
                    <td style={tdRight}>{margin} <span className="unit">USDT</span></td>
                    <td style={tdRight}>{feePaid} <span className="unit">USDT</span></td>
                    <td style={tdRight}>
                      {pnl1dRealized === 0 ? (
                        <span>0.00 <span className="unit">USDT</span></span>
                      ) : (
                        <span><span style={{ color: pnl1dColor }}>{pnl1dRealized > 0 ? '+ ' : '- '}{pnl1dAbs}</span> <span className="unit">USDT</span></span>
                      )}
                    </td>
                    <td style={tdRight}>
                      {(() => {
                        try {
                          const qtyAbs = Math.abs(Number(firstPos?.contracts ?? firstPos?.contractsSize ?? 0))
                          const sideLower = String(firstPos?.side || '').toLowerCase()
                          const showBadge = qtyAbs > 0 && (sideLower === 'long' || sideLower === 'short')
                          if (showBadge) {
                            const label = (sideLower === 'short') ? '空' : '多'
                            const cls = `badge-ov ${sideLower === 'short' ? 'badge-ov-short' : 'badge-ov-long'}`
                            return <><span className={cls}>{label}</span> {qtyTxt} <span className="unit">{baseUnit || ''}</span></>
                          }
                        } catch (_) {}
                        return <>{qtyTxt} <span className="unit">{baseUnit || ''}</span></>
                      })()}
                    </td>
                    <td style={tdRight}>{entryTxt} <span className="unit">USDT</span></td>
                    <td style={tdRight}>{markTxt} <span className="unit">USDT</span></td>
                    <td style={tdRight}>{liqTxt} <span className="unit">USDT</span></td>
                    <td style={tdRight}>
                      {unp === 0 ? (
                        <span>0.00 <span className="unit">USDT</span></span>
                      ) : (
                        <span><span style={{ color: unpColor }}>{unp > 0 ? '+ ' : '- '}{unpAbs}</span> <span className="unit">USDT</span></span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && null}
        </div>
      </div>
    )
  }, [rows])

  return table
}

const th = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #333' }
const thRight = { ...th, textAlign: 'right' }
const td = { padding: '6px 8px', borderBottom: '1px solid #222' }
const tdRight = { ...td, textAlign: 'right' }


