# API 技術參考

## 主要 API 一覽

- `/api/login`：登入系統
- `/api/logout`：登出系統
- `/api/account/status`：查詢帳戶狀態
- `/api/position/status`：查詢持倉狀態
- `/api/trading/status`：查詢交易日/交割日/開市狀態
- `/api/ngrok/status`：查詢 ngrok 狀態
- `/api/ngrok/update`：ngrok 自動更新
- `/api/sinopac/status`：查詢永豐 API 狀態
- `/api/sinopac/update`：shioaji 自動更新
- `/api/close_application`：關閉主程式

## 回傳格式
所有 API 回傳皆為 JSON 格式，包含 status、data、error 等欄位。

---

詳細參數與範例請參考原始碼與前端 main.js。 