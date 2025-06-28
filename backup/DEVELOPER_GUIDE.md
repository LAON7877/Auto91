# 開發者指南

## 系統架構

### ngrok 自動管理架構（重要）

#### 核心設計原則
- **全自動管理**：用戶無需手動啟動、停止或配置 ngrok
- **高可用性**：自動故障檢測和恢復機制
- **資源管理**：程式退出時自動清理，避免進程殘留
- **錯誤恢復**：靜默處理 4040 API 錯誤，自動重試

#### ngrok 啟動流程
```python
def start_ngrok():
    # 1. 檢查是否已有 ngrok 在運行
    # 2. 啟動背景進程（不使用 CREATE_NEW_CONSOLE）
    ngrok_process = subprocess.Popen(
        [ngrok_exe_path, 'http', '5002'],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # 3. 等待啟動並獲取 URL（5秒等待）
    # 4. 多次重試獲取 tunnel 信息
    # 5. 檢查進程狀態
```

#### ngrok 自動重啟機制
```python
def start_ngrok_auto_restart():
    # 1. 取消現有重啟定時器
    # 2. 創建新的重啟定時器（5秒延遲）
    ngrok_auto_restart_timer = threading.Timer(5.0, auto_restart_task)
    
def auto_restart_task():
    # 1. 終止舊進程
    # 2. 重新啟動 ngrok
    # 3. 發送前端系統日誌
```

#### ngrok 狀態檢查邏輯
```python
def get_ngrok_status():
    # 1. 嘗試連接 4040 API
    # 2. 檢查 tunnel 狀態
    # 3. 如果無法連接且之前為 running，啟動自動重啟
    # 4. 返回狀態：running|stopped|checking|error
```

#### 4040 API 錯誤處理
```python
def get_ngrok_requests():
    try:
        response = requests.get('http://localhost:4040/api/requests', timeout=3)
        # 處理正常回應
    except Exception:
        # 靜默處理錯誤，不輸出 DEBUG 訊息
        pass
    return {'requests': []}
```

#### 程式退出清理
```python
def cleanup_on_exit():
    # 1. 停止自動登出定時器
    # 2. 停止自動重啟定時器
    # 3. 終止 ngrok 進程（terminate + kill）
    # 4. 登出永豐 API
    # 5. 重置 LOGIN 狀態
```

### 交易日判斷架構（重要）

#### 源頭設計
- **唯一源頭**：`main.py` 中的 `is_trading_day_advanced()` 函數
- **設計原則**：避免重複實現，統一邏輯來源
- **調用方式**：所有交易日判斷都通過 API 調用此函數

#### 核心邏輯
```python
def is_trading_day_advanced(check_date=None):
    # 1. 週日檢查
    if check_date.weekday() == 6:  # 週日
        return False
    
    # 2. 假期檔案檢查
    # 支援民國年格式：holidaySchedule_114.csv
    # 備註欄位：'o'=交易日，其他=非交易日
    
    # 3. 預設為交易日
    return True
```

#### 調用鏈
```
web/main.js → /api/trading/status → main.py (源頭)
```

### 檔案結構
- `main.py` - Web服務器、ngrok 管理、交易日判斷源頭
- `TXserver.py` - 獨立交易服務器
- `web/main.js` - 前端邏輯，通過API調用後端
- `holiday/` - 假期檔案目錄（民國年格式）

## 開發規範

### ngrok 管理規範
- **嚴禁**手動啟動或停止 ngrok，必須通過程式自動管理
- **必須**處理 4040 API 錯誤，使用靜默處理避免頻繁錯誤日誌
- **統一**使用 `cleanup_on_exit()` 確保資源清理
- **自動重啟**邏輯必須包含延遲機制，避免頻繁重啟

### 交易日判斷
- **嚴禁**在其他地方重複實現交易日判斷邏輯
- **必須**通過 API 調用 `main.py` 的結果
- **統一**使用民國年假期檔案格式

### 錯誤處理規範
- **4040 API 錯誤**：使用 try-catch 靜默處理
- **進程管理錯誤**：使用 terminate() + kill() 確保清理
- **網路錯誤**：設置合理的 timeout 值
- **日誌記錄**：重要錯誤發送到前端系統日誌

## Debug 指南

### ngrok 問題排查
1. **檢查進程狀態**
   ```powershell
   Get-Process ngrok
   ```

2. **檢查 4040 API**
   ```powershell
   Invoke-RestMethod http://localhost:4040/api/tunnels
   ```

3. **檢查日誌**
   - 查看終端機輸出
   - 檢查前端系統日誌
   - 檢查 ngrok 進程狀態

4. **手動重啟測試**
   ```python
   # 在 main.py 中測試
   stop_ngrok()
   time.sleep(2)
   start_ngrok()
   ```

### 常見問題
- **ngrok 無法啟動**：檢查 ngrok.exe 是否存在，端口是否被占用
- **4040 API 錯誤**：這是已知的 ngrok bug，程式會自動處理
- **自動重啟循環**：檢查重啟定時器是否正確取消
- **進程殘留**：確保 `cleanup_on_exit()` 被正確調用

### 性能優化
- **狀態檢查頻率**：避免過於頻繁的 API 調用
- **錯誤處理**：靜默處理非關鍵錯誤，減少日誌噪音
- **資源管理**：及時清理定時器和進程

---

如需協作請先 fork 並發 PR，或聯絡原作者。 