#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto91 自動依賴管理系統
作者設計理念：讓新用戶零門檻使用系統

核心功能：
1. 啟動時自動檢查缺失套件
2. 一鍵自動安裝所有依賴 
3. 更新時同步處理新依賴
4. 用戶友好的進度顯示
5. 網絡錯誤處理與重試機制
6. 離線包支援（預留）
"""

import os
import sys
import subprocess
import importlib
import json
import time
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import threading

# 設置編碼
sys.stdout.reconfigure(encoding='utf-8')

class DependencyManager:
    """自動依賴管理器"""
    
    def __init__(self, project_root=None):
        """初始化依賴管理器"""
        if project_root is None:
            current_file = Path(__file__).resolve()
            self.project_root = current_file.parent
        else:
            self.project_root = Path(project_root)
        
        self.requirements_file = self.project_root / "requirements.txt"
        self.installed_packages_cache = set()
        
        # 系統核心依賴列表（按重要性排序）
        self.core_dependencies = [
            "requests>=2.25.0",
            "flask>=2.0.0", 
            "openpyxl>=3.0.0",
            "shioaji>=1.0.0",
            "schedule>=1.0.0",
            "python-dotenv>=0.19.0",
            "websocket-client>=1.0.0",
            "pytz>=2021.0"
        ]
        
        # 可選依賴（用於增強功能）
        self.optional_dependencies = [
            "pandas>=1.3.0",
            "numpy>=1.21.0", 
            "matplotlib>=3.5.0"
        ]
    
    def create_requirements_file(self):
        """創建 requirements.txt 文件"""
        try:
            all_deps = self.core_dependencies + self.optional_dependencies
            
            with open(self.requirements_file, 'w', encoding='utf-8') as f:
                f.write("# Auto91 系統依賴套件\n")
                f.write("# 核心依賴 - 必須安裝\n")
                for dep in self.core_dependencies:
                    f.write(f"{dep}\n")
                
                f.write("\n# 可選依賴 - 用於增強功能\n")
                for dep in self.optional_dependencies:
                    f.write(f"# {dep}\n")  # 註解掉可選依賴
            
            print("已創建 requirements.txt 文件")
            return True
            
        except Exception as e:
            print(f"創建 requirements.txt 失敗: {e}")
            return False
    
    def check_package_installed(self, package_name: str) -> bool:
        """檢查套件是否已安裝"""
        # 處理版本號 (例如: requests>=2.25.0 -> requests)
        clean_name = package_name.split('>=')[0].split('==')[0].split('<')[0].strip()
        
        # 檢查緩存
        if clean_name in self.installed_packages_cache:
            return True
        
        try:
            importlib.import_module(clean_name)
            self.installed_packages_cache.add(clean_name)
            return True
        except ImportError:
            # 處理特殊套件名稱映射
            package_mapping = {
                'python-dotenv': 'dotenv',
                'websocket-client': 'websocket'
            }
            
            if clean_name in package_mapping:
                try:
                    importlib.import_module(package_mapping[clean_name])
                    self.installed_packages_cache.add(clean_name)
                    return True
                except ImportError:
                    pass
            
            return False
    
    def get_missing_packages(self, package_list: List[str]) -> List[str]:
        """獲取缺失的套件列表"""
        missing = []
        
        print("檢查系統依賴套件...")
        for package in package_list:
            package_name = package.split('>=')[0].split('==')[0].split('<')[0].strip()
            
            if not self.check_package_installed(package):
                missing.append(package)
                print(f"  缺失: {package_name}")
            else:
                print(f"  已安裝: {package_name}")
        
        return missing
    
    def install_package(self, package: str, retry_count: int = 3) -> bool:
        """安裝單個套件（帶重試機制）"""
        package_name = package.split('>=')[0].split('==')[0].split('<')[0].strip()
        
        for attempt in range(retry_count):
            try:
                print(f"正在安裝 {package_name}... (嘗試 {attempt + 1}/{retry_count})")
                
                # 使用當前Python環境的pip
                cmd = [sys.executable, "-m", "pip", "install", package, "--quiet", "--no-warn-script-location"]
                
                # 在Windows上使用額外的參數避免權限問題
                if os.name == 'nt':
                    cmd.extend(["--user"])
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300  # 5分鐘超時
                )
                
                if result.returncode == 0:
                    print(f"  {package_name} 安裝成功")
                    # 清除緩存，強制重新檢查
                    if package_name in self.installed_packages_cache:
                        self.installed_packages_cache.remove(package_name)
                    return True
                else:
                    print(f"  {package_name} 安裝失敗: {result.stderr}")
                    
            except subprocess.TimeoutExpired:
                print(f"  {package_name} 安裝超時")
            except Exception as e:
                print(f"  {package_name} 安裝異常: {e}")
            
            if attempt < retry_count - 1:
                wait_time = (attempt + 1) * 2  # 2, 4, 6秒
                print(f"  {wait_time}秒後重試...")
                time.sleep(wait_time)
        
        return False
    
    def install_packages_batch(self, packages: List[str]) -> Tuple[List[str], List[str]]:
        """批量安裝套件"""
        if not packages:
            return [], []
        
        print(f"\n開始安裝 {len(packages)} 個依賴套件...")
        print("=" * 60)
        
        success_packages = []
        failed_packages = []
        
        for i, package in enumerate(packages, 1):
            package_name = package.split('>=')[0].split('==')[0].split('<')[0].strip()
            print(f"\n[{i}/{len(packages)}] 處理 {package_name}")
            
            if self.install_package(package):
                success_packages.append(package)
            else:
                failed_packages.append(package)
                print(f"  {package_name} 安裝失敗，將在稍後重試")
        
        return success_packages, failed_packages
    
    def auto_install_dependencies(self, force_reinstall: bool = False) -> bool:
        """自動安裝依賴套件"""
        try:
            print("\nAuto91 自動依賴安裝系統")
            print("=" * 60)
            
            # 1. 創建 requirements.txt（如果不存在）
            if not self.requirements_file.exists():
                print("創建系統依賴配置文件...")
                self.create_requirements_file()
            
            # 2. 檢查缺失的核心依賴
            if force_reinstall:
                missing_packages = self.core_dependencies
                print("強制重新安裝所有核心依賴...")
            else:
                missing_packages = self.get_missing_packages(self.core_dependencies)
            
            if not missing_packages:
                print("所有核心依賴已安裝完成")
                return True
            
            # 3. 安裝缺失的套件
            print(f"\n發現 {len(missing_packages)} 個缺失的核心依賴")
            print("正在自動安裝，請稍候...")
            
            success_packages, failed_packages = self.install_packages_batch(missing_packages)
            
            # 4. 處理安裝失敗的套件
            if failed_packages:
                print(f"\n有 {len(failed_packages)} 個套件安裝失敗，嘗試重新安裝...")
                
                retry_success, retry_failed = self.install_packages_batch(failed_packages)
                success_packages.extend(retry_success)
                failed_packages = retry_failed
            
            # 5. 結果報告
            print("\n" + "=" * 60)
            print("安裝結果報告")
            print("=" * 60)
            
            if success_packages:
                print(f"成功安裝 {len(success_packages)} 個套件:")
                for pkg in success_packages:
                    pkg_name = pkg.split('>=')[0].split('==')[0].split('<')[0].strip()
                    print(f"  - {pkg_name}")
            
            if failed_packages:
                print(f"\n安裝失敗 {len(failed_packages)} 個套件:")
                for pkg in failed_packages:
                    pkg_name = pkg.split('>=')[0].split('==')[0].split('<')[0].strip()
                    print(f"  - {pkg_name}")
                
                print(f"\n解決建議:")
                print(f"  1. 檢查網絡連接是否正常")
                print(f"  2. 嘗試手動運行: pip install {' '.join(failed_packages)}")
                print(f"  3. 如問題持續，請聯繫技術支援")
                
                # 如果關鍵套件安裝失敗，返回 False
                critical_packages = ['requests', 'flask']
                failed_critical = [pkg for pkg in failed_packages 
                                 if any(critical in pkg.lower() for critical in critical_packages)]
                
                if failed_critical:
                    print(f"\n關鍵套件安裝失敗，系統可能無法正常運行")
                    return False
            
            print(f"\n依賴安裝完成！系統即將啟動...")
            return True
            
        except Exception as e:
            print(f"自動安裝依賴過程中發生錯誤: {e}")
            return False
    
    def check_and_install_on_startup(self) -> bool:
        """啟動時檢查並安裝依賴"""
        try:
            # 快速檢查關鍵依賴
            critical_packages = ['requests', 'flask']
            missing_critical = []
            
            for pkg in critical_packages:
                if not self.check_package_installed(pkg):
                    missing_critical.append(pkg)
            
            # 如果關鍵依賴缺失，進行完整安裝
            if missing_critical:
                print(f"檢測到關鍵依賴缺失: {', '.join(missing_critical)}")
                print("正在啟動自動安裝程序...")
                return self.auto_install_dependencies()
            else:
                # 快速檢查其他依賴
                missing_others = self.get_missing_packages(self.core_dependencies)
                if missing_others:
                    print(f"檢測到 {len(missing_others)} 個依賴缺失，正在後台安裝...")
                    # 後台安裝非關鍵依賴
                    threading.Thread(
                        target=self.auto_install_dependencies,
                        daemon=True
                    ).start()
                
                return True
                
        except Exception as e:
            print(f"啟動依賴檢查失敗: {e}")
            return False
    
    def update_dependencies_from_requirements(self) -> bool:
        """從 requirements.txt 更新依賴"""
        try:
            if not self.requirements_file.exists():
                print("requirements.txt 不存在，創建新文件...")
                self.create_requirements_file()
                return True
            
            print("讀取 requirements.txt...")
            
            with open(self.requirements_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # 解析依賴列表
            requirements = []
            for line in lines:
                line = line.strip()
                if line and not line.startswith('#') and not line.startswith('-'):
                    requirements.append(line)
            
            if not requirements:
                print("requirements.txt 中沒有找到有效的依賴")
                return True
            
            # 檢查並安裝
            missing = self.get_missing_packages(requirements)
            if missing:
                print(f"發現 {len(missing)} 個新依賴需要安裝...")
                success, failed = self.install_packages_batch(missing)
                return len(failed) == 0
            else:
                print("所有依賴都已安裝")
                return True
                
        except Exception as e:
            print(f"更新依賴失敗: {e}")
            return False

# ========== 便利函數 ==========
def auto_install_dependencies_on_startup(project_root=None) -> bool:
    """啟動時自動安裝依賴的便利函數"""
    manager = DependencyManager(project_root)
    return manager.check_and_install_on_startup()

def create_requirements_file(project_root=None) -> bool:
    """創建 requirements.txt 的便利函數"""
    manager = DependencyManager(project_root)
    return manager.create_requirements_file()

def install_all_dependencies(project_root=None, force_reinstall=False) -> bool:
    """安裝所有依賴的便利函數"""
    manager = DependencyManager(project_root)
    return manager.auto_install_dependencies(force_reinstall)

if __name__ == "__main__":
    print("Auto91 自動依賴管理系統")
    print("讓新用戶零門檻使用系統")
    print()
    
    manager = DependencyManager()
    
    choice = input("選擇操作：\n1. 檢查並安裝依賴\n2. 創建 requirements.txt\n3. 強制重新安裝所有依賴\n請輸入選項 (1-3): ").strip()
    
    if choice == "1":
        success = manager.auto_install_dependencies()
    elif choice == "2":
        success = manager.create_requirements_file()
    elif choice == "3":
        success = manager.auto_install_dependencies(force_reinstall=True)
    else:
        print("無效選項")
        success = False
    
    if success:
        print("操作完成")
    else:
        print("操作失敗")