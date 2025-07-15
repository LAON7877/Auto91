# 開發者指南

## 最新重大更新 (v1.4.1 - 2025-07-15)

### 轉倉系統完整重構與代碼優化

#### 轉倉邏輯核心架構

**動態交割日計算**：
```python
def get_third_wednesday(year, month):
    """動態計算每月第三個星期三（台灣期貨交割日）"""
    first_day = datetime(year, month, 1)
    first_weekday = first_day.weekday()
    
    if first_weekday <= 2:
        first_wednesday = 3 - first_weekday
    else:
        first_wednesday = 10 - first_weekday
    
    third_wednesday = first_wednesday + 14
    return third_wednesday
```

**智能R2合約檢測**：
```python
def get_next_month_contracts():
    """優先尋找R2後綴合約，回退使用第二個合約"""
    for code in ['TXF', 'MXF', 'TMF']:
        contracts = sinopac_api.Contracts.Futures.get(code)
        sorted_contracts = sorted(contracts, key=get_sort_date)
        
        # 方法1: 尋找R2合約
        next_month_contract = None
        for contract in sorted_contracts:
            if contract.code.endswith('R2'):
                next_month_contract = contract
                break
        
        # 方法2: 如果沒有R2，使用第二個合約
        if not next_month_contract and len(sorted_contracts) >= 2:
            next_month_contract = sorted_contracts[1]
```

**統一合約選擇邏輯**：
```python
def get_contract_for_rollover(contract_type):
    """所有交易函數的統一合約選擇邏輯"""
    if not rollover_mode:
        # 非轉倉模式：使用當前合約 (R1)
        return current_contracts[contract_type]
    
    # 轉倉模式：使用次月合約 (R2)
    next_month_contract = next_month_contracts.get(contract_type)
    if next_month_contract:
        return next_month_contract
    else:
        # 回退機制：使用當前合約
        return current_contracts[contract_type]
```

#### 轉倉狀態管理系統

**轉倉模式觸發機制**：
```python
def check_rollover_mode():
    """檢查是否應該進入轉倉模式"""
    today = datetime.now().date()
    
    # 計算當前合約交割日
    delivery_date = 當月第三個星期三
    rollover_start = delivery_date - timedelta(days=1)  # 交割前一天
    
    if today >= rollover_start:
        if not rollover_mode:
            rollover_mode = True
            # 發送轉倉通知，獲取次月合約
            send_rollover_notification()
            get_next_month_contracts()
```

**統一函數更新範圍**：
- `place_futures_order`：下單函數
- `update_futures_contracts`：合約更新
- `api_futures_contracts`：前端API
- `process_entry_signal`：進場訊號處理
- `process_exit_signal`：出場訊號處理
- Webhook合約初始化邏輯

## 前一版本更新 (v1.4.0 - 2025-07-14)

### BTC加密貨幣交易系統重大整合

#### 雙系統架構開發

**核心架構設計**：
```python
# main.py - 統一入口點
from btcmain import *  # BTC系統模組

# 檢查BTC模組可用性
try:
    import btcmain
    BTC_MODULE_AVAILABLE = True
except ImportError:
    BTC_MODULE_AVAILABLE = False
    print("BTC模組不可用")

# 雙系統配置管理
def load_configurations():
    tx_config = load_env_file('config/tx.env')  # TX系統配置
    btc_config = load_env_file('config/btc.env')  # BTC系統配置
    return tx_config, btc_config
```

#### 統一Webhook路由系統

**多路徑路由設計**：
```python
@app.route('/webhook', methods=['POST'], defaults={'system': 'auto'})
@app.route('/webhook/<system>', methods=['POST'])
def unified_webhook(system):
    """統一webhook處理器，支持TX和BTC系統"""
    try:
        data = json.loads(request.data.decode('utf-8'))
        
        if system == 'btc':
            if BTC_MODULE_AVAILABLE:
                return btcmain.btc_webhook()
            else:
                return jsonify({'error': 'BTC模組不可用'}), 503
        elif system == 'tx':
            return tradingview_webhook_tx()
        elif system == 'auto':
            # 自動識別訊號類型
            if is_btc_signal(data):
                if BTC_MODULE_AVAILABLE:
                    return btcmain.btc_webhook()
                else:
                    return jsonify({'error': 'BTC模組不可用'}), 503
            else:
                return tradingview_webhook_tx()
        
        return jsonify({'error': '未知系統類型'}), 400
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def is_btc_signal(data):
    """識別是否為BTC訊號"""
    btc_indicators = ['symbol', 'action', 'position_size']
    tx_indicators = ['tradeId', 'contract', 'direction']
    
    btc_score = sum(1 for key in btc_indicators if key in data)
    tx_score = sum(1 for key in tx_indicators if key in data)
    
    return btc_score > tx_score
```

#### BTC系統API端點設計

**模組化API架構**：
```python
# BTC系統管理端點
@app.route('/api/btc/login', methods=['POST'])
def btc_login():
    if BTC_MODULE_AVAILABLE:
        return btcmain.login_btc_api()
    return jsonify({'error': 'BTC模組不可用'}), 503

@app.route('/api/btc/status', methods=['GET'])
def btc_status():
    if BTC_MODULE_AVAILABLE:
        return btcmain.get_btc_status()
    return jsonify({'status': 'unavailable', 'message': 'BTC模組不可用'})

@app.route('/api/btc/account/balance', methods=['GET'])
def btc_account_balance():
    if BTC_MODULE_AVAILABLE:
        return btcmain.get_account_balance()
    return jsonify({'error': 'BTC模組不可用'}), 503

@app.route('/api/btc/position', methods=['GET'])
def btc_position():
    if BTC_MODULE_AVAILABLE:
        return btcmain.get_position_info()
    return jsonify({'error': 'BTC模組不可用'}), 503
```

