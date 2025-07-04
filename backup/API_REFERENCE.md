# API 參考文檔

## 最新更新 (v1.3.4 - 2025-07-04)

### 統一失敗通知格式 API
新增 `send_unified_failure_message()` 函數，統一處理所有訂單提交失敗的通知格式：

#### 功能特點
- **統一格式**：所有失敗通知使用相同的訊息格式
- **完整資訊**：包含合約代碼、交割日期、訂單類型、失敗原因等
- **多合約支援**：同時處理大台、小台、微台的失敗通知
- **錯誤翻譯**：使用 `OP_MSG_TRANSLATIONS` 提供友善的中文錯誤訊息

#### 支援的失敗原因
- "存在相反持倉"
- "保證金不足" 
- "非交易時間"
- "手動取消訂單"
- "價格未滿足"
- "訂單未找到"
- 其他API錯誤訊息

### 訂單回調函數增強
改進 `order_callback()` 函數，智能推斷開平倉和手動/自動狀態：

#### 智能推斷功能
- **開平倉判斷**：從持倉資訊自動判斷是否為平倉操作
- **操作類型推斷**：智能區分手動和自動操作
- **合約資訊檢索**：改進合約代碼和交割日期的檢索邏輯

### 合約代碼顯示修復
修復多個通知函數中合約代碼顯示錯誤的問題：

#### 修復內容
- **完整合約代碼**：正確顯示如 "TMFG5" 的完整合約代碼
- **交割日期檢索**：改進交割日期的檢索和格式化邏輯
- **全域合約對象**：使用 `contract_txf`、`contract_mxf`、`contract_tmf` 全域變數

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

### POST /api/ngrok/setup
**ngrok 自動化設置 API (v1.3.2 新增)**

#### 請求格式
```json
{
  "action": "user_setup",
  "token": "2nVXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

#### 回應格式
```json
{
  "status": "success",
  "message": "Token設置成功",
  "data": {
    "saved": true,
    "started": true
  }
}
```

#### 說明
- 用戶自定義ngrok token設置
- 自動保存token到 `server/config/ngrok_token.txt`
- 自動啟動ngrok並建立tunnel
- 僅支援 `user_setup` 模式

### POST /api/ngrok/validate_token
**ngrok Token 驗證 API (v1.3.2 新增)**

#### 請求格式
```json
{
  "token": "2nVXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

#### 回應格式
```json
{
  "status": "success",
  "valid": true|false,
  "message": "Token格式驗證通過"
}
```

#### 驗證規則
- Token必須以 `1_` 或 `2` 開頭
- 長度必須大於等於10字符
- 驗證通過才能進行設置

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

## 其他 API

### GET /api/account/status
帳戶狀態查詢

### GET /api/position/status  
持倉狀態查詢

### POST /api/login
登入永豐API

### POST /api/logout
登出永豐API

### GET /api/connection/duration
獲取連線時長信息

### POST /api/close_application
關閉整個應用程式

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