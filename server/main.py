from flask import Flask, send_from_directory, request, jsonify, abort
from flask_cors import CORS
import threading
import webview
import os
import re
import requests
import subprocess
import json
import time
import atexit
import signal
import sys
import platform
import zipfile
import shutil
from datetime import datetime, timezone, timedelta
import csv
import logging
import schedule

# 永豐API相關
try:
    import shioaji as sj
    from dotenv import load_dotenv
    SHIOAJI_AVAILABLE = True
    DOTENV_AVAILABLE = True
except ImportError as e:
    if 'shioaji' in str(e):
        SHIOAJI_AVAILABLE = False
        print("警告: shioaji 模組未安裝，永豐API功能將無法使用")
    if 'dotenv' in str(e):
        DOTENV_AVAILABLE = False
        print("警告: python-dotenv 模組未安裝")
    try:
        import shioaji as sj
        SHIOAJI_AVAILABLE = True
    except ImportError:
        SHIOAJI_AVAILABLE = False
    try:
        from dotenv import load_dotenv
        DOTENV_AVAILABLE = True
    except ImportError:
        DOTENV_AVAILABLE = False

# 創建兼容的常數處理類別
class SafeConstants:
    """安全的常數處理類別，避免shioaji版本相容性問題"""
    
    @staticmethod
    def get_action(action_str):
        """獲取動作常數"""
        if not SHIOAJI_AVAILABLE:
            return action_str
        try:
            if action_str.upper() == 'BUY':
                return sj.constant.Action.Buy
            else:
                return sj.constant.Action.Sell
        except AttributeError:
            return action_str
    
    @staticmethod
    def get_price_type(price_type_str):
        """獲取價格類型常數"""
        if not SHIOAJI_AVAILABLE:
            return price_type_str
        try:
            if price_type_str.upper() == 'MKT':
                return sj.constant.FuturesPriceType.MKT
            else:
                return sj.constant.FuturesPriceType.LMT
        except AttributeError:
            return price_type_str
    
    @staticmethod
    def get_order_type(order_type_str):
        """獲取訂單類型常數"""
        if not SHIOAJI_AVAILABLE:
            return order_type_str
        try:
            if order_type_str.upper() == 'IOC':
                return sj.constant.FuturesOrderType.IOC
            else:
                return sj.constant.FuturesOrderType.ROD
        except AttributeError:
            return order_type_str
    
    @staticmethod
    def get_oc_type(oc_type='Auto'):
        """獲取開平倉類型常數"""
        if not SHIOAJI_AVAILABLE:
            return oc_type
        try:
            if oc_type.upper() == 'NEW':
                return sj.constant.FuturesOCType.New
            elif oc_type.upper() == 'COVER':
                return sj.constant.FuturesOCType.Cover
            else:
                return sj.constant.FuturesOCType.Auto
        except AttributeError:
            return oc_type
    
    @staticmethod
    def check_order_status(status, target_status):
        """檢查訂單狀態"""
        if not SHIOAJI_AVAILABLE:
            return str(status).upper() == target_status.upper()
        try:
            if target_status.upper() == 'FILLED':
                return status == sj.constant.OrderStatus.Filled
            elif target_status.upper() == 'FAILED':
                return status == sj.constant.OrderStatus.Failed
            else:
                return False
        except AttributeError:
            return str(status).upper() == target_status.upper()

safe_constants = SafeConstants()

app = Flask(__name__, static_folder='web', static_url_path='')
CORS(app, origins=['*'])  # 允許所有域名的跨域請求

# ngrok相關變數
ngrok_process = None
ngrok_status = "stopped"  # stopped, starting, running, error
ngrok_version = None
ngrok_update_available = False
ngrok_auto_restart_timer = None  # 自動重啟定時器

# 永豐API相關變數
sinopac_api = None
sinopac_connected = False
sinopac_account = None
sinopac_login_status = False
sinopac_login_time = None  # 新增：記錄登入時間

# 期貨合約相關變數
futures_contracts = {
    'TXF': None,  # 大台指
    'MXF': None,  # 小台指
    'TMF': None   # 微台指
}
margin_requirements = {
    '大台': 0,
    '小台': 0,
    '微台': 0
}

# 新增：12小時自動登出相關變數
AUTO_LOGOUT_HOURS = 12  # 12小時自動登出
auto_logout_timer = None  # 自動登出定時器

# 新增：記錄上一次的保證金金額
last_margin_requirements = {
    '大台': 0,
    '小台': 0,
    '微台': 0
}

# 新增：訂單映射管理（參考TXserver.py架構）
order_octype_map = {}  # 記錄訂單詳細資訊
global_lock = threading.Lock()  # 線程鎖

# TXserver 風格的全域變數和狀態管理
contract_txf = None
contract_mxf = None 
contract_tmf = None
active_trades = {"txf": None, "mxf": None, "tmf": None}
recent_signals = set()
contract_key_map = {"大台": "txf", "小台": "mxf", "微台": "tmf"}
# 轉倉相關變數
has_processed_delivery_exit = False
rollover_mode = False  # 是否處於轉倉模式
next_month_contracts = {}  # 次月合約快取
rollover_start_date = None  # 轉倉開始日期
rollover_processed_signals = set()  # 已處理的轉倉訊號ID

# 斷線重連相關變數
connection_monitor_timer = None  # 連線監控定時器
connection_check_interval = 60  # 每1分鐘檢查一次連線狀態
max_reconnect_attempts = 999  # 無限重連嘗試
reconnect_attempts = 0  # 當前重連嘗試次數
last_connection_check = None  # 上次連線檢查時間
is_reconnecting = False  # 是否正在重連中

# 自定義請求日誌系統（用於前端顯示）
custom_request_logs = []
MAX_CUSTOM_LOGS = 50  # 最多保留50筆記錄

# 新增：錯誤訊息翻譯對照表
OP_MSG_TRANSLATIONS = {
    "Order not found": "訂單未找到",
    "Price not satisfied": "價格未滿足",
    "Insufficient margin": "保證金不足",
    "Invalid quantity": "無效數量",
    "Invalid price": "無效價格",
    "Market closed": "市場已關閉",
    "非該商品可下單時間": "非交易時間",
    "可委託金額不足": "保證金不足",
    "委託價格不符合規範": "委託價格不符合規範",
    "委託數量不符合規範": "委託數量不符合規範",
    "帳戶未開啟": "帳戶未開啟",
    "未開放交易": "未開放交易",
    "已超過風控限制": "已超過風控限制",
    "該商品已停止交易": "該商品已停止交易",
    "無足夠庫存": "無足夠庫存",
    "委託失敗": "委託失敗",
    "系統忙碌中": "系統忙碌中",
    "超過單筆委託數量限制": "超過單筆委託數量限制",
    "超過單日委託數量限制": "超過單日委託數量限制",
    "不可做空": "不可做空",
    "暫停交易": "暫停交易",
    "漲跌停限制": "漲跌停限制",
    "未知錯誤": "未知錯誤",
    "Order Cancelled": "手動取消訂單",
    "cancelled": "手動取消訂單",
    "Cancelled": "手動取消訂單",
    "CANCELLED": "手動取消訂單",
    "手動取消": "手動取消訂單",
    "取消訂單": "手動取消訂單"
}

ENV_TEMPLATE = '''# Telegram Bot
BOT_TOKEN=7202376519:AAF-i3MbuMEpz0W7nFE9KmieqVw7L5s0xK4

# Telegram ID
CHAT_ID=

# 永豐 API Key
API_KEY=

# 永豐 Secret Key
SECRET_KEY=

# 身分證字號
PERSON_ID=

# 台股日曆
HOLIDAY_DIR=Desktop/AutoTX/server/holiday

# 憑證檔案
CA_PATH=Desktop/AutoTX/server/holiday

# 憑證密碼
CA_PASSWD=

# 憑證起始日
CERT_START=

# 憑證到期日
CERT_END=

# 登入狀態
LOGIN=0
'''

CONFIG_DIR = os.path.join(os.path.dirname(__file__), 'config')
ENV_PATH = os.path.join(CONFIG_DIR, '.env')
os.makedirs(CONFIG_DIR, exist_ok=True)
if not os.path.exists(ENV_PATH):
    with open(ENV_PATH, 'w', encoding='utf-8') as f:
        f.write(ENV_TEMPLATE)

def update_login_status(status):
    """更新LOGIN狀態的通用函數"""
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        found = False
        for i, line in enumerate(lines):
            if line.startswith('LOGIN='):
                lines[i] = f'LOGIN={status}\n'
                found = True
                break
        if not found:
            lines.append(f'LOGIN={status}\n')
        with open(ENV_PATH, 'w', encoding='utf-8') as f:
            f.writelines(lines)

