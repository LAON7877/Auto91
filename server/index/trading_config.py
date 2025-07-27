#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
量化交易系統配置管理
統一管理BTC和TX系統的配置參數和常量
"""

import os
from datetime import timedelta

class TradingConfig:
    """量化交易系統配置類"""
    
    # 系統基礎配置
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))  # Auto91根目錄
    SERVER_DIR = os.path.join(BASE_DIR, 'server')  # server目錄
    
    # 數據存儲配置
    DATA_RETENTION_DAYS = 30  # 數據保留天數
    CLEANUP_PROBABILITY = 0.1  # 清理執行機率（10%）
    
    # 目錄配置
    BTC_RECORDS_DIR = os.path.join(SERVER_DIR, 'traderecordsBTC')
    TX_RECORDS_DIR = os.path.join(SERVER_DIR, 'traderecordsTX')
    BTC_DATA_DIR = os.path.join(SERVER_DIR, 'tradedataBTC')
    TX_DATA_DIR = os.path.join(SERVER_DIR, 'tradedataTX')
    
    # 交易配對配置
    PAIRING_LOOKBACK_DAYS = 30  # 配對回溯天數
    POSITION_PRECISION_BTC = 8  # BTC持倉精度
    POSITION_PRECISION_TX = 0   # TX持倉精度（整數）
    
    # BTC交易配置
    BTC_SYMBOL = 'BTCUSDT'
    BTC_MIN_PRECISION = 0.00000001  # BTC最小精度
    
    # TX合約配置
    TX_POINT_VALUES = {
        'TXF': 200,  # 大台點值
        'MXF': 50,   # 小台點值
        'TMF': 50    # 微台點值
    }
    
    # 日誌配置
    LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    
    # 性能優化配置
    JSON_CACHE_SIZE = 100  # JSON文件緩存大小
    BATCH_PROCESS_SIZE = 50  # 批處理大小
    
    @classmethod
    def get_contract_point_value(cls, contract_code):
        """獲取合約點值"""
        base_contract = contract_code[:3]
        return cls.TX_POINT_VALUES.get(base_contract, 50)
    
    @classmethod
    def is_btc_position_zero(cls, quantity):
        """判斷BTC持倉是否為零（考慮精度）"""
        return abs(quantity) <= cls.BTC_MIN_PRECISION
    
    @classmethod
    def format_btc_quantity(cls, quantity):
        """格式化BTC數量"""
        return f"{float(quantity):.8f}"