#### 分離的數據存儲系統

**TX和BTC數據分離**：
```python
# 數據存儲路徑設計
TX_DATA_DIR = 'TXtransdata'
BTC_DATA_DIR = 'BTCtransdata'

def get_data_directory(system='tx'):
    """獲取對應系統的數據目錄"""
    if system.lower() == 'btc':
        return BTC_DATA_DIR
    return TX_DATA_DIR

def save_trade_record(trade_data, system='tx'):
    """保存交易記錄到對應系統目錄"""
    data_dir = get_data_directory(system)
    os.makedirs(data_dir, exist_ok=True)
    
    today = datetime.now().strftime('%Y%m%d')
    prefix = 'BTC' if system.lower() == 'btc' else 'TX'
    filename = f'{prefix}trades_{today}.json'
    filepath = os.path.join(data_dir, filename)
    
    # 保存邏輯...
```

#### 前端三面板架構

**JavaScript模組化設計**：
```javascript
// 系統日誌分離管理
let systemLogs = [];     // TX系統日誌
let btcSystemLogs = [];  // BTC系統日誌
let requestsLog = [];    // TX請求日誌
let btcRequestsLog = []; // BTC請求日誌

// 統一日誌更新函數
function updateSystemLogs(system = 'tx') {
    const targetLogs = system === 'btc' ? btcSystemLogs : systemLogs;
    const logContainer = system === 'btc' ? 
        document.getElementById('btc-system-logs') : 
        document.getElementById('system-logs');
    
    fetch(`/api/system_log?system=${system}`)
        .then(response => response.json())
        .then(data => {
            if (data.logs) {
                targetLogs.length = 0;
                targetLogs.push(...data.logs);
                displayLogs(targetLogs, logContainer);
            }
        })
        .catch(error => console.error(`${system}系統日誌更新失敗:`, error));
}

// 分離的帳戶狀態管理
function updateAccountStatus(system = 'tx') {
    const endpoint = system === 'btc' ? '/api/btc/account/balance' : '/api/account/status';
    
    fetch(endpoint)
        .then(response => response.json())
        .then(data => {
            if (system === 'btc') {
                updateBTCAccountDisplay(data);
            } else {
                updateTXAccountDisplay(data);
            }
        })
        .catch(error => console.error(`${system}帳戶狀態更新失敗:`, error));
}
```

#### 配置管理系統

**分離的環境配置**：
```python
# config/tx.env - TX系統配置
API_KEY_TX=your_sinopac_api_key
SECRET_KEY_TX=your_sinopac_secret
PERSON_ID_TX=your_person_id
CERT_PATH_TX=path/to/cert.pfx
CERT_PASSWORD_TX=cert_password
BOT_TOKEN_TX=telegram_bot_token
CHAT_ID_TX=telegram_chat_id
LOGIN_TX=1

# config/btc.env - BTC系統配置
BOT_TOKEN_BTC=btc_telegram_bot_token
CHAT_ID_BTC=btc_telegram_chat_id
BINANCE_API_KEY=binance_api_key
BINANCE_SECRET_KEY=binance_secret_key
BINANCE_USER_ID=binance_user_id
TRADING_PAIR=BTCUSDT
LEVERAGE=5
CONTRACT_TYPE=PERPETUAL
LOGIN_BTC=1

def load_system_config(system='tx'):
    """載入指定系統配置"""
    config_file = f'config/{system.lower()}.env'
    if os.path.exists(config_file):
        return load_env_file(config_file)
    return {}
```

#### 代碼清理與優化

**移除ngrok遺留代碼**：
```python
# 清理前 - 錯誤的ngrok變數引用
# ngrok_url = "error"  # 已移除
# ngrok_tunnel_info = get_tunnel_info()  # 已修正

# 清理後 - 正確的Cloudflare Tunnel實現
def get_tunnel_info():
    """獲取隧道信息"""
    try:
        if tunnel_manager and tunnel_manager.is_running():
            return {
                'url': tunnel_manager.get_tunnel_url(),
                'status': 'running',
                'type': 'cloudflare'
            }
    except Exception as e:
        print(f"獲取隧道信息失敗: {e}")
    
    return {'status': 'stopped', 'type': 'unknown'}
```

**統一import管理**：
```python
# btcmain.py - 清理後的imports
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timedelta
from binance.client import Client
from binance.exceptions import BinanceAPIException

# 移除重複和無用的imports
# import json  # 重複 - 已移除
# import requests  # 未使用 - 已移除
```

#### 開發規範與最佳實踐

**雙系統開發規範**：
1. **模組隔離**：TX和BTC系統功能完全獨立，避免相互依賴
2. **配置分離**：使用獨立的.env文件管理各系統配置
3. **數據分離**：使用不同目錄和文件前綴管理交易數據
4. **日誌分離**：前端和後端日誌都按系統分類
5. **錯誤隔離**：單一系統故障不影響另一系統運行

**API設計原則**：
1. **統一前綴**：BTC系統API統一使用 `/api/btc/` 前綴
2. **狀態一致**：兩個系統返回相似格式的狀態信息
3. **錯誤處理**：統一的錯誤返回格式
4. **可用性檢查**：所有BTC API都檢查模組可用性

**Webhook路由原則**：
1. **自動識別**：支援自動識別訊號類型
2. **明確路由**：支援明確指定系統路由
3. **向後兼容**：保持對舊版本URL的支援
4. **錯誤回退**：識別失敗時使用預設處理

