# 開發者指南

## 最新更新 (v1.3.9 - 2025-07-09)

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