#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto91 線上自動更新系統
功能：
1. 檢查GitHub最新版本
2. 自動下載並更新文件
3. 備份與回滾機制
4. 用戶友好的更新體驗
"""

import os
import sys
import json
import requests
import zipfile
import shutil
import time
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import tempfile
import hashlib
import platform

# 設置編碼
sys.stdout.reconfigure(encoding='utf-8')

# ========== 日誌配置 ==========
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('updater_system')

class AutoUpdater:
    """Auto91 自動更新器"""
    
    def __init__(self, project_root=None, silent_mode=False):
        """初始化更新器
        
        Args:
            project_root: 專案根目錄路徑
        """
        if project_root is None:
            # 取得當前目錄（server目錄）
            current_file = Path(__file__).resolve()
            self.project_root = current_file.parent
        else:
            self.project_root = Path(project_root)
        
        self.version_file = self.project_root / "version.json"
        self.backup_dir = self.project_root / "backup_update"
        self.temp_dir = None
        self.silent_mode = silent_mode
        self.lock_file = self.project_root / ".update_check.lock"
        
        # 載入當前版本信息
        self.current_version = self._load_version_info()
        
        # 靜默初始化，不輸出詳細信息
    
    def _load_version_info(self) -> Dict:
        """載入版本信息"""
        try:
            if self.version_file.exists():
                with open(self.version_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                # 如果版本文件不存在，創建默認版本
                default_version = {
                    "version": "1.0.0",
                    "build": "20250101001",
                    "release_date": "2025-01-01",
                    "description": "初始版本",
                    "github_repo": "your-username/Auto91",
                    "update_url": "https://api.github.com/repos/your-username/Auto91/releases/latest"
                }
                self._save_version_info(default_version)
                return default_version
        except Exception as e:
            return {}
    
    def _save_version_info(self, version_info: Dict):
        """保存版本信息"""
        try:
            with open(self.version_file, 'w', encoding='utf-8') as f:
                json.dump(version_info, f, ensure_ascii=False, indent=2)
        except Exception as e:
            pass
    
    def check_for_updates(self) -> Tuple[bool, Dict]:
        """檢查是否有新版本
        
        Returns:
            Tuple[bool, Dict]: (是否有更新, 最新版本信息)
        """
        # 檢查是否已經有其他進程在檢查更新
        if self._is_update_check_running():
            if not self.silent_mode:
                logger.info("其他進程正在檢查更新，跳過重複檢查")
            return False, {}
        
        # 創建鎖文件
        lock_acquired = self._acquire_update_lock()
        if not lock_acquired:
            if not self.silent_mode:
                logger.info("無法獲取更新檢查鎖，可能有其他進程正在檢查")
            return False, {}
        
        try:
            if not self.silent_mode:
                logger.info("檢查線上最新版本...")
            
            # 獲取GitHub API URL
            update_url = self.current_version.get("update_url")
            if not update_url:
                logger.info("更新URL未配置")
                return False, {}
            
            # 請求GitHub API
            headers = {
                'User-Agent': 'Auto91-Updater/1.0',
                'Accept': 'application/vnd.github.v3+json'
            }
            
            response = requests.get(update_url, headers=headers, timeout=10)
            response.raise_for_status()
            
            latest_release = response.json()
            latest_version = latest_release.get('tag_name', '').lstrip('v')
            
            if not latest_version:
                logger.info("無法獲取最新版本信息")
                return False, {}
            
            current_version = self.current_version.get('version', '0.0.0')
            
            logger.info(f"當前版本: {current_version}")
            logger.info(f"最新版本: {latest_version}")
            
            # 比較版本
            has_update = self._compare_versions(current_version, latest_version)
            
            if has_update:
                logger.info("發現新版本可用！")
                return True, {
                    'version': latest_version,
                    'name': latest_release.get('name', ''),
                    'body': latest_release.get('body', ''),
                    'published_at': latest_release.get('published_at', ''),
                    'download_url': latest_release.get('zipball_url', ''),
                    'html_url': latest_release.get('html_url', '')
                }
            else:
                if not self.silent_mode:
                    logger.info("當前版本已是最新版本")
                return False, {}
                
        except requests.RequestException as e:
            if "404" in str(e):
                repo_name = self.current_version.get("github_repo", "未知")
                logger.info(f"GitHub Repository '{repo_name}' 尚未建立或無Release，跳過更新檢查")
                logger.info(f"請確認Repository名稱是否正確，或在GitHub上創建對應的Repository和Release")
            else:
                logger.error(f"網絡請求失敗: {e}")
            return False, {}
        except Exception as e:
            if not self.silent_mode:
                logger.error(f"檢查更新失敗: {e}")
            return False, {}
        finally:
            # 釋放鎖
            self._release_update_lock()
    
    def _compare_versions(self, current: str, latest: str) -> bool:
        """比較版本號
        
        Args:
            current: 當前版本
            latest: 最新版本
        
        Returns:
            bool: True如果最新版本更新
        """
        try:
            # 簡單的版本比較（假設格式為 x.y.z）
            current_parts = [int(x) for x in current.split('.')]
            latest_parts = [int(x) for x in latest.split('.')]
            
            # 補齊版本號長度
            max_len = max(len(current_parts), len(latest_parts))
            current_parts.extend([0] * (max_len - len(current_parts)))
            latest_parts.extend([0] * (max_len - len(latest_parts)))
            
            for i in range(max_len):
                if latest_parts[i] > current_parts[i]:
                    return True
                elif latest_parts[i] < current_parts[i]:
                    return False
            
            return False  # 版本相同
            
        except Exception as e:
            logger.error(f"版本比較失敗: {e}")
            return False
    
    def download_update(self, release_info: Dict) -> bool:
        """下載更新文件
        
        Args:
            release_info: 版本發佈信息
        
        Returns:
            bool: 是否下載成功
        """
        try:
            download_url = release_info.get('download_url')
            if not download_url:
                logger.info("下載URL不可用")
                return False
            
            # 創建臨時目錄
            self.temp_dir = tempfile.mkdtemp(prefix='auto91_update_')
            temp_zip = Path(self.temp_dir) / "update.zip"
            
            # 下載更新檔案
            
            # 下載文件
            response = requests.get(download_url, stream=True, timeout=30)
            response.raise_for_status()
            
            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            
            with open(temp_zip, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        
            
            # 解壓縮文件
            extract_dir = Path(self.temp_dir) / "extracted"
            extract_dir.mkdir(exist_ok=True)
            
            with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
            
            return True
            
        except Exception as e:
            self._cleanup_temp()
            return False
    
    def backup_current_version(self) -> bool:
        """備份當前版本
        
        Returns:
            bool: 是否備份成功
        """
        try:
            # 創建備份目錄
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = self.backup_dir / f"backup_{timestamp}"
            backup_path.mkdir(parents=True, exist_ok=True)
            
            # 獲取需要備份的文件列表
            files_to_backup = self.current_version.get('required_files', [])
            files_to_backup.extend([
                'version.json',
                'start.bat'
            ])
            
            backed_up_files = []
            for file_path in files_to_backup:
                src_file = self.project_root / file_path
                if src_file.exists():
                    # 創建目標目錄
                    dst_file = backup_path / file_path
                    dst_file.parent.mkdir(parents=True, exist_ok=True)
                    
                    # 複製文件
                    shutil.copy2(src_file, dst_file)
                    backed_up_files.append(file_path)
            
            # 保存備份信息
            backup_info = {
                'timestamp': timestamp,
                'version': self.current_version.get('version', '未知'),
                'files': backed_up_files,
                'backup_path': str(backup_path)
            }
            
            backup_info_file = backup_path / "backup_info.json"
            with open(backup_info_file, 'w', encoding='utf-8') as f:
                json.dump(backup_info, f, ensure_ascii=False, indent=2)
            
            return True
            
        except Exception as e:
            return False
    
    def apply_update(self, release_info: Dict) -> bool:
        """應用更新
        
        Args:
            release_info: 版本發佈信息
        
        Returns:
            bool: 是否更新成功
        """
        try:
            if not self.temp_dir:
                return False
            
            extract_dir = Path(self.temp_dir) / "extracted"
            if not extract_dir.exists():
                return False
            
            # 找到解壓後的主目錄（通常是第一個目錄）
            extracted_items = list(extract_dir.iterdir())
            if len(extracted_items) == 1 and extracted_items[0].is_dir():
                source_dir = extracted_items[0]
            else:
                source_dir = extract_dir
            
            # 獲取需要更新的文件
            files_to_update = self.current_version.get('required_files', [])
            files_to_update.extend(['version.json'])
            
            updated_files = []
            for file_path in files_to_update:
                src_file = source_dir / file_path
                dst_file = self.project_root / file_path
                
                if src_file.exists():
                    # 創建目標目錄
                    dst_file.parent.mkdir(parents=True, exist_ok=True)
                    
                    # 複製文件
                    shutil.copy2(src_file, dst_file)
                    updated_files.append(file_path)
            
            # 更新版本信息
            new_version_info = self.current_version.copy()
            new_version_info.update({
                'version': release_info.get('version', '未知'),
                'build': datetime.now().strftime("%Y%m%d%H%M"),
                'release_date': datetime.now().strftime("%Y-%m-%d"),
                'description': release_info.get('name', '線上更新'),
                'updated_at': datetime.now().isoformat(),
                'updated_files': updated_files
            })
            
            self._save_version_info(new_version_info)
            self.current_version = new_version_info
            
            return True
            
        except Exception as e:
            return False
    
    def rollback_update(self, backup_path: str = None) -> bool:
        """回滾到備份版本
        
        Args:
            backup_path: 備份路徑，如果未指定則使用最新備份
        
        Returns:
            bool: 是否回滾成功
        """
        try:
            if not backup_path:
                # 尋找最新的備份
                if not self.backup_dir.exists():
                    return False
                
                backups = [d for d in self.backup_dir.iterdir() if d.is_dir() and d.name.startswith('backup_')]
                if not backups:
                    return False
                
                # 選擇最新的備份
                latest_backup = max(backups, key=lambda x: x.name)
                backup_path = latest_backup
            else:
                backup_path = Path(backup_path)
            
            # 載入備份信息
            backup_info_file = backup_path / "backup_info.json"
            if backup_info_file.exists():
                with open(backup_info_file, 'r', encoding='utf-8') as f:
                    backup_info = json.load(f)
                files_to_restore = backup_info.get('files', [])
            else:
                # 如果沒有備份信息，嘗試恢復所有文件
                files_to_restore = [f.relative_to(backup_path) for f in backup_path.rglob('*') if f.is_file() and f.name != 'backup_info.json']
            
            # 恢復文件
            restored_files = []
            for file_path in files_to_restore:
                src_file = backup_path / file_path
                dst_file = self.project_root / file_path
                
                if src_file.exists():
                    # 創建目標目錄
                    dst_file.parent.mkdir(parents=True, exist_ok=True)
                    
                    # 複製文件
                    shutil.copy2(src_file, dst_file)
                    restored_files.append(str(file_path))
            
            # 重新載入版本信息
            self.current_version = self._load_version_info()
            
            return True
            
        except Exception as e:
            return False
    
    def _cleanup_temp(self):
        """清理臨時文件"""
        if self.temp_dir and Path(self.temp_dir).exists():
            try:
                shutil.rmtree(self.temp_dir)
            except Exception as e:
                pass
    
    def update_flow(self, auto_confirm: bool = False) -> bool:
        """完整的更新流程
        
        Args:
            auto_confirm: 是否自動確認更新
        
        Returns:
            bool: 是否更新成功
        """
        try:
            
            # 1. 檢查更新
            has_update, release_info = self.check_for_updates()
            if not has_update:
                return True  # 沒有更新也算成功
            
            # 2. 詢問用戶是否更新
            if not auto_confirm:
                logger.info(f"發現新版本: {release_info.get('version', '未知')}")
                choice = input("是否立即更新？ (y/n): ").lower().strip()
                if choice not in ['y', 'yes', '是']:
                    return False
            else:
                # 自動確認模式下顯示友善的更新提示
                logger.info(f"發現新版本 {release_info.get('version', '未知')}")
                logger.info("正在自動更新中，請稍候...")
            
            # 3. 備份當前版本
            if not self.backup_current_version():
                return False
            
            # 4. 下載更新
            if not self.download_update(release_info):
                return False
            
            # 5. 應用更新
            if not self.apply_update(release_info):
                self.rollback_update()
                return False
            
            # 6. 清理臨時文件
            self._cleanup_temp()
            
            logger.info("更新完成！請重新啟動程式以使用新版本")
            
            return True
            
        except Exception as e:
            self._cleanup_temp()
            return False
    
    def _is_update_check_running(self) -> bool:
        """檢查是否已有更新檢查在進行中"""
        return self.lock_file.exists()
    
    def _acquire_update_lock(self) -> bool:
        """獲取更新檢查鎖（Windows兼容）"""
        try:
            if self.lock_file.exists():
                # 檢查鎖文件是否過期（超過5分鐘）
                try:
                    lock_time = self.lock_file.stat().st_mtime
                    current_time = time.time()
                    if current_time - lock_time > 300:  # 5分鐘
                        self.lock_file.unlink()  # 刪除過期鎖
                    else:
                        return False
                except:
                    # 如果無法讀取鎖文件，刪除它
                    try:
                        self.lock_file.unlink()
                    except:
                        pass
            
            # 創建鎖文件（Windows兼容方式）
            try:
                with open(self.lock_file, 'x') as f:  # 'x' 模式只在文件不存在時創建
                    f.write(f"{os.getpid()}:{time.time()}")
                return True
            except FileExistsError:
                # 文件已存在，表示另一個進程正在執行更新檢查
                return False
            
        except Exception as e:
            return False
    
    def _release_update_lock(self):
        """釋放更新檢查鎖"""
        try:
            if self.lock_file.exists():
                self.lock_file.unlink()
        except Exception as e:
            pass

def check_and_update(project_root=None, auto_confirm=False, silent_mode=False) -> bool:
    """便利函數：檢查並執行更新
    
    Args:
        project_root: 專案根目錄
        auto_confirm: 是否自動確認更新
        silent_mode: 是否靜默模式（避免重複日誌）
    
    Returns:
        bool: 是否成功（無更新或更新成功都算成功）
    """
    updater = AutoUpdater(project_root, silent_mode=silent_mode)
    return updater.update_flow(auto_confirm)

if __name__ == "__main__":
    # 手動更新模式
    check_and_update(auto_confirm=False)