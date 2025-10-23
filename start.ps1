Param()

# Bootstrap and start (ASCII-only output to avoid mojibake)
$ErrorActionPreference = 'Stop'

function Ensure-Program($name, $exeName, $wingetId) {
  Write-Host "[Check] $name..." -ForegroundColor Cyan
  $found = $false
  try {
    $cmd = Get-Command $exeName -ErrorAction SilentlyContinue
    if ($cmd) { $found = $true }
  } catch {}
  if (-not $found) {
    Write-Host "[Install] $name (winget)" -ForegroundColor Yellow
    & winget install --id $wingetId --silent --accept-package-agreements --accept-source-agreements | Out-Null
  }
}

function Ensure-EnvFile() {
  if (-not (Test-Path "backend/.env")) {
    $envContent = @'
# 自動建立：請先填寫 ENCRYPTION_KEY（32位元 base64）後重啟

# 服務
PORT=5001
WS_PORT=5002
TZ=Asia/Taipei

# 資料庫
MONGODB_URI=mongodb://127.0.0.1:27017/auto91_tradebot

# 前端白名單（你的網域）（以逗號分隔）上線請填你的網域
ALLOWED_ORIGINS=https://<你的域名>.com,http://localhost:5173

# 管理端金鑰（選填，用於受保護端點）
# 產生方式：node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY=REPLACE_WITH_SECURE_BASE64_32_BYTES
ADMIN_KEY=

# 訊號驗證（留空=開放模式；生產建議填寫）
# 只用 API Key 即可，TradingView 在 URL 加 ?apiKey=(自定義)
SIGNAL_API_KEYS=
SIGNAL_SECRET=
#後端未設 SIGNAL_API_KEYS：不用 apiKey 也能送訊號。
#後端有設 SIGNAL_API_KEYS：必須用帶 apiKey 的 URL 才能送訊號

# Cloudflared 自動重啟設定
CF_AUTORESTART=true
CF_RESTART_DELAY_MS=5000

# 訊號分發併發度（避免一次打爆交易所）
SIGNAL_DISPATCH_CONCURRENCY=10

# 冪等時間窗（毫秒）與指標視窗（毫秒）
IDEM_TTL_MS=300000
METRICS_WINDOW_MS=86400000

# 維護：交易保留天數（設值才會刪，例如 90）
TRADE_TTL_DAYS=90
# 維護：Mongo 本機輸出檔大小上限（MB），超過則截斷（設值才會生效）
LOG_TRIM_MB=50
# 維護：截斷後保留大小（MB）
LOG_TRIM_KEEP_MB=5

# Telegram Bot（留空則停用通知）
TELEGRAM_BOT_TOKEN=
'@
    $envContent | Out-File -Encoding UTF8 "backend/.env"
  }
}

function Ensure-FrontendEnvFile() {
  if (-not (Test-Path "frontend/.env")) {
    $feContent = @'
# 前端環境變數

# WebSocket 連線（擇一設定即可）
# VITE_WS_URL=ws://你的域名或IP:埠號   # 若使用完整 URL，請取消註解並填入
VITE_WS_PORT=5002                       # 若僅改埠號，維持此值與後端 WS_PORT 一致

# 管理端金鑰（與後端 ADMIN_KEY 相同；留空則不帶）
VITE_ADMIN_KEY=

# 用於「通道列表-含 apiKey 複製」按鈕（選填）。設定後會顯示含 apiKey 的複製按鈕
VITE_SIGNAL_API_KEY=
'@
    $feContent | Out-File -Encoding UTF8 "frontend/.env"
  }
}

function Install-NodeModules($path) {
  Push-Location $path
  npm install --silent --no-progress | Out-Null
  Pop-Location
}

function Ensure-NodeModules($path) {
  if (-not (Test-Path "$path/node_modules")) {
    Install-NodeModules $path
  } else {
    Push-Location $path
    npm install --silent --no-progress | Out-Null
    Pop-Location
  }
}

