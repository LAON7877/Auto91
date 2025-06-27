# API 參考文檔

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

## 其他 API

### GET /api/account/status
帳戶狀態查詢

### GET /api/position/status  
持倉狀態查詢

### POST /api/login
登入永豐API

### POST /api/logout
登出永豐API

### GET /api/ngrok/status
ngrok 狀態查詢

---

**注意**：所有交易日相關判斷都統一使用 `/api/trading/status` API 