def get_ngrok_version():
    """獲取當前ngrok版本"""
    global ngrok_version
    try:
        ngrok_exe_path = os.path.join(os.path.dirname(__file__), 'ngrok.exe')
        if not os.path.exists(ngrok_exe_path):
            return None
        
        result = subprocess.run(
            [ngrok_exe_path, 'version'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            # 解析版本信息，通常格式為 "ngrok version 3.x.x"
            output = result.stdout.strip()
            if 'version' in output:
                version_line = output.split('\n')[0]
                version_match = re.search(r'version\s+([\d\.]+)', version_line)
                if version_match:
                    ngrok_version = version_match.group(1)
                    return ngrok_version
        return None
    except Exception as e:
        print(f"獲取ngrok版本失敗: {e}")
        return None

def check_ngrok_update():
    global ngrok_update_available
    try:
        # 獲取GitHub最新版本信息
        response = requests.get(
            'https://api.github.com/repos/ngrok/ngrok-go/releases/latest',
            timeout=10
        )
        if response.status_code == 200:
            latest_release = response.json()
            latest_version = latest_release['tag_name'].lstrip('v')
            current_version = get_ngrok_version()
            if current_version:
                if compare_versions(latest_version, current_version) > 0:
                    ngrok_update_available = True
                    return {
                        'update_available': True,
                        'current_version': current_version,
                        'latest_version': latest_version,
                        'download_url': get_download_url(latest_release)
                    }
                else:
                    ngrok_update_available = False
                    return {
                        'update_available': False,
                        'current_version': current_version,
                        'latest_version': latest_version
                    }
            else:
                return {
                    'update_available': True,
                    'current_version': 'unknown',
                    'latest_version': latest_version,
                    'download_url': get_download_url(latest_release)
                }
        else:
            return None
    except Exception:
        return check_ngrok_update_alternative()

def compare_versions(version1, version2):
    """比較版本號，返回1表示version1更新，-1表示version2更新，0表示相同"""
    try:
        v1_parts = [int(x) for x in version1.split('.')]
        v2_parts = [int(x) for x in version2.split('.')]
        
        # 補齊位數
        max_len = max(len(v1_parts), len(v2_parts))
        v1_parts.extend([0] * (max_len - len(v1_parts)))
        v2_parts.extend([0] * (max_len - len(v2_parts)))
        
        for i in range(max_len):
            if v1_parts[i] > v2_parts[i]:
                return 1
            elif v1_parts[i] < v2_parts[i]:
                return -1
        return 0
    except:
        return 0

def get_download_url(release_data):
    """獲取適合當前系統的ngrok下載URL"""
    try:
        system = platform.system().lower()
        arch = platform.machine().lower()
        
        # 確定系統類型
        if system == 'windows':
            if '64' in arch or 'amd64' in arch:
                target = 'windows_amd64'
            else:
                target = 'windows_386'
        elif system == 'darwin':  # macOS
            if 'arm' in arch or 'aarch64' in arch:
                target = 'darwin_arm64'
            else:
                target = 'darwin_amd64'
        elif system == 'linux':
            if 'arm' in arch:
                target = 'linux_arm64'
            elif '64' in arch:
                target = 'linux_amd64'
            else:
                target = 'linux_386'
        else:
            return None
        
        # 在release資產中尋找匹配的下載鏈接
        for asset in release_data['assets']:
            if target in asset['name'] and asset['name'].endswith('.zip'):
                return asset['browser_download_url']
        
        return None
    except Exception as e:
        print(f"獲取下載URL失敗: {e}")
        return None

def download_and_update_ngrok(download_url, backup=True):
    """下載並更新ngrok"""
    try:
        ngrok_exe_path = os.path.join(os.path.dirname(__file__), 'ngrok.exe')
        temp_dir = os.path.join(os.path.dirname(__file__), 'temp_ngrok')
        
        # 創建臨時目錄
        os.makedirs(temp_dir, exist_ok=True)
        
        # 停止當前ngrok
        stop_ngrok()
        
        # 備份舊版本
        if backup and os.path.exists(ngrok_exe_path):
            backup_path = ngrok_exe_path + '.backup'
            shutil.copy2(ngrok_exe_path, backup_path)
            print(f"已備份舊版本到: {backup_path}")
        
        # 下載新版本
        print(f"正在下載ngrok更新...")
        response = requests.get(download_url, stream=True, timeout=300)
        response.raise_for_status()
        
        zip_path = os.path.join(temp_dir, 'ngrok.zip')
        with open(zip_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        # 解壓縮
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        # 找到ngrok執行檔並替換
        for file in os.listdir(temp_dir):
            if file.startswith('ngrok') and (file.endswith('.exe') or '.' not in file):
                source_path = os.path.join(temp_dir, file)
                if os.path.exists(ngrok_exe_path):
                    os.remove(ngrok_exe_path)
                shutil.move(source_path, ngrok_exe_path)
                
                # 在Unix系統上設置執行權限
                if not ngrok_exe_path.endswith('.exe'):
                    os.chmod(ngrok_exe_path, 0o755)
                
                print(f"ngrok更新完成！")
                break
        
        # 清理臨時檔案
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        # 更新版本信息
        get_ngrok_version()
        
        return True
        
    except Exception as e:
        print(f"ngrok更新失敗: {e}")
        # 嘗試還原備份
        if backup:
            backup_path = ngrok_exe_path + '.backup'
            if os.path.exists(backup_path):
                try:
                    shutil.copy2(backup_path, ngrok_exe_path)
                    print("已還原備份版本")
                except:
                    pass
        return False

def auto_update_ngrok_if_needed():
    """如果需要且用戶同意，自動更新ngrok"""
    try:
        update_info = check_ngrok_update()
        if update_info and update_info.get('update_available'):
            current_ver = update_info.get('current_version', 'unknown')
            latest_ver = update_info.get('latest_version', 'unknown')
            download_url = update_info.get('download_url')
            
            if download_url:
                print(f"檢測到ngrok更新: {current_ver} -> {latest_ver}")
                # 這裡可以添加用戶確認機制，暫時自動更新
                return download_and_update_ngrok(download_url)
        return False
    except Exception as e:
        print(f"自動更新檢查失敗: {e}")
        return False

def start_ngrok():
    """啟動ngrok"""
    global ngrok_process, ngrok_status
    
    try:
        print("開始啟動 ngrok...")
        ngrok_status = "starting"
        ngrok_exe_path = os.path.join(os.path.dirname(__file__), 'ngrok.exe')
        
        # 檢查ngrok是否需要更新（在背景執行，不阻塞啟動）
        def check_update_background():
            try:
                auto_update_ngrok_if_needed()
            except Exception as e:
                print(f"背景更新檢查失敗: {e}")
        
        threading.Thread(target=check_update_background, daemon=True).start()
        
        if not os.path.exists(ngrok_exe_path):
            print(f"ngrok.exe 不存在於路徑: {ngrok_exe_path}")
            ngrok_status = "error"
            return False
        
        print(f"找到 ngrok.exe: {ngrok_exe_path}")
        
        # 先檢查是否已經有ngrok在運行
        try:
            response = requests.get('http://localhost:4040/api/tunnels', timeout=2)
            if response.status_code == 200:
                tunnels = response.json()['tunnels']
                if tunnels:
                    # 檢查是否有對應當前端口的tunnel
                    for tunnel in tunnels:
                        config_addr = tunnel.get('config', {}).get('addr', '')
                        if str(CURRENT_PORT) in config_addr:
                            print(f"找到對應{CURRENT_PORT}端口的tunnel: {tunnel.get('public_url', 'N/A')}")
                            ngrok_status = "running"
                            return True
                    
                    # 如果沒有當前端口的tunnel，但有其他tunnel在運行，認為ngrok已經啟動
                    ngrok_status = "running"
                    print(f"ngrok已啟動，但沒有{CURRENT_PORT}端口的tunnel，共有{len(tunnels)}個tunnel")
                    return True
        except Exception as e:
            print(f"檢查現有ngrok狀態失敗: {e}")
            pass
        
        # 如果沒有ngrok在運行，啟動新的ngrok進程
        print("啟動新的 ngrok 進程...")
        
        # 在背景運行 ngrok，不使用 CREATE_NEW_CONSOLE
        ngrok_process = subprocess.Popen(
            [ngrok_exe_path, 'http', str(CURRENT_PORT)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        print(f"ngrok 進程已啟動，PID: {ngrok_process.pid}")
        
        # 等待 ngrok 啟動
        time.sleep(3)
        
        # 檢查是否啟動成功
        try:
            response = requests.get('http://localhost:4040/api/tunnels', timeout=5)
            if response.status_code == 200:
                tunnels = response.json()['tunnels']
                for tunnel in tunnels:
                    config_addr = tunnel.get('config', {}).get('addr', '')
                    # 找到對應當前端口的tunnel
                    if str(CURRENT_PORT) in config_addr:
                        print(f"ngrok 啟動成功！找到對應{CURRENT_PORT}端口的tunnel: {tunnel.get('public_url', 'N/A')}")
                        ngrok_status = "running"
                        return True
                print("ngrok 啟動成功，但沒有找到當前端口的tunnel")
                ngrok_status = "running"
                return True
            print("ngrok 啟動失敗")
            ngrok_status = "error"
            return False
        except Exception as e:
            print(f"檢查ngrok啟動狀態失敗: {e}")
            ngrok_status = "error"
            return False
        
    except Exception as e:
        print(f"啟動 ngrok 時發生錯誤: {e}")
        ngrok_status = "error"
        return False

def stop_ngrok():
    """停止ngrok"""
    global ngrok_process, ngrok_status
    
    if ngrok_process:
        ngrok_process.terminate()
        ngrok_process = None
    
    ngrok_status = "stopped"

def get_ngrok_status():
    """獲取ngrok狀態"""
    global ngrok_status, ngrok_auto_restart_timer
    
    try:
        # 獲取ngrok session狀態
        session_response = requests.get('http://localhost:4040/api/tunnels', timeout=2)
        if session_response.status_code == 200:
            tunnels_data = session_response.json()
            
            tunnels = tunnels_data.get('tunnels', [])
            if tunnels:
                # 檢查是否有任何tunnel在線
                online_tunnels = []
                tunnel_urls = []
                
                for tunnel in tunnels:
                    public_url = tunnel.get('public_url', '')
                    config_addr = tunnel.get('config', {}).get('addr', '')
                    tunnel_name = tunnel.get('name', 'unnamed')
                    
                    if public_url:
                        online_tunnels.append(tunnel)
                        tunnel_urls.append({
                            'name': tunnel_name,
                            'url': public_url,
                            'local_addr': config_addr
                        })
                
                if online_tunnels:
                    # 如果有tunnel在線，顯示所有tunnel的URL
                    # 對URL進行排序：按照本地端口號從小到大排序
                    def extract_local_port(tunnel_info):
                        """從本地地址中提取端口號"""
                        try:
                            local_addr = tunnel_info.get('local_addr', '')
                            # 從 http://localhost:5000 中提取端口號
                            if ':' in local_addr:
                                port_str = local_addr.split(':')[-1]
                                return int(port_str)
                            return 9999  # 如果沒有端口號，放到最後
                        except:
                            return 9999  # 如果解析失敗，放到最後
                    
                    tunnel_urls.sort(key=lambda x: extract_local_port(x))
                    
                    ngrok_status = "running"
                    # 取消自動重啟定時器
                    if ngrok_auto_restart_timer:
                        ngrok_auto_restart_timer.cancel()
                        ngrok_auto_restart_timer = None
                    
                    return {
                        'status': 'running',
                        'urls': tunnel_urls,
                        'message': 'online'
                    }
                else:
                    ngrok_status = "error"
                    return {
                        'status': 'error',
                        'urls': [],
                        'message': 'offline'
                    }
    except Exception:
        pass
    
    # 如果無法連接到ngrok API，檢查進程狀態
    if ngrok_process and ngrok_process.poll() is None:
        # 進程還在運行，但API無法連接
        ngrok_status = "checking"
        return {
            'status': 'checking',
            'urls': [],
            'message': 'checking ngrok status...'
        }
    else:
        # 進程已停止，啟動自動重連
        if ngrok_status == "running" and not ngrok_auto_restart_timer:
            print("ngrok 進程已停止，啟動自動重連...")
            start_ngrok_auto_restart()
        
        # 進程已停止
        ngrok_status = "stopped"
        return {
            'status': 'stopped',
            'urls': [],
            'message': 'offline'
        }

def get_ngrok_latency():
    """獲取ngrok延遲"""
    try:
        # 先檢查ngrok狀態
        status_response = requests.get('http://localhost:4040/api/tunnels', timeout=2)
        if status_response.status_code == 200:
            tunnels_data = status_response.json()
            tunnels = tunnels_data.get('tunnels', [])
            
            # 只有在有tunnel運行時才獲取延遲
            if tunnels:
                response = requests.get('http://localhost:4040/api/status', timeout=2)
                if response.status_code == 200:
                    data = response.json()
                    if 'session' in data and 'legs' in data['session'] and len(data['session']['legs']) > 0:
                        latency = data['session']['legs'][0].get('latency', '0ms')
                        return {'latency': latency}
    except Exception:
        # 靜默處理錯誤，不輸出DEBUG訊息
        pass
    
    return {'latency': '-'}

def get_ngrok_connections():
    """獲取ngrok連接統計信息"""
    try:
        # 先檢查ngrok狀態
        status_response = requests.get('http://localhost:4040/api/tunnels', timeout=3)
        if status_response.status_code == 200:
            tunnels_data = status_response.json()
            tunnels = tunnels_data.get('tunnels', [])
            
            # 只有在有tunnel運行時才獲取連接統計
            if tunnels:
                response = requests.get('http://localhost:4040/api/status', timeout=3)
                if response.status_code == 200:
                    data = response.json()
                    if 'session' in data and 'legs' in data['session'] and len(data['session']['legs']) > 0:
                        leg = data['session']['legs'][0]
                        connections = leg.get('connections', {})
                        
                        return {
                            'ttl': connections.get('ttl', 0),
                            'opn': connections.get('opn', 0),
                            'rt1': connections.get('rt1', 0.00),
                            'rt5': connections.get('rt5', 0.00),
                            'p50': connections.get('p50', 0.00),
                            'p90': connections.get('p90', 0.00)
                        }
    except Exception:
        # 靜默處理錯誤，不輸出DEBUG訊息
        pass
    
    return {
        'ttl': 0,
        'opn': 0,
        'rt1': 0.00,
        'rt5': 0.00,
        'p50': 0.00,
        'p90': 0.00
    }

def add_custom_request_log(method, uri, status, extra_info=None):
    """添加自定義請求記錄"""
    global custom_request_logs
    
    # 建立時間戳（ngrok 格式）
    now = datetime.now()
    time_str = now.strftime('%H:%M:%S.%f')[:-3] + ' CST'
    
    # 建立請求記錄
    log_entry = {
        'timestamp': time_str,
        'method': method,
        'uri': uri,
        'status': status,
        'status_text': get_status_text(status),
        'type': 'webhook' if uri == '/webhook' else 'custom',
        'extra_info': extra_info or {}
    }
    
    # 添加到日誌列表
    with global_lock:
        custom_request_logs.append(log_entry)
        # 保持日誌數量在限制內
        if len(custom_request_logs) > MAX_CUSTOM_LOGS:
            custom_request_logs = custom_request_logs[-MAX_CUSTOM_LOGS:]

def get_ngrok_requests():
    """獲取合併的請求日誌（ngrok + 自定義）"""
    all_requests = []
    
    # 獲取 ngrok 請求日誌
    try:
        response = requests.get('http://localhost:4040/api/requests', timeout=3)
        if response.status_code == 200:
            data = response.json()
            requests_list = data.get('requests', [])
            
            # 只取最近的50個 ngrok 請求
            recent_requests = requests_list[-50:] if len(requests_list) > 50 else requests_list
            
            # 格式化 ngrok 請求數據
            for req in recent_requests:
                # 格式化時間戳為 ngrok 格式
                started_at = req.get('started_at', '')
                time_str = ''
                if started_at:
                    try:
                        # 解析時間戳
                        dt = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                        # 轉換為台灣時區 (CST)
                        taiwan_tz = timezone(timedelta(hours=8))
                        dt_taiwan = dt.astimezone(taiwan_tz)
                        # 格式化為 ngrok 格式: HH:MM:SS.mmm CST
                        time_str = dt_taiwan.strftime('%H:%M:%S.%f')[:-3] + ' CST'
                    except:
                        time_str = ''
                
                # 獲取狀態文字
                status_code = req.get('status', 200)
                status_text = get_status_text(status_code)
                
                all_requests.append({
                    'timestamp': time_str,
                    'method': req.get('method', 'GET'),
                    'uri': req.get('uri', '/'),
                    'status': status_code,
                    'status_text': status_text,
                    'type': 'ngrok'
                })
    except Exception:
        # 靜默處理錯誤，不輸出DEBUG訊息
        pass
    
    # 添加自定義請求日誌
    with global_lock:
        all_requests.extend(custom_request_logs.copy())
    
    # 按時間戳排序（最新的在最後）
    def parse_time(timestamp):
        try:
            if ' CST' in timestamp:
                time_part = timestamp.replace(' CST', '')
                return datetime.strptime(time_part, '%H:%M:%S.%f').time()
        except:
            pass
        return datetime.min.time()
    
    all_requests.sort(key=lambda x: parse_time(x.get('timestamp', '')))
    
    # 只保留最近的100筆記錄
    recent_requests = all_requests[-100:] if len(all_requests) > 100 else all_requests
    
    return {'requests': recent_requests}

def get_status_text(status_code):
    """根據狀態碼獲取狀態文字"""
    status_texts = {
        200: 'OK',
        201: 'Created',
        204: 'No Content',
        301: 'Moved Permanently',
        302: 'Found',
        304: 'Not Modified',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        405: 'Method Not Allowed',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
        504: 'Gateway Timeout'
    }
    return status_texts.get(status_code, 'Unknown')

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/save_env', methods=['POST'])
def save_env():
    data = request.get_json()
    # 讀取原始 env 模板，保留註解與順序
    with open(ENV_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    new_lines = []
    has_empty_required_fields = False
    
    # 必填欄位列表
    required_fields = ['CHAT_ID', 'API_KEY', 'SECRET_KEY', 'PERSON_ID', 'CA_PASSWD', 'CERT_START', 'CERT_END']
    
    for line in lines:
        m = re.match(r'^(\w+)=.*$', line)
        if m:
            key = m.group(1)
            # BOT_TOKEN不允許被覆蓋，保持原值
            if key == 'BOT_TOKEN':
                new_lines.append(line)
            # 處理其他欄位
            elif key in data:
                val = data.get(key, '').strip()
                new_lines.append(f'{key}={val}\n')
                # 檢查必填欄位是否為空
                if key in required_fields and not val:
                    has_empty_required_fields = True
            else:
                new_lines.append(f'{key}=\n')
        else:
            new_lines.append(line)
    
    # 如果有必填欄位為空，自動登出
    if has_empty_required_fields:
        update_login_status(0)
    
    with open(ENV_PATH, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    
    return jsonify({'status': 'ok', 'has_empty_fields': has_empty_required_fields})

@app.route('/api/load_env', methods=['GET'])
def load_env():
    env_data = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # 載入所有欄位，包括空值
                    env_data[key] = value.strip()
    return jsonify(env_data)

@app.route('/api/upload/holiday', methods=['POST'])
def upload_holiday():
    try:
        if 'file' not in request.files:
            return jsonify({'error': '沒有檔案'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': '沒有選擇檔案'}), 400
        
        if not file.filename.endswith('.csv'):
            return jsonify({'error': '只支援 CSV 檔案'}), 400
        
        # 確保目錄存在
        holiday_dir = os.path.join(os.path.dirname(__file__), 'holiday')
        os.makedirs(holiday_dir, exist_ok=True)
        
        # 儲存檔案
        file_path = os.path.join(holiday_dir, file.filename)
        file.save(file_path)
        
        return jsonify({'status': 'success', 'message': '檔案上傳成功'})
    except Exception as e:
        return jsonify({'error': f'上傳失敗: {str(e)}'}), 500

@app.route('/api/upload/certificate', methods=['POST'])
def upload_certificate():
    try:
        if 'file' not in request.files:
            return jsonify({'error': '沒有檔案'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': '沒有選擇檔案'}), 400
        
        if not file.filename.endswith('.pfx'):
            return jsonify({'error': '只支援 PFX 檔案'}), 400
        
        # 確保目錄存在
        cert_dir = os.path.join(os.path.dirname(__file__), 'certificate')
        os.makedirs(cert_dir, exist_ok=True)
        
        # 儲存檔案
        file_path = os.path.join(cert_dir, file.filename)
        file.save(file_path)
        
        return jsonify({'status': 'success', 'message': '檔案上傳成功'})
    except Exception as e:
        return jsonify({'error': f'上傳失敗: {str(e)}'}), 500

@app.route('/api/uploaded_files', methods=['GET'])
def get_uploaded_files():
    try:
        holiday_dir = os.path.join(os.path.dirname(__file__), 'holiday')
        cert_dir = os.path.join(os.path.dirname(__file__), 'certificate')
        
        holiday_file = None
        cert_file = None
        
        # 檢查台股日曆檔案
        if os.path.exists(holiday_dir):
            csv_files = [f for f in os.listdir(holiday_dir) if f.endswith('.csv')]
            if csv_files:
                holiday_file = csv_files[0]  # 取第一個CSV檔案
        
        # 檢查憑證檔案
        if os.path.exists(cert_dir):
            cert_files = [f for f in os.listdir(cert_dir) if not f.endswith('.txt')]
            if cert_files:
                cert_file = cert_files[0]  # 取第一個檔案
        
        # 計算實際使用的憑證路徑（與登入時邏輯一致）
        ca_path = os.getenv('CA_PATH', '')
        actual_cert_path = None
        if ca_path:
            if os.path.isabs(ca_path):
                actual_cert_path = ca_path
            else:
                program_root = os.path.dirname(os.path.dirname(__file__))
                actual_cert_path = os.path.join(program_root, ca_path)
        
        return jsonify({
            'holiday_file': holiday_file,
            'certificate_file': cert_file,
            'cert_path_info': {
                'env_value': ca_path,
                'actual_path': actual_cert_path,
                'exists': os.path.exists(actual_cert_path) if actual_cert_path else False
            }
        })
    except Exception as e:
        return jsonify({'error': f'獲取檔案資訊失敗: {str(e)}'}), 500

@app.route('/api/bot_username', methods=['POST'])
def get_bot_username():
    try:
        # 從.env文件讀取token，如果沒有則使用硬編碼值
        token = None
        if os.path.exists(ENV_PATH):
            with open(ENV_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('BOT_TOKEN='):
                        token = line.split('=', 1)[1]
                        break
        
        # 如果.env中沒有token，使用硬編碼值
        if not token:
            token = '7202376519:AAF-i3MbuMEpz0W7nFE9KmieqVw7L5s0xK4'
        
        if not token:
            return jsonify({'username': None})
        
        # 呼叫 Telegram Bot API 獲取 Bot 資訊
        url = f'https://api.telegram.org/bot{token}/getMe'
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            bot_data = response.json()
            if bot_data.get('ok'):
                username = bot_data['result'].get('username', '')
                if username:
                    return jsonify({'username': f'@{username}'})
        
        return jsonify({'username': None})
    except Exception as e:
        return jsonify({'error': f'查詢失敗: {str(e)}'}), 500

@app.route('/api/login', methods=['POST'])
def api_login():
    # 將 LOGIN=1 寫入 .env
    update_login_status(1)
    
    # 在背景線程中啟動ngrok，不阻塞主請求
    def start_ngrok_background():
        start_ngrok()
    
    threading.Thread(target=start_ngrok_background, daemon=True).start()
    
    # 同時登入永豐API
    def login_sinopac_background():
        login_sinopac()
    
    threading.Thread(target=login_sinopac_background, daemon=True).start()
    
    return jsonify({'status': 'ok'})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    # 重置LOGIN狀態
    update_login_status(0)
    
    # 停止ngrok
    stop_ngrok()
    
    # 登出永豐API
    logout_sinopac()
    
    return jsonify({'status': 'ok'})

@app.route('/api/ngrok/start', methods=['POST'])
def api_start_ngrok():
    """啟動ngrok API"""
    success = start_ngrok()
    return jsonify({
        'success': success,
        'status': get_ngrok_status()
    })

@app.route('/api/ngrok/stop', methods=['POST'])
def api_stop_ngrok():
    """停止ngrok API"""
    stop_ngrok()
    return jsonify({
        'success': True,
        'status': get_ngrok_status()
    })

@app.route('/api/ngrok/status', methods=['GET'])
def api_ngrok_status():
    """獲取ngrok狀態 API"""
    return jsonify(get_ngrok_status())

@app.route('/api/ngrok/latency', methods=['GET'])
def api_ngrok_latency():
    return jsonify(get_ngrok_latency())

@app.route('/api/ngrok/connections', methods=['GET'])
def api_ngrok_connections():
    return jsonify(get_ngrok_connections())

@app.route('/api/ngrok/requests', methods=['GET'])
def api_ngrok_requests():
    """獲取ngrok請求日誌 API"""
    return jsonify(get_ngrok_requests())

@app.route('/api/ngrok/version', methods=['GET'])
def api_ngrok_version():
    """獲取ngrok版本信息"""
    current_version = get_ngrok_version()
    return jsonify({
        'current_version': current_version,
        'update_available': ngrok_update_available
    })

@app.route('/api/ngrok/check_update', methods=['POST'])
def api_ngrok_check_update():
    """檢查ngrok更新"""
    try:
        update_info = check_ngrok_update()
        if update_info:
            return jsonify({
                'status': 'success',
                'data': update_info
            })
        else:
            return jsonify({
                'status': 'error',
                'message': '無法檢查更新'
            })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'檢查更新失敗: {str(e)}'
        }), 500

@app.route('/api/ngrok/update', methods=['POST'])
def api_ngrok_update():
    """更新ngrok"""
    try:
        data = request.get_json() or {}
        download_url = data.get('download_url')
        
        if not download_url:
            # 自動獲取最新版本
            update_info = check_ngrok_update()
            if update_info and update_info.get('download_url'):
                download_url = update_info['download_url']
            else:
                return jsonify({
                    'status': 'error',
                    'message': '無法獲取下載鏈接'
                }), 400
        
        # 在背景執行更新
        def update_background():
            success = download_and_update_ngrok(download_url)
            if success:
                print("ngrok更新成功！")
            else:
                print("ngrok更新失敗！")
                
        threading.Thread(target=update_background, daemon=True).start()
        
        return jsonify({
            'status': 'success',
            'message': '正在背景更新ngrok，請稍候...'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'更新失敗: {str(e)}'
        }), 500

@app.route('/api/ngrok/setup', methods=['POST'])
def api_ngrok_setup():
    """設置ngrok authtoken並啟動"""
    try:
        data = request.get_json() or {}
        authtoken = data.get('authtoken', '').strip()
        
        if not authtoken:
            return jsonify({
                'status': 'error',
                'message': '請提供有效的ngrok authtoken'
            }), 400
        
        # 驗證authtoken格式（基本檢查）
        if len(authtoken) < 20:
            return jsonify({
                'status': 'error',
                'message': 'authtoken格式不正確'
            }), 400
        
        # 執行ngrok配置
        def setup_ngrok_background():
            try:
                import subprocess
                import time
                
                ngrok_exe_path = os.path.join(os.path.dirname(__file__), 'ngrok.exe')
                
                # 1. 設置authtoken
                print(f"設置ngrok authtoken...")
                result = subprocess.run(
                    [ngrok_exe_path, 'config', 'add-authtoken', authtoken],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                if result.returncode != 0:
                    print(f"設置authtoken失敗: {result.stderr}")
                    return False
                    
                print("authtoken設置成功")
                
                # 2. 停止現有ngrok進程
                global ngrok_process
                if ngrok_process:
                    ngrok_process.terminate()
                    time.sleep(2)
                
                # 3. 啟動ngrok
                print("啟動ngrok tunnel...")
                start_ngrok()
                
                # 4. 驗證啟動成功
                time.sleep(5)
                try:
                    response = requests.get('http://localhost:4040/api/tunnels', timeout=5)
                    if response.status_code == 200:
                        tunnels = response.json().get('tunnels', [])
                        if tunnels:
                            print("ngrok設置並啟動成功！")
                            return True
                except:
                    pass
                
                print("ngrok啟動驗證失敗")
                return False
                
            except Exception as e:
                print(f"設置ngrok失敗: {e}")
                return False
        
        # 在背景執行設置
        threading.Thread(target=setup_ngrok_background, daemon=True).start()
        
        return jsonify({
            'status': 'success',
            'message': '正在設置ngrok，請稍候...'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'設置失敗: {str(e)}'
        }), 500

@app.route('/api/ngrok/validate_token', methods=['POST'])
def api_ngrok_validate_token():
    """驗證ngrok authtoken有效性"""
    try:
        data = request.get_json() or {}
        authtoken = data.get('authtoken', '').strip()
        
        if not authtoken:
            return jsonify({
                'status': 'error',
                'message': '請提供authtoken'
            }), 400
        
        # 基本格式驗證
        if len(authtoken) < 20 or not authtoken.replace('_', '').replace('-', '').isalnum():
            return jsonify({
                'status': 'error',
                'message': 'authtoken格式不正確'
            }), 400
        
        return jsonify({
            'status': 'success',
            'message': 'authtoken格式有效'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'驗證失敗: {str(e)}'
        }), 500

@app.route('/api/ngrok/token/save', methods=['POST'])
def api_ngrok_token_save():
    """保存ngrok authtoken到服務器端"""
    try:
        data = request.get_json() or {}
        authtoken = data.get('authtoken', '').strip()
        
        if not authtoken:
            return jsonify({
                'status': 'error',
                'message': '請提供authtoken'
            }), 400
        
        # 保存到配置目錄
        config_dir = os.path.join(os.path.dirname(__file__), 'config')
        os.makedirs(config_dir, exist_ok=True)
        
        token_file = os.path.join(config_dir, 'ngrok_token.txt')
        with open(token_file, 'w', encoding='utf-8') as f:
            f.write(authtoken)
        
        return jsonify({
            'status': 'success',
            'message': 'Token已保存'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'保存失敗: {str(e)}'
        }), 500

@app.route('/api/ngrok/token/load', methods=['GET'])
def api_ngrok_token_load():
    """從服務器端載入ngrok authtoken"""
    try:
        config_dir = os.path.join(os.path.dirname(__file__), 'config')
        token_file = os.path.join(config_dir, 'ngrok_token.txt')
        
        if os.path.exists(token_file):
            with open(token_file, 'r', encoding='utf-8') as f:
                authtoken = f.read().strip()
            
            if authtoken:
                return jsonify({
                    'status': 'success',
                    'authtoken': authtoken
                })
        
        return jsonify({
            'status': 'not_found',
            'message': '未找到保存的token'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'載入失敗: {str(e)}'
        }), 500

@app.route('/api/ngrok/token/clear', methods=['POST'])
def api_ngrok_token_clear():
    """清除服務器端保存的ngrok authtoken"""
    try:
        config_dir = os.path.join(os.path.dirname(__file__), 'config')
        token_file = os.path.join(config_dir, 'ngrok_token.txt')
        
        if os.path.exists(token_file):
            os.remove(token_file)
        
        return jsonify({
            'status': 'success',
            'message': 'Token已清除'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'清除失敗: {str(e)}'
        }), 500



@app.route('/api/sinopac/status', methods=['GET'])
def api_sinopac_status():
    """獲取永豐API連線狀態和期貨帳號"""
    return jsonify(get_sinopac_status())

@app.route('/api/sinopac/version', methods=['GET'])
def api_sinopac_version():
    """獲取永豐shioaji版本信息"""
    try:
        if SHIOAJI_AVAILABLE:
            import shioaji as sj
            version = getattr(sj, '__version__', 'unknown')
            return jsonify({
                'version': version,
                'available': True
            })
        else:
            return jsonify({
                'version': 'N/A',
                'available': False
            })
    except Exception as e:
        return jsonify({
            'version': 'Error',
            'available': False,
            'error': str(e)
        })

@app.route('/api/sinopac/check_update', methods=['POST'])
def api_sinopac_check_update():
    """檢查shioaji更新"""
    try:
        import requests
        import json
        
        # 獲取當前版本
        current_version = None
        if SHIOAJI_AVAILABLE:
            import shioaji as sj
            current_version = getattr(sj, '__version__', 'unknown')
        
        # 查詢PyPI獲取最新版本
        response = requests.get('https://pypi.org/pypi/shioaji/json', timeout=10)
        if response.status_code == 200:
            pypi_data = response.json()
            latest_version = pypi_data.get('info', {}).get('version', 'unknown')
            
            if current_version and latest_version != 'unknown':
                # 簡單版本比較
                if compare_versions(latest_version, current_version) > 0:
                    return jsonify({
                        'status': 'success',
                        'data': {
                            'update_available': True,
                            'current_version': current_version,
                            'latest_version': latest_version,
                            'update_command': 'pip install --upgrade shioaji'
                        }
                    })
                else:
                    return jsonify({
                        'status': 'success',
                        'data': {
                            'update_available': False,
                            'current_version': current_version,
                            'latest_version': latest_version
                        }
                    })
        
        return jsonify({
            'status': 'error',
            'message': '無法檢查更新'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'檢查更新失敗: {str(e)}'
        }), 500

@app.route('/api/sinopac/update', methods=['POST'])
def api_sinopac_update():
    """更新shioaji (僅提供更新指令，不自動執行)"""
    try:
        # 注意：不直接執行pip命令，而是提供指令給用戶
        return jsonify({
            'status': 'success',
            'message': '請在終端機中執行以下指令來更新shioaji:',
            'command': 'pip install --upgrade shioaji',
            'note': '更新後請重新啟動應用程序'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'更新失敗: {str(e)}'
        }), 500

@app.route('/api/sinopac/auto_update', methods=['POST'])
def api_sinopac_auto_update():
    """自動更新shioaji"""
    try:
        import subprocess
        import sys
        import os
        
        # 執行pip更新
        print("開始自動更新shioaji...")
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '--upgrade', 'shioaji'],
            capture_output=True,
            text=True,
            timeout=300  # 5分鐘超時
        )
        
        if result.returncode == 0:
            # 更新成功
            update_output = result.stdout
            
            return jsonify({
                'status': 'success',
                'message': 'shioaji更新成功！',
                'output': update_output,
                'note': '請重啟應用程序以應用新版本'
            })
        else:
            # 更新失敗
            error_output = result.stderr
            return jsonify({
                'status': 'error',
                'message': 'shioaji更新失敗',
                'error': error_output
            }), 500
            
    except subprocess.TimeoutExpired:
        return jsonify({
            'status': 'error',
            'message': '更新超時，請手動執行: pip install --upgrade shioaji'
        }), 500
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'自動更新失敗: {str(e)}'
        }), 500

@app.route('/api/futures/contracts', methods=['GET'])
def api_futures_contracts():
    """獲取期貨合約資訊"""
    global futures_contracts, margin_requirements, sinopac_connected, sinopac_api
    
    if not sinopac_connected or not sinopac_api:
        return jsonify({
            'status': 'disconnected',
            'selected_contracts': {
                'TXF': '-',
                'MXF': '-', 
                'TMF': '-'
            },
            'available_contracts': {
                'TXF': [],
                'MXF': [],
                'TMF': []
            }
        })
    
    try:
        # 獲取所有可用合約
        available_contracts = {}
        selected_contracts = {}
        
        for code in ['TXF', 'MXF', 'TMF']:
            try:
                contracts = sinopac_api.Contracts.Futures.get(code)
                if contracts:
                    # 按交割日期排序（確保正確的日期格式排序）
                    sorted_contracts = sorted(contracts, key=get_sort_date)
                    
                    # 可用合約列表
                    available_list = []
                    for c in sorted_contracts:
                        delivery_date = format_delivery_date(c.delivery_date)
                        
                        available_list.append({
                            'code': c.code,
                            'delivery_date': delivery_date,
                            'delivery_month': getattr(c, 'delivery_month', ''),
                            'name': getattr(c, 'name', '')
                        })
                    
                    available_contracts[code] = available_list
                    
                    # 選用合約（第一個，即最近交割日）
                    if sorted_contracts:
                        selected_contract = sorted_contracts[0]
                        contract_name = '大台' if code == 'TXF' else '小台' if code == 'MXF' else '微台'
                        margin = margin_requirements.get(contract_name, 0)
                        
                        delivery_date = format_delivery_date(selected_contract.delivery_date)
                        
                        selected_contracts[code] = f"{selected_contract.code}　交割日：{delivery_date}　保證金 ${margin:,}"
                    else:
                        selected_contracts[code] = '-'
                else:
                    available_contracts[code] = []
                    selected_contracts[code] = '-'
                    
            except Exception as e:
                print(f"獲取{code}合約失敗: {e}")
                available_contracts[code] = []
                selected_contracts[code] = '-'
        
        return jsonify({
            'status': 'connected',
            'selected_contracts': selected_contracts,
            'available_contracts': available_contracts
        })
        
    except Exception as e:
        print(f"獲取期貨合約資訊失敗: {e}")
        return jsonify({
            'status': 'error',
            'selected_contracts': {
                'TXF': '-',
                'MXF': '-',
                'TMF': '-'
            },
            'available_contracts': {
                'TXF': [],
                'MXF': [],
                'TMF': []
            }
        })

@app.route('/api/account/status', methods=['GET'])
def api_account_status():
    """獲取帳戶狀態資訊"""
    global sinopac_api, sinopac_connected
    
    if not sinopac_connected or not sinopac_api:
        return jsonify({
            'status': 'disconnected',
            'error': '永豐API未連線'
        }), 400
    
    try:
        # 獲取保證金資訊
        margin_data = sinopac_api.margin()
        
        # 獲取持倉資訊計算未實現盈虧
        total_pnl = 0.0
        try:
            positions = sinopac_api.list_positions(sinopac_api.futopt_account)
            for pos in positions:
                total_pnl += pos.pnl
        except:
            total_pnl = 0.0
        
        return jsonify({
            'status': 'success',
            'data': {
                '權益總值': getattr(margin_data, 'equity', 0) or 0,
                '權益總額': getattr(margin_data, 'equity_amount', 0) or 0,
                '今日餘額': getattr(margin_data, 'today_balance', 0) or 0,
                '昨日餘額': getattr(margin_data, 'yesterday_balance', 0) or 0,
                '可用保證金': getattr(margin_data, 'available_margin', 0) or 0,
                '原始保證金': getattr(margin_data, 'initial_margin', 0) or 0,
                '維持保證金': getattr(margin_data, 'maintenance_margin', 0) or 0,
                '風險指標': getattr(margin_data, 'risk_indicator', 0) or 0,
                '手續費': getattr(margin_data, 'fee', 0) or 0,
                '期交稅': getattr(margin_data, 'tax', 0) or 0,
                '本日平倉損益': getattr(margin_data, 'future_settle_profitloss', 0) or 0,
                '未實現盈虧': total_pnl
            },
            'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'獲取帳戶狀態失敗: {str(e)}'
        }), 500

@app.route('/api/trading/status', methods=['GET'])
def api_trading_status():
    """獲取交易日和交割日狀態"""
    try:
        import csv
        
        today = datetime.now()
        
        # 判斷交易日 - 直接調用TXserver中的源頭方法
        def is_trading_day_advanced(check_date=None):
            """交易日判斷邏輯，獨立實現"""
            if check_date is None:
                check_date = today.date()
            
            # 週日固定為非交易日（週六有夜盤交易到凌晨05:00，所以週六是交易日）
            if check_date.weekday() == 6:  # 週日
                return False
            
            # 檢查假期表 - 尋找當年度的holidaySchedule_XXX.csv檔案（民國年）
            try:
                holiday_dir = os.path.join(os.path.dirname(__file__), 'holiday')
                if os.path.exists(holiday_dir):
                    # 轉換西元年為民國年（民國年 = 西元年 - 1911）
                    current_year = check_date.year
                    roc_year = current_year - 1911
                    
                    # 尋找當年度的假期檔案（民國年格式）
                    holiday_files = [f for f in os.listdir(holiday_dir) 
                                   if f.startswith('holidaySchedule_') and f.endswith('.csv')]
                    
                    # 嘗試找到包含當年民國年的檔案
                    target_file = None
                    for filename in holiday_files:
                        # 檔案名稱可能包含民國年資訊（如 holidaySchedule_114.csv）
                        if str(roc_year) in filename:
                            target_file = filename
                            break
                    
                    # 如果沒找到年份檔案，使用最新的檔案
                    if not target_file and holiday_files:
                        target_file = max(holiday_files, key=lambda f: os.path.getctime(os.path.join(holiday_dir, f)))
                    
                    if target_file:
                        csv_path = os.path.join(holiday_dir, target_file)
                        holidays = {}
                        
                        with open(csv_path, 'r', encoding='big5') as f:
                            reader = csv.DictReader(f)
                            for row in reader:
                                try:
                                    # 解析日期
                                    date_str = row.get('日期', '')
                                    if '/' in date_str:
                                        holiday_date = datetime.strptime(date_str, '%Y/%m/%d').date()
                                    elif '-' in date_str:
                                        holiday_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                                    else:
                                        continue
                                    
                                    # 判斷是否為交易日：'o'表示交易日，其他或空白表示非交易日
                                    remark = row.get('備註', '').strip().lower()
                                    is_trading = (remark == 'o')
                                    holidays[holiday_date] = is_trading
                                except (ValueError, KeyError):
                                    continue
                        
                        # 檢查今天是否在假期表中
                        if check_date in holidays:
                            return holidays[check_date]
            except Exception as e:
                print(f"讀取假期檔案失敗: {e}")
                pass
            
            # 未在假期表中的工作日視為交易日
            return True
        
        # 判斷交割日 - 檢查現在使用的合約交割日期
        def is_delivery_day_advanced(check_date=None):
            """交割日判斷邏輯，檢查現在使用的合約是否今天交割"""
            if check_date is None:
                check_date = today.date()
            
            try:
                global sinopac_api, sinopac_connected
                if not sinopac_connected or not sinopac_api:
                    return False
                
                # 檢查目前選用的合約（最近交割日的合約）的交割日
                for code in ['TXF', 'MXF', 'TMF']:
                    try:
                        contracts = sinopac_api.Contracts.Futures.get(code)
                        if contracts:
                            # 按交割日期排序，取得最近的合約（即選用合約）
                            sorted_contracts = sorted(contracts, key=get_sort_date)
                            if sorted_contracts:
                                # 檢查最近的合約（選用合約）是否今天交割
                                selected_contract = sorted_contracts[0]
                                delivery_date_str = selected_contract.delivery_date
                                
                                try:
                                    # 解析交割日期
                                    if isinstance(delivery_date_str, str):
                                        if len(delivery_date_str) == 8:  # YYYYMMDD
                                            delivery_date = datetime.strptime(delivery_date_str, '%Y%m%d').date()
                                        elif '/' in delivery_date_str:  # YYYY/MM/DD
                                            delivery_date = datetime.strptime(delivery_date_str, '%Y/%m/%d').date()
                                        elif '-' in delivery_date_str:  # YYYY-MM-DD
                                            delivery_date = datetime.strptime(delivery_date_str, '%Y-%m-%d').date()
                                        else:
                                            continue
                                    else:
                                        continue
                                    
                                    # 如果今天是任一選用合約的交割日，就返回True
                                    if check_date == delivery_date:
                                        return True
                                except ValueError:
                                    continue
                    except Exception as e:
                        print(f"檢查{code}合約交割日失敗: {e}")
                        continue
                
                return False
            except Exception as e:
                print(f"檢查交割日失敗: {e}")
                return False
        
        # 執行判斷
        is_trading = is_trading_day_advanced()
        is_delivery = is_delivery_day_advanced()
        
        # 判斷開市/關市狀態
        def is_market_open():
            """判斷是否為開市時間"""
            # 如果不是交易日，直接返回休市
            if not is_trading:
                return False
            
            current_hour = today.hour
            current_minute = today.minute
            current_time = current_hour * 100 + current_minute  # HHMM格式
            current_weekday = today.weekday()  # 0=週一, 6=週日
            
            # 週六特殊處理：週六凌晨05:00後為休市
            if current_weekday == 5:  # 週六
                if current_time >= 500:  # 05:00後
                    return False  # 休市
            
            # 早盤：8:45-13:45
            morning_start = 845
            morning_end = 1345
            
            # 午盤：14:50-次日05:00
            afternoon_start = 1450
            afternoon_end = 500  # 次日05:00
            
            # 判斷是否在交易時段
            if current_time >= morning_start and current_time <= morning_end:
                return True  # 早盤時段
            elif current_time >= afternoon_start or current_time <= afternoon_end:
                return True  # 午盤時段（跨日）
            
            return False
        
        is_open = is_market_open()
        
        # 週幾的中文對應
        weekday_chinese = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']
        weekday_display = weekday_chinese[today.weekday()]
        
        return jsonify({
            'status': 'success',
            'current_datetime': today.strftime('%Y/%m/%d %H:%M:%S'),
            'weekday': weekday_display,
            'trading_day_status': '交易日' if is_trading else '非交易日',
            'delivery_day_status': '交割日' if is_delivery else '非交割日',
            'market_status': '開市' if is_open else '休市',
            'is_trading_day': is_trading,
            'is_delivery_day': is_delivery,
            'is_market_open': is_open
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'獲取交易狀態失敗: {str(e)}'
        }), 500

@app.route('/api/position/status', methods=['GET'])
def api_position_status():
    """獲取持倉狀態資訊"""
    global sinopac_api, sinopac_connected
    
    if not sinopac_connected or not sinopac_api:
        return jsonify({
            'status': 'disconnected',
            'error': '永豐API未連線'
        }), 400

    try:
        # 獲取持倉資訊
        positions = sinopac_api.list_positions(sinopac_api.futopt_account)
        
        # 初始化三種合約的持倉資料
        position_data = {
            'TXF': {'動作': '-', '數量': '-', '均價': '-', '市價': '-', '未實現盈虧': '-'},
            'MXF': {'動作': '-', '數量': '-', '均價': '-', '市價': '-', '未實現盈虧': '-'},
            'TMF': {'動作': '-', '數量': '-', '均價': '-', '市價': '-', '未實現盈虧': '-'}
        }
        
        # 初始化總損益
        total_pnl = 0.0
        has_positions = False
        
        if positions and len(positions) > 0:
            # 遍歷所有持倉，按合約類型分類
            for position in positions:
                contract_code = position.code
                contract_type = None
                
                if 'TXF' in contract_code:
                    contract_type = 'TXF'
                elif 'MXF' in contract_code:
                    contract_type = 'MXF'
                elif 'TMF' in contract_code:
                    contract_type = 'TMF'
                else:
                    continue  # 跳過非期貨合約
                
                # 判斷多空方向
                direction = '多單' if position.direction == 'Buy' else '空單'
                
                # 獲取該持倉的未實現盈虧
                unrealized_pnl = float(position.pnl) if hasattr(position, 'pnl') else 0.0
                
                # 獲取市價
                last_price = float(position.last_price) if hasattr(position, 'last_price') else 0.0
                
                # 更新對應合約的資料
                position_data[contract_type] = {
                    '動作': direction,
                    '數量': f"{abs(int(position.quantity))} 口",
                    '均價': f"{float(position.price):,.0f}",
                    '市價': f"{last_price:,.0f}",
                    '未實現盈虧': f"{unrealized_pnl:,.0f}"
                }
                
                # 累計總損益
                total_pnl += unrealized_pnl
                has_positions = True
        
        # 格式化總損益
        total_pnl_display = f"{total_pnl:,.0f} TWD" if has_positions else "-"
        
        return jsonify({
            'status': 'success',
            'data': position_data,
            'total_pnl': total_pnl_display,
            'total_pnl_value': total_pnl,
            'has_positions': has_positions,
            'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'獲取持倉狀態失敗: {str(e)}'
        }), 500

@app.route('/api/system_log', methods=['POST'])
def api_system_log():
    """接收前端系統日誌"""
    try:
        data = request.get_json()
        message = data.get('message', '')
        log_type = data.get('type', 'info')
        
        # 儲存到 custom_request_logs
        add_custom_request_log(
            method='POST',
            uri='/api/system_log',
            status=200,
            extra_info={
                'message': message,
                'type': log_type
            }
        )
        
        # 這裡可以添加後端日誌記錄邏輯
        print(f"前端系統日誌 [{log_type.upper()}]: {message}")
        
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/rollover/status', methods=['GET'])
def api_rollover_status():
    """獲取轉倉狀態"""
    global rollover_mode, rollover_start_date, next_month_contracts
    
    try:
        # 檢查轉倉模式
        check_rollover_mode()
        
        # 獲取當前合約資訊
        current_contracts = {
            'TXF': contract_txf.code if contract_txf else None,
            'MXF': contract_mxf.code if contract_mxf else None,
            'TMF': contract_tmf.code if contract_tmf else None
        }
        
        # 獲取次月合約資訊
        next_contracts = {
            'TXF': next_month_contracts.get('TXF', {}).code if next_month_contracts.get('TXF') else None,
            'MXF': next_month_contracts.get('MXF', {}).code if next_month_contracts.get('MXF') else None,
            'TMF': next_month_contracts.get('TMF', {}).code if next_month_contracts.get('TMF') else None
        }
        
        return jsonify({
            'status': 'success',
            'rollover_mode': rollover_mode,
            'rollover_start_date': rollover_start_date.isoformat() if rollover_start_date else None,
            'current_contracts': current_contracts,
            'next_month_contracts': next_contracts,
            'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'獲取轉倉狀態失敗: {str(e)}'
        }), 500

@app.route('/api/connection/duration', methods=['GET'])
def api_connection_duration():
    """獲取連線時長信息"""
    try:
        duration_hours = get_connection_duration()
        login_time = sinopac_login_time.isoformat() if sinopac_login_time else None
        
        return jsonify({
            'status': 'success',
            'duration_hours': round(duration_hours, 2),
            'login_time': login_time,
            'auto_logout_hours': AUTO_LOGOUT_HOURS,
            'remaining_hours': max(0, AUTO_LOGOUT_HOURS - duration_hours)
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/connection/monitor', methods=['GET'])
def api_connection_monitor_status():
    """查詢連線監控狀態"""
    global reconnect_attempts, last_connection_check, max_reconnect_attempts, is_reconnecting
    
    try:
        # 獲取當前動態檢查間隔
        current_interval = get_dynamic_check_interval()
        
        # 判斷當前檢查模式
        if is_reconnecting:
            check_mode = "重連中"
            interval_display = "30秒"
        elif current_interval == 60:
            check_mode = "交易時間"
            interval_display = "1分鐘"
        else:
            check_mode = "非交易時間"
            interval_display = "10分鐘"
        
        return jsonify({
            'status': 'success',
            'monitor_active': connection_monitor_timer is not None,
            'check_interval_seconds': current_interval,
            'check_interval_display': interval_display,
            'check_mode': check_mode,
            'max_reconnect_attempts': max_reconnect_attempts,
            'current_reconnect_attempts': reconnect_attempts,
            'is_reconnecting': is_reconnecting,
            'last_check_time': last_connection_check.strftime('%Y-%m-%d %H:%M:%S') if last_connection_check else None,
            'connection_status': sinopac_connected and sinopac_login_status
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/close_application', methods=['POST'])
def api_close_application():
    """關閉整個應用程式"""
    try:
        # 執行清理工作
        cleanup_on_exit()
        
        # 延遲一秒後關閉程式，確保清理工作完成
        def delayed_exit():
            time.sleep(1)
            os._exit(0)  # 強制關閉整個程式
        
        threading.Thread(target=delayed_exit, daemon=True).start()
        
        return jsonify({
            'status': 'success',
            'message': '應用程式正在關閉...'
        })
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'關閉程式失敗: {str(e)}'
        }), 500

@app.route('/<path:path>')
def static_files(path):
    if path.startswith('api/'):
        abort(404)
    return send_from_directory(app.static_folder, path)

@app.route('/favicon/<path:filename>')
def serve_favicon(filename):
    favicon_dir = os.path.join(os.path.dirname(__file__), 'favicon')
    return send_from_directory(favicon_dir, filename)

# 端口設置
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
                        if not (1024 <= port <= 65535):  # 檢查端口範圍
                            port = 5000
                    except ValueError:
                        port = 5000
                elif line.startswith('log_console:'):
                    try:
                        log_str = line.split(':')[1].strip()
                        log_console = int(log_str)
                        if log_console not in [0, 1]:  # 檢查值範圍
                            log_console = 1
                    except ValueError:
                        log_console = 1
            
            return port, log_console
    except Exception as e:
        print(f"讀取設置失敗: {e}，使用預設設置")
        return 5000, 1

# 獲取當前端口和日誌設置
CURRENT_PORT, LOG_CONSOLE = get_port()

def start_flask():
    # 啟用基本的 HTTP 請求日誌輸出（用於 webhook 調試）
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.INFO)  # 顯示所有 HTTP 請求日誌
    
    # 如果只想看 POST 請求，可以設置為 WARNING 並在下方添加過濾
    # log.setLevel(logging.WARNING)
    
    app.run(port=CURRENT_PORT, threaded=True)

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
    
    # 創建webview視窗
    window = webview.create_window(
        'Auto91－交易系統', 
        f'http://127.0.0.1:{CURRENT_PORT}',
        width=1280,
        height=960,
        min_size=(1280, 960),
        maximized=True
    )
    
    # 綁定視窗關閉事件
    def on_window_closing():
        print("視窗關閉中，正在清理資源...")
        cleanup_on_exit()
        # 確保程式完全退出
        os._exit(0)
        return True  # 允許關閉
    
    # 使用closing事件來確保在關閉前執行清理
    window.events.closing += on_window_closing
    
    # 啟動webview
    webview.start(debug=False)
    
    # webview關閉後不再重複顯示清理訊息

# 永豐API相關函數
def init_sinopac_api():
    """初始化永豐API對象（不設置callback）"""
    global sinopac_api
    try:
        if not SHIOAJI_AVAILABLE:
            print("shioaji模組未安裝，無法初始化永豐API")
            return False
            
        sinopac_api = sj.Shioaji()
        print("永豐API對象創建成功")
        return True
    except Exception as e:
        print(f"初始化永豐API失敗: {e}")
        sinopac_api = None
        return False

def update_futures_contracts():
    """更新期貨合約資訊"""
    global futures_contracts, sinopac_api, sinopac_connected
    
    if not sinopac_api or not sinopac_connected:
        return False
    
    try:
        # 獲取各期貨合約的最新資訊
        for code in ['TXF', 'MXF', 'TMF']:
            contracts = sinopac_api.Contracts.Futures.get(code)
            if contracts:
                # 選擇最近的交割日期合約
                sorted_contracts = sorted(contracts, key=lambda x: x.delivery_date)
                futures_contracts[code] = sorted_contracts[0]
        
        return True
    except Exception as e:
        print(f"更新期貨合約失敗: {e}")
        return False

def update_margin_requirements_from_api():
    """從台期所API更新保證金資訊"""
    global margin_requirements
    
    try:
        import requests
        url = "https://openapi.taifex.com.tw/v1/IndexFuturesAndOptionsMargining"
        response = requests.get(url)
        
        if response.status_code == 200:
            data = response.json()
            new_margins = {}
            
            for item in data:
                contract = item.get('Contract', '')
                margin = int(item.get('InitialMargin', 0))
                
                if contract == '臺股期貨':
                    new_margins['大台'] = margin
                elif contract == '小型臺指':
                    new_margins['小台'] = margin  
                elif contract == '微型臺指期貨':
                    new_margins['微台'] = margin
            
            if new_margins:
                margin_requirements.update(new_margins)
                return True
        
        return False
    except Exception as e:
        print(f"更新保證金失敗: {e}")
        return False

def order_callback(state, deal, order=None):
    """訂單回調函數處理（參考TXserver.py架構）"""
    global order_octype_map, contract_txf, contract_mxf, contract_tmf
        
    try:
        print(f"收到回調事件: {state}")
        
        # 成交回調和訂單回調的數據結構不同，需要分別處理
        if str(state) == 'OrderState.FuturesDeal':
            # 成交回調：使用 deal 的直接欄位
            order_id = deal.get('trade_id', deal.get('order_id', '未知')).strip()
            contract_code = deal.get('code', '')
        else:
            # 訂單回調：使用 order 結構
            order_id = deal.get('order', {}).get('id', '未知').strip()
            contract_code = deal.get('contract', {}).get('code', '')
        
        # 調試信息
        print(f"=== order_callback 調試 ===")
        print(f"state: {state}")
        print(f"order_id: '{order_id}'")
        print(f"contract_code: '{contract_code}'")
        print(f"order_octype_map keys: {list(order_octype_map.keys())}")
        print(f"order_octype_map: {order_octype_map}")
        
        # 取得合約名稱
        contract_name = get_contract_name_from_code(contract_code)
        
        # 從映射中獲取訂單詳細資訊
        octype_info = order_octype_map.get(order_id)
        if octype_info is None:
            # 如果找不到映射資訊，嘗試從交易記錄JSON文件中讀取（參考TXserver.py）
            today = datetime.now().strftime("%Y%m%d")
            filename = f"{LOG_DIR}/trades_{today}.json"
            oc_type, direction, order_type, price_type, is_manual = None, None, None, None, True
            
            if os.path.exists(filename):
                try:
                    with open(filename, 'r') as f:
                        trades = json.load(f)
                    for trade in trades:
                        if trade.get('deal_order_id') == order_id and trade.get('type') == 'order':
                            raw_order = trade.get('raw_data', {}).get('order', {})
                            oc_type = raw_order.get('oc_type', 'New')
                            direction = raw_order.get('action', deal.get('order', {}).get('action', 'Sell'))
                            order_type = raw_order.get('order_type', deal.get('order', {}).get('order_type', 'IOC'))
                            price_type = raw_order.get('price_type', 'MKT')
                            is_manual = trade.get('is_manual', True)
                            break
                except Exception as e:
                    print(f"讀取交易記錄失敗：{e}")
            
            # 如果從交易記錄中找不到，使用推斷邏輯
            if not oc_type:
                try:
                    # 獲取持倉資訊來判斷是否為平倉
                    positions = sinopac_api.list_positions(sinopac_api.futopt_account)
                    
                    # 根據合約代碼前綴找到對應的持倉
                    contract_positions = []
                    if contract_code.startswith('TXF'):
                        contract_positions = [p for p in positions if p.code.startswith('TXF')]
                    elif contract_code.startswith('MXF'):
                        contract_positions = [p for p in positions if p.code.startswith('MXF')]
                    elif contract_code.startswith('TMF'):
                        contract_positions = [p for p in positions if p.code.startswith('TMF')]
                    
                    # 如果有持倉且訂單方向與持倉方向相反，則為平倉
                    action = None
                    if deal.get('order', {}).get('action'):
                        action = deal.get('order', {}).get('action')
                    elif deal.get('action'):
                        action = deal.get('action')
                    else:
                        action = 'Sell'  # 預設值
                    
                    print(f"推斷邏輯調試:")
                    print(f"  action: '{action}'")
                    print(f"  contract_positions: {[f'{p.code}:{p.direction}:{p.quantity}' for p in contract_positions]}")
                    
                    has_opposite_position = any(
                        (p.direction != action and p.quantity != 0) for p in contract_positions
                    )
                    
                    print(f"  has_opposite_position: {has_opposite_position}")
                    
                    oc_type = 'Cover' if has_opposite_position else 'New'
                    direction = action
                    order_type = deal.get('order', {}).get('order_type', 'IOC')
                    price_type = deal.get('order', {}).get('price_type', 'MKT')
                    is_manual = True  # 預設為手動操作
                except:
                    oc_type = 'New'
                    direction = deal.get('order', {}).get('action', 'Sell')
                    order_type = deal.get('order', {}).get('order_type', 'IOC')
                    price_type = deal.get('order', {}).get('price_type', 'MKT')
                    is_manual = True  # 預設為手動操作
            
            octype_info = {
                'octype': oc_type,
                'direction': direction,
                'contract_name': contract_name,
                'order_type': order_type,
                'price_type': price_type,
                'is_manual': is_manual
            }
            
            # 調試信息
            print(f"=== 找不到映射，使用備援機制 ===")
            print(f"order_id: {order_id}")
            print(f"從交易記錄讀取: oc_type={oc_type}, direction={direction}")
            print(f"最終 octype_info: {octype_info}")
        
        octype = octype_info['octype']
        direction = octype_info['direction']
        order_type = octype_info['order_type']
        price_type = octype_info['price_type']
        is_manual = octype_info.get('is_manual', False)
        
        # 調試信息
        print(f"=== order_callback 調試 ===")
        print(f"octype: '{octype}'")
        print(f"direction: '{direction}'")
        print(f"order_type: '{order_type}'")
        print(f"price_type: '{price_type}'")
        print(f"is_manual: {is_manual}")
        
        # 獲取訂單數量和操作信息
        qty = deal.get('order', {}).get('quantity', 0)
        op_code = deal.get('operation', {}).get('op_code', '00')
        op_msg = deal.get('operation', {}).get('op_msg', '')
        op_type = deal.get('operation', {}).get('op_type', '')
        
        current_time = datetime.now().strftime('%Y/%m/%d %H:%M')
        
        # 處理成交回調
        if str(state) == 'OrderState.FuturesDeal' and deal.get('code') and deal.get('quantity'):
            handle_futures_deal_callback(deal, octype_info)
            
        # 處理訂單提交回調
        elif str(state) in ['OrderState.Submitted', 'OrderState.FuturesOrder']:
            if op_type == 'Cancel' or op_code != '00':
                # 訂單失敗或取消
                if op_type == 'Cancel':
                    if order_type == 'IOC' and not op_msg:
                        fail_reason = "價格未滿足"
                    else:
                        fail_reason = "手動取消掛單"  # 手動取消訂單
                else:
                    fail_reason = OP_MSG_TRANSLATIONS.get(op_msg, op_msg or '未知錯誤')
                
                price_value = order.get('price', 0.0) if order else deal.get('order', {}).get('price', 0.0)
                
                # 獲取完整合約代碼和交割日期用於失敗通知
                full_contract_code = None
                delivery_date_for_fail = None
                try:
                    # 根據合約代碼前綴找到對應的全域合約對象
                    if contract_code.startswith('TXF') and contract_txf:
                        full_contract_code = contract_txf.code
                        if hasattr(contract_txf, 'delivery_date'):
                            if hasattr(contract_txf.delivery_date, 'strftime'):
                                delivery_date_for_fail = contract_txf.delivery_date.strftime('%Y/%m/%d')
                            else:
                                delivery_date_for_fail = str(contract_txf.delivery_date)
                    elif contract_code.startswith('MXF') and contract_mxf:
                        full_contract_code = contract_mxf.code
                        if hasattr(contract_mxf, 'delivery_date'):
                            if hasattr(contract_mxf.delivery_date, 'strftime'):
                                delivery_date_for_fail = contract_mxf.delivery_date.strftime('%Y/%m/%d')
                            else:
                                delivery_date_for_fail = str(contract_mxf.delivery_date)
                    elif contract_code.startswith('TMF') and contract_tmf:
                        full_contract_code = contract_tmf.code
                        if hasattr(contract_tmf, 'delivery_date'):
                            if hasattr(contract_tmf.delivery_date, 'strftime'):
                                delivery_date_for_fail = contract_tmf.delivery_date.strftime('%Y/%m/%d')
                            else:
                                delivery_date_for_fail = str(contract_tmf.delivery_date)
                except:
                    pass
                
                # 保存交易記錄（參考TXserver.py）
                save_trade({
                    'type': 'order',
                    'trade_category': 'normal',
                    'raw_data': deal,
                    'deal_order_id': order_id,
                    'contract_name': contract_name,
                    'timestamp': datetime.now().isoformat(),
                    'is_manual': is_manual
                })
                
                # 保存交易記錄（參考TXserver.py）
                save_trade({
                    'type': 'cancel',
                    'trade_category': 'normal',
                    'raw_data': deal,
                    'deal_order_id': order_id,
                    'contract_name': contract_name,
                    'timestamp': datetime.now().isoformat(),
                    'is_manual': is_manual
                })
                
                # 記錄掛單失敗日誌
                log_message = get_simple_order_log_message(
                    contract_name=contract_name,
                    direction=direction,
                    qty=qty,
                    price=price_value,
                    order_id=order_id,
                    octype=octype,
                    is_manual=is_manual,
                    is_success=False,
                    order_type=order_type,
                    price_type=price_type
                )
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': log_message, 'type': 'error'},
                        timeout=5
                    )
                except:
                    pass
                
                # 發送失敗通知
                msg = get_formatted_order_message(
                    is_success=False,
                    order_id=order_id,
                    contract_name=contract_name,
                    qty=qty,
                    price=price_value,
                    octype=octype,
                    direction=direction,
                    order_type=order_type,
                    price_type=price_type,
                    is_manual=is_manual,
                    reason=fail_reason,
                    contract_code=full_contract_code or contract_code,
                    delivery_date=delivery_date_for_fail
                )
                send_telegram_message(msg)
                
                # 清理映射
                with global_lock:
                    order_octype_map.pop(order_id, None)
            else:
                # 訂單提交成功
                price_value = order.get('price', 0.0) if order else deal.get('order', {}).get('price', 0.0)
                
                # 獲取完整合約代碼和交割日期
                full_contract_code = None
                delivery_date = None
                try:
                    # 首先嘗試從deal或order獲取delivery_month
                    delivery_month = None
                    if order and order.get('delivery_month'):
                        delivery_month = order.get('delivery_month')
                    elif deal and deal.get('contract', {}).get('delivery_month'):
                        delivery_month = deal.get('contract', {}).get('delivery_month')
                    
                    if delivery_month and len(delivery_month) == 6:
                        year = int(delivery_month[:4])
                        month = int(delivery_month[4:6])
                        delivery_date = f"{year}/{month:02d}/16"
                    else:
                        # 如果沒有delivery_month，從全域合約對象獲取
                        if contract_code.startswith('TXF') and contract_txf:
                            full_contract_code = contract_txf.code
                            if hasattr(contract_txf, 'delivery_date'):
                                if hasattr(contract_txf.delivery_date, 'strftime'):
                                    delivery_date = contract_txf.delivery_date.strftime('%Y/%m/%d')
                                else:
                                    delivery_date = str(contract_txf.delivery_date)
                        elif contract_code.startswith('MXF') and contract_mxf:
                            full_contract_code = contract_mxf.code
                            if hasattr(contract_mxf, 'delivery_date'):
                                if hasattr(contract_mxf.delivery_date, 'strftime'):
                                    delivery_date = contract_mxf.delivery_date.strftime('%Y/%m/%d')
                                else:
                                    delivery_date = str(contract_mxf.delivery_date)
                        elif contract_code.startswith('TMF') and contract_tmf:
                            full_contract_code = contract_tmf.code
                            if hasattr(contract_tmf, 'delivery_date'):
                                if hasattr(contract_tmf.delivery_date, 'strftime'):
                                    delivery_date = contract_tmf.delivery_date.strftime('%Y/%m/%d')
                                else:
                                    delivery_date = str(contract_tmf.delivery_date)
                except:
                    pass
                
                # 保存交易記錄（參考TXserver.py）
                save_trade({
                    'type': 'order',
                    'trade_category': 'normal',
                    'raw_data': deal,  # 保存完整的deal對象，包含order信息
                    'deal_order_id': order_id,
                    'contract_name': contract_name,
                    'timestamp': datetime.now().isoformat(),
                    'is_manual': is_manual
                })
                
                # 記錄掛單成功日誌
                log_message = get_simple_order_log_message(
                    contract_name=contract_name,
                    direction=direction,
                    qty=qty,
                    price=price_value,
                    order_id=order_id,
                    octype=octype,
                    is_manual=is_manual,
                    is_success=False,
                    order_type=order_type,
                    price_type=price_type
                )
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': log_message, 'type': 'success'},
                        timeout=5
                    )
                except:
                    pass
                
                # 發送提交成功通知
                msg = get_formatted_order_message(
                    is_success=True,
                    order_id=order_id,
                    contract_name=contract_name,
                    qty=qty,
                    price=price_value,
                    octype=octype,
                    direction=direction,
                    order_type=order_type,
                    price_type=price_type,
                    is_manual=is_manual,
                    contract_code=full_contract_code or contract_code,
                    delivery_date=delivery_date
                )
                send_telegram_message(msg)
        
    except Exception as e:
        print(f"回調函數處理失敗: {e}")

def handle_futures_deal_callback(deal, octype_info):
    """處理期貨成交回調"""
    global order_octype_map, contract_txf, contract_mxf, contract_tmf
    
    try:
        order_id = deal.get('trade_id', deal.get('order_id', '未知'))
        contract_code = deal.get('code', '')
        contract_name = get_contract_name_from_code(contract_code)
        
        deal_price = deal.get('price', 0)
        deal_quantity = deal.get('quantity', 0)
        
        current_time = datetime.now().strftime('%Y/%m/%d %H:%M')
        
        # 修正：確保使用正確的訂單資訊
        # 如果octype_info中有完整的訂單資訊，優先使用
        octype = octype_info.get('octype', 'New')
        direction = octype_info.get('direction', 'Sell')
        order_type = octype_info.get('order_type', 'IOC')
        price_type = octype_info.get('price_type', 'MKT')
        is_manual = octype_info.get('is_manual', False)
        
        # 獲取完整合約代碼和交割日期用於成交通知
        full_contract_code = None
        delivery_date_for_deal = None
        try:
            # 根據合約代碼前綴找到對應的全域合約對象
            if contract_code.startswith('TXF') and contract_txf:
                full_contract_code = contract_txf.code
                if hasattr(contract_txf, 'delivery_date'):
                    if hasattr(contract_txf.delivery_date, 'strftime'):
                        delivery_date_for_deal = contract_txf.delivery_date.strftime('%Y/%m/%d')
                    else:
                        delivery_date_for_deal = str(contract_txf.delivery_date)
            elif contract_code.startswith('MXF') and contract_mxf:
                full_contract_code = contract_mxf.code
                if hasattr(contract_mxf, 'delivery_date'):
                    if hasattr(contract_mxf.delivery_date, 'strftime'):
                        delivery_date_for_deal = contract_mxf.delivery_date.strftime('%Y/%m/%d')
                    else:
                        delivery_date_for_deal = str(contract_mxf.delivery_date)
            elif contract_code.startswith('TMF') and contract_tmf:
                full_contract_code = contract_tmf.code
                if hasattr(contract_tmf, 'delivery_date'):
                    if hasattr(contract_tmf.delivery_date, 'strftime'):
                        delivery_date_for_deal = contract_tmf.delivery_date.strftime('%Y/%m/%d')
                    else:
                        delivery_date_for_deal = str(contract_tmf.delivery_date)
        except:
            pass
        
        # 記錄成交成功日誌
        log_message = get_simple_order_log_message(
            contract_name=contract_name,
            direction=direction,
            qty=deal_quantity,
            price=deal_price,
            order_id=order_id,
            octype=octype,
            is_manual=is_manual,
            is_success=True,
            order_type=order_type,
            price_type=price_type
        )
        try:
            requests.post(
                f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                json={'message': log_message, 'type': 'success'},
                timeout=5
            )
        except:
            pass
        
        # 發送成交通知 - 使用正確的訂單資訊，延遲5秒發送
        msg = get_formatted_trade_message(
            order_id=order_id,
            contract_name=contract_name,
            qty=deal_quantity,
            price=deal_price,
            octype=octype,
            direction=direction,
            order_type=order_type,
            price_type=price_type,
            is_manual=is_manual,
            contract_code=full_contract_code or contract_code,
            delivery_date=delivery_date_for_deal
        )
        
        # 保存成交記錄
        save_trade({
            'type': 'deal',
            'trade_category': 'normal',
            'raw_data': {
                'operation': {
                    'op_type': 'Deal',
                    'op_code': '00',
                    'op_msg': ''
                },
                'order': {
                    'id': order_id,
                    'action': direction,
                    'price': deal_price,
                    'quantity': deal_quantity,
                    'oc_type': octype,
                    'order_type': order_type,
                    'price_type': price_type
                },
                'contract': {
                    'code': contract_code
                }
            },
            'deal_order_id': order_id,
            'contract_name': contract_name,
            'timestamp': datetime.now().isoformat(),
            'is_manual': is_manual
        })
        
        # 延遲5秒發送成交通知，確保在提交通知之後
        def delayed_send():
            time.sleep(5)
            send_telegram_message(msg)
        
        threading.Thread(target=delayed_send, daemon=True).start()
        
        # 清理映射
        with global_lock:
            order_octype_map.pop(order_id, None)
            
    except Exception as e:
        print(f"處理期貨成交回調失敗: {e}")

def get_contract_name_from_code(contract_code):
    """根據合約代碼獲取合約名稱"""
    if not contract_code:
        return "未知"
    
    if contract_code.startswith('TXF'):
        return "大台"
    elif contract_code.startswith('MXF'):
        return "小台"
    elif contract_code.startswith('TMF'):
        return "微台"
    else:
        return "未知"

# 新增：參考TXserver.py的動作顯示邏輯
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

def get_formatted_order_message(is_success, order_id, contract_name, qty, price, octype, direction, order_type, price_type, is_manual, reason=None, contract_code=None, delivery_date=None):
    """格式化訂單提交訊息（參考TXserver.py）"""
    current_time = datetime.now().strftime('%Y/%m/%d')
    
    # 獲取完整合約資訊
    try:
        if contract_code and delivery_date:
            # 簡化合約代碼顯示：TMFG5 -> TMF, MXFG5 -> MXF, TXFG5 -> TXF
            if contract_code.startswith('TMF'):
                simple_code = 'TMF'
            elif contract_code.startswith('MXF'):
                simple_code = 'MXF'
            elif contract_code.startswith('TXF'):
                simple_code = 'TXF'
            else:
                simple_code = contract_code
            contract_display = f"{simple_code} ({delivery_date})"
        elif contract_code:
            # 簡化合約代碼顯示
            if contract_code.startswith('TMF'):
                simple_code = 'TMF'
            elif contract_code.startswith('MXF'):
                simple_code = 'MXF'
            elif contract_code.startswith('TXF'):
                simple_code = 'TXF'
            else:
                simple_code = contract_code
            contract_display = f"{simple_code} (日期未知)"
        else:
            contract_display = "未知"
    except:
        contract_display = "未知"
    
    # 訂單類型顯示
    try:
        if str(price_type).upper() == 'MKT':
            price_text = "市價單"
        else:
            price_text = "限價單"
        
        if str(order_type).upper() == 'IOC':
            type_text = "IOC"
        else:
            type_text = "ROD"
        
        order_type_display = f"{price_text}（{type_text}）"
    except:
        order_type_display = f"未知 ({order_type})"
    
    # 提交類型 - 參考TXserver.py邏輯
    manual_type = "手動" if is_manual else "自動"
    # 根據octype判斷開平倉
    if str(octype).upper() == 'NEW':
        octype_display = "開倉"
    elif str(octype).upper() == 'COVER':
        octype_display = "平倉"
    else:
        octype_display = f"未知({octype})"  # 不預設為開倉，顯示實際值
    submit_type = f"{manual_type}{octype_display}"
    
    # 提交動作 - 使用TXserver.py的get_action_display_by_rule邏輯
    submit_action = get_action_display_by_rule(str(octype).upper(), str(direction).upper())
    
    # 提交價格
    if str(price_type).upper() == "MKT":
        price_display = "市價"
    else:
        price_display = f"{price:.0f}"
    
    # 失敗原因翻譯 - 參考TXserver.py的OP_MSG_TRANSLATIONS
    if reason:
        translated_reason = OP_MSG_TRANSLATIONS.get(reason, reason)
    else:
        translated_reason = reason
    
    if is_success:
        msg = (f"⭕ 提交成功（{current_time}）\n"
               f"選用合約：{contract_display}\n"
               f"訂單類型：{order_type_display}\n"
               f"提交單號：{order_id}\n"
               f"提交類型：{submit_type}\n"
               f"提交動作：{submit_action}\n"
               f"提交部位：{contract_name}\n"
               f"提交數量：{qty} 口\n"
               f"提交價格：{price_display}")
    else:
        msg = (f"❌ 提交失敗（{current_time}）\n"
               f"選用合約：{contract_display}\n"
               f"訂單類型：{order_type_display}\n"
               f"提交單號：{order_id if order_id != '未知' else '未知'}\n"
               f"提交類型：{submit_type}\n"
               f"提交動作：{submit_action}\n"
               f"提交部位：{contract_name}\n"
               f"提交數量：{qty} 口\n"
               f"提交價格：{price_display}\n"
               f"原因：{translated_reason}")
    
    return msg

def get_formatted_trade_message(order_id, contract_name, qty, price, octype, direction, order_type, price_type, is_manual, contract_code=None, delivery_date=None):
    """格式化成交訊息"""
    current_time = datetime.now().strftime('%Y/%m/%d')
    
    # 獲取完整合約資訊 - 修正：簡化合約代碼顯示
    try:
        if contract_code and delivery_date:
            # 簡化合約代碼顯示：TMFG5 -> TMF, MXFG5 -> MXF, TXFG5 -> TXF
            if contract_code.startswith('TMF'):
                simple_code = 'TMF'
            elif contract_code.startswith('MXF'):
                simple_code = 'MXF'
            elif contract_code.startswith('TXF'):
                simple_code = 'TXF'
            else:
                simple_code = contract_code
            contract_display = f"{simple_code} ({delivery_date})"
        elif contract_code:
            # 簡化合約代碼顯示
            if contract_code.startswith('TMF'):
                simple_code = 'TMF'
            elif contract_code.startswith('MXF'):
                simple_code = 'MXF'
            elif contract_code.startswith('TXF'):
                simple_code = 'TXF'
            else:
                simple_code = contract_code
            contract_display = f"{simple_code} (日期未知)"
        else:
            contract_display = "未知"
    except:
        contract_display = "未知"
    
    # 訂單類型顯示
    try:
        if str(price_type).upper() == 'MKT':
            price_text = "市價單"
        else:
            price_text = "限價單"
        
        if str(order_type).upper() == 'IOC':
            type_text = "IOC"
        else:
            type_text = "ROD"
        
        order_type_display = f"{price_text}（{type_text}）"
    except:
        order_type_display = f"未知 ({order_type})"
    
    # 成交類型
    manual_type = "手動" if is_manual else "自動"
    # 根據octype判斷開平倉
    if str(octype).upper() == 'NEW':
        octype_display = "開倉"
    elif str(octype).upper() == 'COVER':
        octype_display = "平倉"
    else:
        octype_display = f"未知({octype})"  # 不預設為開倉，顯示實際值
    trade_type = f"{manual_type}{octype_display}"
    
    # 成交動作 - 使用TXserver.py的get_action_display_by_rule邏輯
    trade_action = get_action_display_by_rule(str(octype).upper(), str(direction).upper())
    
    msg = (f"✅ 成交通知（{current_time}）\n"
           f"選用合約：{contract_display}\n"
           f"訂單類型：{order_type_display}\n"
           f"成交單號：{order_id}\n"
           f"成交類型：{trade_type}\n"
           f"成交動作：{trade_action}\n"
           f"成交部位：{contract_name}\n"
           f"成交數量：{qty} 口\n"
           f"成交價格：{price:.0f}")
    
    return msg

def get_simple_order_log_message(contract_name, direction, qty, price, order_id, octype, is_manual, is_success=False, order_type=None, price_type=None):
    """生成簡化的訂單日誌訊息"""
    try:
        # 簡化合約名稱
        if '微台' in contract_name or 'TMF' in contract_name:
            simple_contract = '微台'
        elif '小台' in contract_name or 'MXF' in contract_name:
            simple_contract = '小台'
        elif '大台' in contract_name or 'TXF' in contract_name:
            simple_contract = '大台'
        else:
            simple_contract = contract_name
        
        # 判斷開平倉
        if str(octype).upper() == 'NEW':
            action_type = '開倉'
        elif str(octype).upper() == 'COVER':
            action_type = '平倉'
        else:
            action_type = '未知'
        
        # 判斷手動/自動
        manual_type = '手動' if is_manual else '自動'
        
        # 格式化價格
        if price == 0:
            price_display = '市價'
        else:
            price_display = f'$ {price:,.0f}'
        
        # 格式化方向
        if str(direction).upper() == 'BUY':
            direction_display = '多單'
        elif str(direction).upper() == 'SELL':
            direction_display = '空單'
        else:
            direction_display = direction
        
        # 格式化訂單類型和價格類型
        order_type_display = order_type or 'ROD'
        price_type_display = price_type or 'LMT'
        
        # 組合訂單類型顯示
        if price_type_display.upper() == 'MKT':
            order_info = f"市價 ({order_type_display})"
        else:
            order_info = f"限價 ({order_type_display})"
        
        if is_success:
            # 成交成功格式
            return f"{action_type}成功：{simple_contract}｜{direction_display}｜{qty} 口｜{price_display}｜{order_info}"
        else:
            # 掛單格式
            return f"{manual_type}{action_type}：{simple_contract}｜{direction_display}｜{qty} 口｜{price_display}｜{order_info}"
            
    except Exception as e:
        print(f"生成簡化日誌訊息失敗: {e}")
        return f"日誌生成失敗: {order_id}"

def login_sinopac():
    global sinopac_api, sinopac_connected, sinopac_account, sinopac_login_status, sinopac_login_time, auto_logout_timer
    
    try:
        # 使用與main.py相同的方式載入.env設定
        if DOTENV_AVAILABLE and os.path.exists(ENV_PATH):
            load_dotenv(ENV_PATH)
        
        api_key = os.getenv('API_KEY', '')
        secret_key = os.getenv('SECRET_KEY', '')
        person_id = os.getenv('PERSON_ID', '')
        ca_passwd = os.getenv('CA_PASSWD', '')
        ca_path = os.getenv('CA_PATH', '')
        
        # 初始化API
        if sinopac_api:
            try:
                sinopac_api.logout()
            except:
                pass
        
        sinopac_api = sj.Shioaji()
        
        # API登入
        sinopac_api.login(api_key=api_key, secret_key=secret_key)
        
        # 設置回調函數
        try:
            sinopac_api.set_order_callback(order_callback)
            print("回調函數設置成功")
        except Exception as e:
            print(f"回調函數設置失敗: {e}")
            # 回調函數設置失敗，但繼續使用基本功能
        
        # 激活CA憑證 - 智能路徑處理
        cert_file = None
        
        # 優先檢查 server/certificate/ 目錄
        cert_dir = os.path.join(os.path.dirname(__file__), 'certificate')
        if os.path.exists(cert_dir):
            for file in os.listdir(cert_dir):
                if file.endswith('.pfx'):
                    cert_file = os.path.join(cert_dir, file)
                    print(f"找到憑證檔案: {cert_file}")
                    break
        
        # 如果 server/certificate/ 目錄沒有找到，再檢查 ca_path
        if not cert_file and ca_path:
            # 如果是絕對路徑，直接使用
            if os.path.isabs(ca_path):
                final_ca_path = ca_path
            else:
                # 如果是相對路徑，轉換為絕對路徑
                final_ca_path = os.path.abspath(os.path.join(os.path.dirname(__file__), ca_path))
            
            print(f"憑證路徑: {final_ca_path}")
            
            # 檢查路徑是否存在
            if os.path.isfile(final_ca_path):
                cert_file = final_ca_path
            elif os.path.isdir(final_ca_path):
                for file in os.listdir(final_ca_path):
                    if file.endswith('.pfx'):
                        cert_file = os.path.join(final_ca_path, file)
                        print(f"找到憑證檔案: {cert_file}")
                        break
        
        if cert_file and os.path.exists(cert_file):
            try:
                sinopac_api.activate_ca(ca_path=cert_file, ca_passwd=ca_passwd, person_id=person_id)
                print("憑證激活成功")
            except Exception as e:
                error_msg = str(e).lower()
                print(f"憑證激活失敗: {e}")
                
                # 詳細的錯誤分析和建議（僅控制台輸出，不發送TG通知）
                if "password" in error_msg or "passwd" in error_msg or "密碼" in error_msg:
                    print("❌ 憑證密碼錯誤！請檢查前端輸入的憑證密碼是否正確")
                elif "person_id" in error_msg or "身分證" in error_msg or "id" in error_msg:
                    print("❌ 身分證字號錯誤！請檢查格式是否為：1個英文字母+9個數字")
                elif "file" in error_msg or "path" in error_msg or "not found" in error_msg:
                    print("❌ 憑證檔案問題！請檢查 .pfx 檔案是否正確上傳")
                elif "expired" in error_msg or "過期" in error_msg:
                    print("❌ 憑證已過期！請聯絡永豐證券更新憑證")
                else:
                    print(f"❌ 憑證激活失敗：{e}")
                
                # 記錄到前端系統日誌
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': f'憑證激活失敗：{str(e)[:100]}', 'type': 'error'},
                        timeout=5
                    )
                except:
                    pass
        else:
            error_msg = f"找不到憑證檔案，請確認 {final_ca_path if 'final_ca_path' in locals() else ca_path} 目錄下有 .pfx 檔案"
            print(f"❌ {error_msg}")
            # 不發送TG通知，只記錄到前端
            try:
                requests.post(
                    f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                    json={'message': error_msg, 'type': 'error'},
                    timeout=5
                )
            except:
                pass
        
        # 設定期貨帳戶
        try:
            accounts = [acc for acc in sinopac_api.list_accounts() if acc.account_type == 'F']
            if accounts:
                sinopac_api.futopt_account = accounts[0]
                sinopac_account = accounts[0].account_id
            else:
                sinopac_account = "無期貨帳戶"
        except Exception:
            sinopac_account = "帳戶設定失敗"
        
        sinopac_connected = True
        sinopac_login_status = True
        sinopac_login_time = datetime.now()  # 記錄登入時間
        
        # 啟動12小時自動登出定時器
        start_auto_logout_timer()
        
        # 登入成功後更新期貨合約和保證金資訊
        update_futures_contracts()
        update_margin_requirements_from_api()
        
        # 初始化TXserver風格的合約對象
        init_contracts()
        
        print("永豐API 登入成功！！！")
        return True
        
    except Exception as e:
        sinopac_connected = False
        sinopac_login_status = False
        sinopac_account = None
        sinopac_login_time = None
        print(f"永豐API 登入失敗！！！ 錯誤：{str(e)}")
        return False

def logout_sinopac():
    """登出永豐API"""
    global sinopac_api, sinopac_connected, sinopac_account, sinopac_login_status, sinopac_login_time, auto_logout_timer, order_octype_map
    
    try:
        if sinopac_api and sinopac_connected:
            sinopac_api.logout()
        
        sinopac_connected = False
        sinopac_login_status = False
        sinopac_account = None
        sinopac_login_time = None
        
        # 停止自動登出定時器
        stop_auto_logout_timer()
        
        # 清理訂單映射（參考TXserver.py架構）
        with global_lock:
            order_octype_map.clear()
        
        print("永豐API登出成功！！！")
        return True
        
    except Exception as e:
        print(f"永豐API登出失敗: {e}")
        sinopac_connected = False
        sinopac_login_status = False
        sinopac_account = None
        sinopac_login_time = None
        
        # 即使登出失敗也清理映射
        with global_lock:
            order_octype_map.clear()
        
        return False

def start_auto_logout_timer():
    """啟動12小時自動登出定時器"""
    global auto_logout_timer
    
    # 如果已有定時器在運行，先停止它
    stop_auto_logout_timer()
    
    # 計算12小時後的時間
    logout_time = datetime.now() + timedelta(hours=AUTO_LOGOUT_HOURS)
    
    def auto_logout_task():
        """12小時後自動登出並重新登入"""
        global sinopac_connected, sinopac_login_status, is_reconnecting
        
        if sinopac_connected and sinopac_login_status:
            print(f"目前連線已滿{AUTO_LOGOUT_HOURS}個小時，將自動登出並重新登入！")
            
            # 發送前端系統日誌
            try:
                requests.post(
                    f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                    json={'message': f'目前連線已滿{AUTO_LOGOUT_HOURS}個小時，將自動登出並重新登入！', 'type': 'warning'},
                    timeout=5
                )
            except:
                pass  # 如果前端不可用，靜默處理
            
            # 登出
            logout_sinopac()
            
            # 等待1秒後重新登入
            time.sleep(1)
            
            # 重新登入
            if login_sinopac():
                print("12小時自動重新登入成功！")
                # 發送前端系統日誌
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': '自動重新登入成功！', 'type': 'success'},
                        timeout=5
                    )
                except:
                    pass
            else:
                print("12小時自動重新登入失敗！")
                # 發送前端系統日誌
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': '自動重新登入失敗！', 'type': 'error'},
                        timeout=5
                    )
                except:
                    pass
    
    # 計算延遲時間（秒）
    delay_seconds = AUTO_LOGOUT_HOURS * 3600
    
    # 啟動定時器
    auto_logout_timer = threading.Timer(delay_seconds, auto_logout_task)
    auto_logout_timer.daemon = True
    auto_logout_timer.start()
    
    print(f"已啟動{AUTO_LOGOUT_HOURS}小時自動登出定時器，將於 {logout_time.strftime('%Y-%m-%d %H:%M:%S')} 自動登出")

def stop_auto_logout_timer():
    """停止自動登出定時器"""
    global auto_logout_timer
    
    if auto_logout_timer and auto_logout_timer.is_alive():
        auto_logout_timer.cancel()
        auto_logout_timer = None
        print("已停止自動登出定時器")

def get_connection_duration():
    """獲取當前連線時長（小時）"""
    global sinopac_login_time, sinopac_connected
    
    if sinopac_login_time and sinopac_connected:
        duration = datetime.now() - sinopac_login_time
        return duration.total_seconds() / 3600  # 轉換為小時
    elif not sinopac_connected:
        return -1  # 未連線
    else:
        return 0  # 連線但沒有登入時間記錄

def get_sinopac_status():
    """獲取永豐API狀態"""
    global sinopac_connected, sinopac_account, sinopac_login_status
    
    # 處理期貨帳戶顯示
    if sinopac_account and sinopac_account not in ["無期貨帳戶", "帳戶設定失敗"]:
        futures_display = sinopac_account  # 真實帳戶號碼
    elif sinopac_account == "無期貨帳戶":
        futures_display = "無期貨帳戶"
    else:
        futures_display = "未獲取帳戶"  # 包含未獲取和設定失敗的情況
    
    return {
        "connected": sinopac_connected,
        "status": sinopac_login_status,
        "futures_account": futures_display,
        "api_ready": sinopac_connected and sinopac_account is not None and sinopac_account != "無期貨帳戶" and sinopac_account != "帳戶設定失敗"
    }

def reset_login_flag():
    update_login_status(0)
    # 重置LOGIN時停止ngrok
    stop_ngrok()
    # 重置時也登出永豐API（如果已經初始化的話）
    if sinopac_api is not None:
        logout_sinopac()

# 程式啟動時重置登入狀態
reset_login_flag()

def cleanup_on_exit():
    """程式退出時的清理工作"""
    global sinopac_api, sinopac_connected, sinopac_account, sinopac_login_status, auto_logout_timer, ngrok_process, ngrok_auto_restart_timer, order_octype_map, connection_monitor_timer
    
    try:
        # 停止自動登出定時器
        stop_auto_logout_timer()
        
        # 停止連線監控器
        stop_connection_monitor()
        
        # 停止自動重啟定時器
        if ngrok_auto_restart_timer and ngrok_auto_restart_timer.is_alive():
            ngrok_auto_restart_timer.cancel()
            ngrok_auto_restart_timer = None
        
        # 關閉 ngrok 進程
        if ngrok_process:
            try:
                print("正在關閉 ngrok 進程...")
                ngrok_process.terminate()
                # 等待最多3秒讓進程正常關閉
                ngrok_process.wait(timeout=3)
                print("ngrok 進程已關閉")
            except subprocess.TimeoutExpired:
                print("ngrok 進程關閉超時，強制終止...")
                ngrok_process.kill()
            except Exception as e:
                print(f"關閉 ngrok 進程時發生錯誤: {e}")
            finally:
                ngrok_process = None
        
        # 永豐API登出（靜默）
        if sinopac_api and sinopac_connected:
            sinopac_api.logout()
            sinopac_connected = False
            sinopac_account = None
            sinopac_login_status = False
        
        # 清理訂單映射
        with global_lock:
            order_octype_map.clear()
            
    except Exception as e:
        pass  # 靜默處理錯誤
    
    # 重置LOGIN狀態（靜默重試）
    for attempt in range(3):
        try:
            update_login_status(0)
            # 驗證是否成功重置
            if os.path.exists(ENV_PATH):
                with open(ENV_PATH, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if 'LOGIN=0' in content:
                        break
            time.sleep(0.1)  # 縮短重試間隔
        except Exception as e:
            pass  # 靜默處理錯誤
    
    print("清理工作完成")

def signal_handler(signum, frame):
    """信號處理函數"""
    cleanup_on_exit()
    sys.exit(0)

# 註冊程序關閉時的清理函數
# atexit.register(cleanup_on_exit)  # 移除atexit註冊，避免重複執行

# 註冊信號處理器
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# 移除check_ngrok_update_alternative函數，使用check_ngrok_update_simple作為主要更新檢查方法

def check_ngrok_update_simple():
    """簡單的ngrok更新檢查方法，使用已知的最新版本"""
    try:
        print("使用簡單方法檢查ngrok更新...")
        
        # 已知的最新版本（可以定期手動更新）
        known_latest_version = "3.23.3"
        print(f"已知最新版本: {known_latest_version}")
        
        current_version = get_ngrok_version()
        print(f"當前 ngrok 版本: {current_version}")
        
        if current_version:
            if compare_versions(known_latest_version, current_version) > 0:
                ngrok_update_available = True
                print(f"ngrok更新可用: {current_version} -> {known_latest_version}")
                return {
                    'update_available': True,
                    'current_version': current_version,
                    'latest_version': known_latest_version,
                    'download_url': f'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v{known_latest_version}-windows-amd64.zip'
                }
            else:
                ngrok_update_available = False
                print(f"ngrok已是最新版本: {current_version}")
                return {
                    'update_available': False,
                    'current_version': current_version,
                    'latest_version': known_latest_version
                }
        else:
            print("無法獲取當前版本")
            return None
            
    except Exception as e:
        print(f"簡單更新檢查失敗: {e}")
        return None

def start_ngrok_auto_restart():
    """啟動 ngrok 自動重啟"""
    global ngrok_auto_restart_timer, ngrok_process
    
    # 如果已有重啟定時器在運行，先取消
    if ngrok_auto_restart_timer and ngrok_auto_restart_timer.is_alive():
        ngrok_auto_restart_timer.cancel()
    
    def auto_restart_task():
        """自動重啟 ngrok"""
        global ngrok_process, ngrok_status, ngrok_auto_restart_timer
        
        try:
            print("執行 ngrok 自動重啟...")
            
            # 確保舊進程已關閉
            if ngrok_process:
                try:
                    ngrok_process.terminate()
                    ngrok_process.wait(timeout=2)
                except:
                    pass
                ngrok_process = None
            
            # 重新啟動 ngrok
            if start_ngrok():
                print("ngrok 自動重啟成功！")
                # 發送前端系統日誌
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': 'ngrok 自動重啟成功！', 'type': 'success'},
                        timeout=5
                    )
                except:
                    pass
            else:
                print("ngrok 自動重啟失敗！")
                # 發送前端系統日誌
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': 'ngrok 自動重啟失敗！', 'type': 'error'},
                        timeout=5
                    )
                except:
                    pass
        except Exception as e:
            print(f"ngrok 自動重啟時發生錯誤: {e}")
        finally:
            ngrok_auto_restart_timer = None
    
    # 延遲5秒後重啟，避免頻繁重啟
    ngrok_auto_restart_timer = threading.Timer(5.0, auto_restart_task)
    ngrok_auto_restart_timer.daemon = True
    ngrok_auto_restart_timer.start()
    print("已啟動 ngrok 自動重啟定時器，5秒後重啟")

# 移除重複的signal_handler函數，保留第一個

def check_daily_startup_notification():
    """檢查是否需要發送每日啟動通知"""
    try:
        global notification_sent_date
        
        # 檢查是否為交易日且開市
        now = datetime.now()
        today = now.date()
        current_time = now.hour * 100 + now.minute  # HHMM格式
        
        # 只在08:45-08:46之間檢查，確保只在開市時發送
        if 845 <= current_time <= 846:
            # 檢查今天是否為交易日且開市
            response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get('is_trading_day', False) and data.get('is_market_open', False):
                    # 確保今天還沒發送過通知
                    if notification_sent_date != today:
                        send_daily_startup_notification()
                        notification_sent_date = today
                        print(f"已發送每日啟動通知：{today}")
                    else:
                        print(f"今日已發送過啟動通知：{today}")
                else:
                    print(f"非交易日或非開市時間，跳過啟動通知：{today}")
            else:
                print(f"無法獲取交易狀態，跳過啟動通知：{today}")
            
    except Exception as e:
        print(f"檢查每日啟動通知失敗: {e}")

def schedule_next_check():
    """排程下一次檢查"""
    # 清除所有現有的排程
    schedule.clear()
    
    # 設定明天早上 8:45 的檢查
    tomorrow = datetime.now() + timedelta(days=1)
    schedule.every().day.at("08:45").do(check_daily_startup_notification)
    
    # 設定今天下午 14:50 的夜盤檢查
    schedule.every().day.at("14:50").do(check_night_session_notification)
    
    # 設定今天晚上 23:59 的交易統計檢查
    schedule.every().day.at("23:59").do(check_daily_trading_statistics)
    
    # 設定星期六早上 05:00 的交易統計檢查（週六夜盤統計）
    schedule.every().saturday.at("05:00").do(check_saturday_trading_statistics)
    
    print(f"已排程下一次啟動通知檢查：{tomorrow.strftime('%Y-%m-%d')} 08:45")
    print(f"已排程下一次夜盤通知檢查：{datetime.now().strftime('%Y-%m-%d')} 14:50")
    print(f"已排程下一次交易統計檢查：{datetime.now().strftime('%Y-%m-%d')} 23:59")
    print(f"已排程週六交易統計檢查：每週六 05:00")

def start_notification_checker():
    """啟動通知檢查器"""
    global notification_sent_date
    notification_sent_date = None
    
    def schedule_loop():
        # 初始排程
        schedule_next_check()
        
        while True:
            schedule.run_pending()
            time.sleep(30)  # 每30秒檢查一次排程
    
    notification_thread = threading.Thread(target=schedule_loop, daemon=True)
    notification_thread.start()

def send_daily_startup_notification():
    """發送每日啟動通知"""
    try:
        # 讀取 .env 檔案獲取 bot token 和 chat id
        if not os.path.exists(ENV_PATH):
            return
        
        load_dotenv(ENV_PATH)
        bot_token = os.getenv('BOT_TOKEN')
        chat_id = os.getenv('CHAT_ID')
        
        if not bot_token or not chat_id:
            return
        
        # 獲取憑證到期日
        cert_end = os.getenv('CERT_END', '')
        
        # 獲取API狀態
        api_status_response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/sinopac/status', timeout=5)
        api_status_data = api_status_response.json()
        api_status = "已連線" if api_status_data.get('connected', False) else "未連線"
        futures_account = api_status_data.get('futures_account', '-')
        
        # 獲取合約資訊
        contracts_response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/futures/contracts', timeout=5)
        contracts_data = contracts_response.json()
        selected_contracts = contracts_data.get('selected_contracts', {})
        
        # 獲取帳戶狀態
        account_response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/account/status', timeout=5)
        account_data = account_response.json().get('data', {})
        
        # 獲取持倉狀態
        position_response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/position/status', timeout=5)
        position_data = position_response.json()
        
        # 構建訊息
        message = "✅ 自動交易台指期正在啟動中.....\n"
        message += "═════ 系統資訊 ═════\n"
        message += f"憑證效期：{cert_end[:10]}\n"  # 只取年月日
        message += f"綁定帳戶：{futures_account}\n"
        message += f"API 狀態：{api_status}\n"
        
        message += "═════ 選用合約 ═════\n"
        # 按照指定順序顯示合約：大台指、小台指、微台指
        contract_order = [
            ('TXF', '大台指'),
            ('MXF', '小台指'), 
            ('TMF', '微台指')
        ]
        
        for code, contract_name in contract_order:
            contract_info = selected_contracts.get(code, '-')
            if contract_info != '-':
                # 解析合約資訊
                parts = contract_info.split('　')
                code_part = parts[0]
                delivery_part = parts[1].replace('交割日：', '')
                margin_part = parts[2].replace('保證金 $', '').replace(',', '')
                
                message += f"{contract_name} {code_part} ({delivery_part}) ${int(margin_part):,}\n"
        
        message += "═════ 帳戶狀態 ═════\n"
        message += f"權益總值：{account_data.get('權益總值', 0)}\n"
        message += f"權益總額：{account_data.get('權益總額', 0)}\n"
        message += f"今日餘額：{account_data.get('今日餘額', 0)}\n"
        message += f"昨日餘額：{account_data.get('昨日餘額', 0)}\n"
        message += f"可用保證金：{account_data.get('可用保證金', 0)}\n"
        message += f"原始保證金：{account_data.get('原始保證金', 0)}\n"
        message += f"維持保證金：{account_data.get('維持保證金', 0)}\n"
        message += f"風險指標：{account_data.get('風險指標', 0)}%\n"
        message += f"手續費：{account_data.get('手續費', 0)}\n"
        message += f"期交稅：{account_data.get('期交稅', 0)}\n"
        message += f"本日平倉損益＄{account_data.get('本日平倉損益', 0)} TWD\n"
        
        message += "═════ 持倉狀態 ═════\n"
        if not position_data.get('has_positions', False):
            message += "❌ 無持倉部位"
        else:
            positions = position_data.get('data', {})
            total_pnl = position_data.get('total_pnl_value', 0)
            
            # 按照指定順序顯示持倉：大台、小台、微台
            position_order = [
                ('TXF', '大台'),
                ('MXF', '小台'),
                ('TMF', '微台')
            ]
            
            for code, contract_name in position_order:
                pos = positions.get(code, {})
                if pos.get('動作', '-') != '-':  # 有持倉的才顯示
                    # 獲取該持倉的未實現盈虧
                    unrealized_pnl = pos.get('未實現盈虧', '0')
                    # 移除千分位符號並轉換為數字
                    pnl_value = int(unrealized_pnl.replace(',', '')) if unrealized_pnl != '-' else 0
                    message += f"{contract_name}｜{pos['動作']}｜{pos['數量']}｜{pos['均價']}｜＄{pnl_value:,} TWD\n"
            
            message += f"未平倉總損益＄{int(total_pnl):,} TWD"
        
        # 發送 Telegram 訊息
        url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        
    except Exception as e:
        print(f"發送每日啟動通知失敗: {e}")

def check_margin_changes():
    """檢查保證金是否有變更"""
    try:
        global margin_requirements, last_margin_requirements
        
        # 更新保證金資訊
        if update_margin_requirements_from_api():
            # 檢查是否有變更
            has_changes = False
            changes = []
            
            for contract in ['大台', '小台', '微台']:
                current = margin_requirements.get(contract, 0)
                previous = last_margin_requirements.get(contract, 0)
                
                # 如果有之前的記錄，且金額不同，就是有變更
                if previous > 0 and current != previous:
                    has_changes = True
                    changes.append((contract, previous, current))
                
                # 更新記錄
                last_margin_requirements[contract] = current
            
            # 如果有變更，發送通知
            if has_changes:
                send_margin_change_notification(changes)
                
    except Exception as e:
        print(f"檢查保證金變更失敗: {e}")

def send_margin_change_notification(changes):
    """發送保證金變更通知"""
    try:
        # 讀取 .env 檔案獲取 bot token 和 chat id
        if not os.path.exists(ENV_PATH):
            return
        
        load_dotenv(ENV_PATH)
        bot_token = os.getenv('BOT_TOKEN')
        chat_id = os.getenv('CHAT_ID')
        
        if not bot_token or not chat_id:
            return
        
        # 構建訊息
        message = "⚠️ 保證金已更新！！！\n"
        
        # 顯示所有合約的最新保證金
        for contract in ['大台', '小台', '微台']:
            margin = margin_requirements.get(contract, 0)
            contract_name = contract + "指" if contract != "微台" else contract + "指"
            message += f"{contract_name}　${margin:,}\n"
        
        # 發送 Telegram 訊息
        url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        
        # 記錄保證金更新到前端日誌
        try:
            margin_log_message = "保證金已更新！"
            for contract in ['大台', '小台', '微台']:
                margin = margin_requirements.get(contract, 0)
                margin_log_message += f" {contract}/{margin:,}"
            margin_log_message += "！！！"
            
            requests.post(
                f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                json={'message': margin_log_message, 'type': 'info'},
                timeout=5
            )
        except:
            pass
        
    except Exception as e:
        print(f"發送保證金變更通知失敗: {e}")

def check_night_session_notification():
    """檢查是否需要發送夜盤通知"""
    try:
        now = datetime.now()
        current_time = now.hour * 100 + now.minute  # HHMM格式
        
        # 只在14:49-14:51之間檢查
        if 1449 <= current_time <= 1451:
            # 檢查今天是否為交易日且開市
            response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get('is_trading_day', False) and data.get('is_market_open', False):
                    # 檢查保證金變更
                    check_margin_changes()

    except Exception as e:
        print(f"檢查夜盤通知失敗: {e}")

def check_daily_trading_statistics():
    """檢查是否需要發送每日交易統計"""
    try:
        # 檢查今天是否為交易日
        response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get('is_trading_day', False):
                send_daily_trading_statistics()
            else:
                print(f"非交易日，跳過交易統計：{datetime.now().date()}")
        else:
            print(f"無法獲取交易狀態，跳過交易統計：{datetime.now().date()}")
            
    except Exception as e:
        print(f"檢查每日交易統計失敗: {e}")

def check_saturday_trading_statistics():
    """檢查是否需要發送週六交易統計（週六夜盤統計）"""
    try:
        # 週六固定發送夜盤統計
        send_daily_trading_statistics()
        print(f"已發送週六夜盤交易統計：{datetime.now().date()}")
            
    except Exception as e:
        print(f"檢查週六交易統計失敗: {e}")

def send_daily_trading_statistics():
    """發送每日交易統計"""
    try:
        # 讀取 .env 檔案獲取 bot token 和 chat id
        if not os.path.exists(ENV_PATH):
            return
        
        load_dotenv(ENV_PATH)
        bot_token = os.getenv('BOT_TOKEN')
        chat_id = os.getenv('CHAT_ID')
        
        if not bot_token or not chat_id:
            return
        
        # 獲取今天的交易記錄
        today = datetime.now().strftime('%Y%m%d')
        trades_file = os.path.join('transdata', f'trades_{today}.json')
        
        # 統計變數
        total_orders = 0  # 委託單量
        total_trades = 0  # 成交單量
        total_cancels = 0  # 取消單量
        total_cover_quantity = 0  # 平倉口數
        cover_trades = []  # 平倉交易明細
        
        # 讀取交易記錄
        if os.path.exists(trades_file):
            try:
                with open(trades_file, 'r', encoding='utf-8') as f:
                    trades = json.load(f)
                
                # 用於追蹤已統計的訂單ID，避免重複計算
                processed_orders = set()
                
                for trade in trades:
                    raw_data = trade.get('raw_data', {})
                    operation = raw_data.get('operation', {})
                    order = raw_data.get('order', {})
                    order_id = order.get('id', '')
                    
                    # 統計委託單量（所有提交成功的訂單，不重複計算）
                    if trade.get('type') == 'order' and order_id not in processed_orders:
                        total_orders += 1
                        processed_orders.add(order_id)
                    
                    # 統計成交單量（有成交記錄的訂單）
                    if trade.get('type') == 'deal':
                        total_trades += 1
                    
                    # 統計取消單量
                    if trade.get('type') == 'cancel':
                        total_cancels += 1
                    
                    # 統計平倉口數和明細（只統計有成交的平倉）
                    if order.get('oc_type') == 'Cover':
                        # 查找對應的成交記錄
                        has_deal = False
                        deal_price = order.get('price', 0)  # 預設使用委託價格
                        
                        for deal_trade in trades:
                            if (deal_trade.get('type') == 'deal' and 
                                deal_trade.get('deal_order_id') == trade.get('deal_order_id')):
                                has_deal = True
                                deal_price = deal_trade.get('raw_data', {}).get('order', {}).get('price', order.get('price', 0))
                                break
                        
                        # 只有有成交的平倉才統計
                        if has_deal:
                            quantity = order.get('quantity', 0)
                            total_cover_quantity += quantity
                            
                            # 記錄平倉交易明細
                            contract_code = order.get('contract', {}).get('code', '')
                            contract_name = get_contract_name_from_code(contract_code)
                            action = order.get('action', '')
                            order_price = order.get('price', 0)  # 委託價格
                            
                            # 計算損益（這裡需要開倉價格，暫時設為0）
                            # 實際的損益計算需要開倉價格，這裡先顯示成交價格
                            pnl = 0  # 暫時設為0，實際需要開倉價格計算
                            
                            cover_trades.append({
                                'contract_name': contract_name,
                                'action': '空單' if action == 'Sell' else '多單',
                                'quantity': f"{quantity}口",
                                'order_price': f"{int(order_price):,}",
                                'cover_price': f"{int(deal_price):,}",
                                'pnl': pnl
                            })
                        
            except Exception as e:
                print(f"讀取交易記錄失敗: {e}")
        
        # 獲取帳戶狀態
        account_response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/account/status', timeout=5)
        account_data = account_response.json().get('data', {}) if account_response.status_code == 200 else {}
        
        # 獲取持倉狀態
        position_response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/position/status', timeout=5)
        position_data = position_response.json() if position_response.status_code == 200 else {}
        
        # 構建訊息
        today_str = datetime.now().strftime('%Y/%m/%d')
        message = f"📊 交易統計（{today_str}）\n"
        
        message += "═════ 總覽 ═════\n"
        message += f"成交數量：{total_trades} 筆\n"
        message += f"委託數量：{total_orders} 筆\n"
        message += f"取消數量：{total_cancels} 筆\n"
        message += f"平倉口數：{total_cover_quantity} 口\n"
        
        message += "═════ 帳戶狀態 ═════\n"
        message += f"權益總值：{account_data.get('權益總值', 0)}\n"
        message += f"權益總額：{account_data.get('權益總額', 0)}\n"
        message += f"今日餘額：{account_data.get('今日餘額', 0)}\n"
        message += f"昨日餘額：{account_data.get('昨日餘額', 0)}\n"
        message += f"可用保證金：{account_data.get('可用保證金', 0)}\n"
        message += f"原始保證金：{account_data.get('原始保證金', 0)}\n"
        message += f"維持保證金：{account_data.get('維持保證金', 0)}\n"
        message += f"風險指標：{account_data.get('風險指標', 0)}%\n"
        message += f"手續費：{account_data.get('手續費', 0)}\n"
        message += f"期交稅：{account_data.get('期交稅', 0)}\n"
        message += f"本日平倉損益＄{account_data.get('本日平倉損益', 0)} TWD\n"
        
        message += "═════ 交易明細 ═════\n"
        if not cover_trades:
            message += "❌ 無平倉交易"
        else:
            # 按照指定順序排序：大台、小台、微台
            def get_contract_order(contract_name):
                order_map = {'大台': 0, '小台': 1, '微台': 2}
                return order_map.get(contract_name, 3)
            
            # 排序交易明細
            cover_trades.sort(key=lambda x: get_contract_order(x['contract_name']))
            
            for trade in cover_trades:
                message += f"{trade['contract_name']}｜{trade['action']}｜{trade['quantity']}｜{trade['order_price']}｜{trade['cover_price']}\n＄{trade['pnl']:,} TWD\n"
        
        message += "═════ 持倉狀態 ═════\n"
        if not position_data.get('has_positions', False):
            message += "❌ 無持倉部位"
        else:
            positions = position_data.get('data', {})
            total_pnl = position_data.get('total_pnl_value', 0)
            
            # 按照指定順序顯示持倉：大台、小台、微台
            position_order = [
                ('TXF', '大台'),
                ('MXF', '小台'),
                ('TMF', '微台')
            ]
            
            for code, contract_name in position_order:
                pos = positions.get(code, {})
                if pos.get('動作', '-') != '-':  # 有持倉的才顯示
                    # 獲取該持倉的未實現盈虧
                    unrealized_pnl = pos.get('未實現盈虧', '0')
                    # 移除千分位符號並轉換為數字
                    pnl_value = int(unrealized_pnl.replace(',', '')) if unrealized_pnl != '-' else 0
                    message += f"{contract_name}｜{pos['動作']}｜{pos['數量']}｜{pos['均價']}｜＄{pnl_value:,} TWD\n"
            
            message += f"未平倉總損益＄{int(total_pnl):,} TWD"
        
        # 發送 Telegram 訊息
        url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        
        print(f"已發送交易統計：{today_str}")
        
        # 發送前端系統日誌
        try:
            requests.post(
                f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                json={'message': 'Telegram［交易統計］訊息發送成功！！！', 'type': 'success'},
                timeout=5
            )
        except:
            pass
        
    except Exception as e:
        print(f"發送每日交易統計失敗: {e}")

# 測試功能已移除

@app.route('/api/manual/order', methods=['POST'])
def manual_order():
    """手動下單API"""
    try:
        # 驗證API是否已連線
        if not sinopac_connected or not sinopac_api:
            return jsonify({
                'status': 'error',
                'message': '永豐API未連線'
            }), 400
        
        # 獲取下單數據
        data = request.get_json()
        if not data:
            return jsonify({
                'status': 'error',
                'message': '無效的請求數據'
            }), 400
        
        # 解析下單參數
        contract_code = data.get('contract_code', 'TXF')  # 合約代碼
        quantity = int(data.get('quantity', 1))  # 數量
        direction = data.get('direction', '')  # 開多、開空、平多、平空（兼容性）
        price = float(data.get('price', 0))  # 價格
        price_type = data.get('price_type', None)  # MKT或LMT
        order_type = data.get('order_type', None)  # IOC或ROD
        position_type = data.get('position_type', None)  # None、long、short
        action_param = data.get('action', None)  # Buy或Sell（永豐官方參數）
        octype_param = data.get('octype', None)  # New或Cover（永豐官方參數）
        
        # 調試信息
        print(f"=== 手動下單參數調試 ===")
        print(f"原始數據: {data}")
        print(f"所有參數:")
        for key, value in data.items():
            print(f"  {key}: '{value}'")
        print(f"is_manual: True")
        print(f"永豐官方參數: action='{action_param}', octype='{octype_param}'")
        
        # 驗證必要欄位
        if not action_param or not octype_param:
            return jsonify({
                'status': 'error',
                'message': '永豐手動下單需要提供 action (Buy/Sell) 和 octype (New/Cover) 參數'
            }), 400
        
        # 檢查是否為交易時間
        trading_status = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5).json()
        if not trading_status.get('is_trading_day', False) or not trading_status.get('is_market_open', False):
            return jsonify({
                'status': 'error',
                'message': '非交易時間'
            }), 400
        
        # 執行手動下單
        try:
            order_result = place_futures_order(
                contract_code=contract_code,
                quantity=quantity,
                direction=direction,
                price=price,
                is_manual=True,  # 手動下單
                position_type=position_type,
                price_type=price_type,  # 傳遞實際的price_type
                order_type=order_type,  # 傳遞實際的order_type
                action_param=action_param,  # 傳遞永豐官方action參數
                octype_param=octype_param   # 傳遞永豐官方octype參數
            )
            
            return jsonify({
                'status': 'success',
                'message': '手動下單成功',
                'order': order_result
            })
            
        except Exception as e:
            error_msg = str(e)
            return jsonify({
                'status': 'error',
                'message': f'手動下單失敗: {error_msg}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'處理請求失敗: {str(e)}'
        }), 500

def is_ip_allowed(ip):
    """檢查IP是否在白名單中"""
    allowed_ips = {"127.0.0.1", "::1"}  # 本地IP白名單，可根據需要擴充
    return ip in allowed_ips

@app.route('/webhook', methods=['POST'])
def tradingview_webhook():
    """接收TradingView的webhook信號（使用TXserver邏輯）"""
    global has_processed_delivery_exit, active_trades, recent_signals, rollover_processed_signals
    
    client_ip = request.remote_addr
    # 暫時不進行IP限制，但記錄來源IP
    print(f"客戶端IP: {client_ip}")
    
    try:
        raw = request.data.decode('utf-8')
        current_time = datetime.now().strftime('%Y/%m/%d %H:%M:%S')
        print(f"=== [{current_time}] 收到TradingView Webhook請求 ===")
        print(f"原始數據: {raw}")
        
        # 檢查無效訊號
        if '{{strategy.order.alert_message}}' in raw or not raw.strip():
            print("警告: 無效訊號")
            # 記錄失敗的請求
            add_custom_request_log('POST', '/webhook', 400, {
                'reason': '無效訊號',
                'client_ip': client_ip,
                'data_preview': raw[:50] if raw else 'empty'
            })
            return '無效訊號', 400
            
        data = json.loads(raw)
        signal_id = data.get('tradeId')
        
        # 轉倉邏輯檢查
        if process_rollover_signal(data):
            print(f"轉倉模式: 處理訊號 {signal_id}")
            # 在轉倉模式下，強制使用次月合約
            data['rollover_mode'] = True
        
        # 重複訊號檢查
        with global_lock:
            print(f"檢查重複訊號: recent_signals={recent_signals}")
            if signal_id in recent_signals:
                print(f"警告: 重複訊號 {signal_id}，忽略")
                # 記錄重複訊號
                add_custom_request_log('POST', '/webhook', 400, {
                    'reason': '重複訊號',
                    'signal_id': signal_id,
                    'client_ip': client_ip
                })
                return '重複訊號', 400
            recent_signals.add(signal_id)
            # 10秒後清除記錄
            threading.Timer(10, lambda: recent_signals.discard(signal_id)).start()
        
        data['receive_time'] = datetime.now()
        process_signal(data)
        
        # 記錄成功的 webhook 請求
        add_custom_request_log('POST', '/webhook', 200, {
            'signal_id': signal_id,
            'signal_type': data.get('type'),
            'direction': data.get('direction'),
            'client_ip': client_ip,
            'contracts': f"TXF:{data.get('txf', 0)} MXF:{data.get('mxf', 0)} TMF:{data.get('tmf', 0)}"
        })
        
        return 'OK', 200
        
    except Exception as e:
        error_msg = str(e)
        print(f"Webhook 處理錯誤：{error_msg}")
        import traceback
        traceback.print_exc()
        
        # 嘗試使用統一格式，如果無法解析data就用簡單訊息
        try:
            send_unified_failure_message(data, f"Webhook解析錯誤：{error_msg[:100]}")
        except:
            send_telegram_message(f"❌ Webhook 錯誤：{error_msg[:100]}")
        
        # 記錄錯誤的請求
        add_custom_request_log('POST', '/webhook', 500, {
            'reason': error_msg[:100],
            'client_ip': client_ip
        })
        
        return f'錯誤：{error_msg}', 500

def send_unified_failure_message(data, reason, order_id="未知"):
    """發送統一的提交失敗訊息"""
    global contract_txf, contract_mxf, contract_tmf
    
    try:
        # 解析訊號數據
        qty_txf = int(float(data.get('txf', 0)))
        qty_mxf = int(float(data.get('mxf', 0)))
        qty_tmf = int(float(data.get('tmf', 0)))
        price = float(data.get('price', 0))
        direction = data.get('direction', '未知')
        msg_type = data.get('type', 'entry')
        
        # 確定交易動作
        if direction == "開多":
            expected_action = safe_constants.get_action('BUY')
        elif direction == "開空":
            expected_action = safe_constants.get_action('SELL')
        else:
            expected_action = direction
        
        # 確定開平倉類型 - webhook邏輯
        if direction in ['開多', '開空']:
            octype = 'New'  # 開倉
        elif direction in ['平多', '平空']:
            octype = 'Cover'  # 平倉
        else:
            # 根據msg_type判斷
            octype = 'New' if msg_type == 'entry' else 'Cover'
        
        # 獲取合約資訊
        contracts = [
            (contract_txf, qty_txf, "大台", "TXF"),
            (contract_mxf, qty_mxf, "小台", "MXF"), 
            (contract_tmf, qty_tmf, "微台", "TMF")
        ]
        
        # 對每個有數量的合約發送失敗訊息
        for contract, qty, name, code in contracts:
            if qty > 0:
                # 如果合約存在，獲取交割日期
                if contract:
                    delivery_date = contract.delivery_date
                    if hasattr(delivery_date, 'strftime'):
                        delivery_date_str = delivery_date.strftime('%Y/%m/%d')
                    else:
                        delivery_date_str = str(delivery_date)
                    contract_code = contract.code
                else:
                    # 如果合約不存在，使用預設值
                    delivery_date_str = "未知"
                    contract_code = f"{code}XX" 
                
                # 記錄掛單失敗日誌
                log_message = get_simple_order_log_message(
                    contract_name=name,
                    direction=str(expected_action),
                    qty=qty,
                    price=price,
                    order_id=order_id,
                    octype=octype,
                    is_manual=False,
                    is_success=False,
                    order_type="IOC",
                    price_type="MKT"
                )
                try:
                    requests.post(
                        f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                        json={'message': log_message, 'type': 'error'},
                        timeout=5
                    )
                except:
                    pass
                
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
                
    except Exception as e:
        print(f"發送統一失敗訊息錯誤: {e}")
        # 如果統一格式失敗，回退到簡單訊息
        send_telegram_message(f"❌ 提交失敗：{reason}")

def process_signal(data):
    """處理TradingView訊號（參考TXserver.py邏輯）"""
    global has_processed_delivery_exit, active_trades, contract_txf, contract_mxf, contract_tmf, rollover_mode
    
    print(f"[process_signal] 開始處理訊號數據: {data}")
    
    try:
        # 驗證API是否已連線
        if not sinopac_connected or not sinopac_api:
            print("錯誤: 永豐API未連線")
            send_unified_failure_message(data, "永豐API未連線")
            return
            
        # 解析訊號數據
        signal_id = data.get('tradeId')
        msg_type = data.get('type')  # entry 或 exit
        direction = data.get('direction', '未知')
        is_rollover_mode = data.get('rollover_mode', False)
        
        # 獲取價格和時間
        time_ms = int(data.get('time', 0)) / 1000 if data.get('time') else 0
        if time_ms > 0:
            time_str = (datetime.utcfromtimestamp(time_ms) + timedelta(hours=8)).strftime('%Y/%m/%d %H:%M')
        else:
            time_str = datetime.now().strftime('%Y/%m/%d %H:%M')
            
        qty_txf = int(float(data.get('txf', 0)))
        qty_mxf = int(float(data.get('mxf', 0)))
        qty_tmf = int(float(data.get('tmf', 0)))
        price = float(data.get('price', 0))
        
        # 強制使用市價單IOC（參考TXserver.py）
        order_type = "IOC"
        price_type = "MKT"
        
        print(f"解析結果: type={msg_type}, direction={direction}, price={price}")
        print(f"合約數量: TXF={qty_txf}, MXF={qty_mxf}, TMF={qty_tmf}")
        print(f"轉倉模式: {is_rollover_mode}")
        
        # 驗證價格
        if price <= 0:
            error_msg = f"價格 {price} 無效"
            print(f"錯誤: {error_msg}")
            send_unified_failure_message(data, error_msg)
            return
            
        # 檢查交易時間
        trading_status = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5).json()
        if not trading_status.get('is_trading_day', False) or not trading_status.get('is_market_open', False):
            error_msg = "非交易時間"
            print(f"錯誤: {error_msg}")
            send_unified_failure_message(data, error_msg)
            return
            
        # 取得持倉資訊
        positions = sinopac_api.list_positions(sinopac_api.futopt_account)
        
        # 初始化合約對象（如果尚未設置）
        if not contract_txf:
            txf_contracts = sinopac_api.Contracts.Futures.get("TXF")
            if txf_contracts:
                contract_txf = sorted(txf_contracts, key=lambda x: x.delivery_date)[0]
                
        if not contract_mxf:
            mxf_contracts = sinopac_api.Contracts.Futures.get("MXF")
            if mxf_contracts:
                contract_mxf = sorted(mxf_contracts, key=lambda x: x.delivery_date)[0]
                
        if not contract_tmf:
            tmf_contracts = sinopac_api.Contracts.Futures.get("TMF")
            if tmf_contracts:
                contract_tmf = sorted(tmf_contracts, key=lambda x: x.delivery_date)[0]
        
        print(f"當前合約: TXF={contract_txf.code if contract_txf else None}, "
              f"MXF={contract_mxf.code if contract_mxf else None}, "
              f"TMF={contract_tmf.code if contract_tmf else None}")
        
        # 處理進場訊號
        if msg_type == "entry":
            process_entry_signal(data, qty_txf, qty_mxf, qty_tmf, direction, price, order_type, price_type, positions)
            
        # 處理出場訊號  
        elif msg_type == "exit":
            process_exit_signal(data, qty_txf, qty_mxf, qty_tmf, direction, price, order_type, price_type, positions)
            
        else:
            error_msg = f"無效訊號類型 {msg_type}"
            print(f"錯誤: {error_msg}")
            send_unified_failure_message(data, error_msg)
            
    except Exception as e:
        error_msg = str(e)
        print(f"[process_signal] 處理訊號失敗：{error_msg}")
        import traceback
        traceback.print_exc()
        send_unified_failure_message(data, error_msg[:100])