---

## 歷史更新 (v1.3.11 - 2025-07-12)

### 隧道服務架構重構

#### 模組重命名與簡化
```python
# 舊導入方式
from cloudflare_tunnel import CloudflareTunnel

# 新導入方式 
from tunnel import CloudflareTunnel
```

#### Cloudflare Tunnel 域名模式更新
```python
class CloudflareTunnel:
    def __init__(self, port=5000, mode="temporary"):
        self.mode = mode  # custom, temporary (移除 workers 模式)
```

**域名模式說明：**
- **temporary**: 臨時域名 (*.trycloudflare.com) - 完全免費，推薦使用
- **custom**: 自訂域名 - 需要擁有域名和 Cloudflare 設定

#### 新增時間戳格式化函數
```python
def format_timestamp(timestamp_str):
    """格式化時間戳為顯示用格式"""
    if not timestamp_str:
        return ''
    
    try:
        # 嘗試解析 ISO 格式的時間戳
        if 'T' in timestamp_str:
            dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        else:
            # 如果不是 ISO 格式，嘗試其他常見格式
            dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
        
        # 轉換為本地時間並格式化
        local_dt = dt.replace(tzinfo=timezone.utc).astimezone()
        return local_dt.strftime('%H:%M:%S')
    except:
        # 如果解析失敗，返回原始字符串的最後8個字符
        return timestamp_str[-8:] if len(timestamp_str) >= 8 else timestamp_str
```

### 前端界面優化

#### CSS 狀態對齊修正
```css
/* 確保所有狀態文字靠下對齊 */
#ngrok-status,
#sinopac-api-status,
#tunnel-status {
    display: flex !important;
    align-items: flex-end !important;
    line-height: 1 !important;
    min-height: 24px;
}

/* 請求數量顯示樣式統一 */
.requests-count {
    color: #495057;
    font-size: 0.9rem;
    font-weight: 500;
    font-family: 'Courier New', monospace;
    background: #e9ecef;
    padding: 2px 6px;
    border-radius: 3px;
    min-width: 40px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
}
```

#### JavaScript 日誌記錄優化
```javascript
// 移除初啟動時的版本日誌記錄
function getSinopacVersion() {
    fetch('/api/sinopac/version')
    .then(res => res.json())
    .then(data => {
        const versionElement = document.getElementById('sinopac-version');
        
        if (data.available && data.version && data.version !== 'unknown') {
            versionElement.textContent = `sj${data.version}`;
            // 移除初啟動時的版本日誌記錄，只有更新檢查時才記錄
        }
        // ... 其他邏輯
    });
}

// 請求數量顯示優化
function updateRequestsLog() {
    // ... 獲取數據邏輯
    if (requestsCount) {
        requestsCount.textContent = `${webhookRequests.length}`; // 移除「筆」字
    }
}
```

### 系統日誌與報表生成改進

#### 報表生成日誌記錄
```python
def generate_trading_report(...):
    # 保存文件
    wb.save(filepath)
    
    # 添加xlsx生成成功的前端日誌
    try:
        requests.post(
            f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
            json={'message': f"交易日報 {filename} 生成成功！", 'type': 'success'},
            timeout=5
        )
    except:
        pass
    
    # 發送 TG 通知（不再記錄額外的前端日誌）
    send_telegram_message(message)
```

#### 交易統計排程
```python
# 確保週六夜盤統計正確執行
schedule.every().saturday.at("05:00").do(check_saturday_trading_statistics)

def check_saturday_trading_statistics():
    """週六夜盤統計（固定執行）"""
    try:
        send_daily_trading_statistics()
        print(f"已發送週六夜盤交易統計：{datetime.now().date()}")
    except Exception as e:
        print(f"檢查週六交易統計失敗: {e}")
```

### 開發注意事項

1. **模組導入**：使用新的 `tunnel` 模組名稱
2. **域名模式**：不再支援 workers.dev 免費域名
3. **日誌記錄**：避免重複的 TG 發送日誌
4. **狀態顯示**：確保所有狀態文字垂直對齊一致
5. **報表生成**：即使無交易記錄也會生成空白報表

---

## 歷史更新 (v1.3.10 - 2025-07-10)

### 日誌顯示邏輯修正與格式優化

#### 重大修正概述
修正了平倉時方向顯示錯誤的嚴重問題，並統一了所有價格顯示格式。

#### 修正內容詳述

1. **方向顯示邏輯修正**
```python
def get_simple_order_log_message(contract_name, direction, qty, price, order_id, octype, is_manual, is_success=False, order_type=None, price_type=None):
    """生成簡化的訂單日誌訊息（修正方向顯示邏輯和價格格式）"""
    # 格式化價格 - 移除 $ 符號
    if price == 0:
        price_display = '市價'
    else:
        price_display = f'{price:,.0f}'
    
    # 格式化方向 - 修正邏輯
    if str(octype).upper() == 'NEW':
        # 開倉：BUY=多單, SELL=空單
        if str(direction).upper() == 'BUY':
            direction_display = '多單'
        else:
            direction_display = '空單'
    elif str(octype).upper() == 'COVER':
        # 平倉：BUY=平空單, SELL=平多單
        if str(direction).upper() == 'BUY':
            direction_display = '空單'  # 平空單
        else:
            direction_display = '多單'  # 平多單
    else:
        # 備援邏輯
        if str(direction).upper() == 'BUY':
            direction_display = '多單'
        else:
            direction_display = '空單'
    
    # 生成訊息
    action_type = '手動' if is_manual else '自動'
    if str(octype).upper() == 'NEW':
        action = '開倉成功' if is_success else f'{action_type}開倉'
    else:
        action = '平倉成功' if is_success else f'{action_type}平倉'
    
    message = f"{action}：{contract_name}｜{direction_display}｜{qty} 口｜{price_display}｜{order_type_display} ({price_type_display})"
    
    return message
```

