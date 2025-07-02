# 故障排除指南

## ngrok 相關問題

### 問題：ngrok 顯示 offline 狀態
**症狀**：前端顯示 ngrok 狀態為 offline 或 stopped
**可能原因**：
1. ngrok 進程異常退出
2. 網路連線問題
3. 4040 API 無法訪問
4. 防火牆阻擋

**解決方案**：
1. **檢查自動重啟機制**：系統會自動檢測並在 5 秒後重啟 ngrok
2. **手動重啟**：
   ```bash
   curl -X POST http://localhost:5002/api/ngrok/stop
   sleep 2
   curl -X POST http://localhost:5002/api/ngrok/start
   ```
3. **檢查進程狀態**：
   ```powershell
   Get-Process ngrok
   ```
4. **檢查網路連線**：確認網路穩定，無防火牆阻擋

### 問題：4040 API 無法連線
**症狀**：`Connection refused` 或 `timeout` 錯誤
**可能原因**：
1. ngrok 進程未正常啟動
2. 4040 端口被占用
3. 防火牆阻擋本地連接

**解決方案**：
1. **檢查 ngrok 進程**：
   ```powershell
   Get-Process ngrok
   ```
2. **檢查端口占用**：
   ```powershell
   netstat -an | findstr :4040
   ```
3. **重啟 ngrok**：使用 API 或重啟整個程式
4. **檢查防火牆**：確保本地連接不被阻擋

### 問題：4040 API 返回 500 錯誤
**症狀**：`<Error><StatusCode>500</StatusCode><Message>failed to encode response</Message></Error>`
**原因**：這是已知的 ngrok bug，特別是在較舊版本中
**解決方案**：
1. **自動處理**：程式會靜默處理此錯誤，不影響功能
2. **升級 ngrok**：使用 `/api/ngrok/update` 升級到最新版本
3. **減少請求頻率**：避免過於頻繁的 API 調用

### 問題：ngrok 請求日誌無法顯示
**症狀**：前端 ngrok 請求日誌為空或無法獲取
**可能原因**：
1. 只有通過 ngrok 外部 URL 的請求才會出現在日誌中
2. 本地 localhost 請求不會記錄
3. 4040 API 暫時無法訪問

**解決方案**：
1. **確認外部訪問**：使用 ngrok 提供的公開 URL 訪問
2. **檢查 API 狀態**：
   ```bash
   curl http://localhost:4040/api/requests
   ```
3. **等待自動恢復**：程式會自動處理 API 錯誤

### 問題：ngrok 自動重啟循環
**症狀**：ngrok 不斷重啟，無法穩定運行
**可能原因**：
1. 重啟定時器未正確取消
2. 進程狀態判斷錯誤
3. 網路環境不穩定

**解決方案**：
1. **檢查重啟邏輯**：確認 `ngrok_auto_restart_timer` 正確管理
2. **手動停止重啟**：重啟程式，重置所有定時器
3. **檢查網路**：確保網路環境穩定
4. **查看日誌**：檢查前端系統日誌中的重啟訊息

### 問題：ngrok 版本過舊
**症狀**：功能異常或 API 錯誤頻繁
**解決方案**：
1. **檢查版本**：
   ```bash
   curl http://localhost:5002/api/ngrok/version
   ```
2. **檢查更新**：
   ```bash
   curl -X POST http://localhost:5002/api/ngrok/check_update
   ```
3. **自動升級**：
   ```bash
   curl -X POST http://localhost:5002/api/ngrok/update
   ```

## 交易日判斷問題

### 問題：週六顯示為非交易日
**原因**：舊版本邏輯錯誤
**解決方案**：已修正，週六現在正確顯示為交易日（支援夜盤）

### 問題：假期檔案無法讀取
**症狀**：`讀取假期檔案失敗` 錯誤
**檢查項目**：
1. 檔案是否存在於 `server/holiday/` 目錄
2. 檔案名稱是否為民國年格式（如 `holidaySchedule_114.csv`）
3. 檔案編碼是否為 Big5
4. CSV 格式是否正確