def process_entry_signal(data, qty_txf, qty_mxf, qty_tmf, direction, price, order_type, price_type, positions):
    """處理進場訊號"""
    global active_trades, contract_txf, contract_mxf, contract_tmf, rollover_mode
    
    print(f"[process_entry_signal] 處理進場訊號: direction={direction}")
    
    if direction not in ["開多", "開空"]:
        error_msg = f"無效進場動作 {direction}"
        print(f"錯誤: {error_msg}")
        send_unified_failure_message(data, error_msg)
        return
        
    # 確定交易動作
    if direction == "開多":
        expected_action = safe_constants.get_action('BUY')
    else:  # 開空
        expected_action = safe_constants.get_action('SELL')
        
    # 檢查是否有相反持倉
    has_opposite = any(p.direction != expected_action and p.quantity != 0 for p in positions)
    
    if has_opposite:
        print("警告: 存在相反持倉，取消下單")
        
        # 發送提交失敗訊息
        contracts = [
            (get_contract_for_rollover('TXF'), qty_txf, "大台", "TXF"),
            (get_contract_for_rollover('MXF'), qty_mxf, "小台", "MXF"), 
            (get_contract_for_rollover('TMF'), qty_tmf, "微台", "TMF")
        ]
        
        # 對每個有數量的合約發送失敗訊息
        for contract, qty, name, code in contracts:
            if qty > 0 and contract:
                # 獲取交割日期
                delivery_date = contract.delivery_date
                if hasattr(delivery_date, 'strftime'):
                    delivery_date_str = delivery_date.strftime('%Y/%m/%d')
                else:
                    delivery_date_str = str(delivery_date)
                
                fail_message = get_formatted_order_message(
                    is_success=False,
                    order_id="未知",
                    contract_name=name,
                    qty=qty,
                    price=price,
                    octype='New',  # 進場訊號都是開倉
                    direction=str(expected_action),
                    order_type="IOC",
                    price_type="MKT",
                    is_manual=False,  # webhook來源為自動
                    reason="存在相反持倉",
                    contract_code=contract.code,
                    delivery_date=delivery_date_str
                )
                send_telegram_message(fail_message)
        return
        
    # 轉倉邏輯：根據轉倉模式選擇合約
    is_rollover_mode = data.get('rollover_mode', False)
    
    # 執行下單
    contracts = [
        (get_contract_for_rollover('TXF'), qty_txf, "大台", "TXF"),
        (get_contract_for_rollover('MXF'), qty_mxf, "小台", "MXF"), 
        (get_contract_for_rollover('TMF'), qty_tmf, "微台", "TMF")
    ]
    
    for contract, qty, name, code in contracts:
        if qty > 0 and contract:
            try:
                contract_type = "次月" if is_rollover_mode else "當月"
                print(f"[process_entry_signal] 開始處理{name}進場: {qty}口 {direction} ({contract_type}合約)")
                
                result = place_futures_order_tx_style(
                    contract=contract,
                    quantity=qty,
                    direction=direction,
                    price=price,
                    order_type=order_type,
                    price_type=price_type,
                    is_manual=False
                )
                
                if result.get('success'):
                    active_trades[contract_key_map[name]] = data.get('tradeId')
                    print(f"{name}進場成功 ({contract_type}合約)")
                else:
                    print(f"{name}進場失敗: {result.get('message', '未知錯誤')}")
                    
            except Exception as e:
                error_msg = str(e)
                print(f"{name}進場異常: {error_msg}")
                
                # 創建單個合約的data用於發送失敗訊息
                single_data = data.copy()
                single_data['txf'] = qty if code == 'TXF' else 0
                single_data['mxf'] = qty if code == 'MXF' else 0
                single_data['tmf'] = qty if code == 'TMF' else 0
                send_unified_failure_message(single_data, error_msg)

