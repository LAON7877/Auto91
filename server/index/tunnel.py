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
import re
import platform
import zipfile
import shutil
import logging
from datetime import datetime

# ========== 日誌配置 ==========
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('tunnel_system')

# 進程管理器功能已移除
PROCESS_MANAGER_AVAILABLE = False


class TunnelManager:
    """多隧道管理器"""
    def __init__(self):
        self.tunnels = {}  # 隧道實例字典 {tunnel_type: CloudflareTunnel}
        self.ports = {
            'tx': 5000,     # TX使用5000端口
            'btc': 5000     # BTC也使用5000端口（同一Flask應用，不同隧道域名）
        }
        self.auto_create_btc_tunnel = True  # 自動為BTC創建獨立隧道
    
    def create_tunnel(self, tunnel_type='tx', mode="temporary"):
        """創建新隧道"""
        if tunnel_type not in self.ports:
            raise ValueError(f"不支持的隧道類型: {tunnel_type}")
        
        port = self.ports[tunnel_type]
        tunnel = CloudflareTunnel(port=port, mode=mode, tunnel_type=tunnel_type)
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
    def __init__(self, port=5000, mode="temporary", tunnel_type="tx"):
        self.port = port
        self.mode = mode  # custom, temporary
        self.tunnel_type = tunnel_type  # tx, btc
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
        # 嘗試取得 main.ALL_CHILD_PROCESSES
        try:
            import main
            self.child_process_list = main.ALL_CHILD_PROCESSES
        except Exception:
            self.child_process_list = None
    
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
                logger.info("正在下載 Cloudflare Tunnel 客戶端...")
                self.download_cloudflared()
            
            # 設定配置檔路徑
            self.config_file = os.path.join(current_dir, 'cloudflared_config.yml')
            
        except Exception as e:
            logger.error(f"設置 Cloudflare Tunnel 失敗: {e}")
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
            
            logger.info(f"正在下載: {url}")
            
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
            
            logger.info("Cloudflare Tunnel 客戶端下載完成!")
            
        except Exception as e:
            logger.error(f"下載 Cloudflare Tunnel 客戶端失敗: {e}")
            raise
    
    def authenticate(self, token):
        """使用 token 進行身份驗證"""
        try:
            logger.info("正在驗證 Cloudflare Tunnel token...")
            
            # 執行身份驗證命令
            result = subprocess.run([
                self.exe_path, 'tunnel', 'login', '--token', token
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                logger.info("Cloudflare Tunnel 身份驗證成功!")
                return True
            else:
                logger.error(f"身份驗證失敗: {result.stderr}")
                return False
                
        except subprocess.TimeoutExpired:
            logger.info("身份驗證超時")
            return False
        except Exception as e:
            logger.error(f"身份驗證時發生錯誤: {e}")
            return False
    
    def create_tunnel(self, tunnel_name=None):
        """建立隧道"""
        try:
            if not tunnel_name:
                tunnel_name = f"autotx-{int(time.time())}"
            
            self.tunnel_name = tunnel_name
            
            logger.info(f"正在建立隧道: {tunnel_name}")
            
            # 建立隧道
            result = subprocess.run([
                self.exe_path, 'tunnel', 'create', tunnel_name
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                logger.info(f"隧道 {tunnel_name} 建立成功!")
                self.create_config_file()
                return True
            else:
                logger.error(f"建立隧道失敗: {result.stderr}")
                return False
                
        except Exception as e:
            logger.error(f"建立隧道時發生錯誤: {e}")
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
            
            logger.info(f"配置檔案已建立: {self.config_file}")
            
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
            
            logger.info(f"配置檔案已建立: {self.config_file}")
            
        except Exception as e:
            logger.error(f"建立配置檔案失敗: {e}")
            raise
    
    def start_tunnel(self, retry_count=0, max_retries=2):
        """啟動隧道"""
        try:
            if self.status == "running":
                logger.info("隧道已經在運行中")
                return True
            
            logger.info(f"正在啟動 Cloudflare Tunnel... (嘗試 {retry_count + 1}/{max_retries + 1})")
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
            
            logger.info(f"執行命令: {' '.join(cmd)}")
            
            self.process = subprocess.Popen(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.STDOUT,  # 合併stderr到stdout
                text=True,
                bufsize=1,  # 行緩沖
                universal_newlines=True
            )
            
            # ====== 新增：記錄進程到 main.ALL_CHILD_PROCESSES ======
            if self.child_process_list is not None:
                self.child_process_list.append(self.process)
            
            # ====== 新增：註冊進程到進程管理器 ======
            if PROCESS_MANAGER_AVAILABLE and self.process:
                register_subprocess(self.process, f"Cloudflared隧道-{self.mode}", f"cloudflared tunnel")
                register_external_process("cloudflared", self.process.pid)
            
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
                    logger.info(f"隧道進程結束，完整輸出：\n{full_output}")
                    
                    # 檢查完整輸出中是否有URL
                    url_match = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', full_output)
                    if url_match:
                        self.tunnel_url = url_match.group(0)
                        self.tunnel_name = url_match.group(0).split('//')[1].split('.')[0]
                        url_found = True
                        logger.info(f"從完整輸出中找到隧道URL: {self.tunnel_url}")
                        # 重新啟動進程以保持運行
                        self.process = subprocess.Popen(
                            cmd, 
                            stdout=subprocess.PIPE, 
                            stderr=subprocess.STDOUT,
                            text=True
                        )
                        
                        # 註冊重新啟動的進程到進程管理器
                        if PROCESS_MANAGER_AVAILABLE and self.process:
                            register_subprocess(self.process, f"Cloudflared隧道重啟-{self.mode}", f"cloudflared tunnel restart")
                            register_external_process("cloudflared", self.process.pid)
                        
                        break
                    else:
                        # 檢查是否是429錯誤，如果是則嘗試重試
                        if "429 Too Many Requests" in full_output and retry_count < max_retries:
                            logger.error(f"檢測到429錯誤，等待 {(retry_count + 1) * 5} 秒後重試...")
                            time.sleep((retry_count + 1) * 5)  # 遞增延遲
                            return self.start_tunnel(retry_count + 1, max_retries)
                        else:
                            logger.info("進程結束但未找到URL")
                            self.status = "error"
                            return False
                
                # 讀取輸出
                try:
                    line = self.process.stdout.readline()
                    if line:
                        output_buffer.append(line)
                        logger.info(f"讀取輸出: {line.strip()}")
                        
                        if 'trycloudflare.com' in line:
                            url_match = re.search(r'https://[a-zA-Z0-9\-]+\.trycloudflare\.com', line)
                            if url_match:
                                self.tunnel_url = url_match.group(0)
                                self.tunnel_name = url_match.group(0).split('//')[1].split('.')[0]
                                url_found = True
                                logger.info(f"找到隧道URL: {self.tunnel_url}")
                                break
                        
                        # 檢查隧道創建狀態
                        if 'Your quick Tunnel has been created' in line:
                            logger.info("快速隧道已創建，繼續等待URL...")
                        elif 'Registered tunnel connection' in line:
                            logger.info("隧道連接已建立")
                            
                except Exception as e:
                    logger.info(f"讀取輸出時出錯: {e}")
                
                time.sleep(0.5)  # 減少等待間隔
            
            if url_found:
                self.status = "running"
                logger.info(f"Cloudflare Tunnel 啟動成功! URL: {self.tunnel_url}")
                return True
            else:
                logger.info("隧道啟動超時，未能獲取URL")
                self.status = "error"
                return False
            
        except Exception as e:
            logger.error(f"啟動 Cloudflare Tunnel 失敗: {e}")
            self.status = "error"
            return False
    
    def stop_tunnel(self):
        """停止隧道"""
        try:
            if self.process:
                # 從子進程列表中移除
                if self.child_process_list is not None and self.process in self.child_process_list:
                    self.child_process_list.remove(self.process)
                    logger.info(f"已從子進程列表移除 PID={self.process.pid}")
                
                # 先嘗試正常終止
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # 如果5秒內沒有終止，強制殺死進程
                    logger.info("正常終止超時，強制關閉 cloudflared.exe")
                    self.process.kill()
                    self.process.wait(timeout=3)
                self.process = None
            
            if self.auto_restart_timer:
                self.auto_restart_timer.cancel()
                self.auto_restart_timer = None
            
            # 額外的系統級清理，確保沒有殘留進程
            try:
                if platform.system() == "Windows":
                    # Windows 系統使用 taskkill
                    subprocess.run(["taskkill", "/F", "/IM", "cloudflared.exe"], 
                                 capture_output=True, text=True, check=False)
                else:
                    # Linux/WSL 系統使用 pkill
                    subprocess.run(["pkill", "-f", "cloudflared"], 
                                 capture_output=True, text=True, check=False)
                logger.info("已執行系統級 cloudflared 進程清理")
            except Exception as cleanup_error:
                logger.error(f"系統級清理警告: {cleanup_error}")
            
            self.status = "stopped"
            logger.info("Cloudflare Tunnel 已停止")
            return True
            
        except Exception as e:
            logger.error(f"停止 Cloudflare Tunnel 失敗: {e}")
            # 即使出錯也要清除進程引用
            self.process = None
            
            # 即使正常終止失敗，也嘗試系統級強制清理
            try:
                if platform.system() == "Windows":
                    subprocess.run(["taskkill", "/F", "/IM", "cloudflared.exe"], 
                                 capture_output=True, text=True, check=False)
                else:
                    subprocess.run(["pkill", "-f", "cloudflared"], 
                                 capture_output=True, text=True, check=False)
                logger.info("已執行應急系統級 cloudflared 進程清理")
            except Exception as emergency_cleanup_error:
                logger.error(f"應急清理也失敗: {emergency_cleanup_error}")
            
            return False
    
    def get_status(self):
        """取得隧道狀態"""
        # 檢查進程狀態
        if self.status == "running" and self.process:
            if self.process.poll() is not None:
                # 進程已結束
                self.status = "error"
                logger.info(f"隧道進程意外結束，返回碼: {self.process.returncode}")
        
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
        
        logger.info(f"Cloudflare Tunnel 狀態: {self.status}, URL: {self.tunnel_url}")
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
            logger.info("=== Cloudflare Tunnel 快速設定 ===")
            
            # 1. 身份驗證
            if not self.authenticate(token):
                return False
            
            # 2. 建立隧道
            if not self.create_tunnel():
                return False
            
            # 3. 啟動隧道
            if not self.start_tunnel():
                return False
            
            logger.info("=== 設定完成! ===")
            logger.info(f"您的網站網址: {self.tunnel_url}")
            return True
            
        except Exception as e:
            logger.error(f"快速設定失敗: {e}")
            return False
    
    def load_token(self):
        """載入儲存的 Cloudflare Token"""
        try:
            # 這裡可以從配置文件或環境變數載入 token
            # 目前返回 None，表示沒有配置 token
            return None
        except Exception as e:
            logger.error(f"載入 token 失敗: {e}")
            return None
    
    def start_health_monitor(self):
        """啟動隧道健康監控（量化交易專用）"""
        if hasattr(self, '_health_monitor_running') and self._health_monitor_running:
            logger.info("健康監控已在運行中")
            return
        
        self._health_monitor_running = True
        self._failed_checks = 0
        self._last_successful_check = time.time()
        
        def health_check_loop():
            """健康檢查循環（適合量化交易的高頻檢查）"""
            while self._health_monitor_running and self.status != "stopped":
                try:
                    # 每60秒檢查一次連線狀況（降低檢查頻率避免過度重連）
                    time.sleep(60)
                    
                    if not self._health_monitor_running:
                        break
                    
                    # 檢查進程是否存活
                    if not self.process or self.process.poll() is not None:
                        logger.error("🔴 檢測到cloudflared進程異常終止")
                        self._handle_connection_failure("進程終止")
                        continue
                    
                    # 檢查HTTP連線狀況
                    if self.tunnel_url:
                        check_success = self._perform_health_check()
                        if check_success:
                            self._failed_checks = 0
                            self._last_successful_check = time.time()
                            logger.debug("✅ 隧道健康檢查通過")
                        else:
                            self._failed_checks += 1
                            logger.warning(f"⚠️ 隧道健康檢查失敗 ({self._failed_checks}/5)")
                            
                            # 連續失敗5次才觸發重連（提高容錯性）
                            if self._failed_checks >= 5:
                                self._handle_connection_failure("連續健康檢查失敗")
                    
                    # 檢查是否超過5分鐘沒有成功檢查（防止卡死）
                    if time.time() - self._last_successful_check > 300:  # 5分鐘
                        logger.error("🔴 超過5分鐘未通過健康檢查")
                        self._handle_connection_failure("長時間檢查失敗")
                        
                except Exception as e:
                    logger.error(f"健康檢查循環異常: {e}")
                    time.sleep(10)  # 異常時等待10秒
        
        # 在背景執行健康檢查
        self._monitor_thread = threading.Thread(target=health_check_loop, daemon=True, name="TunnelHealthMonitor")
        self._monitor_thread.start()
        logger.info("🟢 隧道健康監控已啟動（量化交易模式）")
    
    def _perform_health_check(self):
        """執行實際的健康檢查（檢查本地服務和隧道進程）"""
        # 1. 檢查cloudflared進程是否存活
        if not self.process or self.process.poll() is not None:
            logger.warning("🔴 cloudflared進程已停止")
            return False
        
        # 2. 檢查本地服務是否響應（避免回環連接問題）
        try:
            response = requests.get(
                f"http://localhost:{self.port}",
                timeout=5,
                headers={'User-Agent': 'Auto91-LocalHealthCheck/1.0'}
            )
            # 本地服務正常響應
            logger.debug("✅ 本地服務健康檢查通過")
            return True
        except requests.exceptions.ConnectionError:
            logger.warning("🔌 本地服務連線錯誤")
            return False
        except requests.exceptions.Timeout:
            logger.warning("⏰ 本地服務檢查超時")
            return False
        except Exception as e:
            logger.warning(f"🔍 本地服務檢查異常: {e}")
            return False
    
    def _handle_connection_failure(self, reason):
        """處理連線失敗（自動重連）"""
        logger.error(f"🔴 隧道連線失敗: {reason}，啟動自動重連...")
        
        # 檢查重連冷卻時間（避免過於頻繁重連）
        current_time = time.time()
        if hasattr(self, '_last_reconnect_time'):
            if current_time - self._last_reconnect_time < 120:  # 2分鐘冷卻時間
                logger.warning(f"⏳ 重連冷卻中，還需等待 {120 - (current_time - self._last_reconnect_time):.0f} 秒")
                return
        
        self._last_reconnect_time = current_time
        
        try:
            # 記錄失敗時間和原因
            failure_info = {
                'time': datetime.now().isoformat(),
                'reason': reason,
                'failed_checks': self._failed_checks,
                'old_url': self.tunnel_url
            }
            
            # 停止當前隧道
            old_url = self.tunnel_url
            self.stop_tunnel()
            
            # 等待5秒後重新啟動
            time.sleep(5)
            
            # 嘗試重新啟動隧道
            restart_success = self.start_tunnel()
            
            if restart_success:
                logger.info("✅ 隧道自動重連成功")
                self._failed_checks = 0
                self._last_successful_check = time.time()
                
                # 檢查URL是否改變
                new_url = self.tunnel_url
                if old_url != new_url:
                    self._notify_url_change(old_url, new_url, reason)
                
                # 重新啟動健康監控
                if not hasattr(self, '_monitor_thread') or not self._monitor_thread.is_alive():
                    self.start_health_monitor()
            else:
                logger.error("❌ 隧道自動重連失敗，將在60秒後再次嘗試")
                # 設定延遲重試
                threading.Timer(60, lambda: self._handle_connection_failure("重連失敗後的延遲重試")).start()
                
        except Exception as e:
            logger.error(f"自動重連處理異常: {e}")
    
    def _notify_url_change(self, old_url, new_url, reason):
        """通知URL變化（發送Telegram通知）"""
        try:
            logger.warning(f"🔄 隧道URL已變化: {old_url} → {new_url}")
            
            # 儲存URL變化記錄
            url_change_record = {
                'timestamp': datetime.now().isoformat(),
                'old_url': old_url,
                'new_url': new_url,
                'reason': reason,
                'tunnel_type': getattr(self, 'tunnel_type', 'unknown')
            }
            
            # 保存到URL變化歷史
            self._save_url_change_history(url_change_record)
            
            # 發送Telegram通知（如果可用）
            self._send_url_change_notification(url_change_record)
            
        except Exception as e:
            logger.error(f"URL變化通知失敗: {e}")
    
    def _save_url_change_history(self, record):
        """保存URL變化歷史"""
        try:
            history_file = os.path.join(os.path.dirname(__file__), 'tunnel_url_history.json')
            
            # 載入現有歷史
            history = []
            if os.path.exists(history_file):
                with open(history_file, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            
            # 添加新記錄
            history.append(record)
            
            # 只保留最近50條記錄
            if len(history) > 50:
                history = history[-50:]
            
            # 保存歷史
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(history, f, indent=2, ensure_ascii=False)
                
            logger.info("📝 URL變化歷史已記錄")
            
        except Exception as e:
            logger.error(f"保存URL變化歷史失敗: {e}")
    
    def _send_url_change_notification(self, record):
        """發送URL變化Telegram通知（使用對應的Bot）"""
        try:
            tunnel_type = record.get('tunnel_type', 'unknown')
            old_url = record.get('old_url', 'N/A')
            new_url = record.get('new_url', 'N/A')
            reason = record.get('reason', 'unknown')
            
            # 根據隧道類型構建正確的webhook後綴
            if tunnel_type.lower() == 'tx':
                webhook_suffix = '/webhook'
            elif tunnel_type.lower() == 'btc':
                webhook_suffix = '/api/btc/webhook'
            else:
                webhook_suffix = f'/webhook/{tunnel_type}'
                
            # 構建通知訊息
            message = f"""{tunnel_type.upper()}隧道重新連接
時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

新Webhook地址:
{new_url}{webhook_suffix}

請立即更新TradingView設定"""

            logger.info(f"📱 準備發送{tunnel_type.upper()}隧道URL變化通知")
            
            # 根據隧道類型使用對應的Bot發送通知
            success = self._send_notification_by_tunnel_type(tunnel_type, message)
            
            if success:
                logger.info(f"✅ {tunnel_type.upper()}隧道URL變化通知已通過對應Bot發送")
            else:
                logger.warning(f"⚠️ {tunnel_type.upper()}隧道URL變化通知發送失敗")
            
        except Exception as e:
            logger.error(f"發送URL變化通知失敗: {e}")
    
    def _send_notification_by_tunnel_type(self, tunnel_type, message):
        """根據隧道類型使用對應的Bot發送通知"""
        try:
            if tunnel_type.lower() == 'tx':
                # 使用TX Bot發送通知
                return self._send_tx_notification(message)
            elif tunnel_type.lower() == 'btc':
                # 使用BTC Bot發送通知
                return self._send_btc_notification(message)
            else:
                logger.warning(f"未知的隧道類型: {tunnel_type}")
                return False
                
        except Exception as e:
            logger.error(f"根據隧道類型發送通知失敗: {e}")
            return False
    
    def _send_tx_notification(self, message):
        """使用TX Bot發送通知"""
        try:
            # 嘗試導入主系統的TX Telegram發送功能
            import main
            if hasattr(main, 'send_telegram_message'):
                # 使用TX的設定發送
                main.send_telegram_message(message)
                return True
            else:
                logger.warning("主系統未提供send_telegram_message功能")
                return False
                
        except Exception as e:
            logger.error(f"TX Bot通知發送失敗: {e}")
            return False
    
    def _send_btc_notification(self, message):
        """使用BTC Bot發送通知"""
        try:
            # 嘗試導入BTC模組的Telegram發送功能
            try:
                import btcmain
                if hasattr(btcmain, 'send_btc_telegram_message'):
                    result = btcmain.send_btc_telegram_message(message)
                    logger.info(f"BTC Bot通知發送結果: {result}")
                    return result
                else:
                    logger.warning("BTC模組未提供send_btc_telegram_message功能")
                    return False
            except ImportError:
                logger.warning("無法導入BTC模組")
                return False
                
        except Exception as e:
            logger.error(f"BTC Bot通知發送失敗: {e}")
            return False
    
    def stop_health_monitor(self):
        """停止健康監控"""
        self._health_monitor_running = False
        if hasattr(self, '_monitor_thread') and self._monitor_thread.is_alive():
            logger.info("正在停止隧道健康監控...")
            # 等待監控線程結束
            self._monitor_thread.join(timeout=2)
        logger.info("🔴 隧道健康監控已停止")
    
    def get_connection_stats(self):
        """獲取連線統計（供量化交易監控使用）"""
        return {
            'status': self.status,
            'failed_checks': getattr(self, '_failed_checks', 0),
            'last_successful_check': getattr(self, '_last_successful_check', 0),
            'monitor_running': getattr(self, '_health_monitor_running', False),
            'uptime_seconds': time.time() - getattr(self, '_start_time', time.time()) if self.status == "running" else 0,
            'tunnel_url': self.tunnel_url
        }


class QuantTradingTunnelManager(TunnelManager):
    """量化交易專用隧道管理器（企業級可靠性）"""
    
    def __init__(self):
        super().__init__()
        self.monitoring_enabled = True
        self.reconnect_attempts = {}  # 記錄重連嘗試次數
        
    def create_tunnel(self, tunnel_type='tx', mode="temporary"):
        """創建帶自動監控的隧道"""
        tunnel = super().create_tunnel(tunnel_type, mode)
        return tunnel
    
    def start_tunnel(self, tunnel_type='tx'):
        """啟動隧道並開啟監控"""
        success = super().start_tunnel(tunnel_type)
        
        if success and self.monitoring_enabled:
            tunnel = self.get_tunnel(tunnel_type)
            if tunnel:
                # 啟動健康監控
                tunnel.start_health_monitor()
                # 記錄啟動時間
                tunnel._start_time = time.time()
                logger.info(f"🟢 {tunnel_type}隧道已啟動並開啟自動監控")
        
        # 如果啟動TX隧道成功且設置了自動創建BTC隧道
        if success and tunnel_type == 'tx' and self.auto_create_btc_tunnel:
            self._auto_create_btc_tunnel()
        
        return success
    
    def _auto_create_btc_tunnel(self):
        """自動創建BTC隧道（獨立URL）"""
        try:
            if 'btc' not in self.tunnels:
                logger.info("🔄 自動創建BTC獨立隧道...")
                btc_tunnel = self.create_tunnel('btc', mode="temporary")
                if btc_tunnel:
                    # 自動啟動BTC隧道
                    btc_success = btc_tunnel.start_tunnel()
                    if btc_success and self.monitoring_enabled:
                        btc_tunnel.start_health_monitor()
                        btc_tunnel._start_time = time.time()
                        logger.info("🟢 BTC隧道已自動創建並啟動監控")
                    else:
                        logger.warning("⚠️ BTC隧道創建成功但啟動失敗")
                else:
                    logger.warning("⚠️ BTC隧道自動創建失敗")
        except Exception as e:
            logger.error(f"自動創建BTC隧道失敗: {e}")
    
    def ensure_both_tunnels_running(self):
        """確保TX和BTC隧道都在運行"""
        tx_status = self.get_tunnel_status('tx').get('status', 'stopped')
        btc_status = self.get_tunnel_status('btc').get('status', 'stopped')
        
        if tx_status != 'running':
            logger.info("🔄 啟動TX隧道...")
            self.start_tunnel('tx')
        
        if btc_status != 'running':
            logger.info("🔄 啟動BTC隧道...")
            self.start_tunnel('btc')
    
    def stop_tunnel(self, tunnel_type='tx'):
        """停止隧道並關閉監控"""
        tunnel = self.get_tunnel(tunnel_type)
        if tunnel:
            # 停止健康監控
            tunnel.stop_health_monitor()
        
        return super().stop_tunnel(tunnel_type)
    
    def get_tunnel_health_report(self, tunnel_type='tx'):
        """獲取隧道健康報告（量化交易專用）"""
        tunnel = self.get_tunnel(tunnel_type)
        if tunnel:
            stats = tunnel.get_connection_stats()
            
            # 計算可用性百分比
            uptime = stats.get('uptime_seconds', 0)
            failed_checks = stats.get('failed_checks', 0)
            
            availability = 100.0 if failed_checks == 0 else max(0, 100 - (failed_checks * 2))
            
            return {
                'tunnel_type': tunnel_type,
                'availability_percentage': round(availability, 2),
                'uptime_hours': round(uptime / 3600, 2),
                'status': stats['status'],
                'last_check_ago_seconds': int(time.time() - stats.get('last_successful_check', 0)),
                'monitor_active': stats.get('monitor_running', False),
                'url': stats.get('tunnel_url', 'N/A')
            }
        
        return None
    
    def enable_monitoring(self):
        """啟用所有隧道的監控"""
        self.monitoring_enabled = True
        for tunnel_type, tunnel in self.tunnels.items():
            if tunnel and tunnel.status == "running":
                tunnel.start_health_monitor()
        logger.info("🟢 已啟用所有隧道的健康監控")
    
    def disable_monitoring(self):
        """停用所有隧道的監控（僅測試時使用）"""
        self.monitoring_enabled = False
        for tunnel_type, tunnel in self.tunnels.items():
            if tunnel:
                tunnel.stop_health_monitor()
        logger.warning("🟡 已停用所有隧道的健康監控")


class PersistentTunnelManager(QuantTradingTunnelManager):
    """固定URL隧道管理器（量化交易專用 - 解決重連URL變化問題）"""
    
    def __init__(self):
        super().__init__()
        self.persistent_config = {
            'domain': None,  # 自定義域名（如果有）
            'tunnel_token': None,  # 持久化隧道token
            'tunnel_name': f"auto91-quant-{int(time.time())}",  # 固定隧道名稱
            'use_named_tunnel': True  # 使用命名隧道而非臨時隧道
        }
        self.tunnel_credentials_file = None
        
    def setup_persistent_tunnel(self, tunnel_type='tx'):
        """設置持久化隧道（固定URL）"""
        logger.info("🔧 正在設置固定URL隧道（量化交易專用）...")
        
        try:
            # 檢查是否已有持久化隧道配置
            existing_config = self._load_tunnel_config(tunnel_type)
            if existing_config:
                logger.info("✅ 發現現有隧道配置，嘗試使用固定URL")
                return self._use_existing_tunnel(tunnel_type, existing_config)
            
            # 創建新的持久化隧道
            return self._create_persistent_tunnel(tunnel_type)
            
        except Exception as e:
            logger.error(f"設置固定URL隧道失敗: {e}")
            # 降級到臨時隧道
            logger.warning("⚠️ 降級使用臨時隧道（URL會變化）")
            return self.create_tunnel(tunnel_type, mode="temporary")
    
    def _create_persistent_tunnel(self, tunnel_type):
        """創建新的持久化隧道"""
        logger.info(f"🆕 創建新的固定URL隧道: {tunnel_type}")
        
        # 創建特殊的持久化隧道實例
        tunnel = PersistentCloudflaredTunnel(
            port=self.ports[tunnel_type],
            tunnel_name=f"{self.persistent_config['tunnel_name']}-{tunnel_type}",
            tunnel_type=tunnel_type
        )
        
        self.tunnels[tunnel_type] = tunnel
        
        # 保存隧道配置
        self._save_tunnel_config(tunnel_type, tunnel.get_persistent_config())
        
        return tunnel
    
    def _load_tunnel_config(self, tunnel_type):
        """載入隧道配置"""
        try:
            config_file = f"tunnel_config_{tunnel_type}.json"
            config_path = os.path.join(os.path.dirname(__file__), config_file)
            
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    logger.info(f"📁 載入{tunnel_type}隧道配置成功")
                    return config
        except Exception as e:
            logger.warning(f"載入隧道配置失敗: {e}")
        
        return None
    
    def _save_tunnel_config(self, tunnel_type, config):
        """保存隧道配置"""
        try:
            config_file = f"tunnel_config_{tunnel_type}.json"
            config_path = os.path.join(os.path.dirname(__file__), config_file)
            
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
                
            logger.info(f"💾 {tunnel_type}隧道配置已保存")
        except Exception as e:
            logger.error(f"保存隧道配置失敗: {e}")
    
    def _use_existing_tunnel(self, tunnel_type, config):
        """使用現有隧道配置"""
        try:
            tunnel = PersistentCloudflaredTunnel(
                port=self.ports[tunnel_type],
                tunnel_name=config.get('tunnel_name'),
                tunnel_type=tunnel_type,
                existing_config=config
            )
            
            self.tunnels[tunnel_type] = tunnel
            logger.info(f"🔄 使用現有{tunnel_type}隧道配置")
            return tunnel
            
        except Exception as e:
            logger.error(f"使用現有隧道配置失敗: {e}")
            return None
    
    def get_persistent_url(self, tunnel_type='tx'):
        """獲取固定URL（用於TradingView等外部服務）"""
        tunnel = self.get_tunnel(tunnel_type)
        if tunnel and hasattr(tunnel, 'get_persistent_url'):
            return tunnel.get_persistent_url()
        return None
    
    def regenerate_tunnel_if_needed(self, tunnel_type='tx'):
        """必要時重新生成隧道（保持URL固定）"""
        tunnel = self.get_tunnel(tunnel_type)
        if tunnel and hasattr(tunnel, 'ensure_persistent_connection'):
            return tunnel.ensure_persistent_connection()
        return False


class PersistentCloudflaredTunnel(CloudflareTunnel):
    """持久化Cloudflared隧道（固定URL - 量化交易專用）"""
    
    def __init__(self, port=5000, tunnel_name=None, tunnel_type='tx', existing_config=None):
        # 初始化基礎隧道
        super().__init__(port, mode="custom")
        
        self.tunnel_type = tunnel_type
        self.tunnel_name = tunnel_name or f"auto91-{tunnel_type}-{int(time.time())}"
        self.persistent_url = None
        self.tunnel_id = None
        self.tunnel_credentials = None
        
        # 如果有現有配置，載入它
        if existing_config:
            self._load_existing_config(existing_config)
        
        logger.info(f"🎯 初始化固定URL隧道: {self.tunnel_name}")
    
    def _load_existing_config(self, config):
        """載入現有配置"""
        self.tunnel_name = config.get('tunnel_name')
        self.persistent_url = config.get('persistent_url')
        self.tunnel_id = config.get('tunnel_id')
        self.tunnel_credentials = config.get('tunnel_credentials')
    
    def start_tunnel(self, retry_count=0, max_retries=2):
        """啟動固定URL隧道"""
        try:
            if self.status == "running":
                logger.info("固定URL隧道已在運行中")
                return True
            
            logger.info(f"🚀 啟動固定URL隧道: {self.tunnel_name}")
            self.status = "starting"
            
            # 檢查是否需要創建新隧道
            if not self.tunnel_id:
                self._create_named_tunnel()
            
            # 啟動隧道連接
            success = self._start_persistent_connection()
            
            if success:
                self.status = "running"
                # 保存配置以供下次使用
                self._update_persistent_config()
                logger.info(f"✅ 固定URL隧道啟動成功: {self.persistent_url}")
                return True
            else:
                self.status = "error"
                return False
                
        except Exception as e:
            logger.error(f"啟動固定URL隧道失敗: {e}")
            self.status = "error"
            return False
    
    def _create_named_tunnel(self):
        """創建命名隧道（獲得固定URL）"""
        try:
            logger.info(f"🔨 創建命名隧道: {self.tunnel_name}")
            
            # 使用cloudflared創建命名隧道
            cmd = [
                self.exe_path, 'tunnel', 'create', self.tunnel_name
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                # 解析輸出獲取隧道ID
                output_lines = result.stderr.split('\n')
                for line in output_lines:
                    if 'Created tunnel' in line and 'with id' in line:
                        # 提取隧道ID
                        import re
                        match = re.search(r'with id ([a-f0-9-]+)', line)
                        if match:
                            self.tunnel_id = match.group(1)
                            logger.info(f"✅ 隧道ID: {self.tunnel_id}")
                            break
                
                if not self.tunnel_id:
                    raise Exception("無法從輸出中提取隧道ID")
                
                # 生成固定URL
                self.persistent_url = f"https://{self.tunnel_id}.cfargotunnel.com"
                logger.info(f"🎯 固定URL生成: {self.persistent_url}")
                
            else:
                # 檢查是否隧道已存在
                if "already exists" in result.stderr:
                    logger.info("隧道已存在，嘗試獲取現有隧道信息")
                    self._get_existing_tunnel_info()
                else:
                    raise Exception(f"創建隧道失敗: {result.stderr}")
                    
        except Exception as e:
            logger.error(f"創建命名隧道失敗: {e}")
            raise
    
    def _start_persistent_connection(self):
        """啟動持久化連接"""
        try:
            logger.info("🔗 啟動隧道連接...")
            
            # 構建啟動命令
            cmd = [
                self.exe_path, 'tunnel', 'run',
                '--url', f'http://localhost:{self.port}',
                self.tunnel_name
            ]
            
            # 啟動隧道進程
            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=os.path.dirname(self.exe_path)
            )
            
            # 註冊到進程管理
            if self.child_process_list is not None:
                self.child_process_list.append(self.process)
                logger.info(f"已註冊固定URL隧道進程 PID={self.process.pid}")
            
            # 等待隧道啟動
            time.sleep(3)
            
            # 檢查進程是否正常運行
            if self.process.poll() is None:
                logger.info("✅ 固定URL隧道進程啟動成功")
                return True
            else:
                logger.error("❌ 固定URL隧道進程異常終止")
                return False
                
        except Exception as e:
            logger.error(f"啟動持久化連接失敗: {e}")
            return False
    
    def _get_existing_tunnel_info(self):
        """獲取現有隧道信息"""
        try:
            # 列出所有隧道
            cmd = [self.exe_path, 'tunnel', 'list']
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            
            if result.returncode == 0:
                # 解析隧道列表
                lines = result.stdout.split('\n')
                for line in lines:
                    if self.tunnel_name in line:
                        # 提取隧道ID
                        parts = line.split()
                        if len(parts) >= 2:
                            self.tunnel_id = parts[0]
                            self.persistent_url = f"https://{self.tunnel_id}.cfargotunnel.com"
                            logger.info(f"🔍 找到現有隧道: {self.tunnel_id}")
                            return
                
                raise Exception(f"在隧道列表中未找到: {self.tunnel_name}")
            else:
                raise Exception(f"獲取隧道列表失敗: {result.stderr}")
                
        except Exception as e:
            logger.error(f"獲取現有隧道信息失敗: {e}")
            raise
    
    def get_persistent_url(self):
        """獲取固定URL"""
        return self.persistent_url
    
    def get_persistent_config(self):
        """獲取持久化配置"""
        return {
            'tunnel_name': self.tunnel_name,
            'tunnel_id': self.tunnel_id,
            'persistent_url': self.persistent_url,
            'tunnel_type': self.tunnel_type,
            'port': self.port,
            'created_at': time.time()
        }
    
    def _update_persistent_config(self):
        """更新持久化配置"""
        config = self.get_persistent_config()
        config_file = f"tunnel_config_{self.tunnel_type}.json"
        config_path = os.path.join(os.path.dirname(__file__), config_file)
        
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            logger.info(f"💾 已更新{self.tunnel_type}隧道持久化配置")
        except Exception as e:
            logger.error(f"更新持久化配置失敗: {e}")
    
    def ensure_persistent_connection(self):
        """確保持久化連接（重連時使用相同URL）"""
        if self.status != "running":
            logger.info("🔄 重新建立固定URL隧道連接...")
            return self.start_tunnel()
        return True
    
    def get_status(self):
        """獲取隧道狀態（包含固定URL信息）"""
        base_status = super().get_status()
        base_status.update({
            'persistent_url': self.persistent_url,
            'tunnel_id': self.tunnel_id,
            'tunnel_name': self.tunnel_name,
            'url_fixed': True,
            'tunnel_type': self.tunnel_type
        })
        return base_status