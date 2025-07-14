#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cloudflare Tunnel 管理模組
用於替換 ngrok 的隧道服務
"""

import os
import json
import subprocess
import threading
import time
import requests
import platform
import zipfile
import shutil
from datetime import datetime


class TunnelManager:
    """多隧道管理器"""
    def __init__(self):
        self.tunnels = {}  # 隧道實例字典 {tunnel_type: CloudflareTunnel}
        self.ports = {
            'tx': 5000,     # TX使用5000端口
            'btc': 5000     # BTC也使用5000端口（同一Flask應用，不同隧道域名）
        }
    
    def create_tunnel(self, tunnel_type='tx', mode="temporary"):
        """創建新隧道"""
        if tunnel_type not in self.ports:
            raise ValueError(f"不支持的隧道類型: {tunnel_type}")
        
        port = self.ports[tunnel_type]
        tunnel = CloudflareTunnel(port=port, mode=mode)
        self.tunnels[tunnel_type] = tunnel
        return tunnel
    
    def get_tunnel(self, tunnel_type='tx'):
        """獲取隧道實例"""
        return self.tunnels.get(tunnel_type)
    
    def start_tunnel(self, tunnel_type='tx'):
        """啟動指定類型的隧道"""
        tunnel = self.get_tunnel(tunnel_type)
        if not tunnel:
            tunnel = self.create_tunnel(tunnel_type)
        return tunnel.start_tunnel()
    
    def stop_tunnel(self, tunnel_type='tx'):
        """停止指定類型的隧道"""
        tunnel = self.get_tunnel(tunnel_type)
        if tunnel:
            return tunnel.stop_tunnel()
        return False
    
    def get_tunnel_status(self, tunnel_type='tx'):
        """獲取指定隧道狀態"""
        tunnel = self.get_tunnel(tunnel_type)
        if tunnel:
            return tunnel.get_status()
        return {
            'status': 'stopped',
            'url': None,
            'port': self.ports.get(tunnel_type, 5000)
        }
    
    def stop_all_tunnels(self):
        """停止所有隧道"""
        for tunnel_type, tunnel in self.tunnels.items():
            if tunnel:
                tunnel.stop_tunnel()
    
    def get_all_status(self):
        """獲取所有隧道狀態"""
        status = {}
        for tunnel_type in self.ports.keys():
            status[tunnel_type] = self.get_tunnel_status(tunnel_type)
        return status

class CloudflareTunnel:
    def __init__(self, port=5000, mode="temporary"):
        self.port = port
        self.mode = mode  # custom, temporary
        self.process = None
        self.status = "stopped"  # stopped, starting, running, error
        self.tunnel_url = None
        self.tunnel_name = None
        self.config_file = None
        self.exe_path = None
        self.auto_restart_timer = None
        self.request_logs = []  # 儲存請求日誌
        self.connections = 0  # 連接數
        self.setup_cloudflared()
    
    def setup_cloudflared(self):
        """設置 cloudflared 執行檔"""
        try:
            # 取得執行檔路徑
            current_dir = os.path.dirname(os.path.abspath(__file__))
            
            if platform.system() == "Windows":
                self.exe_path = os.path.join(current_dir, 'cloudflared.exe')
            else:
                self.exe_path = os.path.join(current_dir, 'cloudflared')
            
            # 檢查是否存在，不存在則下載
            if not os.path.exists(self.exe_path):
                print("正在下載 Cloudflare Tunnel 客戶端...")
                self.download_cloudflared()
            
            # 設定配置檔路徑
            self.config_file = os.path.join(current_dir, 'cloudflared_config.yml')
            
        except Exception as e:
            print(f"設置 Cloudflare Tunnel 失敗: {e}")
            self.status = "error"
    
    def download_cloudflared(self):
        """下載 cloudflared 客戶端"""
        try:
            system = platform.system().lower()
            machine = platform.machine().lower()
            
            # 判斷系統架構
            if system == "windows":
                if "64" in machine or "amd64" in machine:
                    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
                else:
                    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe"
            elif system == "linux":
                if "64" in machine or "amd64" in machine:
                    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
                else:
                    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386"
            elif system == "darwin":  # macOS
                url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
            else:
                raise Exception(f"不支援的系統: {system}")
            
            print(f"正在下載: {url}")
            
            # 下載檔案
            response = requests.get(url, stream=True)
            response.raise_for_status()
            
            # 儲存檔案
            with open(self.exe_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # 設定執行權限 (非Windows)
            if system != "windows":
                os.chmod(self.exe_path, 0o755)
            
            print("Cloudflare Tunnel 客戶端下載完成!")
            
        except Exception as e:
            print(f"下載 Cloudflare Tunnel 客戶端失敗: {e}")
            raise
    
    def authenticate(self, token):
        """使用 token 進行身份驗證"""
        try:
            print("正在驗證 Cloudflare Tunnel token...")
            
            # 執行身份驗證命令
            result = subprocess.run([
                self.exe_path, 'tunnel', 'login', '--token', token
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                print("Cloudflare Tunnel 身份驗證成功!")
                return True
            else:
                print(f"身份驗證失敗: {result.stderr}")
                return False
                
        except subprocess.TimeoutExpired:
            print("身份驗證超時")
            return False
        except Exception as e:
            print(f"身份驗證時發生錯誤: {e}")
            return False
    
    def create_tunnel(self, tunnel_name=None):
        """建立隧道"""
        try:
            if not tunnel_name:
                tunnel_name = f"autotx-{int(time.time())}"
            
            self.tunnel_name = tunnel_name
            
            print(f"正在建立隧道: {tunnel_name}")
            
            # 建立隧道
            result = subprocess.run([
                self.exe_path, 'tunnel', 'create', tunnel_name
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                print(f"隧道 {tunnel_name} 建立成功!")
                self.create_config_file()
                return True
            else:
                print(f"建立隧道失敗: {result.stderr}")
                return False
                
        except Exception as e:
            print(f"建立隧道時發生錯誤: {e}")
            return False
    
    def create_config_file(self):
        """建立配置檔案"""
        try:
            config = {
                'tunnel': self.tunnel_name,
                'credentials-file': os.path.join(os.path.expanduser('~'), '.cloudflared', f'{self.tunnel_name}.json'),
                'ingress': [
                    {
                        'hostname': f'{self.tunnel_name}.trycloudflare.com',
                        'service': f'http://localhost:{self.port}'
                    },
                    {
                        'service': 'http_status:404'
                    }
                ]
            }
            
            with open(self.config_file, 'w') as f:
                import yaml
                yaml.dump(config, f)
            
            print(f"配置檔案已建立: {self.config_file}")
            
        except ImportError:
            # 如果沒有 yaml 模組，使用簡單的字串格式
            config_content = f"""tunnel: {self.tunnel_name}