def process_exit_signal(data, qty_txf, qty_mxf, qty_tmf, direction, price, order_type, price_type, positions):
    """處理出場訊號"""
    global active_trades, rollover_mode
    
    print(f"[process_exit_signal] 處理出場訊號: direction={direction}")
    
    # 轉倉邏輯：在轉倉模式下，先平倉當月合約
    is_rollover_mode = data.get('rollover_mode', False)
    
    # 檢查是否有持倉
    position_txf = next((p for p in positions if p.code.startswith("TXF") and qty_txf > 0), None) if qty_txf > 0 else None
    position_mxf = next((p for p in positions if p.code.startswith("MXF") and qty_mxf > 0), None) if qty_mxf > 0 else None  
    position_tmf = next((p for p in positions if p.code.startswith("TMF") and qty_tmf > 0), None) if qty_tmf > 0 else None
    
    has_position = bool(position_txf or position_mxf or position_tmf)
            
    if not has_position:
        print("警告: 無對應持倉，取消平倉")
        
        # 發送提交失敗訊息
        contracts_to_check = [
            (get_contract_for_rollover('TXF'), qty_txf, "大台", "TXF"),
            (get_contract_for_rollover('MXF'), qty_mxf, "小台", "MXF"), 
            (contract_tmf, qty_tmf, "微台", "TMF")
        ]
        
        # 對每個有數量的合約發送失敗訊息
        for contract, qty, name, code in contracts_to_check:
            if qty > 0 and contract:
                # 獲取交割日期
                delivery_date = contract.delivery_date
                if hasattr(delivery_date, 'strftime'):
                    delivery_date_str = delivery_date.strftime('%Y/%m/%d')
                else:
                    delivery_date_str = str(delivery_date)
                
                fail_message = get_formatted_order_message(
                    is_success=False,
                    order_id="未知",
                    contract_name=name,
                    qty=qty,
                    price=price,
                    octype='Cover',  # 出場訊號都是平倉
                    direction=direction,
                    order_type="IOC",
                    price_type="MKT",
                    is_manual=False,  # webhook來源為自動
                    reason="無對應持倉",
                    contract_code=contract.code,
                    delivery_date=delivery_date_str
                )
                send_telegram_message(fail_message)
        return
        
    # 執行平倉
    contracts_positions = [
        (get_contract_for_rollover('TXF'), qty_txf, "大台", "TXF", position_txf),
        (get_contract_for_rollover('MXF'), qty_mxf, "小台", "MXF", position_mxf),
        (get_contract_for_rollover('TMF'), qty_tmf, "微台", "TMF", position_tmf)
    ]
    
    for contract, qty, name, code, position in contracts_positions:
        if qty > 0 and contract and position:
            try:
                contract_type = "次月" if is_rollover_mode else "當月"
                print(f"[process_exit_signal] 開始處理{name}出場: {qty}口 ({contract_type}合約)")
                
                result = place_futures_order_tx_style(
                    contract=contract,
                    quantity=qty,
                    direction=direction,
                    price=price,
                    order_type=order_type,
                    price_type=price_type,
                    is_manual=False,
                    position=position
                )
                
                if result.get('success'):
                    active_trades[contract_key_map[name]] = None
                    print(f"{name}出場成功 ({contract_type}合約)")
                else:
                    print(f"{name}出場失敗: {result.get('message', '未知錯誤')}")
            
            except Exception as e:
                error_msg = str(e)
                print(f"{name}出場異常: {error_msg}")
                
                # 創建單個合約的data用於發送失敗訊息
                single_data = data.copy()
                single_data['txf'] = qty if code == 'TXF' else 0
                single_data['mxf'] = qty if code == 'MXF' else 0
                single_data['tmf'] = qty if code == 'TMF' else 0
                send_unified_failure_message(single_data, error_msg)

