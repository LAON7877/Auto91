#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto91 依賴管理器
負責檢查和自動安裝系統所需的Python套件
作者: 資深Python工程師設計
"""

import os
import sys
import subprocess
import importlib
import logging
from pathlib import Path
from typing import List, Dict, Tuple, Optional

# 設置日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('dependency_manager')

class DependencyManager:
    """依賴管理器類"""
    
    def __init__(self, project_root: Optional[str] = None):
        """初始化依賴管理器"""
        if project_root:
            self.project_root = Path(project_root)
        else:
            # 自動檢測項目根目錄
            current_file = Path(__file__).resolve()
            self.project_root = current_file.parent.parent  # server 目錄
        
        self.index_dir = self.project_root / "index"
        self.requirements_file = self.index_dir / "requirements.txt"
        
        # 套件名稱映射（安裝名稱 -> 導入名稱）
        self.package_import_map = {
            'python-dotenv': 'dotenv',
            'websocket-client': 'websocket',
            'flask-cors': 'flask_cors',
            'pytz': 'pytz',
            'openpyxl': 'openpyxl',
            'requests': 'requests',
            'flask': 'flask',
            'shioaji': 'shioaji',
            'shioaji[speed]': 'shioaji',  # 效能優化版本
            'schedule': 'schedule',
            'psutil': 'psutil'
        }
        
        logger.info(f"依賴管理器初始化完成，項目根目錄: {self.project_root}")
    
    def load_requirements_from_file(self) -> List[str]:
        """從 requirements.txt 載入依賴清單"""
        dependencies = []
        
        if not self.requirements_file.exists():
            logger.warning(f"requirements.txt 不存在: {self.requirements_file}")
            return self._get_default_dependencies()
        
        try:
            with open(self.requirements_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    # 跳過註釋和空行
                    if line and not line.startswith('#'):
                        # 提取套件名稱（去除版本限制）
                        package_name = line.split('>=')[0].split('==')[0].split('[')[0].strip()
                        if package_name:
                            dependencies.append(package_name)
            
            logger.info(f"從 requirements.txt 載入 {len(dependencies)} 個依賴")
            return dependencies
            
        except Exception as e:
            logger.error(f"讀取 requirements.txt 失敗: {e}")
            return self._get_default_dependencies()
    
    def _get_default_dependencies(self) -> List[str]:
        """獲取預設依賴清單"""
        return [
            'requests', 'flask', 'openpyxl', 'shioaji[speed]', 
            'schedule', 'python-dotenv', 'websocket-client', 'pytz', 'psutil'
        ]
    
    def check_package_installed(self, package_name: str) -> bool:
        """檢查套件是否已安裝"""
        # 獲取正確的導入名稱
        import_name = self.package_import_map.get(package_name, package_name.replace('-', '_'))
        
        try:
            importlib.import_module(import_name)
            return True
        except ImportError:
            return False
    
    def install_package(self, package_name: str) -> bool:
        """安裝單個套件"""
        try:
            logger.info(f"正在安裝套件: {package_name}")
            subprocess.check_call([
                sys.executable, '-m', 'pip', 'install', 
                package_name, '--upgrade'
            ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            logger.info(f"✅ {package_name} 安裝成功")
            return True
        except subprocess.CalledProcessError as e:
            logger.error(f"❌ {package_name} 安裝失敗: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ 安裝 {package_name} 時發生異常: {e}")
            return False
    
    def check_and_install_dependencies(self, dependencies: List[str]) -> Tuple[List[str], List[str]]:
        """檢查並安裝依賴套件"""
        installed = []
        failed = []
        missing = []
        
        # 第一步：檢查哪些套件缺失
        for package in dependencies:
            if self.check_package_installed(package):
                installed.append(package)
                logger.info(f"✅ {package} 已安裝")
            else:
                missing.append(package)
                logger.warning(f"❌ {package} 未安裝")
        
        # 第二步：安裝缺失的套件
        if missing:
            logger.info(f"🔄 開始安裝 {len(missing)} 個缺失的套件...")
            
            for package in missing:
                if self.install_package(package):
                    # 重新檢查是否安裝成功
                    if self.check_package_installed(package):
                        installed.append(package)
                        logger.info(f"✅ {package} 安裝並驗證成功")
                    else:
                        failed.append(package)
                        logger.error(f"❌ {package} 安裝後驗證失敗")
                else:
                    failed.append(package)
        
        return installed, failed
    
    def check_optional_dependencies(self) -> Dict[str, bool]:
        """檢查可選依賴"""
        optional_deps = {
            'flask-cors': False,
            'pandas': False,
            'numpy': False
        }
        
        for package in optional_deps:
            optional_deps[package] = self.check_package_installed(package)
        
        return optional_deps
    
    def update_dependencies_from_requirements(self) -> bool:
        """從 requirements.txt 更新依賴"""
        try:
            dependencies = self.load_requirements_from_file()
            if not dependencies:
                logger.warning("沒有找到任何依賴")
                return True
            
            installed, failed = self.check_and_install_dependencies(dependencies)
            
            # 檢查可選依賴
            optional_status = self.check_optional_dependencies()
            missing_optional = [pkg for pkg, status in optional_status.items() if not status]
            
            # 報告結果
            logger.info(f"依賴檢查完成:")
            logger.info(f"  ✅ 已安裝: {len(installed)}")
            logger.info(f"  ❌ 失敗: {len(failed)}")
            if missing_optional:
                logger.info(f"  ⚠️ 可選依賴未安裝: {', '.join(missing_optional)}")
            
            if failed:
                logger.error(f"以下套件安裝失敗: {', '.join(failed)}")
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"更新依賴時發生錯誤: {e}")
            return False
    
    def generate_requirements_report(self) -> str:
        """生成依賴報告"""
        dependencies = self.load_requirements_from_file()
        optional_status = self.check_optional_dependencies()
        
        report = []
        report.append("=" * 50)
        report.append("Auto91 依賴狀態報告")
        report.append("=" * 50)
        
        # 必要依賴
        report.append("\n📋 必要依賴:")
        for package in dependencies:
            status = "✅" if self.check_package_installed(package) else "❌"
            report.append(f"  {status} {package}")
        
        # 可選依賴
        report.append("\n📋 可選依賴:")
        for package, status in optional_status.items():
            status_icon = "✅" if status else "⚠️"
            report.append(f"  {status_icon} {package}")
        
        report.append("\n" + "=" * 50)
        
        return "\n".join(report)


def auto_install_dependencies_on_startup() -> bool:
    """啟動時自動安裝依賴的便利函數"""
    try:
        # 創建依賴管理器實例
        manager = DependencyManager()
        
        # 執行依賴檢查和安裝
        success = manager.update_dependencies_from_requirements()
        
        if success:
            print("🎉 所有依賴檢查完成")
        else:
            print("⚠️ 部分依賴安裝失敗")
        
        return success
        
    except Exception as e:
        logger.error(f"自動依賴安裝失敗: {e}")
        return False


if __name__ == "__main__":
    print("🔧 Auto91 依賴管理器")
    print("=" * 40)
    
    manager = DependencyManager()
    
    # 生成並顯示報告
    report = manager.generate_requirements_report()
    print(report)
    
    # 執行依賴檢查
    print("\n🔄 開始依賴檢查...")
    success = manager.update_dependencies_from_requirements()
    
    if success:
        print("\n✅ 依賴管理完成")
    else:
        print("\n❌ 依賴管理過程中遇到問題")