2. **價格格式統一**
```python
def format_price_display(price):
    """格式化價格顯示（移除 $ 符號）"""
    if price == 0:
        return '市價'
    else:
        return f'{price:,.0f}'

def format_margin_display(contract, margin):
    """格式化保證金顯示（移除 $ 符號）"""
    return f"{contract} {margin:,}"

def format_pnl_display(pnl):
    """格式化損益顯示（移除 ＄ 符號）"""
    sign = '+' if pnl >= 0 else ''
    return f"{sign}{pnl:,.0f} TWD"
```

3. **Webhook回調機制完善**
```python
@app.route('/webhook', methods=['POST'])
def tradingview_webhook():
    """TradingView Webhook 接收端點（包含完整回調流程）"""
    try:
        data = request.get_json()
        
        # 步驟1：記錄接收到的訊號
        signal_type = data.get('type', 'entry')
        direction = data.get('direction', '未知')
        
        if signal_type == 'entry':
            if direction == '開多':
                log_message = "來自 webhook開倉訊號：開多"
            elif direction == '開空':
                log_message = "來自 webhook開倉訊號：開空"
        elif signal_type == 'exit':
            if direction == '平多':
                log_message = "來自 webhook平倉訊號：平多"
            elif direction == '平空':
                log_message = "來自 webhook平倉訊號：平空"
        
        # 發送到前端系統日誌
        requests.post(
            f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
            json={'message': log_message, 'type': 'info'},
            timeout=5
        )
        
        # 步驟2：處理訊號
        process_signal(data)
        
        return 'OK', 200
        
    except Exception as e:
        error_message = f"Webhook 處理失敗：{str(e)}"
        requests.post(
            f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
            json={'message': error_message, 'type': 'error'},
            timeout=5
        )
        return 'Error', 500
```

#### 測試案例

1. **方向顯示測試**
```python
def test_direction_display_logic():
    """測試方向顯示邏輯的正確性"""
    test_cases = [
        # (octype, direction, expected_display)
        ('NEW', 'BUY', '多單'),      # 手動開多倉
        ('NEW', 'SELL', '空單'),     # 手動開空倉
        ('COVER', 'BUY', '空單'),    # 手動平空倉
        ('COVER', 'SELL', '多單'),   # 手動平多倉
    ]
    
    for octype, direction, expected in test_cases:
        result = get_direction_display(octype, direction)
        assert result == expected, f"測試失敗：{octype}+{direction} 期望 {expected}，實際 {result}"
        
    print("所有測試通過！")
```

2. **價格格式化測試**
```python
def test_price_formatting():
    """測試價格格式化的正確性"""
    test_cases = [
        (22000, "22,000"),
        (0, "市價"),
        (23150, "23,150"),
    ]
    
    for price, expected in test_cases:
        result = format_price_display(price)
        assert result == expected, f"價格格式化測試失敗：{price} 期望 {expected}，實際 {result}"
        
    print("價格格式化測試通過！")
```

#### 用戶體驗改進

1. **日誌準確性**：修正了困擾用戶的方向顯示錯誤問題
2. **格式一致性**：統一了所有價格和損益的顯示格式
3. **交易追蹤便利性**：正確的方向顯示讓用戶能準確追蹤交易歷史
4. **Webhook透明度**：完整的三步驟日誌讓用戶清楚了解webhook處理流程

---

## 版本歷史：v1.3.9 (2025-07-09)

### 交易月報功能實現

#### 功能概述
交易月報功能在每月最後一個交易日的日報生成後自動生成，提供當月完整的交易統計和分析。

#### 實現細節

1. **月末交易日判斷**
```python
def is_last_trading_day_of_month():
    """判斷今天是否為當月最後一個交易日"""
    try:
        today = datetime.now()
        last_day = today.replace(day=1) + timedelta(days=32)
        last_day = last_day.replace(day=1) - timedelta(days=1)
        
        # 從今天開始往後找，直到找到下一個交易日
        current_date = today
        while current_date <= last_day:
            # 檢查是否為交易日
            response = requests.get(
                f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status?date={current_date.strftime("%Y-%m-%d")}',
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                # 如果今天是交易日，且下一個交易日已經是下個月了，則今天是本月最後一個交易日
                if data.get('is_trading_day', False) and current_date == today:
                    return True
            current_date += timedelta(days=1)
        
        return False
        
    except Exception as e:
        print(f"檢查月末交易日失敗: {e}")
        return False
```

2. **月報生成流程**
```python
def generate_monthly_trading_report():
    """生成當月交易月報"""
    try:
        # 建立月報資料夾
        report_dir = os.path.join(os.path.dirname(__file__), 'monthly_reports')
        os.makedirs(report_dir, exist_ok=True)
        
        # 設定月報檔案名稱
        report_file = os.path.join(report_dir, f'{year}-{month}月交易報表.xlsx')
        
        # 建立工作簿和工作表
        wb = Workbook()
        ws = wb.active
        
        # 設定格式
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = 19
            
        # 生成四個區塊
        generate_overview_section(ws)  # 交易總覽
        generate_account_section(ws)   # 帳戶狀態
        generate_trades_section(ws)    # 交易明細
        generate_position_section(ws)  # 持倉狀態
        
        # 儲存並通知
        wb.save(report_file)
        send_notification(report_file)
        
        return True
        
    except Exception as e:
        print(f"生成月報失敗: {e}")
        return False
```