def place_futures_order_tx_style(contract, quantity, direction, price, order_type="IOC", price_type="MKT", is_manual=False, position=None):
    """TXserver風格的下單函數"""
    try:
        # 判斷開平倉類型 - 根據direction判斷
        if direction in ["開多", "開空"]:
            is_entry = True
            octype = 'New'
        elif direction in ["平多", "平空"]:
            is_entry = False
            octype = 'Cover'
        else:
            # 如果direction不是中文，則根據position判斷
            is_entry = position is None
            octype = 'New' if is_entry else 'Cover'
        
        # 確定交易動作
        if is_entry:
            # 開倉
            if direction == "開多":
                action = safe_constants.get_action('BUY')
            elif direction == "開空":
                action = safe_constants.get_action('SELL')
            else:
                raise Exception(f"無效的開倉方向: {direction}")
        else:
            # 平倉：根據持倉方向決定平倉動作
            if position.direction == safe_constants.get_action('BUY'):
                # 持多單，平多
                action = safe_constants.get_action('SELL')
            else:
                # 持空單，平空
                action = safe_constants.get_action('BUY')
        
        # 建立訂單
        order = sinopac_api.Order(
            price=price if price_type == "LMT" else 0,  # 市價單價格設為0
            quantity=quantity,
            action=action,
            price_type=safe_constants.get_price_type(price_type),
            order_type=safe_constants.get_order_type(order_type),
            octype=safe_constants.get_oc_type(),
            account=sinopac_api.futopt_account
        )
        
        # 送出訂單
        trade = sinopac_api.place_order(contract, order)
        
        # 檢查訂單結果
        if not trade or not hasattr(trade, 'order') or not trade.order.id:
            raise Exception("訂單提交失敗")
            
        order_id = trade.order.id
        contract_name = "大台" if contract.code.startswith('TXF') else "小台" if contract.code.startswith('MXF') else "微台"
        
        # 建立訂單映射（參考TXserver.py架構）
        # 修正：將永豐API常數轉換為字符串
        direction_str = 'Buy' if action == sj.constant.Action.Buy else 'Sell'
        octype_str = 'New' if octype == 'New' else 'Cover'
        
        with global_lock:
            order_octype_map[order_id] = {
                'octype': octype_str,  # 使用轉換後的字符串
                'direction': direction_str,  # 使用轉換後的字符串
                'contract_name': contract_name,
                'order_type': order_type,
                'price_type': price_type,
                'is_manual': is_manual,
                'timestamp': datetime.now().strftime('%H:%M:%S')
            }
        
        # 檢查操作結果
        if hasattr(trade, 'operation') and trade.operation.get('op_msg'):
            error_msg = trade.operation.get('op_msg')
            
            # 記錄掛單失敗日誌
            log_message = get_simple_order_log_message(
                contract_name=contract_name,
                direction=direction_str,
                qty=quantity,
                price=price,
                order_id=order_id,
                octype=octype_str,
                is_manual=is_manual,
                is_success=False,
                order_type=order_type,
                price_type=price_type
            )
            try:
                requests.post(
                    f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                    json={'message': log_message, 'type': 'error'},
                    timeout=5
                )
            except:
                pass
            
            # 發送失敗通知
            # 修正：將永豐API常數轉換為字符串
            direction_str = 'Buy' if action == sj.constant.Action.Buy else 'Sell'
            octype_str = 'New' if octype == 'New' else 'Cover'
            
            fail_message = get_formatted_order_message(
                is_success=False,
                order_id=order_id,
                contract_name=contract_name,
                qty=quantity,
                price=price,
                octype=octype_str,  # 使用轉換後的字符串
                direction=direction_str,  # 使用轉換後的字符串
                order_type=order_type,
                price_type=price_type,
                is_manual=is_manual,
                reason=OP_MSG_TRANSLATIONS.get(error_msg, error_msg),
                contract_code=contract.code,
                delivery_date=contract.delivery_date.strftime('%Y/%m/%d')
            )
            send_telegram_message(fail_message)
            
            return {
                'success': False,
                'message': OP_MSG_TRANSLATIONS.get(error_msg, error_msg),
                'order_id': order_id
            }
        
        # 記錄掛單成功日誌
        log_message = get_simple_order_log_message(
            contract_name=contract_name,
            direction=direction_str,
            qty=quantity,
            price=price,
            order_id=order_id,
            octype=octype_str,
            is_manual=is_manual,
            is_success=False,
            order_type=order_type,
            price_type=price_type
        )
        try:
            requests.post(
                f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                json={'message': log_message, 'type': 'success'},
                timeout=5
            )
        except:
            pass
        
        # 訂單提交成功 - 不需要立即發送通知，等callback處理
        print(f"訂單提交成功: {order_id} - {contract_name} {quantity}口 {direction}")
        
        return {
            'success': True,
            'message': '訂單提交成功',
            'order_id': order_id,
            'contract_name': contract_name
        }
            
    except Exception as e:
        error_msg = str(e)
        print(f"下單失敗: {error_msg}")
        
        # 記錄掛單失敗日誌
        contract_name = "大台" if contract.code.startswith('TXF') else "小台" if contract.code.startswith('MXF') else "微台"
        
        # 判斷octype
        if direction in ["開多", "開空"]:
            error_octype = 'New'
        elif direction in ["平多", "平空"]:
            error_octype = 'Cover'
        else:
            error_octype = 'New' if position is None else 'Cover'
        
        log_message = get_simple_order_log_message(
            contract_name=contract_name,
            direction=direction,
            qty=quantity,
            price=price,
            order_id="未知",
            octype=error_octype,
            is_manual=is_manual,
            is_success=False,
            order_type=order_type,
            price_type=price_type
        )
        try:
            requests.post(
                f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                json={'message': log_message, 'type': 'error'},
                timeout=5
            )
        except:
            pass
            
        # 發送錯誤通知
        fail_message = get_formatted_order_message(
            is_success=False,
            order_id="未知",
            contract_name=contract_name,
            qty=quantity,
            price=price,
            octype=error_octype,
            direction=direction,
            order_type=order_type,
            price_type=price_type,
            is_manual=is_manual,
            reason=error_msg,
            contract_code=contract.code if contract else None
        )
        send_telegram_message(fail_message)
        
        return {
            'success': False,
            'message': error_msg,
            'order_id': None
        }

