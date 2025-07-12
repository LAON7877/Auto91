# API 參考文檔

## 最新更新 (v1.3.11 - 2025-07-12)

### 隧道服務重構與界面優化
- 重命名 `cloudflare_tunnel.py` → `tunnel.py`，簡化模組命名
- 修正 Cloudflare Tunnel 域名選項說明，移除已停用的 workers.dev 免費域名
- 突出臨時域名 (*.trycloudflare.com) 作為推薦免費選項
- 修復 `format_timestamp` 函數未定義錯誤
- 優化請求日誌數量顯示，移除「筆」字只顯示純數字
- 修正所有狀態文字的垂直對齊問題 (online/offline/checking)

### 系統日誌優化
- 移除初啟動時的永豐版本日誌記錄，避免重複顯示
- 增加 xlsx 文件生成成功的前端日誌記錄
- 簡化報表生成的日誌記錄流程，避免重複的 TG 發送日誌

### 交易報表生成改進
- 確保即使無交易記錄也會生成空白報表（非交易日除外）
- 週六夜盤交易統計正確執行（週六視為交易日至凌晨05:00）
- 優化報表生成的日誌記錄順序和內容

---

## 歷史更新 (v1.3.10 - 2025-07-10)

### 日誌顯示邏輯修正與格式優化 API

#### 修正後的日誌訊息生成 API
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
    
    # 格式化訂單類型和價格類型
    order_type_display = order_type if order_type else '限價'
    price_type_display = price_type if price_type else 'ROD'
    
    message = f"{action}：{contract_name}｜{direction_display}｜{qty} 口｜{price_display}｜{order_type_display} ({price_type_display})"
    
    return message
```

#### 方向顯示邏輯對照表
```python
# 修正後的邏輯對照表
DIRECTION_LOGIC_MAP = {
    ('NEW', 'BUY'): '多單',    # 開多倉
    ('NEW', 'SELL'): '空單',   # 開空倉
    ('COVER', 'BUY'): '空單',  # 平空倉（買入平倉）
    ('COVER', 'SELL'): '多單', # 平多倉（賣出平倉）
}

def get_direction_display(octype, direction):
    """根據開平倉類型和買賣方向獲取正確的方向顯示"""
    key = (str(octype).upper(), str(direction).upper())
    return DIRECTION_LOGIC_MAP.get(key, '多單' if direction.upper() == 'BUY' else '空單')
```

#### 價格格式化 API 更新
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

#### Webhook 回調流程 API
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

#### 統計報表格式更新 API
```python
def generate_trading_report_v1310(trades, account_data, position_data):
    """生成交易報表（v1.3.10 格式更新）"""
    # 交易總覽區塊
    total_pnl_txf = calculate_pnl('TXF', trades)
    total_pnl_mxf = calculate_pnl('MXF', trades)
    total_pnl_tmf = calculate_pnl('TMF', trades)
    
    # 格式化損益（移除 ＄ 符號）
    ws['E3'] = f"{format_pnl_display(total_pnl_txf)}"
    ws['F3'] = f"{format_pnl_display(total_pnl_mxf)}"
    ws['G3'] = f"{format_pnl_display(total_pnl_tmf)}"
    
    # 保證金更新格式
    margin_log_message = "保證金已更新！"
    for contract, margin in margin_data.items():
        margin_log_message += f" {format_margin_display(contract, margin)}"
    
    return report_file
```

#### API 端點更新

##### 系統日誌 API（格式更新）
```
POST /api/system_log

Request Body:
{
    "message": "手動平倉：大台｜空單｜1 口｜22,000｜限價 (ROD)",
    "type": "success"
}

Response:
{
    "status": "success",
    "message": "日誌已記錄"
}
```

#### 測試用例 API
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

---

## 版本歷史：v1.3.9 (2025-07-09)

### 交易月報功能 API

#### 月末交易日判斷 API
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
            response = requests.get(
                f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status?date={current_date.strftime("%Y-%m-%d")}',
                timeout=5
            )
            if response.status_code == 200:
                data = response.json()
                # 如果今天是交易日，且下一個交易日已經是下個月了，則今天是本月最後一個交易日
                if data.get('is_trading_day', False) and current_date == today:
                    next_date = current_date + timedelta(days=1)
                    while next_date <= last_day:
                        next_response = requests.get(
                            f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status?date={next_date.strftime("%Y-%m-%d")}',
                            timeout=5
                        )
                        if next_response.status_code == 200:
                            if next_response.json().get('is_trading_day', False):
                                return False
                        next_date += timedelta(days=1)
                    return True
            current_date += timedelta(days=1)
        
        return False
        
    except Exception as e:
        print(f"檢查月末交易日失敗: {e}")
        return False
```

