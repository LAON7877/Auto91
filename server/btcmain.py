#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BTC交易系統主程式
處理BTC加密貨幣交易相關功能
"""

from flask import request, jsonify
import os
import json
import time
import hmac
import hashlib
import requests
import threading
import glob
from datetime import datetime, timedelta
from urllib.parse import urlencode

# 配置目錄
CONFIG_DIR = os.path.join(os.path.dirname(__file__), 'config')
BTC_ENV_PATH = os.path.join(CONFIG_DIR, 'btc.env')

# 幣安API配置
BINANCE_BASE_URL = "https://api.binance.com"
BINANCE_FAPI_URL = "https://fapi.binance.com"  # 期貨API

# 全局變量
binance_client = None
account_info = None
btc_active_trades = {}  # 活躍交易記錄

class BinanceClient:
    """幣安API客戶端"""
    
    def __init__(self, api_key, secret_key, testnet=False):
        self.api_key = api_key
        self.secret_key = secret_key
        self.base_url = BINANCE_FAPI_URL if not testnet else "https://testnet.binancefuture.com"
        self.session = requests.Session()
        self.session.headers.update({
            'X-MBX-APIKEY': api_key,
            'Content-Type': 'application/json'
        })
    
    def _generate_signature(self, query_string):
        """生成API簽名"""
        return hmac.new(
            self.secret_key.encode('utf-8'),
            query_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
    
    def _get_server_time(self):
        """獲取幣安服務器時間"""
        try:
            url = f"{self.base_url}/fapi/v1/time"
            response = self.session.get(url)
            if response.status_code == 200:
                return response.json().get('serverTime')
        except:
            pass
        return None
    
    def _make_request(self, method, endpoint, params=None, signed=True):
        """發送API請求"""
        url = f"{self.base_url}{endpoint}"
        
        if params is None:
            params = {}
        
        if signed:
            # 使用幣安服務器時間來避免時間同步問題
            server_time = self._get_server_time()
            if server_time:
                params['timestamp'] = server_time
            else:
                # 如果無法獲取服務器時間，使用本地時間並減去1秒作為安全邊際
                params['timestamp'] = int(time.time() * 1000) - 1000
            
            query_string = urlencode(params)
            params['signature'] = self._generate_signature(query_string)
        
        try:
            if method == 'GET':
                response = self.session.get(url, params=params)
            elif method == 'POST':
                response = self.session.post(url, params=params)
            else:
                response = self.session.request(method, url, params=params)
            
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.RequestException as e:
            print(f"幣安API請求失敗: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"HTTP狀態碼: {e.response.status_code}")
                print(f"錯誤詳情: {e.response.text}")
                # 嘗試解析JSON錯誤
                try:
                    error_json = e.response.json()
                    print(f"API錯誤: {error_json}")
                except:
                    pass
            return None
    
    def test_connection(self):
        """測試API連接"""
        try:
            print(f"正在進行幣安API連接測試...")
            result = self._make_request('GET', '/fapi/v1/ping', signed=False)
            if result is not None and isinstance(result, dict):
                print(f"幣安API ping測試成功: {result}")
                return True
            else:
                print(f"幣安API ping測試失敗: 無回應或格式錯誤 - {result}")
                return False
        except Exception as e:
            print(f"幣安連接測試異常: {e}")
            return False
    
    def get_account_info(self):
        """獲取帳戶信息"""
        return self._make_request('GET', '/fapi/v2/account')
    
    def get_balance(self):
        """獲取餘額信息"""
        return self._make_request('GET', '/fapi/v2/balance')
    
    def get_position_info(self):
        """獲取持倉信息"""
        return self._make_request('GET', '/fapi/v2/positionRisk')
    
    def get_server_time(self):
        """獲取服務器時間"""
        return self._make_request('GET', '/fapi/v1/time', signed=False)
    
    def get_exchange_info(self):
        """獲取交易所信息"""
        return self._make_request('GET', '/fapi/v1/exchangeInfo', signed=False)
    
    def place_order(self, symbol, side, order_type, quantity, price=None, time_in_force='GTC', 
                   reduce_only=False, close_position=False, position_side='BOTH'):
        """下單 - 期貨訂單"""
        params = {
            'symbol': symbol,
            'side': side,  # BUY 或 SELL
            'type': order_type,  # MARKET, LIMIT, STOP, TAKE_PROFIT等
            'quantity': str(quantity),
            'positionSide': position_side,  # BOTH, LONG, SHORT
            'timeInForce': time_in_force,
            'reduceOnly': reduce_only,
            'closePosition': close_position
        }
        
        if order_type == 'LIMIT' and price:
            params['price'] = str(price)
        
        return self._make_request('POST', '/fapi/v1/order', params)
    
    def cancel_order(self, symbol, order_id=None, client_order_id=None):
        """取消訂單"""
        params = {'symbol': symbol}
        
        if order_id:
            params['orderId'] = order_id
        elif client_order_id:
            params['origClientOrderId'] = client_order_id
        else:
            raise ValueError("必須提供 order_id 或 client_order_id")
        
        return self._make_request('DELETE', '/fapi/v1/order', params)
    
    def get_order_status(self, symbol, order_id=None, client_order_id=None):
        """查詢訂單狀態"""
        params = {'symbol': symbol}
        
        if order_id:
            params['orderId'] = order_id
        elif client_order_id:
            params['origClientOrderId'] = client_order_id
        else:
            raise ValueError("必須提供 order_id 或 client_order_id")
        
        return self._make_request('GET', '/fapi/v1/order', params)
    
    def get_all_orders(self, symbol, limit=500):
        """獲取所有訂單"""
        params = {'symbol': symbol, 'limit': limit}
        return self._make_request('GET', '/fapi/v1/allOrders', params)
    
    def get_trades(self, symbol, limit=500):
        """獲取交易歷史"""
        params = {'symbol': symbol, 'limit': limit}
        return self._make_request('GET', '/fapi/v1/userTrades', params)
    
    def get_income_history(self, symbol=None, income_type=None, limit=100):
        """獲取收益歷史"""
        params = {'limit': limit}
        
        if symbol:
            params['symbol'] = symbol
        if income_type:
            params['incomeType'] = income_type  # TRANSFER, WELCOME_BONUS, REALIZED_PNL, etc.
        
        return self._make_request('GET', '/fapi/v1/income', params)
    
    def change_leverage(self, symbol, leverage):
        """調整槓桿倍數"""
        params = {
            'symbol': symbol,
            'leverage': leverage
        }
        return self._make_request('POST', '/fapi/v1/leverage', params)
    
    def change_margin_type(self, symbol, margin_type):
        """調整保證金模式"""
        params = {
            'symbol': symbol,
            'marginType': margin_type  # ISOLATED 或 CROSSED
        }
        return self._make_request('POST', '/fapi/v1/marginType', params)
    
    def get_open_orders(self, symbol=None):
        """獲取當前掛單"""
        params = {}
        if symbol:
            params['symbol'] = symbol
        return self._make_request('GET', '/fapi/v1/openOrders', params)
    
    def cancel_all_orders(self, symbol):
        """取消所有掛單"""
        params = {'symbol': symbol}
        return self._make_request('DELETE', '/fapi/v1/allOpenOrders', params)
    
    def get_position_risk(self, symbol=None):
        """獲取持倉風險"""
        params = {}
        if symbol:
            params['symbol'] = symbol
        return self._make_request('GET', '/fapi/v2/positionRisk', params)
    
    def get_ticker_price(self, symbol=None):
        """獲取最新價格"""
        params = {}
        if symbol:
            params['symbol'] = symbol
        return self._make_request('GET', '/fapi/v1/ticker/price', params, signed=False)
    
    def get_24hr_ticker(self, symbol=None):
        """獲取24小時價格變動"""
        params = {}
        if symbol:
            params['symbol'] = symbol
        return self._make_request('GET', '/fapi/v1/ticker/24hr', params, signed=False)

def save_btc_env():
    """保存BTC環境變量"""
    try:
        data = request.get_json()
        
        # 檢查是否有空值欄位
        required_fields = ['CHAT_ID_BTC', 'BINANCE_API_KEY', 'BINANCE_SECRET_KEY', 'BINANCE_USER_ID', 'TRADING_PAIR', 'LEVERAGE', 'CONTRACT_TYPE']
        has_empty_fields = False
        
        for field in required_fields:
            if not data.get(field, '').strip():
                has_empty_fields = True
                break
        
        # 創建BTC環境文件內容（允許空值）
        btc_env_content = f"""# Telegram Bot
BOT_TOKEN_BTC=7912873826:AAFPPDwuwspKVdyDGwh1oVqxH6u1gQ_N-jU

# Telegram ID
CHAT_ID_BTC={data.get('CHAT_ID_BTC', '')}

# 幣安 API Key
BINANCE_API_KEY={data.get('BINANCE_API_KEY', '')}

# 幣安 Secret Key
BINANCE_SECRET_KEY={data.get('BINANCE_SECRET_KEY', '')}

# 幣安用戶ID
BINANCE_USER_ID={data.get('BINANCE_USER_ID', '')}

# 交易對
TRADING_PAIR={data.get('TRADING_PAIR', 'BTCUSDT')}

# 槓桿倍數
LEVERAGE={data.get('LEVERAGE', '5')}

# 合約類型
CONTRACT_TYPE={data.get('CONTRACT_TYPE', 'PERPETUAL')}

