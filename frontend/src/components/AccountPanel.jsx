// 繁體中文註釋
// 帳戶面板：顯示最新餘額/倉位（由 WS 推送）

import React from 'react'
import { wsConnect } from '../services/ws'
import { subscribePrices, getPrice } from '../services/priceStore'
import { getOkxSummary, getBinanceSummary, getAdminConfig, getWeeklySummary } from '../services/api'

// 本地欄位級快取：每位用戶各自的鍵，避免跨用戶污染
function fieldKey(userId) { return `userFieldCache:${userId}` }
function loadFieldCacheByUser(userId) {
  try {
    if (!userId) return {}
    const raw = localStorage.getItem(fieldKey(userId))
    return raw ? JSON.parse(raw) : {}
  } catch (_) { return {} }
}
function saveFieldCacheByUser(userId, data) {
  try { if (userId) localStorage.setItem(fieldKey(userId), JSON.stringify(data || {})) } catch (_) {}
}

function mergeSummaryRetain(prev = {}, incoming = {}) {
  const out = { ...prev }
  const keys = ['walletBalance','availableTransfer','marginBalance','unrealizedPnl','feePaid','pnl1d','pnl7d','pnl30d']
  for (const k of keys) {
    if (incoming[k] === undefined) continue
    // 三個金額欄位允許 0 覆蓋，其他欄位沿用非 0 覆蓋策略
    if (k === 'walletBalance' || k === 'availableTransfer' || k === 'marginBalance') {
      out[k] = incoming[k]
      continue
    }
    const val = Number(incoming[k])
    const curr = Number(out[k])
    if (Number.isFinite(val)) {
      if (val !== 0 || !Number.isFinite(curr) || curr === 0) out[k] = val
    } else {
      out[k] = incoming[k]
    }
  }
  return out
}