### 問題：交易日判斷不一致
**症狀**：不同頁面顯示不同的交易日狀態
**解決方案**：
1. 確認所有功能都使用 `/api/trading/status` API
2. 檢查是否有地方重複實現交易日判斷邏輯
3. 清除瀏覽器快取

### 問題：民國年轉換錯誤
**症狀**：找不到對應的假期檔案
**檢查項目**：
1. 確認民國年計算：西元年 - 1911
2. 檔案命名格式：`holidaySchedule_XXX.csv`
3. 年份是否正確（如 2025年 = 民國114年）

## 常見系統問題

### 永豐API初始化問題

#### 問題：啟動時出現 'Shioaji' object has no attribute 'on_order_callback' 錯誤
**症狀**：系統啟動時永豐API無法正常登入，出現callback相關錯誤
**原因**：callback設置在API對象完全初始化前就嘗試執行
**解決方案**：
1. **已修復**：v1.3.1版本已將callback設置移動到登入成功後
2. **檢查版本**：確認使用最新版本的代碼
3. **重新啟動**：如仍出現問題，重新啟動應用程式

#### 問題：永豐API連線成功但通知功能異常
**症狀**：API能正常連線和查詢，但下單通知無法正常工作
**原因**：callback設置暫時移除以確保系統穩定性
**說明**：
- 基本交易功能完全正常（查詢、下單、webhook）
- 通知功能改為主動查詢模式，功能完整但略有延遲
- 未來版本將重新實現即時callback功能

#### 問題：shioaji版本兼容性問題
**症狀**：不同版本的shioaji在callback設置上有差異
**解決方案**：
1. **檢查版本**：使用 `/api/sinopac/version` 查看當前版本
2. **更新套件**：使用 `/api/sinopac/auto_update` 自動更新
3. **手動更新**：`pip install --upgrade shioaji`

### API 連線問題
- 檢查永豐 API 憑證是否過期
- 確認網路連線正常
- 檢查 `.env` 設定檔

### 前端顯示問題
- 清除瀏覽器快取
- 檢查 JavaScript 錯誤
- 確認 API 回應格式正確

## 日誌檢查

### 重要日誌檔案
- `shioaji.log` - 永豐 API 連線日誌
- 瀏覽器開發者工具 - 前端錯誤
- 系統事件日誌 - 應用程式錯誤
- 前端系統日誌 - 通過 `/api/system_log` 記錄

### 關鍵錯誤訊息
- `初始化交易日曆失敗` - 假期檔案問題
- `讀取假期檔案失敗` - 檔案格式或編碼問題
- `API 連線失敗` - 網路或憑證問題
- `ngrok 自動重啟成功` - 自動恢復機制運作
- `ngrok 自動重啟失敗` - 需要手動干預

## 緊急處理流程

### 1. 無法啟動主程式
- 檢查 Python 版本與依賴是否安裝齊全
- 查看終端機錯誤訊息
- 確認 ngrok.exe 存在於正確位置

### 2. API 連線失敗
- 檢查 API Key、憑證、網路連線
- 檢查永豐 API 是否維護中
- 確認 `.env` 設定正確

### 3. ngrok 無法連線
- 檢查網路環境和防火牆設定
- 使用手動重啟 API
- 檢查 ngrok 版本是否需要升級

### 4. Telegram Bot 無法推播
- 檢查 Bot Token 與 Chat ID
- 確認 Bot 是否啟用
- 測試 Bot API 連線

### 5. 系統異常重啟
- 檢查自動重啟機制是否正常
- 查看前端系統日誌
- 確認進程管理是否正確

---

**重要**：
1. 交易日判斷問題優先檢查 `main.py` 中的邏輯
2. ngrok 問題優先檢查自動重啟機制
3. 4040 API 錯誤是已知問題，程式會自動處理
4. 大部分問題會通過自動恢復機制解決

更多疑難雜症請參考 backup/MAINTENANCE.md 或聯絡開發者。 