// 繁體中文註釋
// 風控告警（分級 + 可變節奏）：
// 1) 強平臨界：warn/critical/severe 三級
// 2) 保證金餘額不足：warn/critical 兩級
// 3) 未實現虧損超標：warn/critical 兩級（取 max(usd, pct*wallet)）
// 4) 日內已實現虧損超標：warn/critical 兩級（取 max(usd, pct*wallet)）

function safeNum(v, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def }
function pickFloor(floors, wallet) {
  try {
    for (const f of (floors || [])) {
      if (Number(wallet) <= Number(f.maxWallet)) return { warn: Number(f.warn||0), critical: Number(f.critical||0) }
    }
  } catch (_) {}
  return { warn: 0, critical: 0 }
}
function maxPctOrFloor(pct, wallet, floors, level) {
  const byPct = Number(pct||0) * Number(wallet||0)
  const fl = pickFloor(floors, wallet)
  const byFloor = level === 'critical' ? Number(fl.critical||0) : Number(fl.warn||0)
  return Math.max(byPct, byFloor)
}

// 輸出：陣列，每一條為 { key, text }，供上層做每小時去重
function evalPositionAccountChanges({ curr, prev, thresholds }) {
  const out = []
  const t = thresholds || {}
  const positions = Array.isArray(curr?.positions) ? curr.positions : []
  const summary = curr?.summary || {}

  // 取代表倉位（第一筆非 0 倉位）與帳戶彙總
  const pos = positions.find(p => Math.abs(safeNum(p?.contracts)) > 0) || null
  const walletBalance = safeNum(summary.walletBalance, safeNum(summary.marginBalance))

  // 1) 強平臨界：三級
  if (pos && safeNum(pos.liquidationPrice) > 0 && safeNum(pos.markPrice) > 0) {
    const liq = safeNum(pos.liquidationPrice)
    const mark = safeNum(pos.markPrice)
    const side = String(pos.side || '').toLowerCase()
    const dirText = side === 'long' ? '多單' : (side === 'short' ? '空單' : '-')
    const symbol = String(pos.symbol || '')
    const qty = Math.abs(safeNum(pos.contracts))
    const lev = safeNum(pos.leverage)
    const base = symbol.includes('/') ? symbol.split('/')[0] : symbol
    let ratio = 1
    if (side === 'long') ratio = (mark - liq) / Math.max(mark, 1e-9)
    else if (side === 'short') ratio = (liq - mark) / Math.max(liq, 1e-9)
    const pct = Math.max(0, ratio * 100)
    const detail = `${symbol}｜${dirText}｜槓桿 ${lev || 0}x｜數量 ${qty} ${base}｜標記價 ${mark.toFixed(2)}｜強平價 ${liq.toFixed(2)}`
    if (ratio <= safeNum(t.liqSevereRatio, 0.05)) {
      out.push({ scope: 'liq', key: 'liq-severe', severity: 'severe', windowMin: 10, value: ratio, text: `⚠️ 強平價風控｜距強平價僅剩 ${pct.toFixed(1)}%（≤5% 危急）\n${detail}` })
    } else if (ratio <= safeNum(t.liqCriticalRatio, 0.10)) {
      out.push({ scope: 'liq', key: 'liq-critical', severity: 'critical', windowMin: 30, value: ratio, text: `⚠️ 強平價風控｜距強平價僅剩 ${pct.toFixed(1)}%（≤10% 嚴重）\n${detail}` })
    } else if (ratio <= safeNum(t.liqWarnRatio, 0.20)) {
      out.push({ scope: 'liq', key: 'liq-warn', severity: 'warn', windowMin: 60, value: ratio, text: `⚠️ 強平價風控｜距強平價僅剩 ${pct.toFixed(1)}%（≤20% 警示）\n${detail}` })
    }
  }

  // 2) 保證金餘額不足：兩級
  const margin = safeNum(summary.marginBalance, walletBalance)
  const avail = safeNum(summary.availableTransfer)
  if (margin > 0 && avail >= 0) {
    const remain = avail / margin
    const pct = Math.max(0, remain * 100)
    const detail = `可用 ${avail.toFixed(2)} / 保證金 ${margin.toFixed(2)} USDT`
    if (remain <= safeNum(t.marginCriticalRatio, 0.10)) {
      out.push({ scope: 'margin', key: 'margin-critical', severity: 'critical', windowMin: 30, value: remain, text: `⚠️ 保證金餘額風控｜剩餘可用約 ${pct.toFixed(1)}%（≤10% 嚴重）\n${detail}` })
    } else if (remain <= safeNum(t.marginWarnRatio, 0.20)) {
      out.push({ scope: 'margin', key: 'margin-warn', severity: 'warn', windowMin: 60, value: remain, text: `⚠️ 保證金餘額風控｜剩餘可用約 ${pct.toFixed(1)}%（≤20% 警示）\n${detail}` })
    }
  }

  // 3) 未實現虧損超標：兩級（取代表倉或帳戶彙總）
  const unrealized = pos ? safeNum(pos.unrealizedPnl) : safeNum(summary.unrealizedPnl)
  if (walletBalance > 0) {
    const warnLine = -maxPctOrFloor(t.pnlWarnPctWallet, walletBalance, t.pnlFloors, 'warn')
    const critLine = -maxPctOrFloor(t.pnlCriticalPctWallet, walletBalance, t.pnlFloors, 'critical')
    const symbol = pos ? String(pos.symbol || '') : ''
    const side = pos ? String(pos.side || '').toLowerCase() : ''
    const dirText = side === 'long' ? '多單' : (side === 'short' ? '空單' : '-')
    const qty = pos ? Math.abs(safeNum(pos.contracts)) : 0
    const lev = pos ? safeNum(pos.leverage) : 0
    const base = symbol && symbol.includes('/') ? symbol.split('/')[0] : symbol
    const detail = pos ? `${symbol}｜${dirText}｜槓桿 ${lev || 0}x｜數量 ${qty} ${base}` : ''
    if (unrealized <= critLine) {
      out.push({ scope: 'unp', key: 'unp-critical', severity: 'critical', windowMin: 30, value: unrealized, text: `⚠️ 盈虧風控｜未實現盈虧 ${unrealized.toFixed(2)} USDT（≤${critLine.toFixed(0)} 嚴重）${detail ? `\n${detail}` : ''}` })
    } else if (unrealized <= warnLine) {
      out.push({ scope: 'unp', key: 'unp-warn', severity: 'warn', windowMin: 60, value: unrealized, text: `⚠️ 盈虧風控｜未實現盈虧 ${unrealized.toFixed(2)} USDT（≤${warnLine.toFixed(0)} 警示）${detail ? `\n${detail}` : ''}` })
    }
  }

  // 4) 日內已實現虧損超標：兩級（需有 pnl1d）
  const pnl1d = safeNum(summary.pnl1d)
  if (walletBalance > 0 && Number.isFinite(pnl1d)) {
    const warnLine = -maxPctOrFloor(t.realizedWarnPctWallet, walletBalance, t.realizedFloors, 'warn')
    const critLine = -maxPctOrFloor(t.realizedCriticalPctWallet, walletBalance, t.realizedFloors, 'critical')
    if (pnl1d <= critLine) {
      out.push({ scope: 'rlz', key: 'rlz-critical', severity: 'critical', windowMin: 60, value: pnl1d, text: `⚠️ 日內虧損風控｜今日已實現 ${pnl1d.toFixed(2)} USDT（≤${critLine.toFixed(0)} 嚴重）` })
    } else if (pnl1d <= warnLine) {
      out.push({ scope: 'rlz', key: 'rlz-warn', severity: 'warn', windowMin: 120, value: pnl1d, text: `⚠️ 日內虧損風控｜今日已實現 ${pnl1d.toFixed(2)} USDT（≤${warnLine.toFixed(0)} 警示）` })
    }
  }

  return out
}

module.exports = { evalPositionAccountChanges }





