Deploy Notes

PM2（範例）

ecosystem.config.js

module.exports = {
  apps: [{
    name: 'auto91-backend',
    script: 'server.js',
    cwd: './backend',
    env: { NODE_ENV: 'production' }
  }]
}

systemd（範例）

[Unit]
Description=Auto91 Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/repo/backend
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target

健康檢查

- HTTP: GET /health 應回 200
- WebSocket Hub: 監測 5002 連線可用性

Cloudflared

- 已支援自動重啟：CF_AUTORESTART=true, CF_RESTART_DELAY_MS=5000





















