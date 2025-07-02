# 系統維護指南

## ngrok 維護

### 自動管理機制
- **自動啟動**：程式啟動時自動啟動 ngrok 背景進程
- **自動重啟**：檢測到 ngrok 異常時自動重啟（5秒延遲）
- **自動關閉**：程式退出時自動清理 ngrok 進程
- **自動升級**：背景檢查並支援 ngrok 版本自動更新

### ngrok 版本升級

#### 自動升級流程
1. **背景檢查**：程式啟動時自動檢查 ngrok 版本
2. **版本比較**：與 GitHub 最新版本進行比較
3. **自動下載**：發現新版本時自動下載並更新
4. **備份機制**：更新前自動備份舊版本
5. **錯誤恢復**：更新失敗時自動還原備份

#### 手動升級流程
```bash
# 1. 檢查當前版本
curl http://localhost:5002/api/ngrok/version

# 2. 檢查更新
curl -X POST http://localhost:5002/api/ngrok/check_update

# 3. 執行更新
curl -X POST http://localhost:5002/api/ngrok/update
```

#### 升級注意事項
- 升級過程中 ngrok 會暫時停止服務
- 升級完成後會自動重新啟動
- 建議在非交易時段進行升級
- 升級前建議備份重要資料

### ngrok 故障排查

#### 4040 API 錯誤處理
- **500 錯誤**：這是已知的 ngrok bug，程式會自動處理
- **編碼錯誤**：`failed to encode response` 錯誤會被靜默處理
- **超時錯誤**：設置合理的 timeout 值，避免長時間等待
- **自動重試**：程式會自動重試失敗的 API 調用

#### 常見問題排查
1. **ngrok 無法啟動**
   ```powershell
   # 檢查進程
   Get-Process ngrok
   
   # 檢查端口
   netstat -an | findstr :5002
   
   # 檢查檔案
   Test-Path server/ngrok.exe
   ```

2. **4040 API 無法連線**
   ```powershell
   # 測試 API
   Invoke-RestMethod http://localhost:4040/api/tunnels
   
   # 檢查防火牆
   netsh advfirewall firewall show rule name=all | findstr ngrok
   ```

3. **自動重啟循環**
   - 檢查重啟定時器是否正確取消
   - 檢查進程狀態是否正確判斷
   - 查看前端系統日誌

#### 手動重啟 ngrok
```bash
# 停止 ngrok
curl -X POST http://localhost:5002/api/ngrok/stop

# 等待 2 秒
sleep 2

# 啟動 ngrok
curl -X POST http://localhost:5002/api/ngrok/start
```

### ngrok 監控指標
- **狀態**：running|stopped|checking|error
- **延遲**：API 響應時間
- **連接數**：總連接數和當前開啟連接數
- **請求日誌**：最近的 HTTP 請求記錄
- **版本信息**：當前版本和更新可用性

## 交易日判斷維護

### 重要原則
- **唯一源頭**：交易日判斷邏輯只存在於 `main.py` 中
- **嚴禁重複**：不得在其他地方重複實現交易日判斷
- **統一調用**：所有功能都通過 `/api/trading/status` API 獲取交易日狀態

### 假期檔案維護
1. **檔案格式**：使用民國年命名（如 `holidaySchedule_114.csv`）
2. **檔案位置**：`server/holiday/` 目錄
3. **編碼格式**：Big5 編碼
4. **欄位格式**：
   ```csv
   日期,備註
   2025/01/01,非交易
   2025/01/02,o
   ```
   - `'o'` = 交易日
   - 其他或空白 = 非交易日

### 定期檢查項目
- [ ] 假期檔案是否正確更新
- [ ] 民國年轉換是否正確（西元年-1911）
- [ ] 週六夜盤邏輯是否正常運作
- [ ] API 回應是否一致
- [ ] ngrok 狀態是否正常
- [ ] 自動重啟機制是否運作
- [ ] 版本檢查是否正常

### 故障排除
- 交易日判斷異常：檢查 `main.py` 中的 `is_trading_day_advanced()` 函數
- 假期檔案讀取失敗：檢查檔案編碼和格式
- 前端顯示異常：檢查 `/api/trading/status` API 回應
- ngrok 異常：檢查自動重啟機制和進程狀態