export default function AccountPanel({ wsMsg }) {
  const isUpdate = wsMsg && wsMsg.type === 'account_update'
  const userId = String(wsMsg?.userId || '')
  const exchange = String(wsMsg?.exchange || '')
  const pair = String(wsMsg?.pair || '')
  const isOkx = String(exchange || '').toLowerCase() === 'okx'
  const isBinance = String(exchange || '').toLowerCase() === 'binance'

  // 以本地快取為主；收到新資料時只做「非 0 覆蓋」合併
  const [displaySummary, setDisplaySummary] = React.useState(() => (userId ? (loadFieldCacheByUser(userId).summary || {}) : {}))

  React.useEffect(() => {
    if (!userId) return
    const prevCache = (loadFieldCacheByUser(userId).summary) || {}
    const prevMem = displaySummary || {}
    // 對 OKX/Binance：WS 不覆蓋 feePaid/pnl1d/pnl7d/pnl30d（避免覆蓋權威 REST 值）
    const rawIncoming = wsMsg.summary || {}
    const incoming = (isOkx || isBinance) ? {
      ...rawIncoming,
      feePaid: (prevMem.feePaid ?? prevCache.feePaid),
      pnl1d: (prevMem.pnl1d ?? prevCache.pnl1d),
      pnl7d: (prevMem.pnl7d ?? prevCache.pnl7d),
      pnl30d: (prevMem.pnl30d ?? prevCache.pnl30d),
    } : rawIncoming
    const prevForMerge = (isOkx || isBinance) ? {
      ...prevCache,
      feePaid: (prevMem.feePaid ?? prevCache.feePaid),
      pnl1d: (prevMem.pnl1d ?? prevCache.pnl1d),
      pnl7d: (prevMem.pnl7d ?? prevCache.pnl7d),
      pnl30d: (prevMem.pnl30d ?? prevCache.pnl30d),
    } : prevCache
    const next = mergeSummaryRetain(prevForMerge, incoming)
    // 停用 OKX/Binance 四欄位 localStorage：保存時移除四欄位
    if (isOkx || isBinance) {
      const toStore = { ...next }
      delete toStore.feePaid; delete toStore.pnl1d; delete toStore.pnl7d; delete toStore.pnl30d
      saveFieldCacheByUser(userId, { summary: toStore })
    } else {
      saveFieldCacheByUser(userId, { summary: next })
    }
    setDisplaySummary(next)
  }, [isUpdate, userId, wsMsg, isOkx, isBinance])

  // OKX：統一以 /okx/summary 覆蓋 1/7/30 與 fee（初載/WS事件/60s）
  const okxDebounceRef = React.useRef(null)
  const okxPendingRef = React.useRef(false)
  async function refreshOkxSummaryNow(id) {
    try {
      if (!id) return
      if (okxPendingRef.current) return
      okxPendingRef.current = true
      const data = await getOkxSummary(id)
      // 權威覆蓋：直接設定四欄位（不寫入 localStorage）
      setDisplaySummary((prev) => ({
        ...(prev || {}),
        feePaid: Number(data.feePaid || 0),
        pnl1d: Number(data.pnl1d || 0),
        pnl7d: Number(data.pnl7d || 0),
        pnl30d: Number(data.pnl30d || 0)
      }))
    } catch (_) {}
    finally { okxPendingRef.current = false }
  }
  const binanceDebounceRef = React.useRef(null)
  const binancePendingRef = React.useRef(false)
  async function refreshBinanceSummaryNow(id) {
    try {
      if (!id) return
      if (binancePendingRef.current) return
      binancePendingRef.current = true
      const data = await getBinanceSummary(id)
      setDisplaySummary((prev) => ({
        ...(prev || {}),
        feePaid: Number(data.feePaid || 0),
        pnl1d: Number(data.pnl1d || 0),
        pnl7d: Number(data.pnl7d || 0),
        pnl30d: Number(data.pnl30d || 0)
      }))
    } catch (_) {}
    finally { binancePendingRef.current = false }
  }
  // 初載/用戶切換：OKX 立即刷新（不依賴 WS）
  React.useEffect(() => {
    if (!userId) return
    if (isOkx) refreshOkxSummaryNow(userId)
    if (isBinance) refreshBinanceSummaryNow(userId)
  }, [userId, isOkx, isBinance])
  // 週期盈虧與抽傭：切換用戶或交易所即刷新；每 60s 保底
  React.useEffect(() => {
    let canceled = false
    async function refreshWeekly() {
      try {
        if (!userId) return
        const ex = isOkx ? 'okx' : (isBinance ? 'binance' : '')
        if (!ex) { setPnlWeek(0); return }
        const data = await getWeeklySummary(userId, ex)
        if (canceled) return
        setPnlWeek(Number(data.pnlWeek || 0))
      } catch (_) {}
    }
    refreshWeekly()
    const t = setInterval(refreshWeekly, 60000)
    return () => { canceled = true; try { clearInterval(t) } catch (_) {} }
  }, [userId, isOkx, isBinance])
  // 抽傭百分比：每分鐘讀一次設定（DB），預設 0.1
  React.useEffect(() => {
    let canceled = false
    async function load() {
      try {
        const cfg = await getAdminConfig()
        if (canceled) return
        const p = Number(cfg?.weekly?.percent)
        if (Number.isFinite(p) && p >= 0 && p <= 1) setWeeklyPercent(p)
      } catch (_) {}
    }
    load()
    const t = setInterval(load, 60000)
    return () => { canceled = true; try { clearInterval(t) } catch (_) {} }
  }, [])
  // WS 事件後去抖刷新
  React.useEffect(() => {
    if (!isUpdate || !userId) return
    if (isOkx) {
      try { if (okxDebounceRef.current) clearTimeout(okxDebounceRef.current) } catch (_) {}
      okxDebounceRef.current = setTimeout(() => refreshOkxSummaryNow(userId), 300)
    }
    if (isBinance) {
      try { if (binanceDebounceRef.current) clearTimeout(binanceDebounceRef.current) } catch (_) {}
      binanceDebounceRef.current = setTimeout(() => refreshBinanceSummaryNow(userId), 300)
    }
    return () => {
      try { if (okxDebounceRef.current) clearTimeout(okxDebounceRef.current) } catch (_) {}
      try { if (binanceDebounceRef.current) clearTimeout(binanceDebounceRef.current) } catch (_) {}
    }
  }, [isUpdate, userId, isOkx, isBinance])
  // 60s 保底輪詢
  React.useEffect(() => {
    if (!userId) return
    const timers = []
    if (isOkx) timers.push(setInterval(() => { refreshOkxSummaryNow(userId) }, 60000))
    if (isBinance) timers.push(setInterval(() => { refreshBinanceSummaryNow(userId) }, 60000))
    return () => { try { timers.forEach(t => clearInterval(t)) } catch (_) {} }
  }, [userId, isOkx, isBinance])

  const total = displaySummary.walletBalance ?? 0
  const free = displaySummary.availableTransfer ?? 0
  const marginBal = displaySummary.marginBalance ?? 0

  // 單一邏輯：以目前持倉 + 最新 ticker 即時計算帳戶未實現盈虧（不讀後端欄位）
  const [derivedUnreal, setDerivedUnreal] = React.useState(0)
  const lastPositionsRef = React.useRef([])
  const latestPriceRef = React.useRef(undefined)
  // exchange/pair/isOkx 已於上方宣告

  // 估算持倉佔用：即時觀感（不覆蓋權威值，只作顯示輔助）
  const positionsNow = Array.isArray(wsMsg?.positions) ? wsMsg.positions : []
  const hasPositionsNow = React.useMemo(() => {
    try { return positionsNow.some(p => Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0)) > 0) } catch (_) { return false }
  }, [positionsNow])

  const marginUsedEst = React.useMemo(() => {
    try {
      return positionsNow.reduce((acc, p) => {
        const qty = Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0))
        const entry = Number(p?.entryPrice || p?.entry || 0)
        const lev = Math.max(1, Number(p?.leverage || 1))
        if (qty && entry && lev) return acc + (qty * entry) / lev
        return acc
      }, 0)
    } catch (_) { return 0 }
  }, [positionsNow])

  function computeUnreal(positions, priceOverride) {
    try {
      const arr = Array.isArray(positions) ? positions : []
      let sum = 0
      for (const p of arr) {
        const qty = Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0))
        const entry = Number(p?.entryPrice || p?.entry || 0)
        const mark = Number(priceOverride && String(p?.symbol || '') === pair ? priceOverride : (p?.markPrice || 0))
        const side = String(p?.side || '').toLowerCase()
        const has = qty > 0 && entry > 0 && mark > 0 && (side === 'long' || side === 'short')
        const unp = has ? ((side === 'short' ? (entry - mark) : (mark - entry)) * qty) : Number(p?.unrealizedPnl || 0)
        if (Number.isFinite(unp)) sum += unp
      }
      return sum
    } catch (_) { return 0 }
  }

  React.useEffect(() => {
    const incoming = wsMsg && Array.isArray(wsMsg.positions) ? wsMsg.positions : null
    const changedKeys = Array.isArray(wsMsg?.changedKeys) ? wsMsg.changedKeys : []
    // 與 PositionPanel 對齊：
    // - 若帶入 positions，且非零持倉筆數為 0（全為 0 或 flat）→ 視為平倉，立即清 0
    // - 若帶入空陣列 → 視為平倉，立即清 0
    // - 若本次未帶 positions，但 changedKeys 含 positions → 視為平倉，立即清 0
    if (Array.isArray(incoming)) {
      const nonZero = incoming.filter(p => Math.abs(Number(p?.contracts ?? p?.contractsSize ?? 0)) > 0 && String(p?.side || '').toLowerCase() !== 'flat')
      if (incoming.length === 0 || nonZero.length === 0) {
        lastPositionsRef.current = []
        setDerivedUnreal(0)
        return
      }
      // 有非 0 持倉：使用最新 ticker 價（若有）計算
      lastPositionsRef.current = incoming
      const px = latestPriceRef.current
      setDerivedUnreal(computeUnreal(incoming, Number.isFinite(Number(px)) ? Number(px) : undefined))
      return
    }
    if (!incoming && changedKeys.includes('positions')) {
      // 本次未帶 positions，但變更鍵顯示 positions 有變 → 清為 0
      lastPositionsRef.current = []
      setDerivedUnreal(0)
      return
    }
  }, [wsMsg])

  React.useEffect(() => {
    if (!exchange || !pair) return
    const off = subscribePrices(() => {
      try {
        const price = getPrice(exchange, pair)
        if (!Number.isFinite(Number(price)) || Number(price) === 0) return
        latestPriceRef.current = Number(price)
        setDerivedUnreal(computeUnreal(lastPositionsRef.current, Number(price)))
      } catch (_) {}
    })
    return () => { try { off && off() } catch (_) {} }
  }, [exchange, pair])
  const fee = displaySummary.feePaid ?? 0
  const pnl1d = displaySummary.pnl1d ?? 0
  const pnl7d = displaySummary.pnl7d ?? 0
  const pnl30d = displaySummary.pnl30d ?? 0
  const [pnlWeek, setPnlWeek] = React.useState(0)
  const [weeklyPercent, setWeeklyPercent] = React.useState(0.1)
  const weeklyPercentText = (() => {
    try {
      const p = Number(weeklyPercent || 0)
      if (!Number.isFinite(p) || p < 0) return '0%'
      return `${Math.round(p * 100)}%`
    } catch (_) { return '0%' }
  })()

  // 當有持倉時：保證金餘額 = 錢包餘額 + 未實現盈虧（即時）
  const derivedMarginBalRaw = hasPositionsNow ? (Number(total) + Number(derivedUnreal)) : Number(marginBal)
  const derivedMarginBal = Number.isFinite(Number(derivedMarginBalRaw)) ? Number(derivedMarginBalRaw) : 0
  // 當有持倉時：可供轉帳 ≈ max(0, 錢包餘額 + 未實現盈虧 − 估算占用)（Binance/OKX 一致）
  const derivedAvailableRaw = hasPositionsNow
    ? Math.max(0, Number(total) + Number(derivedUnreal) - Number(marginUsedEst))
    : Number(free)
  const derivedAvailable = Number.isFinite(Number(derivedAvailableRaw)) ? Number(derivedAvailableRaw) : 0

  const lastTs = Number(wsMsg?.ts || 0)
  const [now, setNow] = React.useState(Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const staleSec = lastTs ? Math.max(0, Math.floor((now - lastTs) / 1000)) : null

  const fmt8 = (v) => Number(v || 0).toFixed(8)
  const pnlCell = (v) => {
    const n = Number(v || 0)
    if (n > 0) return <span><span style={{ color: '#00c853' }}>+ {fmt8(n)}</span> <span className="unit">USDT</span></span>
    if (n < 0) return <span><span style={{ color: '#ff4d4f' }}>- {fmt8(Math.abs(n))}</span> <span className="unit">USDT</span></span>
    return <span>{fmt8(0)} <span className="unit">USDT</span></span>
  }
  // const pairText = (wsMsg?.pair || '').replace('/', '')

  return (
    <div className="account-panel">
      <h3 className="panel-title">帳戶狀態 <span className="panel-title-right">{(wsMsg?.displayName) || ''}{wsMsg?.uid ? ` ｜ ${wsMsg.uid}` : ''}{staleSec !== null ? ` ｜ 更新延遲 ${staleSec}s` : ''}</span></h3>
      <table>
        <thead>
          <tr>
            <th>錢包餘額</th>
            <th>可供轉帳</th>
            <th>保證金餘額</th>
            <th>未實現盈虧</th>
            <th>交易手續費</th>
            <th>本日盈虧</th>
            <th>7日盈虧</th>
            <th>30日盈虧</th>
            <th>週盈虧（{weeklyPercentText}）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{fmt8(total)} <span className="unit">USDT</span></td>
            <td>{fmt8(derivedAvailable)} <span className="unit">USDT</span></td>
            <td>{fmt8(derivedMarginBal)} <span className="unit">USDT</span></td>
            <td>{pnlCell(derivedUnreal)}</td>
            <td>{fmt8(fee)} <span className="unit">USDT</span></td>
            <td>{pnlCell(pnl1d)}</td>
            <td>{pnlCell(pnl7d)}</td>
            <td>{pnlCell(pnl30d)}</td>
            <td>{(() => { const raw = Number(pnlWeek||0) * Number(weeklyPercent||0); const val = Number.isFinite(raw) ? raw : 0; const abs = Math.abs(val).toFixed(2); const color = val>0?'#00c853':val<0?'#ff4d4f':undefined; return <span><span style={{ color }}>{val>0?`+ ${abs}`:val<0?`- ${abs}`:`0.00`}</span> <span className="unit">USDT</span></span> })()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}



