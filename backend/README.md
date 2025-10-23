Backend Setup

環境變數 (.env)

- PORT, WS_PORT
- MONGODB_URI
- ALLOWED_ORIGINS: 逗號分隔白名單（例: https://leyo-play.com,http://localhost:5173）
- ENCRYPTION_KEY: 32 bytes base64。產生：
  - node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
- ADMIN_KEY: 管理介面非GET動作需在 header 帶 x-admin-key
- SIGNAL_API_KEYS: 允許的 apiKey 名單（若留空=開放模式）
- SIGNAL_SECRET: （可選）設定後需同時帶 signature/ts
- CF_AUTORESTART=true, CF_RESTART_DELAY_MS=5000
- SIGNAL_DISPATCH_CONCURRENCY=5
 - IDEM_TTL_MS=300000 # 訊號去重時間窗（毫秒），預設 5 分鐘

訊號格式與 URL 說明

- JSON 必填欄位：id, action, mp, prevMP
  - 範例：{"id":"sig-123","action":"buy","mp":"long","prevMP":"flat"}
- 通道儲存後會顯示 fullUrl
  - 開放模式：直接 POST 至 fullUrl
  - API Key 模式：fullUrl?apiKey=<你的key>

測試

- 健康檢查：GET /health
- 訊號：POST /api/signal/:suffix，JSON 需含 id/action/mp/prevMP