function Ensure-MongoDB() {
  Write-Host "[Check] MongoDB service..." -ForegroundColor Cyan
  $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'MongoDB*' }
  if ($svc) {
    if ($svc.Status -ne 'Running') {
      try { Start-Service $svc.Name } catch {}
    }
    return
  }
  if (-not (Test-Path 'data/db')) { New-Item -ItemType Directory -Force 'data/db' | Out-Null }
  $mongodExe = $null
  try {
    $latestDir = Get-ChildItem "C:\Program Files\MongoDB\Server" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($latestDir) {
      $candidate = Join-Path $latestDir.FullName "bin\mongod.exe"
      if (Test-Path $candidate) { $mongodExe = $candidate }
    }
  } catch {}
  if (-not $mongodExe) {
    try {
      $where = (& where mongod 2>$null)
      if ($where) { $mongodExe = $where }
    } catch {}
  }
  $logOut = Join-Path $PWD "mongo.out.log"
  $logErr = Join-Path $PWD "mongo.err.log"
  if ($mongodExe) {
    Start-Process "$mongodExe" "--dbpath `"$PWD\data\db`" --bind_ip 127.0.0.1 --port 27017" -RedirectStandardOutput $logOut -RedirectStandardError $logErr -WindowStyle Hidden
  } else {
    Start-Process cmd "/c mongod --dbpath `"$PWD\data\db`" --bind_ip 127.0.0.1 --port 27017" -RedirectStandardOutput $logOut -RedirectStandardError $logErr -WindowStyle Hidden
  }
}

function Wait-MongoReady([int]$timeoutSec = 60) {
  Write-Host "[Wait] MongoDB port 27017..." -ForegroundColor Cyan
  $t0 = Get-Date
  while ((Get-Date) - $t0 -lt ([TimeSpan]::FromSeconds($timeoutSec))) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect('127.0.0.1', 27017)
      $tcp.Close()
      Write-Host "[OK] MongoDB is ready." -ForegroundColor Green
      return $true
    } catch {}
    Start-Sleep -Seconds 1
  }
  Write-Host "[Warn] MongoDB not reachable on 27017 (continue anyway)." -ForegroundColor Yellow
  return $false
}

Write-Host "=== Auto91 Trading Bot Start ===" -ForegroundColor Green

try { winget --version *> $null } catch { Write-Host "winget is not available. Please install Node.js and MongoDB manually if needed." -ForegroundColor Red }

Ensure-Program 'Node.js' 'node' 'OpenJS.NodeJS'
Ensure-Program 'MongoDB' 'mongod' 'MongoDB.MongoDBServer'

Ensure-EnvFile
Ensure-FrontendEnvFile
Ensure-NodeModules 'backend'
Ensure-NodeModules 'frontend'

# Double-check backend critical deps
Push-Location 'backend'
try { node -e "require('bottleneck')" 2>$null } catch { npm i bottleneck --save --silent | Out-Null }
  try { node -e "require('redis')" 2>$null } catch { npm i redis redlock --save --silent | Out-Null }
Pop-Location

Ensure-MongoDB
if (-not (Wait-MongoReady 60)) {
  Write-Host "[Error] MongoDB not ready on 27017. Please install/start MongoDB service or run mongod manually." -ForegroundColor Red
  Write-Host "Check logs: mongo.out.log / mongo.err.log" -ForegroundColor Yellow
  exit 1
}

Write-Host "[Start] Backend and Frontend..." -ForegroundColor Green
# 開新 cmd 視窗（保留日誌）
$backendCmd = "/k cd /d `"$PWD\backend`" && node server.js"
Start-Process -FilePath cmd -ArgumentList $backendCmd
Start-Sleep -Seconds 2
$frontendCmd = "/k cd /d `"$PWD\frontend`" && npm start --silent"
Start-Process -FilePath cmd -ArgumentList $frontendCmd

Write-Host "HTTP: http://localhost:5001  Frontend: http://localhost:5173  WS: ws://localhost:5002" -ForegroundColor Cyan

