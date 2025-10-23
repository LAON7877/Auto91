import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import dotenv from 'dotenv'

// 嘗試讀取後端的 .env 以取得 PORT，若不存在則使用預設 5001/5257
try {
  dotenv.config({ path: path.resolve(__dirname, '../backend/.env') })
} catch {}

const backendPort = process.env.PORT || process.env.VITE_BACKEND_PORT || '5001'
const backendWsPort = process.env.WS_PORT || process.env.VITE_WS_PORT || '5002'
const proxyTarget = process.env.VITE_API_TARGET || `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': proxyTarget
    }
  },
  define: {
    'import.meta.env.VITE_BACKEND_PORT': JSON.stringify(backendPort),
    'import.meta.env.VITE_WS_PORT': JSON.stringify(backendWsPort),
    'import.meta.env.VITE_API_TARGET': JSON.stringify(proxyTarget),
    'import.meta.env.VITE_WS_URL': JSON.stringify(`ws://localhost:${backendWsPort}`)
  }
})



