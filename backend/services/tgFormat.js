// 繁體中文註釋
// Telegram 文本格式化與轉義（HTML 模式）

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function ymd(ts, tz) {
  try {
    const d = tz ? new Date(new Date(ts).toLocaleString('en-US', { timeZone: tz })) : new Date(ts)
    return d.toISOString().slice(0,10)
  } catch (_) { return new Date(ts||Date.now()).toISOString().slice(0,10) }
}

function fmtInt(n) { return Number(n||0).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
function fmt2(n) { return Number(n||0).toFixed(2) }
function fmt4(n) { return Number(n||0).toFixed(4) }

module.exports = { esc, ymd, fmtInt, fmt2, fmt4 }




