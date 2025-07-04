# 系統維護指南

## 最新更新 (v1.3.4 - 2025-07-04)

### 永豐手動下單參數格式標準化維護
**重大架構變更維護**：
- **參數格式標準化**：手動下單改為使用永豐官方參數格式
- **手動/自動下單分離**：明確區分手動下單和 WEBHOOK 下單的參數格式
- **動作對應邏輯標準化**：統一動作對應邏輯，確保通知訊息準確性

**維護檢查清單**：
- [ ] 確認手動下單使用正確的 `action` 和 `octype` 參數
- [ ] 檢查 WEBHOOK 下單使用正確的中文 `direction` 參數
- [ ] 驗證動作對應邏輯的正確性
- [ ] 測試平倉成交通知的準確性
- [ ] 確認開平倉邏輯不再預設為開倉

**參數格式檢查**：
- **手動下單**：必須提供 `action` (Buy/Sell) 和 `octype` (New/Cover)
- **WEBHOOK 下單**：使用中文 `direction` (開多/開空/平多/平空)
- **錯誤處理**：手動下單缺少官方參數時應直接報錯

### 統一失敗通知格式維護
**新增維護項目**：
- **失敗通知格式統一**：所有訂單提交失敗訊息現在使用統一格式
- **錯誤訊息翻譯維護**：`OP_MSG_TRANSLATIONS` 對照表需要定期更新
- **合約代碼顯示檢查**：確保所有通知都能正確顯示完整合約代碼

**維護檢查清單**：
- [ ] 確認失敗通知格式一致性
- [ ] 檢查錯誤訊息翻譯是否完整
- [ ] 驗證合約代碼顯示正確性
- [ ] 測試手動平倉和訂單取消通知

### 訂單回調函數維護
**智能推斷功能維護**：
- **開平倉判斷邏輯**：檢查從持倉資訊推斷開平倉的準確性
- **操作類型推斷**：驗證手動/自動操作判斷的正確性
- **合約資訊檢索**：確保合約代碼和交割日期檢索邏輯正常

**維護檢查清單**：
- [ ] 測試訂單回調函數的智能推斷功能
- [ ] 檢查全域合約對象（contract_txf, contract_mxf, contract_tmf）的初始化
- [ ] 驗證訂單映射（order_octype_map）的正確性
- [ ] 確認回調函數的錯誤處理機制

### Python語法檢查維護
**新增維護項目**：
- **global宣告檢查**：確保所有全域變數使用前都有正確的global宣告
- **語法錯誤預防**：定期檢查代碼中的語法問題
- **變數作用域管理**：確保變數作用域的正確性

**維護檢查清單**：
- [ ] 檢查所有函數中的global宣告位置
- [ ] 驗證全域變數的使用是否正確
- [ ] 確認沒有變數使用前未宣告的問題
- [ ] 測試系統啟動時的語法檢查

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

### ngrok Token 管理（v1.3.2 新增）

#### Token 設置維護
```bash
# 檢查 Token 設置狀態
ls -la server/config/ngrok_token.txt

# 驗證 Token 格式
curl -X POST http://localhost:5002/api/ngrok/validate_token \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN_HERE"}'

# 設置新 Token
curl -X POST http://localhost:5002/api/ngrok/setup \
  -H "Content-Type: application/json" \
  -d '{"action": "user_setup", "token": "YOUR_TOKEN_HERE"}'
```

#### Token 檔案維護
- **存儲位置**：`server/config/ngrok_token.txt`
- **格式要求**：Token必須以 `1_` 或 `2` 開頭，長度≥10字符
- **權限檢查**：確保檔案具有適當的讀寫權限
- **備份建議**：重要Token應定期備份

#### 常見 Token 問題
1. **Token 格式錯誤**：
   - 檢查是否以 `1_` 或 `2` 開頭
   - 確認長度大於等於10字符
   - 檢查是否包含無效字符

2. **Token 檔案丟失**：
   - 檢查 `server/config/` 目錄是否存在
   - 重新設置Token並保存
   - 檢查檔案權限設置

3. **webview localStorage 失效**：
   - v1.3.2已改用服務器端存儲解決此問題
   - 舊版本可能遇到重啟後Token消失
   - 升級到v1.3.2可徹底解決

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

### 通知系統維護（v1.3.2 重大重構）

#### 通知機制演進
- **v1.3.1之前**：即時callback（因API版本問題廢棄）
- **v1.3.1**：主動查詢模式（已廢棄）
- **v1.3.2當前**：回調事件處理機制（參考TXserver.py重構）

#### 現行通知架構維護
1. **訂單映射檢查**：
   ```bash
   # 檢查order_octype_map狀態
   # 通過下單後觀察是否正確建立映射
   ```

2. **回調函數監控**：
   ```python
   # 檢查 order_callback 是否正常註冊
   # 監控各種 OrderState 的處理
   ```

3. **通知格式驗證**：
   ```bash
   # 檢查提交成功通知格式
   # 檢查提交失敗通知格式  
   # 檢查成交通知格式
   ```

#### 通知系統故障排除
1. **通知遺漏**：
   - 檢查 order_octype_map 是否正確建立
   - 驗證 seqno 是否正確對應
   - 確認回調函數是否正常觸發

2. **通知延遲**：
   - v1.3.2使用即時回調，不應有明顯延遲
   - 如有延遲，檢查線程鎖是否造成阻塞

3. **通知格式錯誤**：
   - 檢查 get_formatted_order_message() 函數
   - 檢查 get_formatted_trade_message() 函數
   - 驗證 OP_MSG_TRANSLATIONS 對照表

#### 測試功能（v1.3.2 已移除）
- **重要變更**：v1.3.2已移除所有測試功能API
- **原因**：測試功能容易產生誤導性錯誤，改為直接使用正式功能驗證
- **替代方案**：通過實際下單操作驗證通知系統功能

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