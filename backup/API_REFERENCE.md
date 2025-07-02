# API 參考文檔

## ngrok 管理 API

### GET /api/ngrok/status
**ngrok 狀態查詢 API**

#### 回應格式
```json
{
  "status": "running|stopped|checking|error",
  "urls": [
    {
      "name": "unnamed",
      "url": "https://xxxx.ngrok.io",
      "local_addr": "http://localhost:5002"
    }
  ],
  "message": "online|offline|checking ngrok status..."
}
```

#### 狀態說明
- **running**：ngrok 正常運行，有可用的 tunnel
- **stopped**：ngrok 已停止
- **checking**：正在檢查 ngrok 狀態
- **error**：ngrok 出現錯誤

#### 自動重啟機制
- 當狀態為 `stopped` 且之前為 `running` 時，系統會自動啟動重啟定時器
- 5秒後自動重啟 ngrok 進程
- 重啟成功後狀態恢復為 `running`

### GET /api/ngrok/latency
**ngrok 延遲查詢 API**

#### 回應格式
```json
{
  "latency": "15ms"
}
```

#### 說明
- 只有在 ngrok 正常運行時才返回延遲值
- 無法獲取時返回 `"-"`

### GET /api/ngrok/connections
**ngrok 連接統計 API**

#### 回應格式
```json
{
  "ttl": 150,
  "opn": 5,
  "rt1": 0.15,
  "rt5": 0.12,
  "p50": 0.10,
  "p90": 0.25
}
```

#### 統計項目
- **ttl**：總連接數
- **opn**：當前開啟連接數
- **rt1**：1分鐘平均響應時間
- **rt5**：5分鐘平均響應時間
- **p50**：50% 分位數響應時間
- **p90**：90% 分位數響應時間

### GET /api/ngrok/requests
**ngrok 請求日誌 API**

#### 回應格式
```json
{
  "requests": [
    {
      "timestamp": "14:30:25.123 CST",
      "method": "GET",
      "uri": "/api/status",
      "status": 200,
      "status_text": "OK"
    }
  ]
}
```

#### 說明
- 只返回最近的 100 個請求
- 時間格式為台灣時區 (CST)
- 包含 HTTP 方法、URI、狀態碼和狀態文字

### GET /api/ngrok/version
**ngrok 版本信息 API**

#### 回應格式
```json
{
  "current_version": "3.23.3",
  "update_available": false
}
```

### POST /api/ngrok/check_update
**檢查 ngrok 更新 API**

#### 回應格式
```json
{
  "status": "success",
  "data": {
    "update_available": true,
    "current_version": "3.23.3",
    "latest_version": "3.24.0",
    "download_url": "https://..."
  }
}
```

### POST /api/ngrok/update
**更新 ngrok API**

#### 請求格式
```json
{
  "download_url": "https://..."
}
```

#### 回應格式
```json
{
  "status": "success",
  "message": "正在背景更新ngrok，請稍候..."
}
```

#### 說明
- 在背景執行更新，不阻塞主程式
- 自動備份舊版本
- 更新失敗時自動還原備份

### POST /api/ngrok/start
**手動啟動 ngrok API**

#### 回應格式
```json
{
  "success": true,
  "status": {
    "status": "running",
    "urls": [...],
    "message": "online"
  }
}
```

### POST /api/ngrok/stop
**手動停止 ngrok API**

#### 回應格式
```json
{
  "success": true,
  "status": {
    "status": "stopped",
    "urls": [],
    "message": "offline"
  }
}
```

## 交易日狀態 API

### GET /api/trading/status
**重要**：這是交易日判斷的核心API，所有前端都依賴此API

#### 回應格式
```json
{
  "status": "success",
  "current_datetime": "2025/01/XX XX:XX:XX",
  "weekday": "週X",
  "trading_day_status": "交易日|非交易日",
  "delivery_day_status": "交割日|非交割日", 
  "market_status": "開市|關市",
  "is_trading_day": true|false,
  "is_delivery_day": true|false,
  "is_market_open": true|false
}
```

#### 交易日判斷邏輯
- **源頭**：`main.py` 中的 `is_trading_day_advanced()` 函數
- **週日**：固定為非交易日
- **週一至週六**：預設為交易日（週六有夜盤）
- **特殊日期**：根據 `holidaySchedule_XXX.csv` 檔案（民國年格式）

#### 交易時段判斷
- **早盤**：08:45-13:45
- **夜盤**：14:50-次日05:00
- **週六夜盤**：到週六凌晨05:00結束

## 系統日誌 API

### POST /api/system_log
**接收前端系統日誌 API**

#### 請求格式
```json
{
  "message": "系統日誌訊息",
  "type": "info|warning|error|success"
}
```

#### 回應格式
```json
{
  "status": "success"
}
```

## 永豐API相關 API

### GET /api/sinopac/status
**永豐API連線狀態查詢**

#### 回應格式
```json
{
  "connected": true|false,
  "status": true|false,
  "futures_account": "期貨帳戶號碼",
  "api_ready": true|false
}
```

#### 說明
- **connected**：API是否已連線
- **status**：登入狀態
- **futures_account**：期貨帳戶資訊
- **api_ready**：API是否完全就緒可用

### GET /api/sinopac/version
**shioaji版本信息查詢**

#### 回應格式
```json
{
  "version": "1.2.6",
  "available": true
}
```

### POST /api/sinopac/check_update
**檢查shioaji更新**

