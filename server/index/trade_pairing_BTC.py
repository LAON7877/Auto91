# BTC交易配對系統 - 開倉平倉JSON記錄機制
# 採用量化交易最佳實踐：FIFO配對、高性能緩存、統一配置管理
import json
import os
from datetime import datetime, timedelta
import logging
from trading_config import TradingConfig

logger = logging.getLogger(__name__)

# 使用統一配置管理
BTC_TRADE_RECORDS_DIR = TradingConfig.BTC_RECORDS_DIR

def get_today_str():
    """獲取今日日期字串"""
    return datetime.now().strftime('%Y%m%d')

def load_json_file(file_path):
    """載入JSON檔案"""
    if not os.path.exists(file_path):
        return []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"載入BTC JSON檔案失敗 {file_path}: {e}")
        return []

def save_json_file(file_path, data):
    """儲存JSON檔案"""
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"儲存BTC JSON檔案失敗 {file_path}: {e}")
        return False

def generate_btc_trade_id(action, oc_type):
    """生成唯一BTC交易ID"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]  # 精確到毫秒
    return f"BTC_{oc_type}_{action}_{timestamp}"

def calculate_btc_pnl(open_price, close_price, quantity, close_action):
    """計算BTC損益（美元計算）"""
    try:
        # BTC是美元計價，直接計算價差
        if close_action.upper() == "SELL":  # 平多倉
            price_diff = close_price - open_price
        else:  # close_action == "BUY", 平空倉
            price_diff = open_price - close_price
            
        pnl = price_diff * quantity
        logger.info(f"BTC損益計算: {close_action} {quantity}BTC, 開倉:{open_price} 平倉:{close_price} 價差:{price_diff} 損益:${pnl}")
        return round(pnl, 2)
        
    except Exception as e:
        logger.error(f"計算BTC損益失敗: {e}")
        return 0.0

def record_btc_opening_trade(action, quantity, price, order_id, source='manual', leverage=None):
    """記錄BTC開倉交易
    
    Args:
        action: 交易方向 (BUY/SELL)
        quantity: 數量 (BTC)
        price: 成交價格 (USDT)
        order_id: 訂單ID
        source: 交易來源 ('manual'/'webhook')
        leverage: 訂單槓桿倍數
    """
    try:
        trade_id = generate_btc_trade_id(action, "Open")
        
        trade_record = {
            "trade_id": trade_id,
            "timestamp": datetime.now().isoformat(),
            "symbol": "BTCUSDT",
            "action": action.upper(),  # BUY/SELL
            "oc_type": "Open",
            "quantity": float(quantity),
            "price": float(price),
            "order_id": str(order_id),
            "source": source,  # 添加交易來源
            "leverage": leverage,  # 添加槓桿倍數
            "pair_key": f"BTC_{action.upper()}",
            "remaining_quantity": float(quantity),  # 剩餘未平倉數量
            "status": "open",  # open/partial_covered/fully_covered
            "matched_covers": []  # 被配對的平倉記錄
        }
        
        # 儲存到當日開倉記錄（有數據時才創建目錄）
        today = get_today_str()
        os.makedirs(BTC_TRADE_RECORDS_DIR, exist_ok=True)  # 只在有數據時創建
        open_file = os.path.join(BTC_TRADE_RECORDS_DIR, f'btc_open_positions_{today}.json')
        
        open_positions = load_json_file(open_file)
        open_positions.append(trade_record)
        
        if save_json_file(open_file, open_positions):
            logger.info(f"✅ BTC開倉記錄已儲存: {trade_id} - {action} {quantity}BTC @ ${price}")
            return trade_id
        else:
            logger.error(f"❌ BTC開倉記錄儲存失敗: {trade_id}")
            return None
            
    except Exception as e:
        logger.error(f"記錄BTC開倉交易失敗: {e}")
        return None

def record_btc_covering_trade(action, quantity, price, order_id, source='manual', leverage=None):
    """記錄BTC平倉交易並自動配對
    
    Args:
        action: 交易方向 (BUY/SELL)
        quantity: 數量 (BTC)
        price: 成交價格 (USDT)
        order_id: 訂單ID
        source: 交易來源 ('manual'/'webhook')
        leverage: 訂單槓桿倍數
        
    Returns:
        dict: 平倉記錄（包含配對信息）
    """
    try:
        # 確定需要配對的開倉方向
        required_open_action = "SELL" if action.upper() == "BUY" else "BUY"
        pair_key = f"BTC_{required_open_action}"
        
        logger.info(f"BTC平倉配對開始: {action} {quantity}BTC，尋找開倉方向: {required_open_action}")
        
        # 載入過去30天的開倉記錄進行配對（按時間排序，FIFO原則）
        matched_opens = []
        remaining_to_cover = float(quantity)
        
        # 收集所有可配對的開倉記錄
        available_opens = []
        
        for i in range(TradingConfig.PAIRING_LOOKBACK_DAYS):  # 查找過去30天的開倉記錄
            check_date = datetime.now() - timedelta(days=i)
            date_str = check_date.strftime('%Y%m%d')
            open_file = os.path.join(BTC_TRADE_RECORDS_DIR, f'btc_open_positions_{date_str}.json')
            
            if not os.path.exists(open_file):
                continue
                
            open_positions = load_json_file(open_file)
            
            for open_pos in open_positions:
                if (open_pos["pair_key"] == pair_key and 
                    open_pos["remaining_quantity"] > 0):
                    # 添加檔案路徑信息，便於後續更新
                    open_pos["_file_path"] = open_file
                    available_opens.append(open_pos)
        
        # 按時間排序（FIFO：先進先出）
        available_opens.sort(key=lambda x: x["timestamp"])
        
        logger.info(f"找到{len(available_opens)}筆可配對的BTC開倉記錄")
        
        # 逐筆配對，支援部分平倉
        for open_pos in available_opens:
            if remaining_to_cover <= 0:
                break
                
            # 計算本次配對數量
            matched_qty = min(open_pos["remaining_quantity"], remaining_to_cover)
            
            # 計算損益
            pnl = calculate_btc_pnl(
                open_pos["price"], price, matched_qty, action
            )
            
            # 記錄配對信息
            match_info = {
                "open_trade_id": open_pos["trade_id"],
                "open_timestamp": open_pos["timestamp"],
                "open_price": open_pos["price"],
                "matched_quantity": matched_qty,
                "pnl": pnl
            }
            matched_opens.append(match_info)
            
            # 更新開倉記錄狀態（使用配置中的精度）
            open_pos["remaining_quantity"] -= matched_qty
            if TradingConfig.is_btc_position_zero(open_pos["remaining_quantity"]):
                open_pos["status"] = "fully_covered"
                open_pos["remaining_quantity"] = 0  # 確保為0
                logger.info(f"✅ BTC完全平倉: {open_pos['trade_id']} 全部{open_pos['quantity']}BTC已平倉")
            else:
                open_pos["status"] = "partial_covered"
                logger.info(f"🔸 BTC部分平倉: {open_pos['trade_id']} 平倉{matched_qty}BTC，剩餘{open_pos['remaining_quantity']}BTC")
                
            # 在開倉記錄中添加配對信息
            cover_trade_id = generate_btc_trade_id(action, "Cover")
            cover_info = {
                "cover_trade_id": cover_trade_id,
                "cover_timestamp": datetime.now().isoformat(),
                "cover_price": price,
                "matched_quantity": matched_qty,
                "pnl": pnl
            }
            open_pos["matched_covers"].append(cover_info)
            
            remaining_to_cover -= matched_qty
            
            logger.info(f"BTC配對成功: {matched_qty}BTC 開倉@${open_pos['price']} 平倉@${price} 損益:${pnl}")
        
        # 更新所有修改過的開倉記錄檔案
        updated_files = {}
        for open_pos in available_opens:
            if "_file_path" in open_pos:
                file_path = open_pos["_file_path"]
                if file_path not in updated_files:
                    updated_files[file_path] = load_json_file(file_path)
                
                # 找到對應記錄並更新
                for i, record in enumerate(updated_files[file_path]):
                    if record["trade_id"] == open_pos["trade_id"]:
                        updated_files[file_path][i] = {k: v for k, v in open_pos.items() if k != "_file_path"}
                        break
        
        # 儲存所有更新的檔案
        for file_path, records in updated_files.items():
            save_json_file(file_path, records)
            logger.info(f"📝 已更新BTC開倉記錄檔案: {file_path}")
        
        # 建立平倉交易記錄
        cover_trade_id = generate_btc_trade_id(action, "Cover")
        cover_record = {
            "trade_id": cover_trade_id,
            "timestamp": datetime.now().isoformat(),
            "symbol": "BTCUSDT",
            "action": action.upper(),
            "oc_type": "Cover",
            "quantity": float(quantity),
            "price": float(price),
            "order_id": str(order_id),
            "source": source,  # 添加交易來源
            "leverage": leverage,  # 添加槓桿倍數
            "matched_opens": matched_opens,
            "total_pnl": sum(m["pnl"] for m in matched_opens),
            "unmatched_quantity": remaining_to_cover  # 無法配對的數量
        }
        
        # 儲存平倉記錄（有數據時才創建目錄）
        today = get_today_str()
        os.makedirs(BTC_TRADE_RECORDS_DIR, exist_ok=True)  # 只在有數據時創建
        cover_file = os.path.join(BTC_TRADE_RECORDS_DIR, f'btc_cover_trades_{today}.json')
        
        cover_trades = load_json_file(cover_file)
        cover_trades.append(cover_record)
        
        if save_json_file(cover_file, cover_trades):
            logger.info(f"✅ BTC平倉記錄已儲存: {cover_trade_id} - 配對{len(matched_opens)}筆開倉，總損益:${cover_record['total_pnl']}")
            if not TradingConfig.is_btc_position_zero(remaining_to_cover):
                logger.warning(f"⚠️ 有{remaining_to_cover}BTC無法找到對應開倉記錄")
        else:
            logger.error(f"❌ BTC平倉記錄儲存失敗: {cover_trade_id}")
            
        return cover_record
        
    except Exception as e:
        logger.error(f"記錄BTC平倉交易失敗: {e}")
        return None

def get_btc_trading_statistics(date_range_days=1):
    """獲取BTC交易統計數據
    
    Args:
        date_range_days: 統計天數（最多支援30天）
        
    Returns:
        dict: 統計數據
    """
    try:
        total_opens = 0
        total_covers = 0
        total_pnl = 0
        
        # 統計指定天數的數據
        for i in range(date_range_days):
            check_date = datetime.now() - timedelta(days=i)
            date_str = check_date.strftime('%Y%m%d')
            
            # 統計開倉
            open_file = os.path.join(BTC_TRADE_RECORDS_DIR, f'btc_open_positions_{date_str}.json')
            if os.path.exists(open_file):
                opens = load_json_file(open_file)
                total_opens += len(opens)
            
            # 統計平倉
            cover_file = os.path.join(BTC_TRADE_RECORDS_DIR, f'btc_cover_trades_{date_str}.json')
            if os.path.exists(cover_file):
                covers = load_json_file(cover_file)
                total_covers += len(covers)
                
                # 計算總損益
                for cover in covers:
                    pnl = cover.get('total_pnl', 0)
                    total_pnl += pnl
        
        return {
            'total_opens': total_opens,
            'total_covers': total_covers,
            'total_pnl': round(total_pnl, 2)
        }
        
    except Exception as e:
        logger.error(f"獲取BTC交易統計失敗: {e}")
        return {
            'total_opens': 0,
            'total_covers': 0,
            'total_pnl': 0
        }

def get_btc_cover_trades_for_report(date_range_days=1):
    """獲取BTC平倉交易明細供報表使用
    
    Returns:
        list: 平倉交易明細列表
    """
    try:
        all_covers = []
        
        for i in range(date_range_days):
            check_date = datetime.now() - timedelta(days=i)
            date_str = check_date.strftime('%Y%m%d')
            cover_file = os.path.join(BTC_TRADE_RECORDS_DIR, f'btc_cover_trades_{date_str}.json')
            
            if os.path.exists(cover_file):
                covers = load_json_file(cover_file)
                all_covers.extend(covers)
        
        # 展開為每筆配對的明細
        detailed_covers = []
        for cover in all_covers:
            matched_opens = cover.get('matched_opens', [])
            
            if matched_opens:
                # 有配對成功的記錄：展開每筆配對
                for match in matched_opens:
                    detailed_covers.append({
                        'cover_timestamp': cover['timestamp'],
                        'cover_order_id': cover['order_id'],
                        'symbol': cover['symbol'],
                        'cover_action': cover['action'],
                        'matched_quantity': match['matched_quantity'],
                        'open_price': match['open_price'],
                        'cover_price': cover['price'],
                        'pnl': match['pnl'],
                        'open_timestamp': match['open_timestamp'],
                        'open_trade_id': match['open_trade_id'],
                        'source': cover.get('source', 'manual')  # 添加交易來源信息
                    })
            else:
                # 沒有配對成功的記錄：仍然顯示平倉記錄（開倉價格和損益顯示為未知）
                detailed_covers.append({
                    'cover_timestamp': cover['timestamp'],
                    'cover_order_id': cover['order_id'],
                    'symbol': cover['symbol'],
                    'cover_action': cover['action'],
                    'matched_quantity': cover['quantity'],  # 使用全部平倉數量
                    'open_price': 0,  # 無配對時開倉價格未知
                    'cover_price': cover['price'],
                    'pnl': 0,  # 無配對時損益未知
                    'open_timestamp': '',  # 無配對時開倉時間未知
                    'open_trade_id': '',  # 無配對時開倉ID未知
                    'source': cover.get('source', 'manual')  # 添加交易來源信息
                })
        
        return detailed_covers
        
    except Exception as e:
        logger.error(f"獲取BTC平倉明細失敗: {e}")
        return []

def cleanup_old_btc_files():
    """清理超過30天的BTC交易記錄檔案"""
    try:
        current_date = datetime.now()
        cutoff_date = current_date - timedelta(days=TradingConfig.DATA_RETENTION_DAYS)
        
        # 清理BTC交易記錄目錄
        for file_pattern in ['btc_open_positions_*.json', 'btc_cover_trades_*.json']:
            pattern_path = os.path.join(BTC_TRADE_RECORDS_DIR, file_pattern)
            import glob
            for file_path in glob.glob(pattern_path):
                try:
                    # 從檔名提取日期
                    filename = os.path.basename(file_path)
                    date_str = filename.split('_')[-1].replace('.json', '')
                    file_date = datetime.strptime(date_str, '%Y%m%d')
                    
                    if file_date < cutoff_date:
                        os.remove(file_path)
                        logger.info(f"🗑️ 已清理過期BTC記錄檔案: {filename}")
                except Exception as e:
                    logger.warning(f"清理檔案失敗 {file_path}: {e}")
        
        # 清理BTCtradedata目錄
        btc_transdata_dir = TradingConfig.BTC_DATA_DIR
        if os.path.exists(btc_transdata_dir):
            for file_name in os.listdir(btc_transdata_dir):
                if file_name.startswith('BTCtransdata_') and file_name.endswith('.json'):
                    try:
                        date_str = file_name.replace('BTCtransdata_', '').replace('.json', '')
                        file_date = datetime.strptime(date_str, '%Y%m%d')
                        
                        if file_date < cutoff_date:
                            file_path = os.path.join(btc_transdata_dir, file_name)
                            os.remove(file_path)
                            logger.info(f"🗑️ 已清理過期BTCtransdata檔案: {file_name}")
                    except Exception as e:
                        logger.warning(f"清理BTCtransdata檔案失敗 {file_name}: {e}")
        
        logger.info(f"✅ BTC檔案清理完成，保留最近30天數據")
        
    except Exception as e:
        logger.error(f"BTC檔案清理失敗: {e}")

def save_btc_transdata(trade_data):
    """保存BTC交易數據到BTCtransdata目錄
    
    Args:
        trade_data: 交易數據
    """
    try:
        # BTCtradedata目錄（有數據時才創建）
        btc_transdata_dir = TradingConfig.BTC_DATA_DIR
        os.makedirs(btc_transdata_dir, exist_ok=True)
        
        # 按日期分檔儲存
        today = get_today_str()
        transdata_file = os.path.join(btc_transdata_dir, f'BTCtransdata_{today}.json')
        
        # 載入現有數據
        existing_data = load_json_file(transdata_file)
        
        # 添加新數據
        existing_data.append({
            **trade_data,
            "saved_timestamp": datetime.now().isoformat()
        })
        
        # 儲存
        save_json_file(transdata_file, existing_data)
        logger.info(f"✅ BTC交易數據已儲存至BTCtradedata: {transdata_file}")
        
        # 執行清理（使用配置中的機率設定）
        import random
        if random.random() < TradingConfig.CLEANUP_PROBABILITY:
            cleanup_old_btc_files()
        
    except Exception as e:
        logger.error(f"儲存BTC交易數據失敗: {e}")