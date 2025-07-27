#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
量化交易系統健康檢查工具
確保BTC和TX系統的完整性和性能
"""

import os
import sys
import logging
from datetime import datetime, timedelta
from trading_config import TradingConfig

# 設置日誌
logging.basicConfig(level=logging.INFO, format=TradingConfig.LOG_FORMAT)
logger = logging.getLogger(__name__)

class TradingSystemHealthCheck:
    """量化交易系統健康檢查類"""
    
    def __init__(self):
        self.issues = []
        self.warnings = []
        
    def check_directory_structure(self):
        """檢查目錄結構"""
        logger.info("🔍 檢查目錄結構...")
        
        # 檢查主目錄
        if not os.path.exists(TradingConfig.BASE_DIR):
            self.issues.append(f"主目錄不存在: {TradingConfig.BASE_DIR}")
            
        # 數據目錄會在有數據時自動創建，這裡只檢查權限
        test_dirs = [
            TradingConfig.BTC_RECORDS_DIR,
            TradingConfig.TX_RECORDS_DIR,
            TradingConfig.BTC_DATA_DIR,
            TradingConfig.TX_DATA_DIR
        ]
        
        for dir_path in test_dirs:
            parent_dir = os.path.dirname(dir_path)
            if not os.access(parent_dir, os.W_OK):
                self.issues.append(f"目錄無寫入權限: {parent_dir}")
                
    def check_module_imports(self):
        """檢查模組導入"""
        logger.info("🔍 檢查模組導入...")
        
        try:
            import trade_pairing_BTC
            logger.info("✅ BTC配對模組導入成功")
        except ImportError as e:
            self.issues.append(f"BTC配對模組導入失敗: {e}")
            
        try:
            import trade_pairing_TX
            logger.info("✅ TX配對模組導入成功")
        except ImportError as e:
            self.issues.append(f"TX配對模組導入失敗: {e}")
            
    def check_data_consistency(self):
        """檢查數據一致性"""
        logger.info("🔍 檢查數據一致性...")
        
        # 檢查BTC數據
        self._check_btc_data_consistency()
        
        # 檢查TX數據
        self._check_tx_data_consistency()
        
    def _check_btc_data_consistency(self):
        """檢查BTC數據一致性"""
        if os.path.exists(TradingConfig.BTC_RECORDS_DIR):
            try:
                from trade_pairing_BTC import get_btc_trading_statistics
                stats = get_btc_trading_statistics(date_range_days=7)
                
                if stats['total_opens'] < 0 or stats['total_covers'] < 0:
                    self.issues.append("BTC統計數據異常：負數值")
                    
                if stats['total_covers'] > stats['total_opens']:
                    self.warnings.append("BTC平倉數量超過開倉數量，可能存在配對問題")
                    
                logger.info(f"✅ BTC數據檢查完成: {stats}")
                
            except Exception as e:
                self.issues.append(f"BTC數據檢查失敗: {e}")
                
    def _check_tx_data_consistency(self):
        """檢查TX數據一致性"""
        if os.path.exists(TradingConfig.TX_RECORDS_DIR):
            try:
                from trade_pairing_TX import get_trading_statistics
                stats = get_trading_statistics(date_range_days=7)
                
                if stats['total_opens'] < 0 or stats['total_covers'] < 0:
                    self.issues.append("TX統計數據異常：負數值")
                    
                if stats['total_covers'] > stats['total_opens']:
                    self.warnings.append("TX平倉數量超過開倉數量，可能存在配對問題")
                    
                logger.info(f"✅ TX數據檢查完成: {stats}")
                
            except Exception as e:
                self.issues.append(f"TX數據檢查失敗: {e}")
                
    def check_performance_metrics(self):
        """檢查性能指標"""
        logger.info("🔍 檢查性能指標...")
        
        # 檢查磁盤空間
        import shutil
        total, used, free = shutil.disk_usage(TradingConfig.BASE_DIR)
        free_gb = free // (1024**3)
        
        if free_gb < 1:  # 少於1GB
            self.issues.append(f"磁盤空間不足: 剩餘{free_gb}GB")
        elif free_gb < 5:  # 少於5GB
            self.warnings.append(f"磁盤空間偏低: 剩餘{free_gb}GB")
            
        logger.info(f"✅ 磁盤空間檢查: 剩餘{free_gb}GB")
        
    def run_full_check(self):
        """執行完整健康檢查"""
        logger.info("🚀 開始量化交易系統健康檢查")
        logger.info("=" * 50)
        
        self.check_directory_structure()
        self.check_module_imports()
        self.check_data_consistency()
        self.check_performance_metrics()
        
        # 報告結果
        logger.info("=" * 50)
        logger.info("📊 健康檢查結果:")
        
        if not self.issues and not self.warnings:
            logger.info("🎉 系統狀態完美！所有檢查通過")
            return True
            
        if self.warnings:
            logger.info("⚠️  警告事項:")
            for warning in self.warnings:
                logger.warning(f"   • {warning}")
                
        if self.issues:
            logger.error("❌ 發現問題:")
            for issue in self.issues:
                logger.error(f"   • {issue}")
            return False
            
        logger.info("✅ 系統基本正常，但有警告事項需注意")
        return True

def main():
    """主函數"""
    health_checker = TradingSystemHealthCheck()
    success = health_checker.run_full_check()
    
    if success:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()