def init_contracts():
    """初始化TXserver風格的合約對象"""
    global contract_txf, contract_mxf, contract_tmf
    
    try:
        print("[init_contracts] 開始初始化合約對象...")
        
        # 初始化大台指合約
        txf_contracts = sinopac_api.Contracts.Futures.get("TXF")
        if txf_contracts:
            # 選擇最近月份的合約
            contract_txf = sorted(txf_contracts, key=lambda x: x.delivery_date)[0]
            print(f"大台指合約: {contract_txf.code} (交割日: {contract_txf.delivery_date})")
        else:
            print("警告: 無法獲取大台指合約")
            
        # 初始化小台指合約
        mxf_contracts = sinopac_api.Contracts.Futures.get("MXF")
        if mxf_contracts:
            contract_mxf = sorted(mxf_contracts, key=lambda x: x.delivery_date)[0]
            print(f"小台指合約: {contract_mxf.code} (交割日: {contract_mxf.delivery_date})")
        else:
            print("警告: 無法獲取小台指合約")
            
        # 初始化微台指合約
        tmf_contracts = sinopac_api.Contracts.Futures.get("TMF")
        if tmf_contracts:
            contract_tmf = sorted(tmf_contracts, key=lambda x: x.delivery_date)[0]
            print(f"微台指合約: {contract_tmf.code} (交割日: {contract_tmf.delivery_date})")
        else:
            print("警告: 無法獲取微台指合約")
            
        print("[init_contracts] 合約對象初始化完成")
        
    except Exception as e:
        print(f"[init_contracts] 初始化合約對象失敗: {e}")
        contract_txf = None
        contract_mxf = None
        contract_tmf = None