3. **延遲生成機制**
```python
def delayed_generate_reports():
    """延遲生成日報和月報"""
    try:
        # 先等待30秒後生成日報
        time.sleep(30)
        generate_daily_report()
        
        # 如果是月末最後交易日，再等30秒生成月報
        if is_last_trading_day_of_month():
            time.sleep(30)
            generate_monthly_trading_report()
            
    except Exception as e:
        print(f"延遲生成報表失敗: {e}")
```

#### 月報格式規範

1. **基本設定**
   - 所有欄寬固定為 19
   - 區塊標題使用藍色背景（B8CCE4）
   - 標題置中對齊

2. **區塊內容**
   - 交易總覽：當月統計數據
   - 帳戶狀態：當月帳戶變化
   - 交易明細：當月平倉記錄
   - 持倉狀態：月底持倉情況

3. **數字格式**
   - 整數使用千分位逗號
   - 百分比保留兩位小數
   - 金額顯示 TWD 單位

#### 注意事項

1. **生成時機**
   - 每月最後一個交易日
   - 日報生成後延遲30秒
   - 確保當月有交易記錄

2. **錯誤處理**
   - 檢查資料夾存在
   - 驗證數據完整性
   - 異常時提供錯誤日誌

3. **通知機制**
   - 前端系統日誌
   - Telegram 即時通知
   - 包含檔案路徑資訊

---

# 開發者指南

## 最新更新 (v1.3.8 - 2025-07-08)

### 交易統計格式優化與損益計算改善
新增完整的交易明細顯示和單筆損益計算功能：

```python
def analyze_simple_trading_stats(trades):
    """簡單分析交易統計（簡單配對開平倉，計算單筆損益）"""
    cover_trades = []
    total_cover_quantity = 0
    
    # 分別收集開倉和平倉交易
    open_trades = []
    close_trades = []
    
    for trade in trades:
        # 只處理成交記錄
        if trade.get('type') != 'deal':
            continue
            
        raw_data = trade.get('raw_data', {})
        order = raw_data.get('order', {})
        
        # 獲取基本資訊
        oc_type = order.get('oc_type', '')
        action = order.get('action', '')
        quantity = order.get('quantity', 0)
        price = order.get('price', 0)
        timestamp = trade.get('timestamp', '')
        
        # 分類開倉和平倉
        if oc_type == 'New':
            open_trades.append({
                'contract_code': contract_code,
                'contract_name': contract_name,
                'action': action,
                'quantity': quantity,
                'price': price,
                'timestamp': timestamp
            })
        elif oc_type == 'Cover':
            close_trades.append({
                'contract_code': contract_code,
                'contract_name': contract_name,
                'action': action,
                'quantity': quantity,
                'price': price,
                'timestamp': timestamp
            })
    
    # 簡單配對平倉交易，找對應的開倉價格
    for close_trade in close_trades:
        total_cover_quantity += close_trade['quantity']
        
        # 找對應的開倉交易（簡單配對：同合約、反向動作）
        required_open_action = 'Buy' if close_trade['action'] == 'Sell' else 'Sell'
        open_price = None
        
        # 從開倉交易中找最接近的價格（時間上最早的）
        for open_trade in open_trades:
            if (open_trade['contract_code'] == close_trade['contract_code'] and
                open_trade['action'] == required_open_action):
                open_price = open_trade['price']
                break  # 使用第一個找到的開倉價格
        
        # 計算單筆損益（如果找到開倉價格）
        pnl = 0
        if open_price is not None:
            point_value = get_contract_point_value(close_trade['contract_code'])
            if close_trade['action'] == 'Sell':  # 平多倉
                pnl = (close_trade['price'] - open_price) * close_trade['quantity'] * point_value
            else:  # 平空倉
                pnl = (open_price - close_trade['price']) * close_trade['quantity'] * point_value
        
        action_display = '多單' if close_trade['action'] == 'Sell' else '空單'
        
        cover_trades.append({
            'contract_name': close_trade['contract_name'],
            'action': action_display,
            'quantity': f"{close_trade['quantity']}口",
            'open_price': f"{int(open_price):,}" if open_price is not None else "未知",
            'cover_price': f"{int(close_trade['price']):,}",
            'pnl': int(pnl),
            'timestamp': close_trade['timestamp']
        })
    
    return cover_trades, total_cover_quantity
```

### 點值系統
正確設定各合約點值：

```python
def get_contract_point_value(contract_code):
    """獲取合約點值"""
    if 'TXF' in contract_code:
        return 200  # 大台每點200元
    elif 'MXF' in contract_code:
        return 50   # 小台每點50元
    elif 'TMF' in contract_code:
        return 10   # 微台每點10元
    else:
        return 200  # 預設值
```

### 數字格式化改善
修復數字格式化問題，去除不必要的 `.0` 後綴：

```python
def format_number_for_notification(value):
    """格式化數字用於通知（去除.0後綴）"""
    if value is None:
        return "0"
    
    # 轉換為數字
    try:
        num = float(value)
    except (ValueError, TypeError):
        return "0"
    
    # 如果是整數，去除小數點
    if num == int(num):
        return f"{int(num):,}"
    else:
        return f"{num:,.2f}"
```

### 日誌時間戳格式改善
改善日誌時間戳格式，支援新舊格式：

```python
def parse_time(timestamp):
    """解析時間戳，支援新舊格式"""
    try:
        # 嘗試解析新格式：YYYY-MM-DD HH:MM:SS.mmm CST
        if len(timestamp) >= 23 and timestamp[10] == ' ':
            return datetime.strptime(timestamp[:23], '%Y-%m-%d %H:%M:%S.%f')
        else:
            # 舊格式：HH:MM:SS.mmm CST
            time_part = timestamp.split(' CST')[0]
            return datetime.strptime(time_part, '%H:%M:%S.%f')
    except:
        return datetime.now()
```

