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

#### 通知機制架構變更（v1.3.2重大重構）

##### v1.3.1之前：使用即時callback（已廢棄）
```python
@sinopac_api.on_order_callback
def order_callback(order_state):
    # 處理訂單狀態變化（因為API版本問題廢棄）
```

##### v1.3.1：使用主動查詢（已廢棄）
```python
def send_order_notification(order_info, is_manual=False):
    """主動查詢模式的通知機制（已廢棄）"""
    try:
        order_status = get_order_status(order_info['order_id'])
        # 根據狀態發送對應通知
    except Exception as e:
        print(f"發送通知失敗: {e}")
```

##### v1.3.2：回調事件處理機制（當前架構）
參考TXserver.py的完善架構重構main.py：

```python
# 訂單映射管理
order_octype_map = {}  # 記錄訂單詳細資訊
global_lock = threading.Lock()  # 線程鎖

def order_callback(state, deal, order=None):
    """統一的回調事件處理函數"""
    try:
        if state == OrderState.FuturesDeal:
            # 處理成交回調
            handle_futures_deal_callback(state, deal)
        elif state in [OrderState.Submitted, OrderState.FuturesOrder]:
            # 處理訂單提交回調
            if order:
                send_formatted_order_notification(order)
    except Exception as e:
        print(f"回調處理錯誤: {e}")

def handle_futures_deal_callback(state, deal):
    """處理期貨成交回調"""
    with global_lock:
        seqno = deal.seqno
        if seqno in order_octype_map:
            order_info = order_octype_map[seqno]
            # 發送成交通知
            message = get_formatted_trade_message(deal, order_info)
            send_telegram_message(message)

def place_futures_order(action, quantity, price_type):
    """下單並建立訂單映射"""
    try:
        # 下單
        order = api.place_order(contract, order_obj)
        
        # 立即建立訂單映射（關鍵步驟）
        with global_lock:
            order_octype_map[order.order.seqno] = {
                'action': action_text,
                'quantity': quantity,
                'contract_code': contract.code,
                'timestamp': datetime.now().strftime('%H:%M:%S')
            }
    except Exception as e:
        print(f"下單失敗: {e}")
```

##### v1.3.3：開平倉類型處理機制（最新架構）
```python
def get_oc_type(oc_type='Auto'):
    """根據交易方向判斷開平倉類型"""
    if oc_type == 'Auto':
        # 根據交易方向自動判斷
        if direction in ['開多', '開空']:
            return 'New'
        elif direction in ['平多', '平空']:
            return 'Cover'
    return oc_type

def place_futures_order(action, quantity, price_type):
    """下單時的開平倉類型處理"""
    try:
        # 判斷開平倉類型
        oc_type = get_oc_type('Auto')
        
        # 建立訂單
        order_obj = api.Order(
            action=action,
            quantity=quantity,
            price=price,
            price_type=price_type,
            octype=oc_type
        )
        
        # 下單並建立映射
        order = api.place_order(contract, order_obj)
        with global_lock:
            order_octype_map[order.order.seqno] = {
                'action': action_text,
                'quantity': quantity,
                'contract_code': contract.code,
                'octype': oc_type,  # 記錄開平倉類型
                'timestamp': datetime.now().strftime('%H:%M:%S')
            }
            
        # 發送通知
        message = get_formatted_order_message(order, oc_type)
        send_telegram_message(message)
        
    except Exception as e:
        error_msg = get_error_message(e)
        send_error_notification(error_msg, oc_type)

def get_formatted_order_message(order, oc_type):
    """格式化訂單通知訊息"""
    return f"""
⭕ 提交成功（{datetime.now().strftime('%Y/%m/%d')}）
選用合約：{contract.code} ({contract.delivery_date})
訂單類型：限價單（ROD）
提交單號：{order.order.seqno}
提交類型：{oc_type}
提交動作：{action_text}
提交部位：{position_type}
提交數量：{quantity} 口
提交價格：{price}
"""
```

#### 開平倉處理的架構優勢
- **自動判斷**：根據交易方向自動決定開平倉類型
- **一致性**：統一的開平倉類型處理邏輯
- **可追蹤**：在訂單映射中記錄開平倉類型
- **錯誤處理**：完整的錯誤處理和通知機制
- **通知準確**：確保通知中顯示正確的開平倉類型

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