def place_futures_order(contract_code, quantity, direction, price=0, is_manual=False, position_type=None, price_type=None, order_type=None, action_param=None, octype_param=None):
    """執行期貨下單
    contract_code: 合約代碼 (TXF, MXF, TMF)
    quantity: 數量
    direction: 方向 ('開多', '開空', '平多', '平空')
    price: 價格 (0為市價)
    is_manual: 是否為手動下單
    position_type: 持倉類型 (當direction為平倉時使用)
    price_type: 價格類型 (LMT/MKT)
    order_type: 單別 (ROD/IOC/FOK)
    """
    try:
        # 調試信息
        print(f"=== place_futures_order 調試 ===")
        print(f"contract_code: '{contract_code}'")
        print(f"quantity: {quantity}")
        print(f"direction: '{direction}'")
        print(f"price: {price}")
        print(f"is_manual: {is_manual}")
        print(f"position_type: '{position_type}'")
        print(f"price_type: '{price_type}'")
        print(f"order_type: '{order_type}'")
        # 獲取合約資訊
        contracts = sinopac_api.Contracts.Futures.get(contract_code)
        if not contracts:
            raise Exception(f'無法獲取{contract_code}合約資訊')
        
        # 選擇最近月份的合約（按到期日排序）
        target_contract = sorted(contracts, key=lambda x: x.delivery_date)[0]  # 使用最近月合約
        
        # 判斷交易動作 - 修正邏輯
        print(f"=== 動作判斷調試 ===")
        print(f"direction: '{direction}'")
        print(f"position_type: '{position_type}'")
        print(f"is_manual: {is_manual}")
        
        # 參數處理邏輯
        print(f"=== 參數處理調試 ===")
        print(f"direction: '{direction}'")
        print(f"position_type: '{position_type}'")
        print(f"is_manual: {is_manual}")
        
        # 永豐手動下單：使用永豐官方參數格式
        if is_manual:
            # 永豐手動下單應該使用永豐官方的參數格式
            # 前端應該傳遞 action (Buy/Sell) 和 octype (New/Cover) 參數
            # 而不是中文的 direction 參數
            
            # 使用傳入的永豐官方參數
            print(f"永豐手動下單參數檢查:")
            print(f"  action_param: '{action_param}'")
            print(f"  octype_param: '{octype_param}'")
            
            if action_param and octype_param:
                # 使用永豐官方參數
                final_action = safe_constants.get_action(action_param)
                final_octype = safe_constants.get_oc_type(octype_param)
                print(f"永豐手動下單使用官方參數: action={action_param} -> {final_action}, octype={octype_param} -> {final_octype}")
            else:
                # 如果沒有官方參數，顯示未知
                print(f"錯誤: 永豐手動下單缺少官方參數")
                raise Exception('永豐手動下單缺少官方參數 action 和 octype')
        # WEBHOOK下單：使用 direction 參數
        else:
            if direction:
                if direction == "開多":
                    final_action = safe_constants.get_action('BUY')
                    final_octype = safe_constants.get_oc_type('New')
                    print(f"WEBHOOK開多 -> BUY/New")
                elif direction == "開空":
                    final_action = safe_constants.get_action('SELL')
                    final_octype = safe_constants.get_oc_type('New')
                    print(f"WEBHOOK開空 -> SELL/New")
                elif direction == "平多":
                    final_action = safe_constants.get_action('SELL')
                    final_octype = safe_constants.get_oc_type('Cover')
                    print(f"WEBHOOK平多 -> SELL/Cover")
                elif direction == "平空":
                    final_action = safe_constants.get_action('BUY')
                    final_octype = safe_constants.get_oc_type('Cover')
                    print(f"WEBHOOK平空 -> BUY/Cover")
                else:
                    print(f"無效的WEBHOOK direction: '{direction}'")
                    raise Exception(f'無效的WEBHOOK交易方向: {direction}')
            else:
                print(f"WEBHOOK缺少direction參數")
                raise Exception('WEBHOOK缺少direction參數')
        
        print(f"最終: action={final_action}, octype={final_octype}")
        
        # 判斷訂單類型
        if is_manual:
            # 手動下單，使用傳入的參數或根據price判斷
            if price_type is None:
                final_price_type = safe_constants.get_price_type('MKT' if price == 0 else 'LMT')
            else:
                final_price_type = safe_constants.get_price_type(price_type)
            
            if order_type is None:
                final_order_type = safe_constants.get_order_type('ROD')  # 手動預設使用ROD
            else:
                final_order_type = safe_constants.get_order_type(order_type)
        else:
            # webhook下單，強制使用市價單IOC
            final_price_type = safe_constants.get_price_type('MKT')
            final_order_type = safe_constants.get_order_type('IOC')
            price = 0  # 確保使用市價
        
        # 建立訂單
        order = sinopac_api.Order(
            price=price,
            quantity=quantity,
            action=final_action,
            price_type=final_price_type,
            order_type=final_order_type,
            octype=final_octype,
            account=sinopac_api.futopt_account
        )
        
        # 送出訂單
        trade = sinopac_api.place_order(target_contract, order)
        
        # 檢查是否有操作訊息
        if hasattr(trade, 'operation') and trade.operation.get('op_msg'):
            error_msg = trade.operation.get('op_msg')
            print(f"訂單操作訊息: {error_msg}")
            
            # 準備訂單資訊用於失敗通知
            contract_name = '大台' if contract_code == 'TXF' else '小台' if contract_code == 'MXF' else '微台'
            order_id = trade.order.id if trade and trade.order else "未知"
            
            # 發送失敗通知 - 延遲5秒發送
            # 修正：將永豐API常數轉換為字符串
            direction_str = 'Buy' if final_action == sj.constant.Action.Buy else 'Sell'
            octype_str = 'New' if final_octype == sj.constant.FuturesOCType.New else 'Cover'
            
            fail_message = get_formatted_order_message(
                is_success=False,
                order_id=order_id,
                contract_name=contract_name,
                qty=quantity,
                price=price,
                octype=octype_str,
                direction=direction_str,
                order_type=str(final_order_type),
                price_type=str(final_price_type),
                is_manual=is_manual,
                reason=OP_MSG_TRANSLATIONS.get(error_msg, error_msg),
                contract_code=target_contract.code,
                delivery_date=target_contract.delivery_date.strftime('%Y/%m/%d')
            )
            
            # 記錄掛單失敗日誌
            log_message = get_simple_order_log_message(
                contract_name=contract_name,
                direction=direction_str,
                qty=quantity,
                price=price,
                order_id=order_id,
                octype=octype_str,
                is_manual=is_manual,
                is_success=False,
                order_type=str(final_order_type),
                price_type=str(final_price_type)
            )
            try:
                requests.post(
                    f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                    json={'message': log_message, 'type': 'error'},
                    timeout=5
                )
            except:
                pass
            
            # 延遲5秒發送失敗通知
            def delayed_send_fail():
                time.sleep(5)
                send_telegram_message(fail_message)
            
            threading.Thread(target=delayed_send_fail, daemon=True).start()
            
            raise Exception(error_msg)
        
        # 檢查訂單是否成功提交
        if not trade or not hasattr(trade, 'order') or not trade.order.id:
            raise Exception("訂單提交失敗")
        
        order_id = trade.order.id
        contract_name = '大台' if contract_code == 'TXF' else '小台' if contract_code == 'MXF' else '微台'
        
        # 建立訂單映射資訊（關鍵：參考TXserver.py架構）
        # 使用已確定的final_action和final_octype
        print(f"=== 訂單映射調試 ===")
        print(f"使用 final_action: {final_action}")
        print(f"使用 final_octype: {final_octype}")
        
        # 修正：將永豐API常數轉換為字符串
        direction_str = 'Buy' if final_action == sj.constant.Action.Buy else 'Sell'
        octype_str = 'New' if final_octype == sj.constant.FuturesOCType.New else 'Cover'
        
        order_info = {
            'octype': octype_str,
            'direction': direction_str,
            'contract_name': contract_name,
            'order_type': str(final_order_type),
            'price_type': str(final_price_type),
            'is_manual': is_manual
        }
        
        # 將訂單資訊存入映射（使用線程鎖確保線程安全）
        with global_lock:
            order_octype_map[order_id] = order_info
        
        print(f"訂單提交成功，單號: {order_id}")
        print(f"訂單映射已建立: {order_info}")
        print(f"當前 order_octype_map 內容: {order_octype_map}")
        
        # 記錄掛單成功日誌
        log_message = get_simple_order_log_message(
            contract_name=contract_name,
            direction=direction_str,
            qty=quantity,
            price=price,
            order_id=order_id,
            octype=octype_str,
            is_manual=is_manual,
            is_success=False,
            order_type=str(final_order_type),
            price_type=str(final_price_type)
        )
        try:
            requests.post(
                f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                json={'message': log_message, 'type': 'success'},
                timeout=5
            )
        except:
            pass
        
        # 返回訂單資訊
        return {
            'contract_code': contract_code,
            'contract_name': target_contract.code,
            'delivery_date': target_contract.delivery_date.strftime('%Y/%m/%d'),
            'quantity': quantity,
            'action': final_action,
            'position_type': position_type,
            'order_id': order_id,
            'status': 'submitted',
            'contract_type': contract_name,
            'price': price,
            'price_type': final_price_type,
            'order_type': final_order_type
        }
        
    except Exception as e:
        raise Exception(f'{contract_code}下單失敗: {str(e)}')