# 登入狀態
LOGIN_BTC=0
"""
        
        # 儲存到btc.env文件
        with open(BTC_ENV_PATH, 'w', encoding='utf-8') as f:
            f.write(btc_env_content)
        
        return jsonify({
            'success': True, 
            'message': 'BTC配置儲存成功',
            'has_empty_fields': has_empty_fields
        })
        
    except Exception as e:
        print(f"儲存BTC配置失敗: {e}")
        return jsonify({'success': False, 'message': f'儲存失敗: {str(e)}'})

def btc_login():
    """BTC帳戶登入/連接"""
    global binance_client, account_info
    
    try:
        # 載入BTC配置
        if not os.path.exists(BTC_ENV_PATH):
            return jsonify({'success': False, 'message': 'BTC配置不存在，請先儲存配置'})
        
        btc_env = {}
        with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    btc_env[key] = value
        
        # 獲取API配置
        api_key = btc_env.get('BINANCE_API_KEY', '').strip()
        secret_key = btc_env.get('BINANCE_SECRET_KEY', '').strip()
        trading_pair = btc_env.get('TRADING_PAIR', 'BTCUSDT')
        
        if not api_key or not secret_key:
            return jsonify({'success': False, 'message': 'API Key 或 Secret Key 不存在'})
        
        # 創建幣安客戶端
        binance_client = BinanceClient(api_key, secret_key)
        
        # 測試連接
        print(f"正在測試幣安API連接...")
        connection_test = binance_client.test_connection()
        print(f"幣安API連接測試結果: {connection_test}")
        
        if not connection_test:
            print(f"幣安API連接測試失敗")
            return jsonify({'success': False, 'message': '無法連接到幣安服務器'})
        
        print(f"幣安API連接測試成功，正在獲取帳戶信息...")
        # 獲取帳戶信息
        fresh_account_info = binance_client.get_account_info()
        print(f"帳戶信息獲取結果: {type(fresh_account_info)} - {fresh_account_info}")
        
        if not fresh_account_info:
            print(f"獲取帳戶信息失敗 - 返回值為空")
            return jsonify({'success': False, 'message': 'API認證失敗，請檢查API Key和Secret Key'})
        
        # 更新全局帳戶信息
        account_info = fresh_account_info
        print(f"成功獲取帳戶信息，總錢包餘額: {account_info.get('totalWalletBalance', 'N/A')}")
        
        # 獲取餘額信息
        balance_info = binance_client.get_balance()
        
        # 將登入狀態寫入btc.env
        updated_content = []
        login_found = False
        
        with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith('LOGIN_BTC='):
                    updated_content.append('LOGIN_BTC=1\n')
                    login_found = True
                else:
                    updated_content.append(line)
        
        if not login_found:
            updated_content.append('LOGIN_BTC=1\n')
        
        with open(BTC_ENV_PATH, 'w', encoding='utf-8') as f:
            f.writelines(updated_content)
        
        # 準備返回信息
        total_wallet_balance = account_info.get('totalWalletBalance', '0')
        available_balance = account_info.get('availableBalance', '0')
        
        print(f"BTC帳戶連接成功 - 交易對: {trading_pair}, 餘額: {total_wallet_balance} USDT")
        
        # 啟動WebSocket實時數據連接
        try:
            start_btc_websocket()
            print("BTC WebSocket連接已啟動")
        except Exception as e:
            print(f"啟動BTC WebSocket失敗: {e}")
        
        # 啟動風險監控
        try:
            risk_thread = threading.Thread(target=start_btc_risk_monitoring, daemon=True)
            risk_thread.start()
            print("BTC風險監控已啟動")
        except Exception as e:
            print(f"啟動BTC風險監控失敗: {e}")
        
        return jsonify({
            'success': True, 
            'message': f'BTC帳戶連接成功 ({trading_pair})',
            'trading_pair': trading_pair,
            'total_balance': total_wallet_balance,
            'available_balance': available_balance,
            'account_alias': account_info.get('alias', '主帳戶')
        })
        
    except Exception as e:
        print(f"BTC登入失敗: {e}")
        binance_client = None
        account_info = None
        return jsonify({'success': False, 'message': f'連接失敗: {str(e)}'})

def btc_logout():
    """BTC帳戶登出"""
    try:
        if not os.path.exists(BTC_ENV_PATH):
            return jsonify({'success': False, 'message': 'BTC配置不存在'})
        
        # 將登入狀態改為0
        updated_content = []
        with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith('LOGIN_BTC='):
                    updated_content.append('LOGIN_BTC=0\n')
                else:
                    updated_content.append(line)
        
        with open(BTC_ENV_PATH, 'w', encoding='utf-8') as f:
            f.writelines(updated_content)
        
        print("BTC帳戶登出成功")
        return jsonify({'success': True, 'message': 'BTC帳戶登出成功'})
        
    except Exception as e:
        print(f"BTC登出失敗: {e}")
        return jsonify({'success': False, 'message': f'登出失敗: {str(e)}'})

def get_btc_bot_username():
    """獲取BTC Bot用戶名"""
    try:
        # 從BTC環境文件中讀取Bot Token
        bot_token = "7912873826:AAFPPDwuwspKVdyDGwh1oVqxH6u1gQ_N-jU"
        
        # 使用Telegram Bot API獲取Bot信息
        bot_api_url = f"https://api.telegram.org/bot{bot_token}/getMe"
        
        try:
            response = requests.get(bot_api_url, timeout=5)
            if response.status_code == 200:
                bot_info = response.json()
                if bot_info.get('ok'):
                    username = bot_info['result'].get('username', 'Auto91_BtcBot')
                    return jsonify({'username': f'@{username}'})
        except:
            pass
        
        # 如果API調用失敗，返回默認值
        return jsonify({'username': '@Auto91_BtcBot'})
        
    except Exception as e:
        print(f"獲取BTC Bot用戶名失敗: {e}")
        return jsonify({'username': '@Auto91_BtcBot'})

def load_btc_env():
    """載入BTC環境變量"""
    try:
        if os.path.exists(BTC_ENV_PATH):
            btc_env = {}
            with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        btc_env[key] = value
            return jsonify(btc_env)
        else:
            return jsonify({})
            
    except Exception as e:
        print(f"載入BTC配置失敗: {e}")
        return jsonify({})

def load_btc_env_data():
    """載入BTC環境變量數據（內部使用）"""
    try:
        env_data = {}
        if os.path.exists(BTC_ENV_PATH):
            with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_data[key] = value
        return env_data
    except Exception as e:
        print(f"載入BTC環境數據失敗: {e}")
        return {}

def calculate_btc_quantity(signal_data, account_balance):
    """計算BTC交易數量"""
    try:
        # 獲取配置的槓桿倍數
        env_data = load_btc_env_data()
        leverage = float(env_data.get('LEVERAGE', 5))
        
        # 獲取倉位大小百分比(預設使用2%風險)
        position_size_pct = float(signal_data.get('position_size', 2.0)) / 100
        
        # 計算可用餘額
        available_balance = float(account_balance.get('availableBalance', 0))
        
        # 計算下單金額 = 可用餘額 * 倉位比例 * 槓桿
        order_value = available_balance * position_size_pct * leverage
        
        # 獲取當前價格
        current_price = float(signal_data.get('price', 0))
        if current_price <= 0:
            # 如果信號沒有價格，獲取市場價格
            if binance_client:
                ticker = binance_client.get_ticker_price('BTCUSDT')
                current_price = float(ticker.get('price', 0)) if ticker else 0
        
        if current_price <= 0:
            raise ValueError("無法獲取有效價格")
        
        # 計算數量 = 下單金額 / 價格
        quantity = order_value / current_price
        
        # 幣安最小下單單位調整(通常是0.001)
        min_qty = 0.001
        quantity = max(min_qty, round(quantity, 3))
        
        print(f"BTC倉位計算: 可用餘額={available_balance}, 槓桿={leverage}, 風險={position_size_pct*100}%, 價格={current_price}, 數量={quantity}")
        
        return quantity
        
    except Exception as e:
        print(f"計算BTC數量失敗: {e}")
        return 0.001  # 返回最小單位

def place_btc_futures_order(symbol, side, quantity, price=None, order_type="MARKET", reduce_only=False, is_manual=False):
    """BTC期貨下單"""
    global binance_client, btc_active_trades
    
    try:
        if not binance_client:
            raise ValueError("BTC客戶端未初始化")
        
        # 判斷是開倉還是平倉
        action_type = '平倉' if reduce_only else '開倉'
        manual_type = '手動' if is_manual else '自動'
        
        print(f"準備下BTC單: symbol={symbol}, side={side}, quantity={quantity}, type={order_type}, action={action_type}")
        # 記錄到系統日誌
        log_btc_system_message(f"準備{manual_type}{action_type}: {symbol} {side} {quantity} {order_type}", "info")
        
        # 執行下單
        result = binance_client.place_order(
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price if order_type == 'LIMIT' else None
        )
        
        if result:
            order_id = result.get('orderId')
            client_order_id = result.get('clientOrderId')
            
            print(f"BTC訂單提交成功: OrderID={order_id}, ClientOrderID={client_order_id}")
            
            # 記錄詳細的訂單提交日誌（參考TX格式）
            detailed_log = get_btc_order_log_message(
                symbol=symbol,
                side=side,
                quantity=quantity,
                price=price if order_type == 'LIMIT' else 0,
                order_id=order_id,
                order_type=order_type,
                is_manual=is_manual,
                action_type=action_type
            )
            log_btc_system_message(detailed_log, "info")
            
            # 記錄到活躍交易
            trade_record = {
                'order_id': order_id,
                'client_order_id': client_order_id,
                'symbol': symbol,
                'side': side,
                'quantity': quantity,
                'order_type': order_type,
                'is_manual': is_manual,
                'action_type': action_type,
                'reduce_only': reduce_only,
                'status': result.get('status', 'NEW'),
                'timestamp': datetime.now().isoformat()
            }
            
            btc_active_trades[order_id] = trade_record
            
            # 發送提交成功通知
            send_btc_order_submit_notification(trade_record, True)
            
            # 延遲檢查成交狀態
            def check_fill_status():
                time.sleep(3)  # 延遲3秒檢查
                check_btc_order_fill(order_id, symbol)
            
            threading.Thread(target=check_fill_status, daemon=True).start()
            
            return {
                'success': True,
                'message': f'{manual_type}{action_type}成功',
                'order_id': order_id,
                'symbol': symbol,
                'side': side,
                'quantity': quantity,
                'result': result
            }
        else:
            raise Exception("下單返回空結果")
            
    except Exception as e:
        print(f"BTC下單失敗: {e}")
        # 記錄到系統日誌
        log_btc_system_message(f"下單失敗: {e}", "error")
        # 發送提交失敗通知
        error_record = {
            'symbol': symbol,
            'side': side,
            'quantity': quantity,
            'error': str(e)
        }
        send_btc_order_submit_notification(error_record, False)
        return {
            'success': False,
            'message': f'下單失敗: {str(e)}',
            'symbol': symbol,
            'side': side,
            'quantity': quantity
        }

def check_btc_order_fill(order_id, symbol):
    """檢查BTC訂單成交狀態"""
    global binance_client, btc_active_trades
    
    try:
        if not binance_client:
            return
        
        # 查詢訂單狀態
        order_status = binance_client.get_order_status(symbol, order_id=order_id)
        
        if order_status:
            status = order_status.get('status')
            
            if status == 'FILLED':
                # 訂單已成交
                trade_record = btc_active_trades.get(order_id, {})
                trade_record.update({
                    'fill_price': order_status.get('avgPrice'),
                    'fill_quantity': order_status.get('executedQty'),
                    'fill_time': order_status.get('updateTime'),
                    'status': 'FILLED'
                })
                
                print(f"BTC訂單成交: OrderID={order_id}, 成交價={trade_record.get('fill_price')}")
                
                # 記錄成交日誌到系統日誌（參考TX格式）
                fill_price = float(trade_record.get('fill_price', '0'))
                fill_quantity = trade_record.get('fill_quantity', '0')
                symbol = trade_record.get('symbol', 'BTCUSDT')
                side = trade_record.get('side', 'BUY')
                
                # 生成詳細的成交日誌（使用保存的訂單信息）
                detailed_fill_log = get_btc_order_log_message(
                    symbol=symbol,
                    side=side,
                    quantity=fill_quantity,
                    price=fill_price,
                    order_id=order_id,
                    order_type=trade_record.get('order_type', 'MARKET'),
                    is_manual=trade_record.get('is_manual', False),
                    action_type=trade_record.get('action_type', '開倉'),
                    is_success=True  # 成交時使用成功格式
                )
                log_message = detailed_fill_log
                log_btc_system_message(log_message, "success")
                
                # 發送成交通知
                send_btc_trade_notification(trade_record)
                
                # 保存交易記錄
                save_btc_trade_record(trade_record)
                
            elif status in ['CANCELED', 'REJECTED', 'EXPIRED']:
                # 訂單失效
                trade_record = btc_active_trades.get(order_id, {})
                trade_record.update({'status': status})
                print(f"BTC訂單失效: OrderID={order_id}, 狀態={status}")
                
                # 記錄失效日誌到系統日誌
                symbol = trade_record.get('symbol', 'BTCUSDT')
                side = trade_record.get('side', '未知')
                quantity = trade_record.get('quantity', '0')
                
                log_message = f"BTC訂單失效：{symbol}｜{side}｜{quantity}｜狀態：{status}"
                log_btc_system_message(log_message, "warning")
                
        # 從活躍交易中移除已完成的訂單
        if order_id in btc_active_trades:
            final_status = btc_active_trades[order_id].get('status')
            if final_status in ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']:
                del btc_active_trades[order_id]
                
    except Exception as e:
        print(f"檢查BTC訂單狀態失敗: {e}")

def process_btc_entry_signal(signal_data):
    """處理BTC進場信號"""
    try:
        action = signal_data.get('action', '').upper()
        symbol = signal_data.get('symbol', 'BTCUSDT')
        
        if action not in ['LONG', 'SHORT', 'BUY', 'SELL']:
            raise ValueError(f"無效的進場動作: {action}")
        
        # 標準化方向
        side = 'BUY' if action in ['LONG', 'BUY'] else 'SELL'
        
        # 獲取帳戶餘額計算數量
        if not binance_client:
            raise ValueError("BTC客戶端未初始化")
        
        balance_info = binance_client.get_balance()
        if not balance_info:
            raise ValueError("無法獲取帳戶餘額")
        
        # 找到USDT餘額
        usdt_balance = None
        for balance in balance_info:
            if balance.get('asset') == 'USDT':
                usdt_balance = balance
                break
        
        if not usdt_balance:
            raise ValueError("找不到USDT餘額")
        
        # 計算交易數量
        quantity = calculate_btc_quantity(signal_data, usdt_balance)
        
        # 執行下單（webhook為自動交易，預設為開倉）
        order_result = place_btc_futures_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            order_type='MARKET',
            reduce_only=False,  # 開倉
            is_manual=False     # 自動交易
        )
        
        return order_result
        
    except Exception as e:
        print(f"處理BTC進場信號失敗: {e}")
        return None

def process_btc_exit_signal(signal_data):
    """處理BTC出場信號"""
    try:
        action = signal_data.get('action', '').upper()
        symbol = signal_data.get('symbol', 'BTCUSDT')
        
        if action not in ['CLOSE', 'EXIT', 'CLOSE_LONG', 'CLOSE_SHORT']:
            raise ValueError(f"無效的出場動作: {action}")
        
        # 獲取當前持倉
        if not binance_client:
            raise ValueError("BTC客戶端未初始化")
        
        positions = binance_client.get_position_info()
        if not positions:
            print("沒有找到持倉信息")
            return None
        
        # 找到對應的持倉
        target_position = None
        for pos in positions:
            if pos.get('symbol') == symbol and float(pos.get('positionAmt', 0)) != 0:
                target_position = pos
                break
        
        if not target_position:
            print(f"沒有找到{symbol}的活躍持倉")
            return None
        
        # 計算平倉方向和數量
        position_amt = float(target_position.get('positionAmt', 0))
        
        if position_amt > 0:
            # 多頭持倉，需要賣出平倉
            side = 'SELL'
            quantity = abs(position_amt)
        else:
            # 空頭持倉，需要買入平倉
            side = 'BUY' 
            quantity = abs(position_amt)
        
        # 執行平倉單
        order_result = place_btc_futures_order(
            symbol=symbol,
            side=side,
            quantity=quantity,
            order_type='MARKET',
            reduce_only=True,   # 平倉
            is_manual=False     # 自動交易
        )
        
        return order_result
        
    except Exception as e:
        print(f"處理BTC出場信號失敗: {e}")
        return None


def save_btc_trade_record(trade_record):
    """保存BTC交易記錄 - 使用日期格式文件名"""
    try:
        today = datetime.now().strftime("%Y%m%d")
        trades_file = os.path.join(os.path.dirname(__file__), 'BTCtransdata', f'BTCtrades_{today}.json')
        
        # 確保目錄存在
        os.makedirs(os.path.dirname(trades_file), exist_ok=True)
        
        # 讀取現有交易記錄
        existing_trades = []
        if os.path.exists(trades_file):
            try:
                with open(trades_file, 'r', encoding='utf-8') as f:
                    existing_trades = json.load(f)
            except:
                existing_trades = []
        
        # 添加時間戳
        trade_record['timestamp'] = datetime.now().isoformat()
        
        # 添加新交易記錄
        existing_trades.append(trade_record)
        
        # 保存回文件
        with open(trades_file, 'w', encoding='utf-8') as f:
            json.dump(existing_trades, f, ensure_ascii=False, indent=2)
        
        # 清理舊的BTC交易記錄檔案（保留30個交易日）
        cleanup_old_btc_trade_files()
            
    except Exception as e:
        print(f"保存BTC交易記錄失敗: {e}")

def cleanup_old_btc_trade_files():
    """清理舊的BTC交易記錄檔案，保留30個交易日"""
    try:
        btc_log_dir = os.path.join(os.path.dirname(__file__), 'BTCtransdata')
        if not os.path.exists(btc_log_dir):
            return
        
        # 獲取所有BTC交易記錄檔案
        trade_files = []
        for filename in os.listdir(btc_log_dir):
            if filename.startswith('BTCtrades_') and filename.endswith('.json'):
                try:
                    # 從檔案名提取日期
                    date_str = filename.replace('BTCtrades_', '').replace('.json', '')
                    file_date = datetime.strptime(date_str, '%Y%m%d')
                    trade_files.append((filename, file_date))
                except ValueError:
                    # 如果檔案名格式不正確，跳過
                    continue
        
        # 按日期排序（最新的在前）
        trade_files.sort(key=lambda x: x[1], reverse=True)
        
        # 保留最新的30個檔案，刪除其餘的
        if len(trade_files) > 30:
            files_to_delete = trade_files[30:]
            for filename, _ in files_to_delete:
                try:
                    file_path = os.path.join(btc_log_dir, filename)
                    os.remove(file_path)
                    print(f"已刪除舊BTC交易記錄檔案：{filename}")
                except Exception as e:
                    print(f"刪除BTC檔案失敗 {filename}：{e}")
            
        print(f"BTC交易記錄檔案清理完成，保留 {min(len(trade_files), 30)} 個檔案")
    
    except Exception as e:
        print(f"清理舊BTC交易記錄檔案失敗：{e}")

def send_btc_telegram_message(message, chat_id=None, bot_token=None):
    """發送BTC Telegram訊息（參考TX系統格式）"""
    try:
        print(f"=== 準備發送BTC Telegram訊息 ===")
        print(f"訊息內容:\n{message}")
        
        # 載入BTC配置
        env_data = load_btc_env_data()
        
        if not chat_id:
            chat_id = env_data.get('CHAT_ID_BTC')
        if not bot_token:
            bot_token = env_data.get('BOT_TOKEN_BTC')
        
        if not chat_id or not bot_token:
            print("BTC Telegram配置不完整，跳過通知")
            log_btc_system_message("Telegram配置不完整", "error")
            return False
        
        print(f"BTC BOT_TOKEN: {bot_token[:10]}...")
        print(f"BTC CHAT_ID: {chat_id}")
        
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        
        print(f"發送請求到 BTC Telegram API...")
        response = requests.post(url, json=payload, timeout=10)
        
        print(f"BTC Telegram API 回應: {response.status_code}")
        
        if response.status_code == 200:
            print("BTC Telegram 訊息發送成功！")
            
            # 根據訊息內容判斷發送狀態類型（參考TX系統）
            if "訂單提交成功" in message or "提交成功" in message:
                log_message = "Telegram ［提交成功］訊息發送成功！！！"
            elif "訂單提交失敗" in message or "提交失敗" in message:
                log_message = "Telegram ［提交失敗］訊息發送成功！！！"
            elif "成交通知" in message or "訂單成交" in message:
                log_message = "Telegram ［成交通知］訊息發送成功！！！"
            elif "API連線異常" in message or "連線失敗" in message:
                log_message = "Telegram ［API連線異常］訊息發送成功！！！"
            elif "API連線成功" in message or "連線成功" in message:
                log_message = "Telegram ［API連線成功］訊息發送成功！！！"
            elif "交易統計" in message or "統計報告" in message:
                log_message = "Telegram ［交易統計］訊息發送成功！！！"
            elif "日報" in message or "月報" in message or "報表" in message:
                log_message = "Telegram ［報表通知］訊息發送成功！！！"
            elif "系統啟動" in message or "啟動通知" in message:
                log_message = "Telegram ［系統通知］訊息發送成功！！！"
            else:
                log_message = "Telegram 訊息發送成功！！！"
            
            # 記錄到BTC系統日誌
            log_type = 'warning' if 'API連線異常' in log_message else 'success'
            log_btc_system_message(log_message, log_type)
            print(f"BTC系統日誌已發送: {log_message}")
            
            return True
        else:
            print(f"BTC Telegram API 錯誤: {response.text}")
            # 發送失敗也要記錄日誌
            error_log_message = f"Telegram 訊息發送失敗！錯誤代碼：{response.status_code}"
            log_btc_system_message(error_log_message, "error")
            print(f"BTC系統錯誤日誌已發送: {error_log_message}")
            return False
            
    except Exception as e:
        print(f"發送BTC Telegram訊息失敗: {e}")
        print(f"錯誤類型: {str(e.__class__.__name__)}")
        if hasattr(e, 'response'):
            print(f"回應內容: {e.response.text}")
        import traceback
        traceback.print_exc()
        
        # 記錄異常到系統日誌
        error_log_message = f"Telegram 訊息發送異常：{str(e)[:100]}"
        log_btc_system_message(error_log_message, "error")
        return False

def get_btc_order_log_message(symbol, side, quantity, price, order_id, order_type, is_manual, action_type, is_success=False):
    """生成BTC訂單日誌訊息（完全參考TX邏輯）"""
    try:
        # 簡化交易對名稱（對應TX的合約名稱）
        if 'BTCUSDT' in symbol:
            simple_symbol = 'BTC'
        elif 'ETHUSDT' in symbol:
            simple_symbol = 'ETH'
        else:
            simple_symbol = symbol.replace('USDT', '')
        
        # 判斷手動/自動（與TX一致）
        manual_type = '手動' if is_manual else '自動'
        
        # 格式化價格（與TX邏輯一致）
        if price == 0 or order_type == 'MARKET':
            price_display = '市價'
        else:
            price_display = f'{price:,.1f}'
        
        # 格式化方向 - 完全遵循TX邏輯
        if action_type == '開倉':
            # 開倉：BUY=多單, SELL=空單（與TX NEW邏輯一致）
            if str(side).upper() == 'BUY':
                direction_display = '多單'
            else:
                direction_display = '空單'
        elif action_type == '平倉':
            # 平倉：BUY=平空單, SELL=平多單（與TX COVER邏輯一致）
            if str(side).upper() == 'BUY':
                direction_display = '空單'  # 平空單
            else:
                direction_display = '多單'  # 平多單
        else:
            # 備援邏輯（與TX一致）
            if str(side).upper() == 'BUY':
                direction_display = '多單'
            else:
                direction_display = '空單'
        
        # 格式化訂單類型和價格類型（與TX一致）
        order_type_display = order_type or 'MARKET'
        
        # 組合訂單類型顯示（與TX邏輯一致）
        if order_type_display.upper() == 'MARKET':
            order_info = f"市價 ({order_type_display})"
        else:
            order_info = f"限價 ({order_type_display})"
        
        # 返回格式（與TX格式完全一致）
        if is_success:
            # 成交成功格式
            return f"{action_type}成功：{simple_symbol}｜{direction_display}｜{quantity}｜＄{price_display}｜{order_info}"
        else:
            # 掛單格式
            return f"{manual_type}{action_type}：{simple_symbol}｜{direction_display}｜{quantity}｜＄{price_display}｜{order_info}"
            
    except Exception as e:
        print(f"生成BTC日誌訊息失敗: {e}")
        return f"日誌生成失敗: {order_id}"

def log_btc_system_message(message, log_type="info"):
    """記錄BTC系統日誌到前端"""
    try:
        # 動態獲取當前端口
        import os
        current_port = 5000  # 預設端口
        try:
            # 嘗試從主模組獲取當前端口
            import main
            if hasattr(main, 'CURRENT_PORT'):
                current_port = main.CURRENT_PORT
        except:
            pass
            
        # 使用BTC專用的日誌端點，避免混淆TX系統日誌
        requests.post(
            f'http://127.0.0.1:{current_port}/api/btc_system_log',
            json={'message': message, 'type': log_type},
            timeout=5
        )
    except:
        pass

def send_btc_order_submit_notification(trade_record, success=True):
    """發送BTC訂單提交通知 - 按照新格式"""
    try:
        current_date = datetime.now().strftime('%Y/%m/%d')
        
        # 提取基本信息
        symbol = trade_record.get('symbol', 'BTCUSDT')
        side = trade_record.get('side', '')
        quantity = trade_record.get('quantity', 0)
        order_id = trade_record.get('order_id', '未知' if not success else '')
        price = trade_record.get('price', 0)
        order_type = trade_record.get('order_type', 'MARKET')
        is_manual = trade_record.get('is_manual', False)
        position_side = trade_record.get('positionSide', 'BOTH')  # LONG, SHORT, BOTH
        reduce_only = trade_record.get('reduceOnly', False)
        
        # 判斷開平倉類型
        if reduce_only:
            action_type = "平倉"
        else:
            action_type = "開倉"
        
        # 判斷自動/手動
        submit_type = "手動" if is_manual else "自動"
        submit_type += action_type
        
        # 判斷多空單和買賣方向
        if action_type == "開倉":
            if side == 'BUY':
                direction_display = "多單買入"
            else:  # SELL
                direction_display = "空單賣出"
        else:  # 平倉
            if side == 'BUY':
                direction_display = "空單買入"  # 平空倉用買入
            else:  # SELL
                direction_display = "多單賣出"  # 平多倉用賣出
        
        # 訂單類型顯示
        order_type_display = "市價單" if order_type == 'MARKET' else "限價單"
        
        # 價格顯示
        price_display = f"{price:,.2f} USDT" if price > 0 else "市價"
        
        if success:
            msg = (f"⭕ 提交成功（{current_date}）\n"
                   f"選用合約：永續合約\n"
                   f"交易幣種：{symbol}\n"
                   f"訂單類型：{order_type_display}\n"
                   f"提交單號：{order_id}\n"
                   f"提交類型：{submit_type}\n"
                   f"提交動作：{direction_display}\n"
                   f"提交數量：{quantity} BTC\n"
                   f"提交價格：{price_display}")
        else:
            error = trade_record.get('error', '未知錯誤')
            msg = (f"❌ 提交失敗（{current_date}）\n"
                   f"選用合約：永續合約\n"
                   f"交易幣種：{symbol}\n"
                   f"訂單類型：{order_type_display}\n"
                   f"提交單號：{order_id}\n"
                   f"提交類型：{submit_type}\n"
                   f"提交動作：{direction_display}\n"
                   f"提交數量：{quantity} BTC\n"
                   f"提交價格：{price_display}\n"
                   f"原因：{error}")
        
        send_btc_telegram_message(msg)
        
        # 添加到系統日誌
        print(f"BTC訂單通知: {msg}")
        
    except Exception as e:
        print(f"發送BTC訂單提交通知失敗: {e}")

def send_btc_trade_notification(trade_record):
    """發送BTC成交通知 - 按照新格式"""
    try:
        current_date = datetime.now().strftime('%Y/%m/%d')
        
        # 提取基本信息
        symbol = trade_record.get('symbol', 'BTCUSDT')
        side = trade_record.get('side', '')
        quantity = trade_record.get('fill_quantity', trade_record.get('quantity', 0))
        fill_price = trade_record.get('fill_price', 0)
        order_id = trade_record.get('order_id', '')
        order_type = trade_record.get('order_type', 'MARKET')
        is_manual = trade_record.get('is_manual', False)
        position_side = trade_record.get('positionSide', 'BOTH')
        reduce_only = trade_record.get('reduceOnly', False)
        
        # 判斷開平倉類型
        if reduce_only:
            action_type = "平倉"
        else:
            action_type = "開倉"
        
        # 判斷自動/手動
        trade_type = "手動" if is_manual else "自動"
        trade_type += action_type
        
        # 判斷多空單和買賣方向
        if action_type == "開倉":
            if side == 'BUY':
                direction_display = "多單買入"
            else:  # SELL
                direction_display = "空單賣出"
        else:  # 平倉
            if side == 'BUY':
                direction_display = "空單買入"  # 平空倉用買入
            else:  # SELL
                direction_display = "多單賣出"  # 平多倉用賣出
        
        # 訂單類型顯示
        order_type_display = "市價單" if order_type == 'MARKET' else "限價單"
        
        # 成交價格顯示
        price_display = f"{fill_price:,.2f} USDT"
        
        msg = (f"✅ 成交通知（{current_date}）\n"
               f"選用合約：永續合約\n"
               f"交易幣種：{symbol}\n"
               f"訂單類型：{order_type_display}\n"
               f"成交單號：{order_id}\n"
               f"成交類型：{trade_type}\n"
               f"成交動作：{direction_display}\n"
               f"成交數量：{quantity} BTC\n"
               f"成交價格：{price_display}")
        
        send_btc_telegram_message(msg)
        
        # 添加到系統日誌
        print(f"BTC成交通知: {msg}")
        
    except Exception as e:
        print(f"發送BTC成交通知失敗: {e}")

def send_btc_trading_statistics():
    """發送BTC每日交易統計 - 按照新格式"""
    try:
        current_date = datetime.now().strftime('%Y-%m-%d')
        
        # 讀取今日交易記錄
        today = datetime.now().strftime('%Y%m%d')
        trades_file = os.path.join(os.path.dirname(__file__), 'BTCtransdata', f'BTCtrades_{today}.json')
        today_trades = []
        
        if os.path.exists(trades_file):
            try:
                with open(trades_file, 'r', encoding='utf-8') as f:
                    all_trades = json.load(f)
                
                # 篩選今日交易
                for trade in all_trades:
                    trade_time = trade.get('timestamp', '')
                    if current_date in trade_time:
                        today_trades.append(trade)
            except:
                pass
        
        # 計算基本統計
        total_trades = len(today_trades)
        buy_trades = len([t for t in today_trades if t.get('side') == 'BUY'])
        sell_trades = len([t for t in today_trades if t.get('side') == 'SELL'])
        
        # 分析平倉交易並計算各交易對盈虧
        symbol_pnl = {}  # 各交易對的總盈虧
        closed_trades = []  # 已平倉的交易明細
        
        # 簡單配對邏輯：尋找平倉交易並計算盈虧
        for trade in today_trades:
            if trade.get('reduceOnly', False):  # 平倉交易
                symbol = trade.get('symbol', '')
                side = trade.get('side', '')
                quantity = float(trade.get('quantity', 0))
                fill_price = float(trade.get('fill_price', 0))
                
                # 尋找對應的開倉交易（簡化邏輯）
                for open_trade in reversed(today_trades):
                    if (open_trade.get('symbol') == symbol and 
                        open_trade.get('side') != side and 
                        not open_trade.get('reduceOnly', False) and
                        float(open_trade.get('quantity', 0)) == quantity):
                        
                        open_price = float(open_trade.get('fill_price', 0))
                        direction = "多單" if open_trade.get('side') == 'BUY' else "空單"
                        
                        # 計算盈虧
                        if open_trade.get('side') == 'BUY':  # 平多倉
                            pnl = (fill_price - open_price) * quantity
                        else:  # 平空倉
                            pnl = (open_price - fill_price) * quantity
                        
                        # 累計各交易對盈虧
                        if symbol not in symbol_pnl:
                            symbol_pnl[symbol] = 0
                        symbol_pnl[symbol] += pnl
                        
                        # 記錄交易明細
                        closed_trades.append({
                            'symbol': symbol,
                            'direction': direction,
                            'quantity': quantity,
                            'open_price': open_price,
                            'close_price': fill_price,
                            'pnl': pnl
                        })
                        break
        
        # 組織訊息
        msg = f"📊 交易統計（{current_date}）\n"
        msg += f"交易次數：{total_trades} 筆\n"
        msg += f"買入次數：{buy_trades} 筆\n"
        msg += f"賣出次數：{sell_trades} 筆\n"
        
        # 各交易對盈虧統計（有平倉才顯示）
        if symbol_pnl:
            for symbol, pnl in symbol_pnl.items():
                msg += f"{symbol}＄{pnl:,.2f} USDT\n"
        
        # 獲取帳戶狀態
        msg += "═════ 帳戶狀態 ═════\n"
        if binance_client:
            try:
                account_info = binance_client.get_account_info()
                if account_info:
                    wallet_balance = float(account_info.get('totalWalletBalance', 0))
                    available_balance = float(account_info.get('availableBalance', 0))
                    total_margin = float(account_info.get('totalInitialMargin', 0))
                    margin_balance = float(account_info.get('totalMarginBalance', 0))
                    maintenance_margin = float(account_info.get('totalMaintMargin', 0))
                    
                    # 計算保證金率
                    margin_ratio = 0
                    if maintenance_margin > 0:
                        margin_ratio = (margin_balance / maintenance_margin) * 100
                    
                    msg += f"錢包餘額：{wallet_balance:,.2f} USDT\n"
                    msg += f"可用餘額：{available_balance:,.2f} USDT\n"
                    msg += f"總保證金：{total_margin:,.2f} USDT\n"
                    msg += f"保證金餘額：{margin_balance:,.2f} USDT\n"
                    msg += f"維持保證金：{maintenance_margin:,.2f} USDT\n"
                    msg += f"保證金率：{margin_ratio:,.1f}%\n"
                    msg += f"手續費：0.00 USDT\n"
                    msg += f"本日已實現盈虧：0.00 USDT\n"
            except Exception as e:
                print(f"獲取BTC帳戶信息失敗: {e}")
                msg += "帳戶信息獲取失敗\n"
        
        # 交易明細（已平倉的交易）
        msg += "═════ 交易明細 ═════\n"
        if closed_trades:
            for trade in closed_trades:
                msg += f"{trade['symbol']}｜{trade['direction']}｜{trade['quantity']}｜{trade['open_price']:.2f}｜{trade['close_price']:.2f}\n"
                msg += f"＄{trade['pnl']:,.2f} USDT\n"
        else:
            msg += "今日無平倉交易\n"
        
        # 持倉狀態
        msg += "═════ 持倉狀態 ═════\n"
        total_unrealized_pnl = 0
        if binance_client:
            try:
                position_info = binance_client.get_position_info()
                active_positions = []
                
                if position_info:
                    for pos in position_info:
                        if float(pos.get('positionAmt', 0)) != 0:
                            symbol = pos.get('symbol')
                            amount = float(pos.get('positionAmt', 0))
                            pnl = float(pos.get('unRealizedProfit', 0))
                            entry_price = float(pos.get('entryPrice', 0))
                            direction = "多單" if amount > 0 else "空單"
                            total_unrealized_pnl += pnl
                            active_positions.append(f"{symbol}｜{direction}｜{abs(amount)}｜{entry_price:.2f}｜＄{pnl:,.2f} USDT")
                
                if active_positions:
                    for pos in active_positions:
                        msg += f"{pos}\n"
                    msg += f"未實現總盈虧＄{total_unrealized_pnl:,.2f} USDT"
                else:
                    msg += "❌ 無持倉部位"
            except Exception as e:
                print(f"獲取BTC持倉信息失敗: {e}")
                msg += "持倉信息獲取失敗"
        else:
            msg += "❌ 無持倉部位"
        
        send_btc_telegram_message(msg)
        print(f"BTC每日交易統計已發送")
        
    except Exception as e:
        print(f"發送BTC每日交易統計失敗: {e}")

def check_btc_daily_trading_statistics():
    """檢查是否需要發送BTC每日交易統計 - BTC 24/7無交易日限制"""
    try:
        print("開始檢查BTC每日交易統計...")
        # BTC 24/7交易，直接發送統計
        send_btc_trading_statistics()
        print("BTC每日交易統計發送完成")
        
        # 延遲生成報表 - 與TX邏輯一致
        def delayed_generate_btc_reports():
            # 先等待30秒後生成日報
            time.sleep(30)
            print("開始生成BTC交易日報...")
            daily_report_result = generate_btc_trading_report()
            
            # 如果是月末且日報生成成功，再等待30秒後生成月報
            if daily_report_result and is_last_day_of_month():
                time.sleep(30)
                print("月末檢測，開始生成BTC交易月報...")
                generate_btc_monthly_report()
        
        # 在新線程中執行延遲生成報表
        threading.Thread(target=delayed_generate_btc_reports, daemon=True).start()
        
    except Exception as e:
        print(f"檢查BTC每日交易統計失敗: {e}")


def is_last_day_of_month():
    """檢查是否為月末最後一天"""
    try:
        today = datetime.now()
        tomorrow = today + timedelta(days=1)
        return today.month != tomorrow.month
    except Exception as e:
        print(f"檢查月末日期失敗: {e}")
        return False

def btc_webhook():
    """BTC交易策略接收端點"""
    try:
        data = request.get_json()
        
        # 驗證請求格式
        if not data:
            return jsonify({'success': False, 'message': '無效的請求格式'})
        
        # 記錄接收到的策略信號
        timestamp = datetime.now().isoformat()
        
        # 載入BTC配置
        if not os.path.exists(BTC_ENV_PATH):
            return jsonify({'success': False, 'message': 'BTC配置不存在'})
        
        btc_env = {}
        with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    btc_env[key] = value
        
        print(f"BTC Webhook收到數據: {data}")
        
        # 處理策略信號並執行交易
        action = data.get('action', '').upper()
        
        # 執行交易
        order_result = None
        
        if action in ['LONG', 'SHORT', 'BUY', 'SELL']:
            # 進場信號
            order_result = process_btc_entry_signal(data)
        elif action in ['CLOSE', 'EXIT', 'CLOSE_LONG', 'CLOSE_SHORT']:
            # 出場信號
            order_result = process_btc_exit_signal(data)
        else:
            print(f"BTC未知的動作類型: {action}")
            log_btc_system_message(f"BTC未知的動作類型: {action}", "warning")
        
        # 處理交易策略信號記錄
        strategy_data = {
            'timestamp': timestamp,
            'signal': data,
            'action': action,
            'processed': True,
            'order_result': order_result,
            'order_id': order_result.get('orderId') if order_result else None
        }
        
        
        # 發送Telegram通知（如果配置了）
        chat_id = btc_env.get('CHAT_ID_BTC')
        if chat_id:
            try:
                message = f"🔔 BTC交易信號\n"
                message += f"時間: {timestamp}\n"
                message += f"信號: {json.dumps(data, ensure_ascii=False, indent=2)}"
                
                # 這裡可以添加發送Telegram消息的邏輯
                print(f"BTC策略信號: {message}")
                
            except Exception as e:
                print(f"發送Telegram通知失敗: {e}")
        
        return jsonify({
            'success': True, 
            'message': 'BTC策略信號接收成功',
            'timestamp': timestamp
        })
        
    except Exception as e:
        print(f"處理BTC策略信號失敗: {e}")
        return jsonify({'success': False, 'message': f'處理失敗: {str(e)}'})


def get_btc_strategy_status():
    """獲取BTC策略狀態"""
    try:
        if not os.path.exists(BTC_ENV_PATH):
            return jsonify({
                'status': 'inactive',
                'message': 'BTC配置不存在'
            })
        
        # 載入BTC配置
        btc_env = {}
        with open(BTC_ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    btc_env[key] = value
        
        # 檢查登入狀態
        login_status = btc_env.get('LOGIN_BTC', '0')
        
        if login_status == '1':
            return jsonify({
                'status': 'active',
                'trading_pair': btc_env.get('TRADING_PAIR', ''),
                'leverage': btc_env.get('LEVERAGE', ''),
                'message': 'BTC策略運行中'
            })
        else:
            return jsonify({
                'status': 'inactive',
                'message': 'BTC帳戶未登入'
            })
            
    except Exception as e:
        print(f"獲取BTC策略狀態失敗: {e}")
        return jsonify({
            'status': 'error',
            'message': f'狀態獲取失敗: {str(e)}'
        })

# ========================== 新增的帳戶相關API ==========================

def get_btc_account_balance():
    """獲取BTC帳戶餘額"""
    global binance_client
    
    try:
        if not binance_client:
            return jsonify({'success': False, 'message': '請先登入BTC帳戶'})
        
        # 獲取帳戶信息
        account_info = binance_client.get_account_info()
        if not account_info:
            return jsonify({'success': False, 'message': '無法獲取帳戶信息'})
        
        # 獲取餘額信息
        balance_info = binance_client.get_balance()
        
        # 整理餘額數據
        balances = []
        if balance_info:
            for balance in balance_info:
                if float(balance.get('balance', 0)) > 0:
                    balances.append({
                        'asset': balance.get('asset'),
                        'balance': balance.get('balance'),
                        'available': balance.get('withdrawAvailable', balance.get('balance'))
                    })
        
        return jsonify({
            'success': True,
            'total_wallet_balance': account_info.get('totalWalletBalance', '0'),
            'total_unrealized_pnl': account_info.get('totalUnrealizedProfit', '0'),
            'total_margin_balance': account_info.get('totalMarginBalance', '0'),
            'available_balance': account_info.get('availableBalance', '0'),
            'balances': balances
        })
        
    except Exception as e:
        print(f"獲取BTC帳戶餘額失敗: {e}")
        return jsonify({'success': False, 'message': f'獲取失敗: {str(e)}'})

def get_btc_position():
    """獲取BTC持倉信息"""
    global binance_client
    
    try:
        if not binance_client:
            return jsonify({'success': False, 'message': '請先登入BTC帳戶'})
        
        # 獲取持倉信息
        position_info = binance_client.get_position_info()
        if not position_info:
            return jsonify({'success': False, 'message': '無法獲取持倉信息'})
        
        # 過濾出有持倉的合約
        active_positions = []
        for position in position_info:
            position_amt = float(position.get('positionAmt', 0))
            if position_amt != 0:
                active_positions.append({
                    'symbol': position.get('symbol'),
                    'position_amt': position.get('positionAmt'),
                    'entry_price': position.get('entryPrice'),
                    'unrealized_pnl': position.get('unRealizedProfit'),
                    'percentage': position.get('percentage'),
                    'side': 'LONG' if position_amt > 0 else 'SHORT',
                    'leverage': position.get('leverage')
                })
        
        return jsonify({
            'success': True,
            'positions': active_positions,
            'total_positions': len(active_positions)
        })
        
    except Exception as e:
        print(f"獲取BTC持倉信息失敗: {e}")
        return jsonify({'success': False, 'message': f'獲取失敗: {str(e)}'})

def get_btc_version():
    """獲取幣安版本信息"""
    global binance_client
    
    try:
        if not binance_client:
            return jsonify({'success': False, 'message': '請先登入BTC帳戶'})
        
        # 獲取交易所信息
        exchange_info = binance_client.get_exchange_info()
        if not exchange_info:
            return jsonify({'success': False, 'message': '無法獲取交易所信息'})
        
        # 獲取服務器時間
        server_time = binance_client.get_server_time()
        
        return jsonify({
            'success': True,
            'version': 'Binance Futures API v1',
            'server_time': server_time.get('serverTime') if server_time else None,
            'timezone': exchange_info.get('timezone', 'UTC'),
            'rate_limits': len(exchange_info.get('rateLimits', [])),
            'symbols_count': len(exchange_info.get('symbols', [])),
            'api_status': 'NORMAL'
        })
        
    except Exception as e:
        print(f"獲取幣安版本信息失敗: {e}")
        return jsonify({'success': False, 'message': f'獲取失敗: {str(e)}'})

def get_btc_trading_status():
    """獲取BTC交易狀態"""
    global binance_client, account_info
    
    try:
        if not binance_client:
            return jsonify({
                'success': False,
                'status': 'disconnected',
                'message': '未連接到幣安API'
            })
        
        # 檢查API連接狀態
        connection_test = binance_client.test_connection()
        if not connection_test:
            return jsonify({
                'success': False,
                'status': 'disconnected',
                'message': 'API連接失敗'
            })
        
        # 檢查帳戶狀態
        if account_info:
            can_trade = account_info.get('canTrade', False)
            can_withdraw = account_info.get('canWithdraw', False)
            can_deposit = account_info.get('canDeposit', False)
            
            # 獲取交易平台信息
            exchange_name = "未知"
            try:
                exchange_info = binance_client.get_exchange_info()
                if exchange_info and isinstance(exchange_info, dict):
                    # 檢查回應是否包含正確的交易所信息
                    if 'timezone' in exchange_info and 'serverTime' in exchange_info:
                        exchange_name = "Binance Futures"
                    elif exchange_info.get('symbols'):  # 或者檢查是否有symbols列表
                        exchange_name = "Binance Futures"
                    else:
                        exchange_name = "Binance Futures"  # 只要API有回應就認為連線成功
            except Exception as e:
                print(f"獲取交易所信息失敗: {e}")
                exchange_name = "Binance Futures"  # 既然API連線正常，就顯示Binance Futures
            
            return jsonify({
                'success': True,
                'status': 'connected',
                'exchange_name': exchange_name,
                'can_trade': can_trade,
                'can_withdraw': can_withdraw,
                'can_deposit': can_deposit,
                'account_type': account_info.get('accountType', 'FUTURES'),
                'message': '幣安API連接正常'
            })
        else:
            # 嘗試重新獲取帳戶信息
            try:
                fresh_account_info = binance_client.get_account_info()
                if fresh_account_info:
                    return jsonify({
                        'success': True,
                        'status': 'connected',
                        'can_trade': fresh_account_info.get('canTrade', False),
                        'can_withdraw': fresh_account_info.get('canWithdraw', False),
                        'can_deposit': fresh_account_info.get('canDeposit', False),
                        'account_type': fresh_account_info.get('accountType', 'FUTURES'),
                        'message': '幣安API連接正常'
                    })
                else:
                    return jsonify({
                        'success': False,
                        'status': 'no_account_info',
                        'message': '無法獲取帳戶信息'
                    })
            except:
                return jsonify({
                    'success': False,
                    'status': 'disconnected',
                    'message': '帳戶信息獲取失敗'
                })
        
    except Exception as e:
        print(f"獲取BTC交易狀態失敗: {e}")
        return jsonify({
            'success': False,
            'status': 'error',
            'message': f'狀態檢查失敗: {str(e)}'
        })

def send_btc_daily_startup_notification():
    """發送BTC每日啟動通知 - 8:45發送，參考TX格式"""
    try:
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        current_date = datetime.now().strftime('%Y-%m-%d')
        
        # BTC啟動通知 (24/7無交易日限制)
        
        # 獲取幣安連線狀態和交易所信息
        api_status = "已連線" if binance_client else "未連線"
        exchange_name = "未知"  # 預設值
        
        # 嘗試從API獲取交易所名稱
        if binance_client:
            try:
                exchange_info = binance_client.get_exchange_info()
                if exchange_info and isinstance(exchange_info, dict):
                    # 檢查回應是否包含正確的交易所信息
                    if 'timezone' in exchange_info and 'serverTime' in exchange_info:
                        exchange_name = "Binance Futures"
                    elif exchange_info.get('symbols'):  # 或者檢查是否有symbols列表
                        exchange_name = "Binance Futures"
                    else:
                        exchange_name = "Binance Futures"  # 只要API有回應就認為連線成功
                else:
                    exchange_name = "未知"
            except Exception as e:
                print(f"獲取交易所信息失敗: {e}")
                exchange_name = "未知"
        
        # 獲取環境配置
        env_data = load_btc_env_data()
        trading_pair = env_data.get('TRADING_PAIR', 'BTCUSDT')
        leverage = env_data.get('LEVERAGE', '5')
        contract_type = env_data.get('CONTRACT_TYPE', 'PERPETUAL')
        user_id = env_data.get('BINANCE_USER_ID', '-')
        
        # 獲取帳戶資訊 - 重新排序並從前端API獲取
        wallet_balance = 0
        available_balance = 0
        total_margin = 0
        margin_balance = 0
        maintenance_margin = 0
        margin_ratio = 0
        fee_paid = 0  # 手續費
        realized_pnl = 0  # 本日已實現盈虧
        unrealized_pnl = 0
        
        if binance_client:
            try:
                # 獲取帳戶資訊
                account_info = binance_client.get_account_info()
                if account_info:
                    wallet_balance = float(account_info.get('totalWalletBalance', 0))
                    available_balance = float(account_info.get('availableBalance', 0))
                    total_margin = float(account_info.get('totalInitialMargin', 0))
                    margin_balance = float(account_info.get('totalMarginBalance', 0))
                    maintenance_margin = float(account_info.get('totalMaintMargin', 0))
                    unrealized_pnl = float(account_info.get('totalUnrealizedProfit', 0))
                    
                    # 計算保證金率
                    if maintenance_margin > 0:
                        margin_ratio = (margin_balance / maintenance_margin) * 100
                
                # 獲取當日手續費和已實現盈虧
                try:
                    today = datetime.now().strftime('%Y-%m-%d')
                    income_data = binance_client._make_request('GET', '/fapi/v1/income', {
                        'incomeType': 'COMMISSION',
                        'startTime': int(datetime.strptime(today, '%Y-%m-%d').timestamp() * 1000),
                        'endTime': int((datetime.strptime(today, '%Y-%m-%d') + timedelta(days=1)).timestamp() * 1000)
                    })
                    if income_data:
                        fee_paid = sum(abs(float(item.get('income', 0))) for item in income_data)
                    
                    realized_data = binance_client._make_request('GET', '/fapi/v1/income', {
                        'incomeType': 'REALIZED_PNL',
                        'startTime': int(datetime.strptime(today, '%Y-%m-%d').timestamp() * 1000),
                        'endTime': int((datetime.strptime(today, '%Y-%m-%d') + timedelta(days=1)).timestamp() * 1000)
                    })
                    if realized_data:
                        realized_pnl = sum(float(item.get('income', 0)) for item in realized_data)
                except:
                    pass  # 如果無法獲取手續費和已實現盈虧，保持為0
                    
            except Exception as e:
                print(f"獲取BTC帳戶信息失敗: {e}")
        
        # 獲取持倉資訊 - 顯示各倉位並計算總盈虧
        position_info = ""
        total_unrealized_pnl = 0
        if binance_client:
            try:
                positions = binance_client.get_position_info()
                active_positions = [pos for pos in positions if float(pos.get('positionAmt', 0)) != 0]
                
                if not active_positions:
                    position_info = "❌ 無持倉部位"
                else:
                    position_info = ""
                    for pos in active_positions:
                        symbol = pos.get('symbol', '')
                        side = "多單" if float(pos.get('positionAmt', 0)) > 0 else "空單"
                        size = abs(float(pos.get('positionAmt', 0)))
                        entry_price = float(pos.get('entryPrice', 0))
                        pnl = float(pos.get('unRealizedProfit', 0))
                        total_unrealized_pnl += pnl
                        # 每個持倉單獨一行
                        position_info += f"{symbol}｜{side}｜{size}｜{entry_price:.2f}｜＄{pnl:,.2f} USDT\n"
                    
                    # 最後顯示未實現總盈虧
                    position_info += f"未實現總盈虧＄{total_unrealized_pnl:,.2f} USDT"
            except Exception as e:
                print(f"獲取BTC持倉信息失敗: {e}")
                position_info = "❌ 持倉資訊獲取失敗"
        else:
            position_info = "❌ 無持倉部位"
        
        # 構建訊息 - 按照用戶要求的格式
        message = "✅ 自動交易BTC正在啟動中.....\n"
        message += "═════ 系統資訊 ═════\n"
        message += f"交易平台：{exchange_name}\n"
        message += f"綁定帳戶：{user_id}\n"
        message += f"API 狀態：{api_status}\n"
        
        message += "═════ 選用合約 ═════\n"
        # 格式化合約信息，簡化永續合約顯示
        contract_display = f"{trading_pair} 永續合約 {leverage}x槓桿"
        if contract_type != 'PERPETUAL':
            contract_display = f"{trading_pair} {contract_type} {leverage}x槓桿"
        message += f"{contract_display}\n"
        
        message += "═════ 帳戶狀態 ═════\n"
        # 按照用戶要求的順序：錢包餘額, 可用餘額, 總保證金, 保證金餘額, 維持保證金, 保證金率, 手續費, 本日已實現盈虧
        message += f"錢包餘額：{wallet_balance:,.2f} USDT\n"
        message += f"可用餘額：{available_balance:,.2f} USDT\n"
        message += f"總保證金：{total_margin:,.2f} USDT\n"
        message += f"保證金餘額：{margin_balance:,.2f} USDT\n"
        message += f"維持保證金：{maintenance_margin:,.2f} USDT\n"
        message += f"保證金率：{margin_ratio:,.1f}%\n"
        message += f"手續費：{fee_paid:,.2f} USDT\n"
        message += f"本日已實現盈虧：{realized_pnl:,.2f} USDT\n"
        
        message += "═════ 持倉狀態 ═════\n"
        message += position_info.rstrip('\n')  # 移除最後的換行符
        
        if send_btc_telegram_message(message):
            print(f"Telegram［每日啟動］通知發送成功: {current_date}")
        
    except Exception as e:
        print(f"Telegram［每日啟動］通知發送失敗: {e}")

def generate_btc_trading_report():
    """生成BTC交易日報 - 新格式"""
    try:
        import openpyxl
        from openpyxl.styles import Alignment, PatternFill, Font
        from openpyxl.utils import get_column_letter
        
        # 創建BTC交易日報目錄（與TX並列）
        report_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'BTC交易日報')
        os.makedirs(report_dir, exist_ok=True)
        
        # 創建工作簿和工作表
        wb = openpyxl.Workbook()
        ws = wb.active
        
        # 設置所有欄寬為19（與TX一致）
        for col in range(1, 12):
            ws.column_dimensions[get_column_letter(col)].width = 19
            
        # 設置藍色和灰色背景、置中對齊（與TX一致）
        blue_fill = PatternFill(start_color='B8CCE4', end_color='B8CCE4', fill_type='solid')
        gray_fill = PatternFill(start_color='D9D9D9', end_color='D9D9D9', fill_type='solid')
        center_alignment = Alignment(horizontal='center', vertical='center')
        
        # 讀取今日交易數據
        today = datetime.now().strftime('%Y%m%d')
        trades_file = os.path.join(os.path.dirname(__file__), 'BTCtransdata', f'BTCtrades_{today}.json')
        trades = []
        
        if os.path.exists(trades_file):
            try:
                with open(trades_file, 'r', encoding='utf-8') as f:
                    trades = json.load(f)
            except:
                pass
        
        # 計算交易統計
        total_orders = len(trades)
        total_cancels = 0  # BTC暫時沒有取消統計
        total_trades = len([t for t in trades if t.get('type') == 'deal'])
        
        # 計算買賣統計
        buy_orders = len([t for t in trades if t.get('side') == 'BUY'])
        sell_orders = len([t for t in trades if t.get('side') == 'SELL'])
        
        # 獲取帳戶信息
        account_data = {}
        if binance_client:
            try:
                account_info = binance_client.get_account_info()
                if account_info:
                    account_data = {
                        'totalWalletBalance': float(account_info.get('totalWalletBalance', 0)),
                        'totalMarginBalance': float(account_info.get('totalMarginBalance', 0)),
                        'availableBalance': float(account_info.get('availableBalance', 0)),
                        'totalUnrealizedProfit': float(account_info.get('totalUnrealizedProfit', 0)),
                        'totalInitialMargin': float(account_info.get('totalInitialMargin', 0)),
                        'totalMaintMargin': float(account_info.get('totalMaintMargin', 0))
                    }
            except:
                pass
        
        # 交易總覽區塊（參考TX格式）
        ws['A1'] = '交易總覽'
        ws['A1'].fill = blue_fill
        ws['A1'].alignment = center_alignment
        
        # 交易總覽標題（橫向）
        titles = ['委託數量', '取消數量', '成交數量', '買入次數', '賣出次數', 'BTC損益', '總錢包餘額']
        for i, title in enumerate(titles):
            col = get_column_letter(i + 1)
            ws[f'{col}2'] = title
            ws[f'{col}2'].alignment = center_alignment
            ws[f'{col}2'].fill = gray_fill
        
        # 交易總覽內容
        ws['A3'] = f"{total_orders} 筆"
        ws['B3'] = f"{total_cancels} 筆"
        ws['C3'] = f"{total_trades} 筆"
        ws['D3'] = f"{buy_orders} 筆"
        ws['E3'] = f"{sell_orders} 筆"
        ws['F3'] = f"＄{account_data.get('totalUnrealizedProfit', 0):,.2f} USDT"
        ws['G3'] = f"＄{account_data.get('totalWalletBalance', 0):,.2f} USDT"
        
        # 帳戶狀態區塊
        current_row = 5
        ws[f'A{current_row}'] = '帳戶狀態'
        ws[f'A{current_row}'].fill = blue_fill
        ws[f'A{current_row}'].alignment = center_alignment
        
        # 帳戶狀態標題（橫向）- 按新順序排列
        account_titles = ['錢包餘額', '可用餘額', '總保證金', '保證金餘額', '維持保證金', '保證金率', '手續費', '本日已實現盈虧']
        for i, title in enumerate(account_titles):
            col = get_column_letter(i + 1)
            ws[f'{col}{current_row + 1}'] = title
            ws[f'{col}{current_row + 1}'].alignment = center_alignment
            ws[f'{col}{current_row + 1}'].fill = gray_fill
        
        # 帳戶狀態內容 - 按新順序排列
        margin_ratio = 0
        if account_data.get('totalMaintMargin', 0) > 0:
            margin_ratio = (account_data.get('totalMarginBalance', 0) / account_data.get('totalMaintMargin', 1)) * 100
        
        ws[f'A{current_row + 2}'] = f"＄{account_data.get('totalWalletBalance', 0):,.2f}"      # 錢包餘額
        ws[f'B{current_row + 2}'] = f"＄{account_data.get('availableBalance', 0):,.2f}"       # 可用餘額
        ws[f'C{current_row + 2}'] = f"＄{account_data.get('totalInitialMargin', 0):,.2f}"     # 總保證金
        ws[f'D{current_row + 2}'] = f"＄{account_data.get('totalMarginBalance', 0):,.2f}"     # 保證金餘額
        ws[f'E{current_row + 2}'] = f"＄{account_data.get('totalMaintMargin', 0):,.2f}"       # 維持保證金
        ws[f'F{current_row + 2}'] = f"{margin_ratio:.2f}%"                                    # 保證金率
        ws[f'G{current_row + 2}'] = f"＄0.00"                                                 # 手續費（暫時為0）
        ws[f'H{current_row + 2}'] = f"＄0.00"                                                 # 本日已實現盈虧（暫時為0）
        
        # 交易明細區塊
        current_row += 4
        ws[f'A{current_row}'] = '交易明細'
        ws[f'A{current_row}'].fill = blue_fill
        ws[f'A{current_row}'].alignment = center_alignment
        
        # 交易明細標題
        detail_titles = ['成交時間', '訂單編號', '交易對', '訂單類型', '成交類型', '成交方向', 
                        '成交動作', '成交數量', '成交價格', '成交金額', '手續費']
        for i, title in enumerate(detail_titles):
            col = get_column_letter(i + 1)
            ws[f'{col}{current_row + 1}'] = title
            ws[f'{col}{current_row + 1}'].alignment = center_alignment
            ws[f'{col}{current_row + 1}'].fill = gray_fill
        
        # 交易明細內容
        if trades:
            for i, trade in enumerate(trades):
                row = current_row + i + 2
                ws[f'A{row}'] = trade.get('timestamp', '')[:19]  # 只顯示日期時間部分
                ws[f'B{row}'] = trade.get('order_id', '')
                ws[f'C{row}'] = trade.get('symbol', 'BTCUSDT')
                
                # 訂單類型
                order_type = trade.get('order_type', 'MARKET')
                ws[f'D{row}'] = '市價單' if order_type == 'MARKET' else '限價單'
                
                # 成交類型
                ws[f'E{row}'] = '手動交易' if trade.get('is_manual', False) else '自動交易'
                
                # 成交方向
                side = trade.get('side', 'BUY')
                ws[f'F{row}'] = '買入' if side == 'BUY' else '賣出'
                
                # 成交動作
                action_type = trade.get('action_type', '開倉')
                ws[f'G{row}'] = action_type
                
                # 成交數量
                quantity = trade.get('quantity', 0)
                ws[f'H{row}'] = f"{quantity}"
                
                # 成交價格
                price = trade.get('price', 0)
                ws[f'I{row}'] = f"＄{price:,.2f}" if price > 0 else '市價'
                
                # 成交金額
                fill_price = trade.get('fill_price', price)
                if fill_price and quantity:
                    amount = float(fill_price) * float(quantity)
                    ws[f'J{row}'] = f"＄{amount:,.2f}"
                else:
                    ws[f'J{row}'] = '-'
                
                # 手續費
                commission = trade.get('commission', 0)
                ws[f'K{row}'] = f"＄{commission:,.4f}" if commission else '-'
        
        # 保存檔案
        current_date = datetime.now().strftime('%Y-%m-%d')
        filename = f"BTC_{current_date}.xlsx"
        filepath = os.path.join(report_dir, filename)
        
        wb.save(filepath)
        print(f"BTC交易日報已生成: {filepath}")
        
        # 添加BTC系統日誌記錄
        log_btc_system_message(f"BTC_{filename} 生成成功！！！", "success")
        
        # 發送 Telegram 通知
        message = f"{filename} BTC交易日報已生成！！！"
        send_btc_telegram_message(message)
        
        return True
        
    except Exception as e:
        print(f"生成BTC交易日報失敗: {e}")
        import traceback
        traceback.print_exc()
        
        # 記錄錯誤到系統日誌
        try:
            log_btc_system_message(f"交易日報生成失敗：{str(e)[:100]}", "error")
        except:
            pass
        
        return False

def generate_btc_monthly_report():
    """生成BTC交易月報 - 參考TX格式"""
    try:
        import openpyxl
        from openpyxl.styles import Alignment, PatternFill, Font
        from openpyxl.utils import get_column_letter
        import calendar
        
        current_date = datetime.now()
        current_month = current_date.strftime('%Y-%m')
        report_time = current_date.strftime('%Y-%m-%d %H:%M:%S')
        
        # 創建工作簿
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"BTC_{current_month}"
        
        # 設置所有欄寬為19（與TX一致）
        for col in range(1, 12):
            ws.column_dimensions[get_column_letter(col)].width = 19
        
        # 設置樣式（與TX一致）
        header_font = Font(bold=True, size=14)
        blue_fill = PatternFill(start_color='B8CCE4', end_color='B8CCE4', fill_type='solid')
        gray_fill = PatternFill(start_color='D9D9D9', end_color='D9D9D9', fill_type='solid')
        center_alignment = Alignment(horizontal="center", vertical="center")
        
        # 報告標題（與TX一致）
        ws.merge_cells('A1:K1')
        ws['A1'] = f"BTC期貨交易月報 - {current_month}"
        ws['A1'].font = Font(bold=True, size=16)
        ws['A1'].alignment = center_alignment
        ws['A1'].fill = gray_fill
        
        # 讀取本月所有交易記錄
        btc_transdata_dir = os.path.join(os.path.dirname(__file__), 'BTCtransdata')
        month_trades = []
        
        if os.path.exists(btc_transdata_dir):
            try:
                # 獲取本月所有交易文件
                trade_files = glob.glob(os.path.join(btc_transdata_dir, 'BTCtrades_*.json'))
                
                for trade_file in trade_files:
                    try:
                        with open(trade_file, 'r', encoding='utf-8') as f:
                            daily_trades = json.load(f)
                            # 篩選本月的交易
                            for trade in daily_trades:
                                trade_time = trade.get('timestamp', '')
                                if current_month in trade_time:
                                    month_trades.append(trade)
                    except Exception as e:
                        print(f"讀取交易文件失敗 {trade_file}: {e}")
            except:
                pass
        
        # 交易總覽區塊（參考TX格式）
        row = 3
        ws['A3'] = '交易總覽'
        ws['A3'].font = header_font
        ws['A3'].fill = blue_fill
        ws['A3'].alignment = center_alignment
        ws.merge_cells('A3:K3')
        
        # 統計數據計算
        total_trades = len(month_trades)
        buy_trades = len([t for t in month_trades if t.get('side') == 'BUY'])
        sell_trades = len([t for t in month_trades if t.get('side') == 'SELL'])
        
        # 計算總交易量和BTC損益
        total_volume = sum(float(t.get('fill_quantity', t.get('quantity', 0))) for t in month_trades)
        
        # 交易總覽標題行（參考TX格式）
        row = 4
        titles = ['委託數量', '取消數量', '成交數量', '買入次數', '賣出次數', 'BTC損益', '總錢包餘額']
        for col, title in enumerate(titles, 1):
            cell = ws.cell(row=row, column=col, value=title)
            cell.fill = gray_fill
            cell.alignment = center_alignment
            cell.font = Font(bold=True, size=10)
        
        # 交易總覽數據行
        row = 5
        ws.cell(row=row, column=1, value=total_trades).alignment = center_alignment
        ws.cell(row=row, column=2, value=0).alignment = center_alignment  # 取消數量暫時為0
        ws.cell(row=row, column=3, value=total_trades).alignment = center_alignment
        ws.cell(row=row, column=4, value=buy_trades).alignment = center_alignment
        ws.cell(row=row, column=5, value=sell_trades).alignment = center_alignment
        ws.cell(row=row, column=6, value=f"{total_volume:.3f}").alignment = center_alignment
        
        # 獲取總錢包餘額
        if binance_client:
            try:
                account_data = binance_client.get_account_info()
                if account_data:
                    total_wallet = float(account_data.get('totalWalletBalance', 0))
                    ws.cell(row=5, column=7, value=f"{total_wallet:.2f}").alignment = center_alignment
            except Exception as e:
                print(f"獲取BTC月報帳戶資訊失敗: {e}")
                ws.cell(row=5, column=7, value="未知").alignment = center_alignment
        else:
            ws.cell(row=5, column=7, value="未知").alignment = center_alignment
        
        # 帳戶狀態區塊（參考TX格式）
        row = 7
        ws[f'A{row}'] = '帳戶狀態'
        ws[f'A{row}'].font = header_font
        ws[f'A{row}'].fill = blue_fill
        ws[f'A{row}'].alignment = center_alignment
        ws.merge_cells(f'A{row}:K{row}')
        
        # 帳戶狀態標題行 - 按新順序排列
        row = 8
        account_titles = ['錢包餘額', '可用餘額', '總保證金', '保證金餘額', '維持保證金', '保證金率', '手續費', '本月已實現盈虧']
        for col, title in enumerate(account_titles, 1):
            cell = ws.cell(row=row, column=col, value=title)
            cell.fill = gray_fill
            cell.alignment = center_alignment
            cell.font = Font(bold=True, size=10)
        
        # 帳戶狀態數據行 - 按新順序排列
        row = 9
        if binance_client:
            try:
                account_data = binance_client.get_account_info()
                if account_data:
                    wallet_balance = float(account_data.get('totalWalletBalance', 0))
                    available_balance = float(account_data.get('availableBalance', 0))
                    total_initial_margin = float(account_data.get('totalInitialMargin', 0))
                    total_margin_balance = float(account_data.get('totalMarginBalance', 0))
                    total_maint_margin = float(account_data.get('totalMaintMargin', 0))
                    
                    # 計算保證金率
                    margin_ratio = 0
                    if total_maint_margin > 0:
                        margin_ratio = (total_margin_balance / total_maint_margin) * 100
                    
                    ws.cell(row=row, column=1, value=f"{wallet_balance:.2f}").alignment = center_alignment      # 錢包餘額
                    ws.cell(row=row, column=2, value=f"{available_balance:.2f}").alignment = center_alignment   # 可用餘額
                    ws.cell(row=row, column=3, value=f"{total_initial_margin:.2f}").alignment = center_alignment # 總保證金
                    ws.cell(row=row, column=4, value=f"{total_margin_balance:.2f}").alignment = center_alignment # 保證金餘額
                    ws.cell(row=row, column=5, value=f"{total_maint_margin:.2f}").alignment = center_alignment   # 維持保證金
                    ws.cell(row=row, column=6, value=f"{margin_ratio:.2f}%").alignment = center_alignment       # 保證金率
                    ws.cell(row=row, column=7, value="0.00").alignment = center_alignment                       # 手續費（暫時為0）
                    ws.cell(row=row, column=8, value="0.00").alignment = center_alignment                       # 本月已實現盈虧（暫時為0）
            except Exception as e:
                print(f"獲取BTC月報帳戶詳細資訊失敗: {e}")
                for col in range(1, 9):  # 修改為9，因為現在有8個欄位
                    ws.cell(row=row, column=col, value="未知").alignment = center_alignment
        else:
            for col in range(1, 9):  # 修改為9，因為現在有8個欄位
                ws.cell(row=row, column=col, value="未知").alignment = center_alignment
        
        # 交易明細區塊（參考TX格式）
        row = 11
        ws[f'A{row}'] = '交易明細'
        ws[f'A{row}'].font = header_font
        ws[f'A{row}'].fill = blue_fill
        ws[f'A{row}'].alignment = center_alignment
        ws.merge_cells(f'A{row}:K{row}')
        
        # 交易明細表頭
        row = 12
        headers = ['日期', '時間', '合約', '方向', '數量', '成交價', '金額(USDT)', '訂單號', '狀態', '手續費', '備註']
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=row, column=col, value=header)
            cell.fill = gray_fill
            cell.alignment = center_alignment
            cell.font = Font(bold=True, size=10)
        
        # 按日期排序交易記錄
        month_trades.sort(key=lambda x: x.get('timestamp', ''))
        
        # 交易明細數據
        for trade in month_trades:
            row += 1
            timestamp = trade.get('timestamp', '')
            trade_date = timestamp[:10] if len(timestamp) >= 10 else ''
            trade_time = timestamp[11:19] if len(timestamp) >= 19 else ''
            symbol = trade.get('symbol', '')
            side = "做多" if trade.get('side') == 'BUY' else "做空"
            quantity = float(trade.get('fill_quantity', trade.get('quantity', 0)))
            price = float(trade.get('fill_price', 0))
            amount = quantity * price if price > 0 else 0
            order_id = str(trade.get('order_id', ''))
            status = trade.get('status', 'NEW')
            
            ws.cell(row=row, column=1, value=trade_date).alignment = center_alignment
            ws.cell(row=row, column=2, value=trade_time).alignment = center_alignment
            ws.cell(row=row, column=3, value=symbol).alignment = center_alignment
            ws.cell(row=row, column=4, value=side).alignment = center_alignment
            ws.cell(row=row, column=5, value=f"{quantity:.3f}").alignment = center_alignment
            ws.cell(row=row, column=6, value=f"{price:.2f}" if price else "-").alignment = center_alignment
            ws.cell(row=row, column=7, value=f"{amount:.2f}" if amount else "-").alignment = center_alignment
            ws.cell(row=row, column=8, value=order_id).alignment = center_alignment
            ws.cell(row=row, column=9, value=status).alignment = center_alignment
            ws.cell(row=row, column=10, value="0.00").alignment = center_alignment  # 手續費暫時為0
            ws.cell(row=row, column=11, value="").alignment = center_alignment  # 備註暫時為空
        
        if not month_trades:
            row = 13
            ws.cell(row=row, column=1, value="本月無交易記錄").alignment = center_alignment
            ws.merge_cells(f'A{row}:K{row}')
        
        # 報告生成時間
        row += 3
        ws.cell(row=row, column=1, value=f"報告生成時間：{report_time}")
        ws.cell(row=row, column=1).font = Font(size=10, italic=True)
        
        # 保存檔案
        monthly_report_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'BTC交易月報')
        os.makedirs(monthly_report_dir, exist_ok=True)
        
        # 提取年月
        year = datetime.now().year
        month = datetime.now().month
        filename = f"BTC_{year}-{month:02d}.xlsx"
        filepath = os.path.join(monthly_report_dir, filename)
        
        wb.save(filepath)
        print(f"BTC交易月報已生成: {filepath}")
        
        # 添加BTC系統日誌記錄
        log_btc_system_message(f"BTC_{filename} 生成成功！！！", "success")
        
        # 發送 Telegram 通知
        message = f"{filename} BTC交易月報已生成！！！"
        send_btc_telegram_message(message)
        
        return filepath
        
    except Exception as e:
        print(f"生成BTC交易月報失敗: {e}")
        return None

# ========================== API 路由函數 ==========================

def get_btc_config():
    """獲取BTC配置"""
    try:
        env_data = load_btc_env_data()
        return jsonify({
            'success': True,
            'config': env_data
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

def get_today_realized_pnl():
    """獲取本日已實現盈虧"""
    try:
        if not binance_client:
            return 0.0
        
        from datetime import datetime, timezone
        
        # 獲取今日00:00的時間戳
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        start_time = int(today.timestamp() * 1000)
        
        # 獲取收益歷史，只獲取已實現盈虧
        income_data = binance_client.get_income_history(
            income_type='REALIZED_PNL',
            limit=100
        )
        
        if not income_data:
            return 0.0
        
        # 計算本日已實現盈虧總和
        today_pnl = 0.0
        for income in income_data:
            income_time = int(income.get('time', 0))
            if income_time >= start_time:
                income_amount = float(income.get('income', 0))
                today_pnl += income_amount
        
        return today_pnl
        
    except Exception as e:
        print(f"獲取本日已實現盈虧失敗: {e}")
        return 0.0

def get_today_commission():
    """獲取本日手續費"""
    try:
        if not binance_client:
            return 0.0
        
        from datetime import datetime, timezone
        
        # 獲取今日00:00的時間戳
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        start_time = int(today.timestamp() * 1000)
        
        # 獲取收益歷史，只獲取手續費
        income_data = binance_client.get_income_history(
            income_type='COMMISSION',
            limit=100
        )
        
        if not income_data:
            return 0.0
        
        # 計算本日手續費總和（手續費通常是負值）
        today_commission = 0.0
        for income in income_data:
            income_time = int(income.get('time', 0))
            if income_time >= start_time:
                commission_amount = abs(float(income.get('income', 0)))  # 取絕對值
                today_commission += commission_amount
        
        return today_commission
        
    except Exception as e:
        print(f"獲取本日手續費失敗: {e}")
        return 0.0

def get_btc_account_info():
    """獲取BTC帳戶資訊"""
    try:
        if not binance_client:
            return jsonify({
                'success': False,
                'error': 'BTC客戶端未初始化'
            })
        
        # 獲取帳戶資訊
        account_data = binance_client.get_account_info()
        if not account_data:
            return jsonify({
                'success': False,
                'error': '無法獲取帳戶資訊'
            })
        
        # 獲取本日已實現盈虧
        today_realized_pnl = get_today_realized_pnl()
        
        # 獲取本日手續費
        today_commission = get_today_commission()
        
        # 按照指定順序重新組織帳戶資訊（使用有序字典確保順序）
        from collections import OrderedDict
        
        # 幣安API字段正確映射：
        # totalWalletBalance: 錢包餘額
        # availableBalance: 可用餘額  
        # totalInitialMargin: 保證金總額（原始保證金）
        # totalMarginBalance: 保證金餘額（可用保證金，錢包餘額 + 未實現盈虧）
        # totalMaintMargin: 維持保證金
        
        organized_account = OrderedDict([
            ('walletBalance', account_data.get('totalWalletBalance', '0')),          # 錢包餘額
            ('availableBalance', account_data.get('availableBalance', '0')),         # 可用餘額  
            ('totalMarginBalance', account_data.get('totalInitialMargin', '0')),     # 保證金總額（原始保證金）
            ('marginBalance', account_data.get('totalMarginBalance', '0')),          # 保證金餘額（可用保證金）
            ('maintMargin', account_data.get('totalMaintMargin', '0')),              # 維持保證金
            ('marginRatio', '無限大'),                                                # 保證金率
            ('todayCommission', str(today_commission)),                              # 手續費
            ('todayRealizedPnl', str(today_realized_pnl)),                          # 本日已實現盈虧
        ])
        
        # 計算保證金率（保證金餘額 / 維持保證金 × 100%）
        try:
            maint_margin = float(organized_account['maintMargin'])
            margin_balance = float(organized_account['marginBalance'])
            if maint_margin > 0:
                margin_ratio = (margin_balance / maint_margin) * 100
                organized_account['marginRatio'] = f"{margin_ratio:.1f}%"
            else:
                organized_account['marginRatio'] = "無限大"
        except:
            organized_account['marginRatio'] = "無法計算"
        
        return jsonify({
            'success': True,
            'account': organized_account
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

def get_btc_positions():
    """獲取BTC持倉資訊"""
    try:
        if not binance_client:
            return jsonify({
                'success': False,
                'error': 'BTC客戶端未初始化'
            })
        
        # 獲取持倉資訊
        positions = binance_client.get_position_info()
        if positions is None:
            return jsonify({
                'success': False,
                'error': '無法獲取持倉資訊'
            })
        
        # 篩選有效持倉（數量不為0的）
        valid_positions = []
        for pos in positions:
            if float(pos.get('positionAmt', 0)) != 0:
                valid_positions.append(pos)
        
        return jsonify({
            'success': True,
            'positions': valid_positions
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

# ========================== BTC風險管理功能 ==========================

def calculate_btc_risk_metrics():
    """計算BTC風險指標"""
    global binance_client, account_info
    
    try:
        if not binance_client or not account_info:
            return None
        
        # 獲取最新帳戶和持倉信息
        fresh_account_info = binance_client.get_account_info()
        positions = binance_client.get_position_info()
        
        if not fresh_account_info or not positions:
            return None
        
        # 基本帳戶數據
        total_wallet_balance = float(fresh_account_info.get('totalWalletBalance', 0))
        total_margin_balance = float(fresh_account_info.get('totalMarginBalance', 0))
        total_unrealized_pnl = float(fresh_account_info.get('totalUnrealizedProfit', 0))
        total_initial_margin = float(fresh_account_info.get('totalInitialMargin', 0))
        total_maint_margin = float(fresh_account_info.get('totalMaintMargin', 0))
        available_balance = float(fresh_account_info.get('availableBalance', 0))
        
        # 計算風險指標
        risk_metrics = {
            'total_wallet_balance': total_wallet_balance,
            'total_margin_balance': total_margin_balance,
            'available_balance': available_balance,
            'total_unrealized_pnl': total_unrealized_pnl,
            'total_initial_margin': total_initial_margin,
            'total_maint_margin': total_maint_margin,
            'margin_ratio': 0,
            'risk_level': 'SAFE',
            'leverage_usage': 0,
            'position_value': 0,
            'max_drawable': available_balance,
            'positions': []
        }
        
        # 保證金比率計算
        if total_maint_margin > 0:
            risk_metrics['margin_ratio'] = (total_margin_balance / total_maint_margin) * 100
        
        # 槓桿使用率計算
        if total_wallet_balance > 0:
            risk_metrics['leverage_usage'] = (total_initial_margin / total_wallet_balance) * 100
        
        # 處理持倉信息
        total_position_value = 0
        active_positions = []
        
        for pos in positions:
            position_amt = float(pos.get('positionAmt', 0))
            if position_amt != 0:
                entry_price = float(pos.get('entryPrice', 0))
                mark_price = float(pos.get('markPrice', 0))
                unrealized_pnl = float(pos.get('unRealizedProfit', 0))
                percentage = float(pos.get('percentage', 0))
                leverage = float(pos.get('leverage', 1))
                
                position_value = abs(position_amt) * mark_price
                total_position_value += position_value
                
                position_info = {
                    'symbol': pos.get('symbol'),
                    'side': 'LONG' if position_amt > 0 else 'SHORT',
                    'size': abs(position_amt),
                    'entry_price': entry_price,
                    'mark_price': mark_price,
                    'unrealized_pnl': unrealized_pnl,
                    'percentage': percentage,
                    'leverage': leverage,
                    'position_value': position_value,
                    'margin_required': position_value / leverage if leverage > 0 else 0
                }
                active_positions.append(position_info)
        
        risk_metrics['position_value'] = total_position_value
        risk_metrics['positions'] = active_positions
        
        # 風險等級評估
        margin_ratio = risk_metrics['margin_ratio']
        leverage_usage = risk_metrics['leverage_usage']
        
        if margin_ratio > 0:
            if margin_ratio < 120:  # 強制平倉風險高
                risk_metrics['risk_level'] = 'HIGH'
            elif margin_ratio < 200:  # 中等風險
                risk_metrics['risk_level'] = 'MEDIUM'
            else:  # 安全
                risk_metrics['risk_level'] = 'SAFE'
        
        # 槓桿使用率風險
        if leverage_usage > 80:
            if risk_metrics['risk_level'] in ['SAFE', 'MEDIUM']:
                risk_metrics['risk_level'] = 'MEDIUM'
        elif leverage_usage > 90:
            risk_metrics['risk_level'] = 'HIGH'
        
        return risk_metrics
        
    except Exception as e:
        print(f"計算BTC風險指標失敗: {e}")
        return None

def check_btc_risk_alerts():
    """檢查BTC風險警報"""
    try:
        risk_metrics = calculate_btc_risk_metrics()
        if not risk_metrics:
            return
        
        risk_level = risk_metrics['risk_level']
        margin_ratio = risk_metrics['margin_ratio']
        leverage_usage = risk_metrics['leverage_usage']
        total_unrealized_pnl = risk_metrics['total_unrealized_pnl']
        
        # 檢查是否需要發送風險警報
        alerts = []
        
        # 強制平倉風險警報
        if margin_ratio > 0 and margin_ratio < 120:
            alerts.append({
                'type': 'LIQUIDATION_RISK',
                'level': 'CRITICAL',
                'message': f'⚠️ 強制平倉風險警報\n保證金比率: {margin_ratio:.1f}%\n請及時補充保證金或減少持倉！'
            })
        elif margin_ratio > 0 and margin_ratio < 200:
            alerts.append({
                'type': 'MARGIN_WARNING',
                'level': 'WARNING',
                'message': f'⚠️ 保證金警告\n保證金比率: {margin_ratio:.1f}%\n建議關注風險控制'
            })
        
        # 槓桿使用率警報
        if leverage_usage > 90:
            alerts.append({
                'type': 'LEVERAGE_RISK',
                'level': 'WARNING',
                'message': f'⚠️ 槓桿使用率過高\n使用率: {leverage_usage:.1f}%\n建議降低槓桿或增加保證金'
            })
        
        # 大額未實現虧損警報
        if total_unrealized_pnl < -1000:  # 虧損超過1000 USDT
            alerts.append({
                'type': 'LARGE_LOSS',
                'level': 'WARNING',
                'message': f'⚠️ 大額未實現虧損\n虧損金額: {total_unrealized_pnl:.2f} USDT\n請考慮風險控制措施'
            })
        
        # 發送警報通知
        for alert in alerts:
            send_btc_risk_alert(alert)
            
        # 記錄風險檢查日誌
        print(f"BTC風險檢查完成 - 風險等級: {risk_level}, 保證金比率: {margin_ratio:.1f}%, 槓桿使用率: {leverage_usage:.1f}%")
        
    except Exception as e:
        print(f"BTC風險檢查失敗: {e}")

def send_btc_risk_alert(alert):
    """發送BTC風險警報通知"""
    try:
        current_time = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        
        # 構建警報訊息
        level_emoji = {
            'CRITICAL': '🚨',
            'WARNING': '⚠️',
            'INFO': 'ℹ️'
        }
        
        emoji = level_emoji.get(alert['level'], '⚠️')
        
        message = f"{emoji} BTC風險管理警報 ({current_time})\n\n{alert['message']}\n\n請及時處理以避免損失！"
        
        # 發送Telegram通知
        send_btc_telegram_message(message)
        
        # 記錄到風險日誌
        risk_log = {
            'timestamp': current_time,
            'alert_type': alert['type'],
            'level': alert['level'],
            'message': alert['message']
        }
        
        print(f"BTC風險警報已發送: {alert['type']} - {alert['level']}")
        
    except Exception as e:
        print(f"發送BTC風險警報失敗: {e}")


def get_btc_risk_status():
    """獲取BTC風險狀態API"""
    try:
        risk_metrics = calculate_btc_risk_metrics()
        if not risk_metrics:
            return jsonify({
                'success': False,
                'message': '無法獲取風險數據'
            })
        
        return jsonify({
            'success': True,
            'risk_metrics': risk_metrics
        })
        
    except Exception as e:
        print(f"獲取BTC風險狀態失敗: {e}")
        return jsonify({
            'success': False,
            'message': f'獲取失敗: {str(e)}'
        })

def start_btc_risk_monitoring():
    """啟動BTC風險監控"""
    print("BTC風險監控已啟動")
    
    while True:
        try:
            # 每分鐘檢查一次風險
            check_btc_risk_alerts()
            time.sleep(60)  # 等待60秒
            
        except Exception as e:
            print(f"BTC風險監控異常: {e}")
            time.sleep(60)  # 發生錯誤時也等待60秒

# ========================== BTC WebSocket實時數據 ==========================
import websocket
import ssl

# WebSocket全局變量
btc_ws = None
btc_ws_thread = None
btc_real_time_data = {}
btc_ws_connected = False

def start_btc_websocket():
    """啟動BTC WebSocket連接"""
    global btc_ws, btc_ws_thread, btc_ws_connected
    
    try:
        if btc_ws_connected:
            print("BTC WebSocket已連接")
            return True
        
        # 獲取活躍的交易對
        env_data = load_btc_env_data()
        trading_pair = env_data.get('TRADING_PAIR', 'BTCUSDT').lower()
        
        # 構建WebSocket URL - 幣安期貨WebSocket
        ws_url = f"wss://fstream.binance.com/ws/{trading_pair}@ticker"
        
        print(f"啟動BTC WebSocket連接: {ws_url}")
        
        # 創建WebSocket連接
        btc_ws = websocket.WebSocketApp(
            ws_url,
            on_open=on_btc_ws_open,
            on_message=on_btc_ws_message,
            on_error=on_btc_ws_error,
            on_close=on_btc_ws_close
        )
        
        # 在新線程中運行WebSocket
        btc_ws_thread = threading.Thread(
            target=btc_ws.run_forever,
            kwargs={'sslopt': {"cert_reqs": ssl.CERT_NONE}},
            daemon=True
        )
        btc_ws_thread.start()
        
        print("BTC WebSocket線程已啟動")
        return True
        
    except Exception as e:
        print(f"啟動BTC WebSocket失敗: {e}")
        return False

def on_btc_ws_open(ws):
    """WebSocket連接開啟"""
    global btc_ws_connected
    btc_ws_connected = True
    print("BTC WebSocket連接成功")

def on_btc_ws_message(ws, message):
    """處理WebSocket訊息"""
    global btc_real_time_data
    
    try:
        data = json.loads(message)
        
        # 更新實時數據
        btc_real_time_data.update({
            'symbol': data.get('s'),
            'price': float(data.get('c', 0)),  # 最新價格
            'price_change': float(data.get('P', 0)),  # 24小時價格變化百分比
            'price_change_abs': float(data.get('p', 0)),  # 24小時價格變化金額
            'high_price': float(data.get('h', 0)),  # 24小時最高價
            'low_price': float(data.get('l', 0)),  # 24小時最低價
            'volume': float(data.get('v', 0)),  # 24小時交易量
            'quote_volume': float(data.get('q', 0)),  # 24小時交易額
            'timestamp': datetime.now().isoformat()
        })
        
        # 計算更新後的持倉盈虧（如果有持倉）
        update_btc_position_pnl()
        
    except Exception as e:
        print(f"處理BTC WebSocket訊息失敗: {e}")

def on_btc_ws_error(ws, error):
    """WebSocket錯誤"""
    print(f"BTC WebSocket錯誤: {error}")

def on_btc_ws_close(ws, close_status_code, close_msg):
    """WebSocket連接關閉"""
    global btc_ws_connected
    btc_ws_connected = False
    print(f"BTC WebSocket連接關閉: {close_status_code} - {close_msg}")
    
    # 嘗試重新連接
    threading.Timer(5.0, reconnect_btc_websocket).start()

def reconnect_btc_websocket():
    """重新連接WebSocket"""
    print("嘗試重新連接BTC WebSocket...")
    start_btc_websocket()

def stop_btc_websocket():
    """停止BTC WebSocket連接"""
    global btc_ws, btc_ws_connected
    
    try:
        if btc_ws:
            btc_ws_connected = False
            btc_ws.close()
            print("BTC WebSocket連接已關閉")
    except Exception as e:
        print(f"關閉BTC WebSocket失敗: {e}")

def update_btc_position_pnl():
    """根據實時價格更新持倉盈虧"""
    global binance_client, btc_real_time_data
    
    try:
        if not binance_client or not btc_real_time_data:
            return
        
        current_price = btc_real_time_data.get('price', 0)
        if current_price <= 0:
            return
        
        # 獲取持倉信息（簡化版，只獲取基本數據）
        positions = binance_client.get_position_info()
        if not positions:
            return
        
        # 更新實時盈虧數據
        for pos in positions:
            position_amt = float(pos.get('positionAmt', 0))
            if position_amt != 0:
                entry_price = float(pos.get('entryPrice', 0))
                if entry_price > 0:
                    # 計算實時盈虧
                    if position_amt > 0:  # 多頭
                        pnl = (current_price - entry_price) * position_amt
                    else:  # 空頭
                        pnl = (entry_price - current_price) * abs(position_amt)
                    
                    # 更新實時數據
                    btc_real_time_data[f'position_pnl_{pos.get("symbol")}'] = pnl
        
    except Exception as e:
        print(f"更新BTC持倉盈虧失敗: {e}")

def get_btc_realtime_data():
    """獲取BTC實時數據API"""
    global btc_real_time_data, btc_ws_connected
    
    try:
        return jsonify({
            'success': True,
            'connected': btc_ws_connected,
            'data': btc_real_time_data,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"獲取BTC實時數據失敗: {e}")
        return jsonify({
            'success': False,
            'message': f'獲取失敗: {str(e)}'
        })

