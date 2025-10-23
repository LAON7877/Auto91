// 內部 WS Hub 位址
export function wsConnect(onMessage, onStatus) {
  const url = import.meta.env?.VITE_WS_URL || `ws://localhost:${import.meta.env?.VITE_WS_PORT || 5002}`
  let ws
  let closed = false
  let attempt = 0
  const connect = () => {
    if (closed) return
    try { onStatus && onStatus('connecting') } catch (_) {}
    ws = new WebSocket(url)
    ws.onopen = () => { attempt = 0; try { onStatus && onStatus('open') } catch (_) {} }
    ws.onmessage = (ev) => { try { onMessage && onMessage(ev) } catch (_) {} }
    ws.onclose = () => {
      try { onStatus && onStatus('closed') } catch (_) {}
      if (closed) return
      const backoff = Math.min(1000 * Math.pow(2, attempt++), 10000) + Math.floor(Math.random() * 500)
      setTimeout(connect, backoff)
    }
    ws.onerror = () => { try { onStatus && onStatus('error') } catch (_) {} }
  }
  connect()
  ws.closeSafely = () => {
    closed = true
    try {
      if (!ws) return
      const state = ws.readyState
      if (state === WebSocket.CONNECTING) {
        try { ws.addEventListener && ws.addEventListener('open', () => { try { ws.close() } catch (_) {} }, { once: true }) } catch (_) {}
        return
      }
      if (state === WebSocket.OPEN || state === WebSocket.CLOSING) {
        ws.close()
      }
    } catch (_) {}
  }
  return ws
}