### port.txt 預設值修正
修正 port.txt 預設值為背景執行模式：

```python
def get_port():
    """從根目錄的 port.txt 檔案讀取端口設置，若無則自動建立"""
    try:
        # 獲取根目錄路徑（server 資料夾的上一層）
        root_dir = os.path.dirname(os.path.dirname(__file__))
        port_file = os.path.join(root_dir, 'port.txt')
        
        if not os.path.exists(port_file):
            # 自動建立預設 port.txt
            with open(port_file, 'w', encoding='utf-8') as f:
                f.write('port:5000\nlog_console:0\n')  # 預設背景執行
            return 5000, 0
        
        with open(port_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            port = 5000
            log_console = 0  # 預設背景執行
            
            for line in lines:
                line = line.strip()
                if line.startswith('port:'):
                    try:
                        port_str = line.split(':')[1].strip()
                        port = int(port_str)
                        if not (1024 <= port <= 65535):
                            port = 5000
                    except ValueError:
                        port = 5000
                elif line.startswith('log_console:'):
                    try:
                        log_str = line.split(':')[1].strip()
                        log_console = int(log_str)
                        if log_console not in [0, 1]:
                            log_console = 0  # 預設背景執行
                    except ValueError:
                        log_console = 0  # 預設背景執行
            
            return port, log_console
    except Exception as e:
        print(f"讀取設置失敗: {e}，使用預設設置")
        return 5000, 0  # 預設背景執行
```

## 最新更新 (v1.3.7 - 2025-07-07)

### 後端日誌顯示開關功能
新增 `log_console` 設定，控制後端程式是否在背景執行：

```python
def get_port():
    """從根目錄的 port.txt 檔案讀取端口設置，若無則自動建立"""
    try:
        # 獲取根目錄路徑（server 資料夾的上一層）
        root_dir = os.path.dirname(os.path.dirname(__file__))
        port_file = os.path.join(root_dir, 'port.txt')
        
        if not os.path.exists(port_file):
            # 自動建立預設 port.txt
            with open(port_file, 'w', encoding='utf-8') as f:
                f.write('port:5000\nlog_console:1\n')
            return 5000, 1
        
        with open(port_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            port = 5000
            log_console = 1
            
            for line in lines:
                line = line.strip()
                if line.startswith('port:'):
                    try:
                        port_str = line.split(':')[1].strip()
                        port = int(port_str)
                        if not (1024 <= port <= 65535):
                            port = 5000
                    except ValueError:
                        port = 5000
                elif line.startswith('log_console:'):
                    try:
                        log_str = line.split(':')[1].strip()
                        log_console = int(log_str)
                        if log_console not in [0, 1]:
                            log_console = 1
                    except ValueError:
                        log_console = 1
            
            return port, log_console
    except Exception as e:
        print(f"讀取設置失敗: {e}，使用預設設置")
        return 5000, 1
```

### 視窗隱藏機制
使用 Windows API 隱藏命令行視窗：

```python
def start_webview():
    # 根據 log_console 設定決定是否隱藏命令行視窗
    if LOG_CONSOLE == 0:
        # 隱藏命令行視窗（背景執行）
        import ctypes
        try:
            # 獲取當前進程的句柄
            hwnd = ctypes.windll.kernel32.GetConsoleWindow()
            if hwnd:
                # 隱藏命令行視窗
                ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE = 0
                print("已隱藏命令行視窗，程式在背景執行")
        except Exception as e:
            print(f"隱藏命令行視窗失敗: {e}")
```

### 程式完全退出機制
確保關閉前端視窗時程式完全退出：

```python
def on_window_closing():
    print("視窗關閉中，正在清理資源...")
    cleanup_on_exit()
    # 確保程式完全退出
    os._exit(0)
    return True  # 允許關閉
```

### 設定檔案格式
`port.txt` 現在支援兩個參數：

```txt
port:5000
log_console:1
```

- `port`: 系統端口號（1024-65535）
- `log_console`: 日誌顯示模式（0=背景執行，1=正常顯示）

## 最新更新 (v1.3.6 - 2025-07-06)
- 轉倉/保證金前端日誌、日誌格式優化、顏色說明、細節修正。

## 最新更新 (v1.3.5 - 2025-07-05)

### 交易記錄持久化系統
新增完整的交易記錄 JSON 儲存機制，確保所有交易參數完整保存：

```python
def save_trade(data):
    """保存交易記錄到 JSON 檔案"""
    today = datetime.now().strftime('%Y%m%d')
    transdata_dir = os.path.join(os.path.dirname(__file__), 'transdata')
    os.makedirs(transdata_dir, exist_ok=True)
    
    filename = os.path.join(transdata_dir, f'trades_{today}.json')
    
    # 讀取現有記錄
    existing_trades = []
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                existing_trades = json.load(f)
        except:
            existing_trades = []
    
    # 添加新記錄
    existing_trades.append(data)
    
    # 保存到檔案
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(existing_trades, f, ensure_ascii=False, indent=2)
```

### 自動清理機制
新增自動清理舊交易記錄的功能：

