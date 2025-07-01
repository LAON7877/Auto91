from flask import Flask, send_from_directory, request, jsonify, abort
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

app = Flask(__name__, static_folder='web', static_url_path='')

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
HOLIDAY_DIR=Desktop/AutoTX/holiday

# 憑證檔案
CA_PATH=Desktop/AutoTX/certificate

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

def get_ngrok_requests():
    """獲取ngrok請求日誌"""
    try:
        response = requests.get('http://localhost:4040/api/requests', timeout=3)
        if response.status_code == 200:
            data = response.json()
            requests_list = data.get('requests', [])
            
            # 只取最近的100個請求
            recent_requests = requests_list[-100:] if len(requests_list) > 100 else requests_list
            
            # 格式化請求數據
            formatted_requests = []
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
                
                formatted_requests.append({
                    'timestamp': time_str,
                    'method': req.get('method', 'GET'),
                    'uri': req.get('uri', '/'),
                    'status': status_code,
                    'status_text': status_text
                })
            
            return {'requests': formatted_requests}
    except Exception:
        # 靜默處理錯誤，不輸出DEBUG訊息
        pass
    
    return {'requests': []}

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
        
        return jsonify({
            'holiday_file': holiday_file,
            'certificate_file': cert_file
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
                    def get_sort_date(contract):
                        date_str = contract.delivery_date
                        if isinstance(date_str, str):
                            if len(date_str) == 8:  # YYYYMMDD
                                return date_str
                            elif '-' in date_str:  # YYYY-MM-DD
                                return date_str.replace('-', '')
                        return str(date_str)
                    
                    sorted_contracts = sorted(contracts, key=get_sort_date)
                    
                    # 可用合約列表
                    available_list = []
                    for c in sorted_contracts:
                        delivery_date = c.delivery_date
                        if isinstance(delivery_date, str):
                            if len(delivery_date) == 8:  # YYYYMMDD
                                delivery_date = f"{delivery_date[:4]}/{delivery_date[4:6]}/{delivery_date[6:8]}"
                            elif '-' in delivery_date:  # YYYY-MM-DD
                                delivery_date = delivery_date.replace('-', '/')
                        
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
                        
                        delivery_date = selected_contract.delivery_date
                        if isinstance(delivery_date, str):
                            if len(delivery_date) == 8:  # YYYYMMDD
                                delivery_date = f"{delivery_date[:4]}/{delivery_date[4:6]}/{delivery_date[6:8]}"
                            elif '-' in delivery_date:  # YYYY-MM-DD
                                delivery_date = delivery_date.replace('-', '/')
                        
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
                            def get_sort_date(contract):
                                date_str = contract.delivery_date
                                if isinstance(date_str, str):
                                    if len(date_str) == 8:  # YYYYMMDD
                                        return date_str
                                    elif '-' in date_str:  # YYYY-MM-DD
                                        return date_str.replace('-', '')
                                return str(date_str)
                            
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
        
        # 這裡可以添加後端日誌記錄邏輯
        print(f"前端系統日誌 [{log_type.upper()}]: {message}")
        
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

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
                f.write('port:5000\n')
            return 5000
        
        with open(port_file, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            # 解析 port:5000 格式
            if ':' in content:
                port_str = content.split(':')[1].strip()
                try:
                    port = int(port_str)
                    if 1024 <= port <= 65535:  # 檢查端口範圍
                        return port
                except ValueError:
                    pass
            
        # 格式錯誤也自動重建
        with open(port_file, 'w', encoding='utf-8') as f:
            f.write('port:5000\n')
        return 5000
    except Exception as e:
        print(f"讀取端口設置失敗: {e}，使用預設端口 5000")
        return 5000

# 獲取當前端口
CURRENT_PORT = get_port()

def start_flask():
    # 禁用 Flask 和 Werkzeug 的 GET 請求日誌輸出
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)  # 只顯示錯誤級別的日誌
    
    app.run(port=CURRENT_PORT, threaded=True)

def start_webview():
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
        return True  # 允許關閉
    
    # 使用closing事件來確保在關閉前執行清理
    window.events.closing += on_window_closing
    
    # 啟動webview
    webview.start(debug=False)
    
    # webview關閉後不再重複顯示清理訊息

# 永豐API相關函數
def init_sinopac_api():
    global sinopac_api
    if not SHIOAJI_AVAILABLE:
        return False
    
    try:
        if sinopac_api is None:
            sinopac_api = sj.Shioaji()
        return True
    except Exception as e:
        print(f"初始化永豐API失敗: {e}")
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
        
        # 激活CA憑證
        cert_file = None
        if os.path.isfile(ca_path):
            cert_file = ca_path
        elif os.path.isdir(ca_path):
            for file in os.listdir(ca_path):
                if file.endswith('.pfx'):
                    cert_file = os.path.join(ca_path, file)
                    break
        
        if cert_file and os.path.exists(cert_file):
            try:
                sinopac_api.activate_ca(ca_path=cert_file, ca_passwd=ca_passwd, person_id=person_id)
            except Exception:
                # 憑證激活失敗，但繼續使用基本功能
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
    global sinopac_api, sinopac_connected, sinopac_account, sinopac_login_status, sinopac_login_time, auto_logout_timer
    
    try:
        if sinopac_api and sinopac_connected:
            sinopac_api.logout()
        
        sinopac_connected = False
        sinopac_login_status = False
        sinopac_account = None
        sinopac_login_time = None
        
        # 停止自動登出定時器
        stop_auto_logout_timer()
        
        print("永豐API登出成功！！！")
        return True
        
    except Exception as e:
        print(f"永豐API登出失敗: {e}")
        sinopac_connected = False
        sinopac_login_status = False
        sinopac_account = None
        sinopac_login_time = None
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
        global sinopac_connected, sinopac_login_status
        
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
                print("自動重新登入成功！")
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
                print("自動重新登入失敗！")
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
    global sinopac_api, sinopac_connected, sinopac_account, sinopac_login_status, auto_logout_timer, ngrok_process, ngrok_auto_restart_timer
    
    try:
        # 停止自動登出定時器
        stop_auto_logout_timer()
        
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

def check_ngrok_update_alternative():
    try:
        api_urls = [
            'https://api.github.com/repos/ngrok/ngrok-go/releases/latest',
            'https://api.github.com/repos/inconshreveable/ngrok/releases/latest'
        ]
        for url in api_urls:
            try:
                response = requests.get(url, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    latest_version = data.get('tag_name', '').lstrip('v')
                    if latest_version and re.match(r'^\d+\.\d+\.\d+$', latest_version):
                        current_version = get_ngrok_version()
                        if current_version:
                            if compare_versions(latest_version, current_version) > 0:
                                ngrok_update_available = True
                                return {
                                    'update_available': True,
                                    'current_version': current_version,
                                    'latest_version': latest_version,
                                    'download_url': get_download_url(data)
                                }
                            else:
                                ngrok_update_available = False
                                return {
                                    'update_available': False,
                                    'current_version': current_version,
                                    'latest_version': latest_version
                                }
                        break
            except Exception:
                continue
        try:
            response = requests.get('https://ngrok.com/download', timeout=10)
            if response.status_code == 200:
                import re
                version_patterns = [
                    r'ngrok-v?(\d+\.\d+\.\d+)',
                    r'version["\']?\s*:\s*["\']?(\d+\.\d+\.\d+)',
                    r'(\d+\.\d+\.\d+).*ngrok',
                    r'ngrok.*(\d+\.\d+\.\d+)'
                ]
                latest_version = None
                for pattern in version_patterns:
                    matches = re.findall(pattern, response.text, re.IGNORECASE)
                    if matches:
                        valid_versions = []
                        for match in matches:
                            if re.match(r'^\d+\.\d+\.\d+$', match):
                                valid_versions.append(match)
                        if valid_versions:
                            latest_version = max(valid_versions, key=lambda v: [int(x) for x in v.split('.')])
                            break
                if latest_version:
                    current_version = get_ngrok_version()
                    if current_version:
                        if compare_versions(latest_version, current_version) > 0:
                            ngrok_update_available = True
                            return {
                                'update_available': True,
                                'current_version': current_version,
                                'latest_version': latest_version,
                                'download_url': f'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v{latest_version}-windows-amd64.zip'
                            }
                        else:
                            ngrok_update_available = False
                            return {
                                'update_available': False,
                                'current_version': current_version,
                                'latest_version': latest_version
                            }
        except Exception:
            pass
        return None
    except Exception:
        return None

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

def signal_handler(signum, frame):
    """信號處理函數"""
    cleanup_on_exit()
    sys.exit(0)

def check_daily_startup_notification():
    """檢查是否需要發送每日啟動通知"""
    try:
        now = datetime.now()
        current_time = now.hour * 100 + now.minute  # HHMM格式
        # 只在早上8:30檢查
        if current_time == 830:
            # 檢查今天是否為交易日
            response = requests.get(f'http://127.0.0.1:{CURRENT_PORT}/api/trading/status', timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get('is_trading_day', False):
                    send_daily_startup_notification()
    except Exception as e:
        # 靜默處理錯誤
        pass

if __name__ == '__main__':
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