## 永豐API維護（v1.3.1新增）

### API初始化維護

#### 初始化流程檢查
1. **API對象創建**：檢查 `init_sinopac_api()` 是否成功執行
2. **登入狀態**：確認 `login_sinopac()` 正常完成
3. **帳戶設置**：驗證期貨帳戶是否正確設置
4. **callback狀態**：檢查callback設置是否跳過（v1.3.1暫時移除）

#### 版本兼容性維護
```bash
# 檢查shioaji版本
curl http://localhost:5002/api/sinopac/version

# 檢查更新
curl -X POST http://localhost:5002/api/sinopac/check_update

# 自動更新（如需要）
curl -X POST http://localhost:5002/api/sinopac/auto_update
```

#### callback設置故障排除
- **v1.3.1修復**：callback設置移至登入成功後
- **錯誤隔離**：callback設置失敗不影響基本功能
- **通知機制**：改為主動查詢模式，確保可靠性

### API連線維護

#### 連線狀態監控
```bash
# 檢查連線狀態
curl http://localhost:5002/api/sinopac/status

# 檢查帳戶狀態
curl http://localhost:5002/api/account/status

# 檢查持倉狀態
curl http://localhost:5002/api/position/status
```

#### 12小時自動重連機制
- **自動登出**：連線滿12小時後自動登出
- **重新登入**：自動執行重新登入程序
- **狀態通知**：通過前端系統日誌記錄

#### 手動重新連線
```bash
# 登出API
curl -X POST http://localhost:5002/api/logout

# 重新登入
curl -X POST http://localhost:5002/api/login
```

### 通知系統維護

#### 通知機制檢查（v1.3.1變更）
- **主動查詢模式**：改為查詢訂單狀態後發送通知
- **通知完整性**：提交成功/失敗/成交通知都正常運作
- **時間延遲**：通知可能比即時callback延遲1-2秒

#### Telegram通知測試
```bash
# 測試提交成功通知
curl -X POST http://localhost:5002/api/test/telegram \
  -H "Content-Type: application/json" \
  -d '{"type": "submit_success"}'

# 測試提交失敗通知
curl -X POST http://localhost:5002/api/test/telegram \
  -H "Content-Type: application/json" \
  -d '{"type": "submit_fail", "error_msg": "測試錯誤"}'

# 測試成交通知
curl -X POST http://localhost:5002/api/test/telegram \
  -H "Content-Type: application/json" \
  -d '{"type": "trade_success"}'
```

### API維護檢查清單
- [ ] shioaji版本是否為最新
- [ ] API初始化是否正常
- [ ] 登入狀態是否穩定
- [ ] 期貨帳戶是否正確設置
- [ ] 12小時自動重連是否運作
- [ ] 通知功能是否正常
- [ ] 下單功能是否正常（手動和webhook）
- [ ] 合約資訊是否能正常獲取

### 常見API問題排除
1. **初始化錯誤**：檢查shioaji模組是否正確安裝
2. **登入失敗**：檢查API Key、Secret Key、憑證設置
3. **callback錯誤**：v1.3.1已修復，確認使用最新版本
4. **通知異常**：檢查Telegram Bot Token和Chat ID
5. **帳戶問題**：確認期貨帳戶已開啟並有足夠權限

## 系統維護

### 日誌檢查
- 檢查 `shioaji.log` 中的錯誤訊息
- 監控 API 連線狀態
- 檢查交易日判斷日誌
- 查看前端系統日誌
- 檢查 ngrok 請求日誌
- 監控永豐API初始化和callback狀態（v1.3.1新增）

### 備份策略
- 定期備份 `.env` 設定檔
- 備份假期檔案
- 備份交易記錄
- 備份 ngrok 配置

### 性能監控
- 監控 ngrok 延遲和連接數
- 檢查 API 響應時間
- 監控系統資源使用情況
- 檢查進程狀態

---

**重要提醒**：
1. 交易日判斷是系統核心功能，任何修改都需謹慎測試
2. ngrok 自動管理機制確保服務高可用性，無需手動干預
3. 定期檢查系統日誌和 ngrok 狀態
4. 重要升級前請先備份並在測試環境驗證

---

如遇重大異常請參考 TROUBLESHOOTING.md 或聯絡開發者。 