```python
def cleanup_old_trade_files():
    """清理超過 30 天的舊交易記錄檔案"""
    transdata_dir = os.path.join(os.path.dirname(__file__), 'transdata')
    if not os.path.exists(transdata_dir):
        return
    
    current_date = datetime.now()
    cutoff_date = current_date - timedelta(days=30)
    
    for filename in os.listdir(transdata_dir):
        if filename.startswith('trades_') and filename.endswith('.json'):
            try:
                # 從檔案名提取日期
                date_str = filename[7:15]  # trades_YYYYMMDD.json
                file_date = datetime.strptime(date_str, '%Y%m%d')
                
                if file_date < cutoff_date:
                    file_path = os.path.join(transdata_dir, filename)
                    os.remove(file_path)
                    print(f"已刪除舊交易記錄檔案: {filename}")
            except:
                continue
```

### 動作顯示統一函數
新增 `get_action_display_by_rule()` 函數，統一動作顯示邏輯：

```python
def get_action_display_by_rule(octype, direction):
    """根據開平倉類型和方向判斷動作顯示（與TXserver.py的get_formatted_order_message內部邏輯一致）"""
    # 統一轉換為大寫進行比較
    octype_upper = str(octype).upper()
    direction_upper = str(direction).upper()
    
    if octype_upper == 'NEW':  # 開倉
        if direction_upper == 'BUY':
            return '多單買入'
        else:  # SELL
            return '空單買入'
    else:  # 平倉 (COVER)
        if direction_upper == 'BUY':
            return '空單賣出'
        else:  # SELL
            return '多單賣出'
```

### 訂單回調推斷邏輯優化
改進 `order_callback()` 函數，當訂單映射缺失時智能推斷交易類型：

```python
def order_callback(state, deal, order=None):
    """訂單回調函數處理（參考TXserver.py架構）"""
    # 從映射中獲取訂單詳細資訊
    octype_info = order_octype_map.get(order_id)
    if octype_info is None:
        # 如果找不到映射資訊，嘗試從回調資料推斷
        try:
            # 獲取持倉資訊來判斷是否為平倉
            positions = sinopac_api.list_positions(sinopac_api.futopt_account)
            contract_positions = [p for p in positions if p.code == contract_code]
            
            # 如果有持倉且訂單方向與持倉方向相反，則為平倉
            has_opposite_position = any(
                (p.direction != action and p.quantity != 0) for p in contract_positions
            )
            
            inferred_octype = 'Cover' if has_opposite_position else 'New'
            inferred_manual = True  # 推斷為手動操作
            
            # 嘗試從 JSON 檔案讀取完整參數
            try:
                today = datetime.now().strftime('%Y%m%d')
                transdata_dir = os.path.join(os.path.dirname(__file__), 'transdata')
                filename = os.path.join(transdata_dir, f'trades_{today}.json')
                
                if os.path.exists(filename):
                    with open(filename, 'r', encoding='utf-8') as f:
                        trades = json.load(f)
                    
                    # 尋找匹配的交易記錄
                    for trade in trades:
                        if trade.get('order_number') == order_id:
                            octype = trade.get('position', inferred_octype)
                            action = trade.get('action', action)
                            is_manual = trade.get('submission_type') == 'manual'
                            break
            except:
                pass
        except:
            inferred_octype = 'New'
            inferred_manual = True
```

### 交易記錄結構
完整的交易記錄包含所有必要參數：

```json
{
  "exchange_sequence": "序號",
  "order_number": "訂單號",
  "contract": "合約代碼",
  "order_type": "訂單類型",
  "submission_number": "提交編號",
  "submission_type": "提交類型(manual/auto)",
  "action": "動作(Buy/Sell)",
  "position": "持倉類型(New/Cover)",
  "quantity": "數量",
  "price": "價格",
  "timestamp": "時間戳"
}
```

### 通知一致性修復
確保提交成功和成交通知使用相同的參數來源：

```python
def get_formatted_trade_message(order_id, contract_name, qty, price, octype, direction, order_type, price_type, is_manual, contract_code=None, delivery_date=None):
    """格式化成交訊息（參考TXserver.py）"""
    current_time = datetime.now().strftime('%Y/%m/%d')
    
    # 使用統一的動作顯示函數
    action_display = get_action_display_by_rule(octype, direction)
    
    # 根據octype判斷開平倉
    if str(octype).upper() == 'NEW':
        octype_display = "開倉"
    elif str(octype).upper() == 'COVER':
        octype_display = "平倉"
    else:
        octype_display = f"未知({octype})"
    
    # 提交類型
    manual_type = "手動" if is_manual else "自動"
    trade_type = f"{manual_type}{octype_display}"
    
    # 格式化訊息
    message = f"📊 成交通知\n"
    message += f"⏰ {current_time}\n"
    message += f"📋 訂單編號: {order_id}\n"
    message += f"📈 合約: {contract_name}\n"
    message += f"🔢 數量: {qty}\n"
    message += f"💰 價格: {price}\n"
    message += f"🎯 動作: {action_display}\n"
    message += f"📝 類型: {trade_type}\n"
    message += f"📋 訂單類型: {order_type}\n"
    message += f"💱 價格類型: {price_type}"
    
    return message
```

## 最新更新 (v1.3.4 - 2025-07-04)

### 永豐手動下單參數格式標準化
重大架構變更：手動下單改為使用永豐官方參數格式，與 WEBHOOK 下單明確分離：

```python
def place_futures_order(contract_code, quantity, direction, price=0, is_manual=False, 
                       position_type=None, price_type=None, order_type=None, 
                       action_param=None, octype_param=None):
    """執行期貨下單 - 支援永豐官方參數格式"""
    
    # 永豐手動下單：使用永豐官方參數格式
    if is_manual:
        if action_param and octype_param:
            # 使用永豐官方參數
            final_action = safe_constants.get_action(action_param)
            final_octype = safe_constants.get_oc_type(octype_param)
        else:
            # 如果沒有官方參數，顯示未知
            raise Exception('永豐手動下單缺少官方參數 action 和 octype')
    
    # WEBHOOK下單：使用 direction 參數
    else:
        if direction == "開多":
            final_action = safe_constants.get_action('BUY')
            final_octype = safe_constants.get_oc_type('New')
        elif direction == "開空":
            final_action = safe_constants.get_action('SELL')
            final_octype = safe_constants.get_oc_type('New')
        # ... 其他方向處理
```