#### 月報生成 API
```python
def generate_monthly_trading_report():
    """生成當月交易月報"""
    try:
        # 獲取當月日期範圍
        today = datetime.now()
        year = today.year
        month = today.month
        
        # 建立月報資料夾
        report_dir = os.path.join(os.path.dirname(__file__), 'monthly_reports')
        os.makedirs(report_dir, exist_ok=True)
        
        # 設定月報檔案名稱
        report_file = os.path.join(report_dir, f'{year}-{month}月交易報表.xlsx')
        
        # 建立工作簿和工作表
        wb = Workbook()
        ws = wb.active
        
        # 設定所有欄寬為19
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width = 19
            
        # 設定區塊標題格式（藍色背景、置中）
        title_fill = PatternFill(start_color='B8CCE4', end_color='B8CCE4', fill_type='solid')
        title_alignment = Alignment(horizontal='center', vertical='center')
        
        # 生成四個區塊：交易總覽、帳戶狀態、交易明細、持倉狀態
        # ... 具體實現略（與日報格式保持一致）
        
        # 儲存檔案
        wb.save(report_file)
        
        # 發送通知
        message = f"📊 {month}月交易月報已生成！\n檔案：{report_file}"
        send_telegram_message(message)
        
        return True
        
    except Exception as e:
        print(f"生成月報失敗: {e}")
        return False
```

#### 延遲生成報表 API
```python
def delayed_generate_reports():
    """延遲生成日報和月報"""
    try:
        # 先等待30秒後生成日報
        time.sleep(30)
        # 生成日報的代碼...
        
        # 如果是月末最後交易日，再等30秒生成月報
        if is_last_trading_day_of_month():
            time.sleep(30)
            generate_monthly_trading_report()
            
    except Exception as e:
        print(f"延遲生成報表失敗: {e}")
```

### 月報格式
月報包含四個主要區塊：

#### 1. 交易總覽
```
═════ 交易總覽 ═════
委託數量：xxx 筆
取消數量：xxx 筆
成交數量：xxx 筆
平倉口數：xxx 口
大台損益：＄xxx,xxx TWD
小台損益：＄xxx,xxx TWD
微台損益：＄xxx,xxx TWD
```

#### 2. 帳戶狀態
```
═════ 帳戶狀態 ═════
權益總值：x,xxx,xxx
權益總額：x,xxx,xxx
本月餘額：x,xxx,xxx
上月餘額：x,xxx,xxx
可用保證金：xxx,xxx
原始保證金：xxx,xxx
維持保證金：xxx,xxx
風險指標：xx%
手續費：x,xxx
期交稅：xxx
本月平倉損益＄xxx,xxx TWD
```

#### 3. 交易明細
```
═════ 交易明細 ═════
大台｜多單｜1口｜23,100｜23,200
＄20,000 TWD
小台｜空單｜1口｜23,050｜23,000
＄2,500 TWD
```

#### 4. 持倉狀態
```
═════ 持倉狀態 ═════
大台｜多單｜2口｜23,050｜＄-200 TWD
未實現總損益＄-200 TWD
```

---

## 最新更新 (v1.3.8 - 2025-07-08)

### 交易統計格式優化與損益計算 API
新增完整的交易明細顯示和單筆損益計算功能：

#### 交易統計分析 API
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

#### 點值系統 API
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

#### 數字格式化 API
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

#### 日誌時間戳格式 API
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

#### port.txt 預設值修正 API
```python
def get_port():
    """從根目錄的 port.txt 檔案讀取端口設置，若無則自動建立"""
    try:
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

### 交易統計格式
新的交易統計格式包含完整的交易明細：

```
📊 交易統計（2025/01/15）
═════ 交易總覽 ═════
委託數量：5 筆
取消數量：0 筆
成交數量：4 筆
平倉口數：2 口
═════ 帳戶狀態 ═════
權益總值：1,500,000
權益總額：1,500,000
今日餘額：1,200,000
昨日餘額：1,100,000
可用保證金：800,000
原始保證金：400,000
維持保證金：300,000
風險指標：20%
手續費：150
期交稅：50
本日平倉損益＄22,500 TWD
═════ 交易明細 ═════
大台｜多單｜1口｜23,100｜23,200
＄20,000 TWD
小台｜空單｜1口｜23,050｜23,000
＄2,500 TWD
═════ 持倉狀態 ═════
大台｜多單｜2口｜23,050｜＄-200 TWD
未實現總損益＄-200 TWD
```

### 損益計算邏輯
- **平多倉**：`(平倉價 - 開倉價) × 數量 × 點值`
- **平空倉**：`(開倉價 - 平倉價) × 數量 × 點值`

### 系統分工
- **系統負責**：統計分析、簡單配對、交易明細
- **永豐API負責**：正式損益計算、帳戶狀態
- **避免重複**：不重新實作複雜的FIFO邏輯

## 最新更新 (v1.3.7 - 2025-07-07)

### 後端日誌顯示開關 API
新增 `log_console` 設定，控制後端程式是否在背景執行：

#### 設定檔案格式
`port.txt` 現在支援兩個參數：
```txt
port:5000
log_console:1
```

#### 參數說明
- **port**: 系統端口號（1024-65535）
- **log_console**: 日誌顯示模式
  - `0` = 背景執行（隱藏命令行視窗）
  - `1` = 正常顯示（顯示命令行視窗）

#### 設定讀取 API
```python
def get_port():
    """從根目錄的 port.txt 檔案讀取端口設置，若無則自動建立"""
    try:
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