#### 回應格式
```json
{
  "status": "success",
  "data": {
    "update_available": true|false,
    "current_version": "1.2.6",
    "latest_version": "1.2.7"
  }
}
```

### GET /api/account/status
**帳戶狀態查詢**

#### 回應格式
```json
{
  "status": "success",
  "data": {
    "權益總值": 1000000,
    "權益總額": 1000000,
    "今日餘額": 1000000,
    "昨日餘額": 950000,
    "可用保證金": 850000,
    "原始保證金": 150000,
    "維持保證金": 112500,
    "風險指標": 15,
    "手續費": 500,
    "期交稅": 200,
    "本日平倉損益": 5000,
    "未實現盈虧": -2000
  },
  "last_updated": "2025-07-02 14:30:00"
}
```

### GET /api/position/status
**持倉狀態查詢**

#### 回應格式
```json
{
  "status": "success",
  "data": {
    "TXF": {
      "動作": "多單",
      "數量": "2 口",
      "均價": "22,500",
      "市價": "22,480",
      "未實現盈虧": "-2,000"
    },
    "MXF": {
      "動作": "-",
      "數量": "-",
      "均價": "-",
      "市價": "-",
      "未實現盈虧": "-"
    },
    "TMF": {
      "動作": "-",
      "數量": "-",
      "均價": "-",
      "市價": "-",
      "未實現盈虧": "-"
    }
  },
  "total_pnl": "-2,000 TWD",
  "total_pnl_value": -2000,
  "has_positions": true,
  "last_updated": "2025-07-02 14:30:00"
}
```

### POST /api/manual/order
**手動下單API （v1.3.1更新）**

#### 請求格式
```json
{
  "contract_code": "TXF|MXF|TMF",
  "quantity": 1,
  "direction": "開多|開空|平多|平空",
  "price": 22500.0,
  "price_type": "MKT|LMT",
  "order_type": "IOC|ROD",
  "position_type": null|"long"|"short"
}
```

#### 回應格式
```json
{
  "status": "success",
  "message": "手動下單成功",
  "order": {
    "contract_code": "TXF",
    "contract_name": "TXFA5",
    "order_id": "ORDER123456",
    "status": "filled"
  }
}
```

### POST /api/webhook/tradingview
**TradingView Webhook API**

#### 請求格式
```json
{
  "type": "entry|exit",
  "direction": "開多|開空|平多|平空",
  "ticker": "TXF",
  "txf": 2,
  "mxf": 0,
  "tmf": 0,
  "tradeId": "TRADE123",
  "time": "2025-07-02 14:30:00",
  "price": "22500"
}
```

#### 回應格式
```json
{
  "status": "success",
  "message": "下單成功",
  "orders": [
    {
      "contract_code": "TXF",
      "order_id": "ORDER123456",
      "status": "submitted"
    }
  ]
}
```

### POST /api/test/telegram
**測試Telegram通知API （v1.3.1新增）**

#### 請求格式
```json
{
  "type": "submit_success|submit_fail|trade_success",
  "error_msg": "錯誤訊息（僅在submit_fail時需要）"
}
```

#### 回應格式
```json
{
  "status": "success",
  "message": "測試通知發送成功",
  "test_message": "實際發送的訊息內容"
}
```

#### 說明
- 用於測試Telegram通知功能是否正常
- 可測試不同類型的通知訊息
- 返回實際發送的訊息內容供檢查

## 系統管理 API

### POST /api/login
**登入永豐API**

#### 說明
- 自動從.env檔案讀取登入設定
- 同時啟動ngrok服務
- 設定12小時自動重新登入機制

### POST /api/logout
**登出永豐API**

#### 說明
- 登出永豐API連線
- 停止ngrok服務
- 重置系統登入狀態

### GET /api/connection/duration
**獲取連線時長信息**

#### 回應格式
```json
{
  "status": "success",
  "duration_hours": 2.5,
  "login_time": "2025-07-02T12:00:00",
  "auto_logout_hours": 12,
  "remaining_hours": 9.5
}
```

### POST /api/close_application
**關閉整個應用程式**

#### 回應格式
```json
{
  "status": "success",
  "message": "應用程式正在關閉..."
}
```

#### 說明
- 執行完整的清理工作
- 停止所有背景服務
- 1秒後強制關閉程式

## 端口配置

系統使用 `port.txt` 作為端口配置的唯一來源：
- 首次啟動時自動創建，預設端口 5000
- 可手動修改端口號，重啟後生效
- 所有 API 都使用此端口提供服務

## 合約資訊 API

### GET /api/futures/contracts
**合約資訊查詢 API**

#### 回應格式
```json
{
  "status": "success",
  "data": {
    "TXF": {
      "code": "TXF",
      "delivery_date": "2025/07/17",
      "margin": 150000
    },
    "MXF": {
      "code": "MXF",
      "delivery_date": "2025/07/17",
      "margin": 37500
    },
    "TMF": {
      "code": "TMF",
      "delivery_date": "2025/07/17",
      "margin": 15000
    }
  }
}
```

#### 說明
- 返回所有支援的期貨合約資訊
- 包含合約代碼、交割日期、保證金
- 支援大台指(TXF)、小台指(MXF)、微台指(TMF)
- 資訊可通過前端重新整理按鈕更新

---

**注意**：
1. 所有交易日相關判斷都統一使用 `/api/trading/status` API
2. ngrok 相關 API 具有自動錯誤恢復機制，4040 API 錯誤會被靜默處理
3. ngrok 狀態檢查包含自動重啟邏輯，確保服務持續可用 