### 動作對應邏輯標準化
統一動作對應邏輯，確保通知訊息準確性：

```python
# 永豐官方參數對應
New Buy = 多單買入
New Sell = 空單買入
Cover Sell = 多單賣出
Cover Buy = 空單賣出

# WEBHOOK 動作對應
開多 = 多單買入
開空 = 空單買入
平多 = 多單賣出
平空 = 空單賣出
```

### 手動下單API參數要求
手動下單必須提供永豐官方參數：

```python
@app.route('/api/manual/order', methods=['POST'])
def manual_order():
    # 解析下單參數
    action_param = data.get('action', None)  # Buy或Sell（永豐官方參數）
    octype_param = data.get('octype', None)  # New或Cover（永豐官方參數）
    
    # 驗證必要欄位
    if not action_param or not octype_param:
        return jsonify({
            'status': 'error',
            'message': '永豐手動下單需要提供 action (Buy/Sell) 和 octype (New/Cover) 參數'
        }), 400
```

### 消息格式化優化
移除預設為開倉的邏輯，確保開平倉類型準確判斷：

```python
def get_formatted_order_message(...):
    # 根據octype判斷開平倉
    if str(octype).upper() == 'NEW':
        octype_display = "開倉"
    elif str(octype).upper() == 'COVER':
        octype_display = "平倉"
    else:
        octype_display = f"未知({octype})"  # 不預設為開倉，顯示實際值
    
    # 提交類型
    manual_type = "手動" if is_manual else "自動"
    submit_type = f"{manual_type}{octype_display}"
```

### 統一失敗通知格式系統
新增 `send_unified_failure_message()` 函數，統一處理所有訂單提交失敗的通知格式：

```python
def send_unified_failure_message(data, reason, order_id="未知"):
    """發送統一的提交失敗訊息"""
    # 解析訊號數據
    qty_txf = int(float(data.get('txf', 0)))
    qty_mxf = int(float(data.get('mxf', 0)))
    qty_tmf = int(float(data.get('tmf', 0)))
    
    # 對每個有數量的合約發送失敗訊息
    for contract, qty, name, code in contracts:
        if qty > 0:
            fail_message = get_formatted_order_message(
                is_success=False,
                order_id=order_id,
                contract_name=name,
                qty=qty,
                price=price,
                octype=octype,
                direction=str(expected_action),
                order_type="IOC",
                price_type="MKT",
                is_manual=False,
                reason=reason,
                contract_code=contract_code,
                delivery_date=delivery_date_str
            )
            send_telegram_message(fail_message)
```

### 錯誤訊息翻譯系統
新增 `OP_MSG_TRANSLATIONS` 對照表，提供友善的中文錯誤訊息：

```python
OP_MSG_TRANSLATIONS = {
    "Order not found": "訂單未找到",
    "Price not satisfied": "價格未滿足",
    "Insufficient margin": "保證金不足",
    "Market closed": "市場已關閉",
    "非該商品可下單時間": "非交易時間",
    "可委託金額不足": "保證金不足",
    "Order Cancelled": "手動取消訂單",
    "cancelled": "手動取消訂單",
    # ... 更多翻譯
}
```

### 訂單回調函數增強
改進 `order_callback()` 函數，智能推斷開平倉和手動/自動狀態：

```python
def order_callback(state, deal, order=None):
    """訂單回調函數處理（參考TXserver.py架構）"""
    # 從映射中獲取訂單詳細資訊
    octype_info = order_octype_map.get(order_id)
    if octype_info is None:
        # 如果找不到映射資訊，嘗試從回調資料推斷
        try:
            # 獲取持倉資訊來判斷是否為平倉
            positions = sinopac_api.list_positions(sinopac_api.futopt_account)
            contract_positions = [p for p in positions if p.code == contract_code]
            
            # 如果有持倉且訂單方向與持倉方向相反，則為平倉
            has_opposite_position = any(
                (p.direction != action and p.quantity != 0) for p in contract_positions
            )
            
            inferred_octype = 'Cover' if has_opposite_position else 'New'
            inferred_manual = True  # 推斷為手動操作
        except:
            inferred_octype = 'New'
            inferred_manual = True
```

### 合約代碼顯示修復
修復多個通知函數中合約代碼和交割日期的檢索邏輯：

```python
# 獲取交割日期用於失敗通知
delivery_date_for_fail = None
try:
    if contract_code:
        # 從全域合約對象獲取交割日期
        target_contract = None
        if contract_code.startswith('TXF') and contract_txf and contract_txf.code == contract_code:
            target_contract = contract_txf
        elif contract_code.startswith('MXF') and contract_mxf and contract_mxf.code == contract_code:
            target_contract = contract_mxf
        elif contract_code.startswith('TMF') and contract_tmf and contract_tmf.code == contract_code:
            target_contract = contract_tmf
        
        if target_contract and hasattr(target_contract, 'delivery_date'):
            if hasattr(target_contract.delivery_date, 'strftime'):
                delivery_date_for_fail = target_contract.delivery_date.strftime('%Y/%m/%d')
            else:
                delivery_date_for_fail = str(target_contract.delivery_date)
except:
    pass
```

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