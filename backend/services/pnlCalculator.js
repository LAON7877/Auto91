// 繁體中文註釋
// 統一的已實現 PnL 計算器：避免多處重複且不一致的邏輯

function toNumber(n, def = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : def
}

function round2(n) {
  const v = toNumber(n, 0)
  return Number.isFinite(v) ? Number(v.toFixed(2)) : 0
}

// positionSide: 'long' | 'short'
// includeFees: 將 fee 納入實現損益（takerFee/makerFee 以同幣別金額傳入，正值代表成本）
function computeCloseRealizedPnl({ positionSide, entryPrice, fillPrice, quantity, includeFees = false, takerFee = 0, makerFee = 0 }) {
  const side = String(positionSide || '').toLowerCase()
  const entry = toNumber(entryPrice, 0)
  const exit = toNumber(fillPrice, 0)
  const qty = Math.abs(toNumber(quantity, 0))
  if (!(qty > 0 && entry > 0 && exit > 0)) return 0

  let pnl = 0
  if (side === 'long') {
    pnl = (exit - entry) * qty
  } else if (side === 'short') {
    pnl = (entry - exit) * qty
  } else {
    return 0
  }

  if (includeFees) {
    const feeSum = toNumber(takerFee, 0) + toNumber(makerFee, 0)
    pnl -= feeSum
  }
  return pnl
}

module.exports = { computeCloseRealizedPnl, round2 }