# 移除舊的通知函數，改用新的回調機制

def send_telegram_message(message, log_type="info"):
    """發送Telegram訊息"""
    try:
        print(f"=== 準備發送Telegram訊息 ===")
        print(f"訊息內容:\n{message}")
        
        if not os.path.exists(ENV_PATH):
            print(f"找不到 .env 檔案，路徑: {ENV_PATH}")
            return False
        
        load_dotenv(ENV_PATH)
        bot_token = os.getenv('BOT_TOKEN')
        chat_id = os.getenv('CHAT_ID')
        
        if not bot_token:
            print("找不到 BOT_TOKEN")
            return False
        if not chat_id:
            print("找不到 CHAT_ID")
            return False
        
        print(f"BOT_TOKEN: {bot_token[:10]}...")
        print(f"CHAT_ID: {chat_id}")
        
        url = f'https://api.telegram.org/bot{bot_token}/sendMessage'
        payload = {
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML'
        }
        
        print(f"發送請求到 Telegram API...")
        response = requests.post(url, json=payload, timeout=10)
        
        print(f"Telegram API 回應: {response.status_code}")
        
        if response.status_code == 200:
            print("Telegram 訊息發送成功！")
            
            # 根據訊息內容判斷發送狀態類型
            if "提交成功" in message:
                log_message = "Telegram ［提交成功］訊息發送成功！！！"
            elif "提交失敗" in message:
                log_message = "Telegram ［提交失敗］訊息發送成功！！！"
            elif "成交通知" in message:
                log_message = "Telegram ［成交通知］訊息發送成功！！！"
            elif "API連線異常" in message:
                log_message = "Telegram ［API連線異常］訊息發送成功！！！"
            elif "API重新連線成功" in message:
                log_message = "Telegram ［API連線成功］訊息發送成功！！！"
            else:
                log_message = "Telegram 訊息發送成功！！！"
            
            # 發送前端系統日誌
            try:
                requests.post(
                    f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                    json={'message': log_message, 'type': 'success'},
                    timeout=5
                )
            except:
                pass
            
            return True
        else:
            print(f"Telegram API 錯誤: {response.text}")
            return False
            
    except Exception as e:
        print(f"發送Telegram訊息失敗: {e}")
        print(f"錯誤類型: {str(e.__class__.__name__)}")
        if hasattr(e, 'response'):
            print(f"回應內容: {e.response.text}")
        import traceback
        traceback.print_exc()
        return False

# 模擬通知函數已移除

# 移除舊的send_order_notification函數，新的回調機制會自動處理

# 新增：交易記錄目錄
LOG_DIR = "transdata"

def save_trade(data):
    """保存交易記錄到JSON文件（參考TXserver.py）"""
    try:
        today = datetime.now().strftime("%Y%m%d")
        filename = f"{LOG_DIR}/trades_{today}.json"
        os.makedirs(LOG_DIR, exist_ok=True)
        try:
            trades = json.load(open(filename, 'r')) if os.path.exists(filename) else []
        except json.JSONDecodeError:
            print(f"交易記錄檔案 {filename} 格式錯誤，重置為空列表")
            send_telegram_message(f"❌ 交易記錄檔案 {filename} 格式錯誤，已重置")
            trades = []
        data['timestamp'] = datetime.now().isoformat()
        trades.append(data)
        with open(filename, 'w') as f:
            json.dump(trades, f, indent=2)
        
        # 清理舊的交易記錄檔案（保留30個交易日）
        cleanup_old_trade_files()
    except Exception as e:
        print(f"儲存交易記錄失敗：{str(e)}")
        send_telegram_message(f"❌ 儲存交易記錄失敗：{str(e)[:100]}")

def cleanup_old_trade_files():
    """清理舊的交易記錄檔案，保留30個交易日"""
    try:
        if not os.path.exists(LOG_DIR):
            return
        
        # 獲取所有交易記錄檔案
        trade_files = []
        for filename in os.listdir(LOG_DIR):
            if filename.startswith('trades_') and filename.endswith('.json'):
                try:
                    # 從檔案名提取日期
                    date_str = filename.replace('trades_', '').replace('.json', '')
                    file_date = datetime.strptime(date_str, '%Y%m%d')
                    trade_files.append((filename, file_date))
                except ValueError:
                    # 如果檔案名格式不正確，跳過
                    continue
        
        # 按日期排序
        trade_files.sort(key=lambda x: x[1], reverse=True)
        
        # 保留最新的30個檔案，刪除其餘的
        if len(trade_files) > 30:
            files_to_delete = trade_files[30:]
            for filename, file_date in files_to_delete:
                file_path = os.path.join(LOG_DIR, filename)
                try:
                    os.remove(file_path)
                    print(f"已刪除舊交易記錄檔案：{filename}")
                except Exception as e:
                    print(f"刪除檔案失敗 {filename}：{e}")
            
            print(f"清理完成：保留 {len(trade_files) - len(files_to_delete)} 個檔案，刪除 {len(files_to_delete)} 個舊檔案")
    
    except Exception as e:
        print(f"清理舊交易記錄檔案失敗：{e}")

# 公共工具函數
def get_sort_date(contract):
    """按交割日期排序合約的公共函數"""
    date_str = contract.delivery_date
    if isinstance(date_str, str):
        if len(date_str) == 8:  # YYYYMMDD
            return date_str
        elif '-' in date_str:  # YYYY-MM-DD
            return date_str.replace('-', '')
    return str(date_str)

def format_delivery_date(delivery_date):
    """格式化交割日期的公共函數"""
    if isinstance(delivery_date, str):
        if len(delivery_date) == 8:  # YYYYMMDD
            return f"{delivery_date[:4]}/{delivery_date[4:6]}/{delivery_date[6:8]}"
        elif '-' in delivery_date:  # YYYY-MM-DD
            return delivery_date.replace('-', '/')
    return str(delivery_date)

# 轉倉相關函數
def get_next_month_contracts():
    """獲取次月合約"""
    global next_month_contracts, sinopac_api
    
    try:
        if not sinopac_connected or not sinopac_api:
            return {}
        
        next_month_contracts = {}
        
        for code in ['TXF', 'MXF', 'TMF']:
            try:
                contracts = sinopac_api.Contracts.Futures.get(code)
                if contracts:
                    # 按交割日期排序
                    sorted_contracts = sorted(contracts, key=get_sort_date)
                    
                    # 獲取第二個合約（次月合約）
                    if len(sorted_contracts) >= 2:
                        next_month_contracts[code] = sorted_contracts[1]
                        print(f"次月{code}合約: {sorted_contracts[1].code}")
                    else:
                        print(f"警告: {code}只有一個合約可用")
                        
            except Exception as e:
                print(f"獲取{code}次月合約失敗: {e}")
                
        return next_month_contracts
        
    except Exception as e:
        print(f"獲取次月合約失敗: {e}")
        return {}

def check_rollover_mode():
    """檢查是否應該進入轉倉模式"""
    global rollover_mode, rollover_start_date, contract_txf, contract_mxf, contract_tmf
    
    try:
        today = datetime.now().date()
        
        # 檢查當前合約的交割日
        current_contracts = [contract_txf, contract_mxf, contract_tmf]
        delivery_dates = []
        
        for contract in current_contracts:
            if contract and hasattr(contract, 'delivery_date'):
                delivery_date_str = contract.delivery_date
                if isinstance(delivery_date_str, str):
                    if len(delivery_date_str) == 8:  # YYYYMMDD
                        delivery_date = datetime.strptime(delivery_date_str, '%Y%m%d').date()
                    elif '/' in delivery_date_str:  # YYYY/MM/DD
                        delivery_date = datetime.strptime(delivery_date_str, '%Y/%m/%d').date()
                    elif '-' in delivery_date_str:  # YYYY-MM-DD
                        delivery_date = datetime.strptime(delivery_date_str, '%Y-%m-%d').date()
                    else:
                        continue
                    delivery_dates.append(delivery_date)
        
        if delivery_dates:
            # 找到最近的交割日
            nearest_delivery = min(delivery_dates)
            # 轉倉開始日期 = 交割日前一天
            rollover_start = nearest_delivery - timedelta(days=1)
            
            # 檢查是否應該進入轉倉模式
            if today >= rollover_start:
                if not rollover_mode:
                    rollover_mode = True
                    rollover_start_date = rollover_start
                    print(f"進入轉倉模式，交割日: {nearest_delivery}")
                    
                    # 獲取次月合約
                    get_next_month_contracts()
                    
                    # 發送轉倉通知
                    rollover_message = f"交易系統將自動轉倉\n交割日: {nearest_delivery}\n下次開倉將使用次月合約！！！"
                    send_telegram_message(rollover_message)
                    
                    # 記錄轉倉通知到前端日誌
                    try:
                        requests.post(
                            f'http://127.0.0.1:{CURRENT_PORT}/api/system_log',
                            json={'message': f'自動轉倉交割日: {nearest_delivery}，下次開倉將使用次月合約！！！', 'type': 'warning'},
                            timeout=5
                        )
                    except:
                        pass
                    
                return True
            else:
                if rollover_mode:
                    rollover_mode = False
                    rollover_start_date = None
                    next_month_contracts.clear()
                    rollover_processed_signals.clear()
                    print("退出轉倉模式")
                    
                return False
                
        return False
        
    except Exception as e:
        print(f"檢查轉倉模式失敗: {e}")
        return False

def get_contract_for_rollover(contract_type):
    """根據轉倉模式獲取合約"""
    global rollover_mode, next_month_contracts, contract_txf, contract_mxf, contract_tmf
    
    if not rollover_mode:
        # 非轉倉模式，使用當前合約
        if contract_type == 'TXF':
            return contract_txf
        elif contract_type == 'MXF':
            return contract_mxf
        elif contract_type == 'TMF':
            return contract_tmf
        else:
            return None
    
    # 轉倉模式，使用次月合約
    next_month_contract = next_month_contracts.get(contract_type)
    if next_month_contract:
        print(f"轉倉模式: 使用次月{contract_type}合約 {next_month_contract.code}")
        return next_month_contract
    else:
        # 如果沒有次月合約，回退到當前合約
        print(f"警告: 沒有次月{contract_type}合約，使用當前合約")
        if contract_type == 'TXF':
            return contract_txf
        elif contract_type == 'MXF':
            return contract_mxf
        elif contract_type == 'TMF':
            return contract_tmf
        else:
            return None

def process_rollover_signal(data):
    """處理轉倉訊號"""
    global rollover_processed_signals
    
    signal_id = data.get('tradeId')
    if signal_id in rollover_processed_signals:
        print(f"轉倉訊號 {signal_id} 已處理，跳過")
        return True
    
    # 檢查是否為轉倉模式
    if not check_rollover_mode():
        return False
    
    # 檢查是否為第一個webhook訊號
    if len(rollover_processed_signals) == 0:
        print("收到轉倉模式下的第一個webhook訊號")
        rollover_processed_signals.add(signal_id)
        return True
    
    return False

def start_rollover_checker():
    """啟動轉倉檢查器"""
    def rollover_check_loop():
        while True:
            try:
                # 每天凌晨00:05檢查一次轉倉模式（避免與其他檢查衝突）
                now = datetime.now()
                if now.hour == 0 and now.minute >= 5:
                    check_rollover_mode()
                    # 檢查後等待到明天凌晨
                    tomorrow = now.replace(hour=0, minute=5, second=0, microsecond=0) + timedelta(days=1)
                    sleep_seconds = (tomorrow - now).total_seconds()
                    time.sleep(sleep_seconds)
                else:
                    # 計算到明天凌晨00:05的時間
                    tomorrow = now.replace(hour=0, minute=5, second=0, microsecond=0) + timedelta(days=1)
                    sleep_seconds = (tomorrow - now).total_seconds()
                    time.sleep(sleep_seconds)
                    
            except Exception as e:
                print(f"轉倉檢查器錯誤: {e}")
                time.sleep(3600)  # 發生錯誤時等待1小時
    
    rollover_thread = threading.Thread(target=rollover_check_loop, daemon=True)
    rollover_thread.start()
    print("轉倉檢查器已啟動（每天凌晨00:05檢查）")

# 斷線重連相關函數
def check_api_connection():
    """檢查API連線狀態"""
    global sinopac_connected, sinopac_api, reconnect_attempts, last_connection_check
    
    try:
        last_connection_check = datetime.now()
        
        # 如果API未初始化，跳過檢查
        if not sinopac_api:
            return True
        
        # 嘗試獲取帳戶資訊來測試連線
        try:
            # 簡單的API調用來測試連線
            test_result = sinopac_api.list_positions(sinopac_api.futopt_account)
            # 如果成功執行，重置重連計數
            reconnect_attempts = 0
            return True
        except Exception as e:
            print(f"API連線檢查失敗: {e}")
            return False
            
    except Exception as e:
        print(f"檢查API連線時發生錯誤: {e}")
        return False

def get_dynamic_check_interval():
    """根據交易時間動態調整檢查間隔"""
    try:
        # 檢查是否為交易時間
        response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5)
        if response.status_code == 200:
            data = response.json()
            is_trading_day = data.get('is_trading_day', False)
            is_market_open = data.get('is_market_open', False)
            
            # 交易時間：每1分鐘檢查
            if is_trading_day and is_market_open:
                return 60  # 1分鐘
            # 非交易時間：每10分鐘檢查
            else:
                return 600  # 10分鐘
        else:
            # 如果無法獲取交易狀態，預設使用較長的間隔
            return 600
    except Exception as e:
        print(f"獲取動態檢查間隔失敗: {e}")
        # 發生錯誤時使用較長的間隔
        return 600

def start_connection_monitor():
    """啟動連線監控器（智能檢查頻率）"""
    global connection_monitor_timer
    
    def connection_monitor_loop():
        global reconnect_attempts, is_reconnecting
        
        while True:
            try:
                # 動態獲取檢查間隔
                check_interval = get_dynamic_check_interval()
                
                # 根據當前狀態決定檢查頻率
                if is_reconnecting:
                    # 重連中：每30秒檢查一次
                    sleep_time = 30
                    print(f"重連中，{sleep_time}秒後檢查連線狀態...")
                else:
                    # 正常狀態：使用動態間隔
                    sleep_time = check_interval
                    if check_interval == 60:
                        print(f"交易時間，{sleep_time}秒後檢查連線狀態...")
                    else:
                        print(f"非交易時間，{sleep_time}秒後檢查連線狀態...")
                
                time.sleep(sleep_time)
                
                # 只有在已登入的情況下才檢查連線
                if sinopac_connected and sinopac_login_status:
                    if not check_api_connection():
                        # 如果還沒開始重連，發送斷線通知
                        if not is_reconnecting:
                            print("檢測到API斷線，開始重連...")
                            send_telegram_message("⚠️ API連線異常！！！\n正在嘗試重新連線．．．")
                            is_reconnecting = True
                            reconnect_attempts = 0
                        
                        # 嘗試重連
                        if reconnect_api():
                            print("API重連成功！")
                            send_telegram_message("✅ API連線成功！！！")
                            reconnect_attempts = 0
                            is_reconnecting = False
                        else:
                            reconnect_attempts += 1
                            print(f"重連失敗，30秒後重試... (第{reconnect_attempts}次)")
                
            except Exception as e:
                print(f"連線監控器錯誤: {e}")
                time.sleep(60)  # 發生錯誤時等待1分鐘
    
    connection_thread = threading.Thread(target=connection_monitor_loop, daemon=True)
    connection_thread.start()
    print("智能連線監控器已啟動（交易時間每1分鐘，非交易時間每10分鐘）")

def reconnect_api():
    """重連API"""
    global sinopac_connected, sinopac_login_status
    
    try:
        print("開始重連API...")
        
        # 先登出（包含token清理）
        if sinopac_connected:
            try:
                sinopac_api.logout()
            except:
                pass
            sinopac_connected = False
            sinopac_login_status = False
        
        # 等待1秒
        time.sleep(1)
        
        # 重新初始化API並登入
        try:
            # 重新初始化API
            if sinopac_api:
                try:
                    sinopac_api.logout()
                except:
                    pass
            
            # 重新初始化
            init_sinopac_api()
            
            # 重新登入
            if login_sinopac():
                print("API重連成功")
                return True
            else:
                print("API重連失敗")
                return False
                
        except Exception as e:
            print(f"重新初始化API時發生錯誤: {e}")
            return False
            
    except Exception as e:
        print(f"重連API時發生錯誤: {e}")
        return False

def stop_connection_monitor():
    """停止連線監控器"""
    global connection_monitor_timer
    
    if connection_monitor_timer and connection_monitor_timer.is_alive():
        connection_monitor_timer.cancel()
        connection_monitor_timer = None
        print("已停止連線監控器")

if __name__ == '__main__':
    # 在其他初始化代碼之前添加
    notification_sent_date = None
    
    # 顯示啟動設定
    print(f"=== Auto91 交易系統啟動 ===")
    print(f"端口設定: {CURRENT_PORT}")
    print(f"日誌模式: {'背景執行' if LOG_CONSOLE == 0 else '正常顯示'}")
    print(f"================================")
    
    # 啟動時清理舊的交易記錄檔案
    cleanup_old_trade_files()
    
    # 初始化保證金記錄
    if update_margin_requirements_from_api():
        last_margin_requirements = margin_requirements.copy()
    
    # 程式啟動時強制重置LOGIN為0，確保乾淨狀態
    try:
        update_login_status(0)
        # 驗證重置是否成功（靜默檢查）
        if os.path.exists(ENV_PATH):
            with open(ENV_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
                if 'LOGIN=0' not in content:
                    print("LOGIN狀態重置失敗")
    except Exception as e:
        print(f"重置LOGIN狀態時發生錯誤: {e}")
    
    # 初始化永豐API
    init_sinopac_api()
    
    # 初始化ngrok版本信息（不輸出print）
    try:
        get_ngrok_version()
    except Exception:
        pass
    
    # 啟動通知檢查器
    start_notification_checker()
    
    # 啟動轉倉檢查器
    start_rollover_checker()
    
    # 啟動連線監控器
    start_connection_monitor()
    
    # 註冊信號處理器
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # 啟動Flask伺服器和webview
        threading.Thread(target=start_flask, daemon=True).start()
        time.sleep(2)  # 等待伺服器啟動
        start_webview()
    except KeyboardInterrupt:
        cleanup_on_exit()