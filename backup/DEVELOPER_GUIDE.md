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

### 永豐API初始化架構（v1.3.1更新）

#### 核心設計原則
- **安全初始化**：確保API對象完全創建後才設置callback
- **穩定性優先**：基本功能優先，callback功能其次
- **錯誤隔離**：callback設置失敗不影響核心交易功能
- **版本兼容**：適配不同版本shioaji的callback差異

#### API初始化流程（重要變更）
```python
def init_sinopac_api():
    """初始化永豐API對象（僅創建對象，不設置callback）"""
    try:
        if not SHIOAJI_AVAILABLE:
            return False
        
        sinopac_api = sj.Shioaji()
        print("永豐API對象創建成功")
        return True
    except Exception as e:
        print(f"初始化永豐API失敗: {e}")
        return False
```

#### 登入後設置callback（修正後流程）
```python
def login_sinopac():
    """登入永豐API並在成功後設置callback"""
    try:
        # 1. API登入
        sinopac_api.login(api_key=api_key, secret_key=secret_key)
        
        # 2. 暫時跳過callback設置，確保基本功能正常
        print("API登入成功，暫時跳過callback設置")
        
        # 3. 設置期貨帳戶
        accounts = [acc for acc in sinopac_api.list_accounts() 
                   if acc.account_type == 'F']
        if accounts:
            sinopac_api.futopt_account = accounts[0]
        
        # 4. 更新狀態
        sinopac_connected = True
        sinopac_login_status = True
        sinopac_login_time = datetime.now()
        
        return True
    except Exception as e:
        print(f"永豐API登入失敗: {e}")
        return False
```

#### 通知機制架構變更
```python
# v1.3.1之前：使用即時callback
@sinopac_api.on_order_callback
def order_callback(order_state):
    # 處理訂單狀態變化
    
# v1.3.1之後：使用主動查詢
def send_order_notification(order_info, is_manual=False):
    """主動查詢模式的通知機制"""
    try:
        # 1. 查詢訂單狀態
        order_status = get_order_status(order_info['order_id'])
        
        # 2. 根據狀態發送對應通知
        if order_status['status'] == 'failed':
            send_failure_notification()
        elif order_status['status'] == 'filled':
            send_success_and_trade_notification()
        else:
            send_submit_notification()
    except Exception as e:
        print(f"發送通知失敗: {e}")
```

#### 版本兼容性處理
```python
# 檢查shioaji版本
if hasattr(sj, '__version__'):
    version = sj.__version__
    if version >= '1.2.6':
        # 使用新版本的callback設置方式
        pass
    else:
        # 使用舊版本的兼容模式
        pass
```

### 端口配置架構

#### 核心設計原則
- **統一配置**：使用 `port.txt` 作為端口設置的唯一來源
- **自動管理**：首次啟動時自動創建配置文件
- **錯誤處理**：完善的端口讀取錯誤處理機制
- **靈活配置**：支援動態修改端口（重啟後生效）

#### 端口管理流程
```python
def get_port():
    # 1. 檢查 port.txt 是否存在
    if not os.path.exists('port.txt'):
        # 2. 不存在則創建，使用預設端口 5000
        with open('port.txt', 'w') as f:
            f.write('5000')
        return 5000
    
    try:
        # 3. 讀取配置的端口
        with open('port.txt', 'r') as f:
            port = int(f.read().strip())
        return port
    except:
        # 4. 讀取失敗使用預設值
        return 5000
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

### 合約資訊管理架構

#### 核心設計原則
- **即時更新**：支援一鍵重新整理合約資訊
- **統一介面**：與其他功能區域保持一致的視覺設計
- **錯誤處理**：完善的錯誤處理和載入狀態管理
- **按鈕交互**：統一的按鈕動畫和載入效果

#### 前端實現
```javascript
async function refreshContractInfo() {
    // 1. 更新按鈕狀態
    const btn = document.querySelector('.refresh-account-btn');
    btn.classList.add('loading');
    
    try {
        // 2. 調用合約資訊 API
        const response = await fetch('/api/futures/contracts');
        const data = await response.json();
        
        // 3. 更新合約資訊
        updateContractDisplay(data);
    } catch (error) {
        console.error('合約資訊更新失敗:', error);
    } finally {
        // 4. 恢復按鈕狀態
        btn.classList.remove('loading');
    }
}
```

#### 後端實現
```python
@app.route('/api/futures/contracts')
def get_futures_contracts():
    try:
        # 1. 獲取合約資訊
        contracts = {
            'TXF': get_contract_info('TXF'),
            'MXF': get_contract_info('MXF'),
            'TMF': get_contract_info('TMF')
        }
        
        # 2. 返回合約資訊
        return jsonify({
            'status': 'success',
            'data': contracts
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500
```

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

### 永豐API開發規範（v1.3.1新增）
- **初始化順序**：必須先創建API對象，再登入，最後設置callback
- **錯誤隔離**：callback設置失敗不能影響基本交易功能
- **版本兼容**：檢查shioaji版本，使用對應的API方法
- **通知機制**：優先使用主動查詢模式，確保通知功能可靠性
- **狀態管理**：正確管理`sinopac_connected`和`sinopac_login_status`
- **資源清理**：程式退出時正確登出API，避免連線殘留

### 錯誤處理規範
- **4040 API 錯誤**：使用 try-catch 靜默處理
- **進程管理錯誤**：使用 terminate() + kill() 確保清理
- **網路錯誤**：設置合理的 timeout 值
- **日誌記錄**：重要錯誤發送到前端系統日誌
- **API初始化錯誤**：記錄錯誤但不中斷程式運行

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