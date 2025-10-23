// 繁體中文註釋
// 系統/風控告警：私有 WS 過舊、重連失敗、REST 補位失敗等

function evalSystemAlerts({ wsStaleSec, wsLastTs, reconnectErrors, restErrors }) {
  const out = []
  try {
    const staleMs = Math.max(0, Date.now() - Number(wsLastTs || 0))
    if (wsStaleSec && staleMs > wsStaleSec * 1000) {
      out.push(`🚨 私有WS過舊 ${Math.floor(staleMs/1000)}s`)
    }
  } catch (_) {}
  if (Array.isArray(reconnectErrors) && reconnectErrors.length) {
    out.push(`🚨 重連錯誤 x${reconnectErrors.length}`)
  }
  if (Array.isArray(restErrors) && restErrors.length) {
    out.push(`🚨 補位失敗 x${restErrors.length}`)
  }
  return out
}

module.exports = { evalSystemAlerts }