credentials-file: {os.path.join(os.path.expanduser('~'), '.cloudflared', f'{self.tunnel_name}.json')}
ingress:
  - hostname: {self.tunnel_name}.trycloudflare.com
    service: http://localhost:{self.port}
  - service: http_status:404
"""
            with open(self.config_file, 'w') as f:
                f.write(config_content)
            
            print(f"配置檔案已建立: {self.config_file}")
            
        except Exception as e:
            print(f"建立配置檔案失敗: {e}")
            raise
    
    def start_tunnel(self, retry_count=0, max_retries=2):
        """啟動隧道"""
        try:
            if self.status == "running":
                print("隧道已經在運行中")
                return True
            
            print(f"正在啟動 Cloudflare Tunnel... (嘗試 {retry_count + 1}/{max_retries + 1})")
            self.status = "starting"
            
            # 根據模式選擇啟動方式
            if self.mode == 'temporary':
                # 臨時域名模式
                cmd = [
                    self.exe_path, 'tunnel', 
                    '--url', f'http://localhost:{self.port}'
                ]
            else:
                # 自訂域名模式 (需要token)
                token = self.load_token()
                if not token:
                    raise Exception("自訂域名模式需要有效的 Cloudflare Token")
                cmd = [
                    self.exe_path, 'tunnel', 
                    'run', '--token', token
                ]
            
            print(f"執行命令: {' '.join(cmd)}")
            
            self.process = subprocess.Popen(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.STDOUT,  # 合併stderr到stdout
                text=True,
                bufsize=1,  # 行緩沖
                universal_newlines=True
            )
            
            # 等待隧道啟動並獲取URL
            start_time = time.time()
            url_found = False
            output_buffer = []
            
            while time.time() - start_time < 45:  # 增加等待時間到45秒
                if self.process.poll() is not None:
                    # 進程已結束，讀取所有剩餘輸出
                    remaining_output = self.process.stdout.read()
                    if remaining_output:
                        output_buffer.append(remaining_output)
                    
                    full_output = ''.join(output_buffer)
                    print(f"隧道進程結束，完整輸出：\n{full_output}")
                    
                    # 檢查完整輸出中是否有URL
                    import re
                    url_match = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', full_output)
                    if url_match:
                        self.tunnel_url = url_match.group(0)
                        self.tunnel_name = url_match.group(0).split('//')[1].split('.')[0]
                        url_found = True
                        print(f"從完整輸出中找到隧道URL: {self.tunnel_url}")
                        # 重新啟動進程以保持運行
                        self.process = subprocess.Popen(
                            cmd, 
                            stdout=subprocess.PIPE, 
                            stderr=subprocess.STDOUT,
                            text=True
                        )
                        break
                    else:
                        # 檢查是否是429錯誤，如果是則嘗試重試
                        if "429 Too Many Requests" in full_output and retry_count < max_retries:
                            print(f"檢測到429錯誤，等待 {(retry_count + 1) * 5} 秒後重試...")
                            time.sleep((retry_count + 1) * 5)  # 遞增延遲
                            return self.start_tunnel(retry_count + 1, max_retries)
                        else:
                            print("進程結束但未找到URL")
                            self.status = "error"
                            return False
                
                # 讀取輸出
                try:
                    line = self.process.stdout.readline()
                    if line:
                        output_buffer.append(line)
                        print(f"讀取輸出: {line.strip()}")
                        
                        if 'trycloudflare.com' in line:
                            import re
                            url_match = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', line)
                            if url_match:
                                self.tunnel_url = url_match.group(0)
                                self.tunnel_name = url_match.group(0).split('//')[1].split('.')[0]
                                url_found = True
                                print(f"找到隧道URL: {self.tunnel_url}")
                                break
                        
                        # 檢查隧道創建狀態
                        if 'Your quick Tunnel has been created' in line:
                            print("快速隧道已創建，繼續等待URL...")
                        elif 'Registered tunnel connection' in line:
                            print("隧道連接已建立")
                            
                except Exception as e:
                    print(f"讀取輸出時出錯: {e}")
                
                time.sleep(0.5)  # 減少等待間隔
            
            if url_found:
                self.status = "running"
                print(f"Cloudflare Tunnel 啟動成功! URL: {self.tunnel_url}")
                return True
            else:
                print("隧道啟動超時，未能獲取URL")
                self.status = "error"
                return False
            
        except Exception as e:
            print(f"啟動 Cloudflare Tunnel 失敗: {e}")
            self.status = "error"
            return False
    
    def stop_tunnel(self):
        """停止隧道"""
        try:
            if self.process:
                self.process.terminate()
                self.process.wait(timeout=5)
                self.process = None
            
            if self.auto_restart_timer:
                self.auto_restart_timer.cancel()
                self.auto_restart_timer = None
            
            self.status = "stopped"
            print("Cloudflare Tunnel 已停止")
            return True
            
        except Exception as e:
            print(f"停止 Cloudflare Tunnel 失敗: {e}")
            return False
    
    def get_status(self):
        """取得隧道狀態"""
        # 檢查進程狀態
        if self.status == "running" and self.process:
            if self.process.poll() is not None:
                # 進程已結束
                self.status = "error"
                print(f"隧道進程意外結束，返回碼: {self.process.returncode}")
        
        status_info = {
            'status': self.status,
            'url': self.tunnel_url,
            'tunnel_name': self.tunnel_name,
            'port': self.port,
            'timestamp': datetime.now().isoformat(),
            'connections': self.connections,
            'request_count': len(self.request_logs)
        }
        
        if self.status == "error" and self.process and self.process.poll() is not None:
            status_info['message'] = "隧道進程意外結束"
        
        print(f"Cloudflare Tunnel 狀態: {self.status}, URL: {self.tunnel_url}")
        return status_info
    
    def add_request_log(self, method, path, status_code, response_time=None):
        """添加請求日誌"""
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'method': method,
            'path': path,
            'status_code': status_code,
            'response_time': response_time,
            'type': 'cloudflare'
        }
        
        self.request_logs.append(log_entry)
        
        # 只保留最近的100條日誌
        if len(self.request_logs) > 100:
            self.request_logs = self.request_logs[-100:]
    
    def get_request_logs(self):
        """取得請求日誌"""
        return self.request_logs.copy()
    
    def get_latency(self):
        """取得延遲信息"""
        if self.status != "running" or not self.tunnel_url:
            return None
            
        try:
            # 對隧道URL進行ping測試
            import time
            start_time = time.time()
            response = requests.get(self.tunnel_url, timeout=5)
            end_time = time.time()
            
            latency = round((end_time - start_time) * 1000, 2)  # 轉換為毫秒
            return f"{latency}ms"
        except:
            return None
    
    def quick_setup(self, token):
        """快速設定 (類似 ngrok 的簡單設定)"""
        try:
            print("=== Cloudflare Tunnel 快速設定 ===")
            
            # 1. 身份驗證
            if not self.authenticate(token):
                return False
            
            # 2. 建立隧道
            if not self.create_tunnel():
                return False
            
            # 3. 啟動隧道
            if not self.start_tunnel():
                return False
            
            print("=== 設定完成! ===")
            print(f"您的網站網址: {self.tunnel_url}")
            return True
            
        except Exception as e:
            print(f"快速設定失敗: {e}")
            return False
    
    def load_token(self):
        """載入儲存的 Cloudflare Token"""
        try:
            # 這裡可以從配置文件或環境變數載入 token
            # 目前返回 None，表示沒有配置 token
            return None
        except Exception as e:
            print(f"載入 token 失敗: {e}")
            return None