#### 視窗隱藏 API
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

#### 程式完全退出 API
```python
def on_window_closing():
    print("視窗關閉中，正在清理資源...")
    cleanup_on_exit()
    # 確保程式完全退出
    os._exit(0)
    return True  # 允許關閉
```

#### 啟動訊息 API
程式啟動時會顯示當前設定：
```
=== Auto91 交易系統啟動 ===
端口設定: 5000
日誌模式: 背景執行
================================
```

### 錯誤處理
- **設定讀取失敗**：使用預設值（port:5000, log_console:1）
- **視窗隱藏失敗**：顯示錯誤訊息但不影響程式運行
- **參數值錯誤**：自動修正為有效值

## 最新更新 (v1.3.6 - 2025-07-06)
- 轉倉/保證金前端日誌、日誌格式優化、顏色說明、細節修正。

## 最新更新 (v1.3.5 - 2025-07-05)

### 交易記錄持久化 API
新增完整的交易記錄 JSON 儲存機制，確保所有交易參數完整保存：

#### 交易記錄儲存 API
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

#### 交易記錄結構
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

#### 自動清理機制 API
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

### 動作顯示統一 API
新增 `get_action_display_by_rule()` 函數，統一動作顯示邏輯：

```python
def get_action_display_by_rule(octype, direction):
    """根據開平倉類型和方向判斷動作顯示"""
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

### 訂單回調推斷邏輯增強
改進 `order_callback()` 函數，當訂單映射缺失時智能推斷交易類型：

#### 智能推斷功能
- **持倉資訊分析**：從持倉資訊判斷是否為平倉操作
- **JSON 檔案讀取**：支援從交易記錄 JSON 檔案讀取完整參數
- **開平倉類型推斷**：根據訂單方向與持倉方向的關係推斷開平倉類型

#### 推斷邏輯
```python
# 如果有持倉且訂單方向與持倉方向相反，則為平倉
has_opposite_position = any(
    (p.direction != action and p.quantity != 0) for p in contract_positions
)

inferred_octype = 'Cover' if has_opposite_position else 'New'
inferred_manual = True  # 推斷為手動操作
```

### 通知一致性修復
確保提交成功和成交通知使用相同的參數來源：

#### 統一參數來源
- **提交通知**：使用訂單提交時的參數
- **成交通知**：優先使用訂單映射，缺失時從 JSON 檔案讀取
- **動作顯示**：統一使用 `get_action_display_by_rule()` 函數

#### 修復內容
- **手動平倉通知錯誤**：修復手動平倉的提交訊息顯示「手動平倉」但成交訊息顯示「手動開倉」的問題
- **動作顯示不一致**：修復成交通知中動作顯示不正確的問題
- **訂單映射缺失處理**：改進當訂單映射缺失時的推斷邏輯，提升通知準確性

## 最新更新 (v1.3.4 - 2025-07-04)

### 永豐手動下單參數格式標準化
重大API變更：手動下單改為使用永豐官方參數格式，與 WEBHOOK 下單明確分離。

#### 手動下單 API 參數要求
```json
{
  "contract_code": "TXF",
  "quantity": 1,
  "price": 0,
  "action": "Buy",    // 永豐官方參數：Buy 或 Sell
  "octype": "Cover"   // 永豐官方參數：New 或 Cover
}
```

#### 參數對應關係
- **action 參數**：
  - `"Buy"` = 買入
  - `"Sell"` = 賣出
- **octype 參數**：
  - `"New"` = 開倉
  - `"Cover"` = 平倉

#### 動作組合對應
- `New Buy` = 多單買入（開倉多單）
- `New Sell` = 空單買入（開倉空單）
- `Cover Sell` = 多單賣出（平倉多單）
- `Cover Buy` = 空單賣出（平倉空單）

#### 錯誤處理
如果沒有提供 `action` 或 `octype` 參數：
```json
{
  "status": "error",
  "message": "永豐手動下單需要提供 action (Buy/Sell) 和 octype (New/Cover) 參數"
}
```

### WEBHOOK 下單參數（保持不變）
```json
{
  "contract_code": "TXF",
  "quantity": 1,
  "price": 0,
  "direction": "平多"  // 中文參數：開多、開空、平多、平空
}
```

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