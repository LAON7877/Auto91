# TX交易配對系統 - 開倉平倉JSON記錄機制
import json
import os
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# JSON檔案目錄
TRADE_RECORDS_DIR = os.path.join(os.path.dirname(__file__), '..', 'TXtraderecords')

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
        logger.error(f"載入JSON檔案失敗 {file_path}: {e}")
        return []

def save_json_file(file_path, data):
    """儲存JSON檔案"""
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"儲存JSON檔案失敗 {file_path}: {e}")
        return False

def generate_trade_id(contract_code, action, oc_type):
    """生成唯一交易ID"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]  # 精確到毫秒
    return f"{contract_code}_{oc_type}_{action}_{timestamp}"

def calculate_pnl(open_price, close_price, quantity, close_action, contract_code):
    """計算損益"""
    try:
        # 點值設定
        point_values = {
            'TXF': 200,  # 大台
            'MXF': 50,   # 小台  
            'TMF': 50    # 微台
        }
        
        base_contract = contract_code[:3]  # TXF, MXF, TMF
        point_value = point_values.get(base_contract, 50)
        
        # 計算點差
        if close_action == "Sell":  # 平多倉
            point_diff = close_price - open_price
        else:  # close_action == "Buy", 平空倉
            point_diff = open_price - close_price
            
        pnl = point_diff * quantity * point_value
        logger.info(f"損益計算: {contract_code} {close_action} {quantity}口, 開倉:{open_price} 平倉:{close_price} 點差:{point_diff} 損益:{pnl}")
        return round(pnl, 2)
        
    except Exception as e:
        logger.error(f"計算損益失敗: {e}")
        return 0.0

def record_opening_trade(contract_code, action, quantity, price, order_id):
    """記錄開倉交易
    
    Args:
        contract_code: 合約代碼 (如 TXFH5)
        action: 交易方向 (Buy/Sell)
        quantity: 數量
        price: 成交價格
        order_id: 訂單ID
    """
    try:
        trade_id = generate_trade_id(contract_code, action, "Open")
        
        trade_record = {
            "trade_id": trade_id,
            "timestamp": datetime.now().isoformat(),
            "contract_code": contract_code,
            "action": action,  # Buy/Sell
            "oc_type": "Open",
            "quantity": quantity,
            "price": float(price),
            "order_id": str(order_id),
            "pair_key": f"{contract_code}_{action}",
            "remaining_quantity": quantity,  # 剩餘未平倉數量
            "status": "open",  # open/partial_covered/fully_covered
            "matched_covers": []  # 被配對的平倉記錄
        }
        
        # 儲存到當日開倉記錄（有數據時才創建目錄）
        today = get_today_str()
        os.makedirs(TRADE_RECORDS_DIR, exist_ok=True)  # 只在有數據時創建
        open_file = os.path.join(TRADE_RECORDS_DIR, f'open_positions_{today}.json')
        
        open_positions = load_json_file(open_file)
        open_positions.append(trade_record)
        
        if save_json_file(open_file, open_positions):
            logger.info(f"✅ 開倉記錄已儲存: {trade_id} - {contract_code} {action} {quantity}口 @ {price}")
            return trade_id
        else:
            logger.error(f"❌ 開倉記錄儲存失敗: {trade_id}")
            return None
            
    except Exception as e:
        logger.error(f"記錄開倉交易失敗: {e}")
        return None

def record_covering_trade(contract_code, action, quantity, price, order_id):
    """記錄平倉交易並自動配對
    
    Args:
        contract_code: 合約代碼 (如 TXFH5)
        action: 交易方向 (Buy/Sell)
        quantity: 數量  
        price: 成交價格
        order_id: 訂單ID
        
    Returns:
        dict: 平倉記錄（包含配對信息）
    """
    try:
        # 確定需要配對的開倉方向
        required_open_action = "Sell" if action == "Buy" else "Buy"
        pair_key = f"{contract_code}_{required_open_action}"
        
        logger.info(f"平倉配對開始: {contract_code} {action} {quantity}口，尋找開倉方向: {required_open_action}")
        
        # 載入過去30天的開倉記錄進行配對（按時間排序，FIFO原則）
        matched_opens = []
        remaining_to_cover = quantity
        
        # 收集所有可配對的開倉記錄
        available_opens = []
        
        for i in range(30):  # 查找過去30天的開倉記錄
            check_date = datetime.now() - timedelta(days=i)
            date_str = check_date.strftime('%Y%m%d')
            open_file = os.path.join(TRADE_RECORDS_DIR, f'open_positions_{date_str}.json')
            
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
        
        logger.info(f"找到{len(available_opens)}筆可配對的開倉記錄")
        
        # 逐筆配對，支援部分平倉
        for open_pos in available_opens:
            if remaining_to_cover <= 0:
                break
                
            # 計算本次配對數量
            matched_qty = min(open_pos["remaining_quantity"], remaining_to_cover)
            
            # 計算損益
            pnl = calculate_pnl(
                open_pos["price"], price, matched_qty, 
                action, contract_code
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
            
            # 更新開倉記錄狀態
            open_pos["remaining_quantity"] -= matched_qty
            if open_pos["remaining_quantity"] == 0:
                open_pos["status"] = "fully_covered"
                logger.info(f"✅ 完全平倉: {open_pos['trade_id']} 全部{open_pos['quantity']}口已平倉")
            else:
                open_pos["status"] = "partial_covered"
                logger.info(f"🔸 部分平倉: {open_pos['trade_id']} 平倉{matched_qty}口，剩餘{open_pos['remaining_quantity']}口")
                
            # 在開倉記錄中添加配對信息
            cover_trade_id = generate_trade_id(contract_code, action, "Cover")
            cover_info = {
                "cover_trade_id": cover_trade_id,
                "cover_timestamp": datetime.now().isoformat(),
                "cover_price": price,
                "matched_quantity": matched_qty,
                "pnl": pnl
            }
            open_pos["matched_covers"].append(cover_info)
            
            remaining_to_cover -= matched_qty
            
            logger.info(f"配對成功: {matched_qty}口 開倉@{open_pos['price']} 平倉@{price} 損益:{pnl}")
        
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
            logger.info(f"📝 已更新開倉記錄檔案: {file_path}")
        
        # 建立平倉交易記錄
        cover_trade_id = generate_trade_id(contract_code, action, "Cover")
        cover_record = {
            "trade_id": cover_trade_id,
            "timestamp": datetime.now().isoformat(),
            "contract_code": contract_code,
            "action": action,
            "oc_type": "Cover",
            "quantity": quantity,
            "price": float(price),
            "order_id": str(order_id),
            "matched_opens": matched_opens,
            "total_pnl": sum(m["pnl"] for m in matched_opens),
            "unmatched_quantity": remaining_to_cover  # 無法配對的數量
        }
        
        # 儲存平倉記錄（有數據時才創建目錄）
        today = get_today_str()
        os.makedirs(TRADE_RECORDS_DIR, exist_ok=True)  # 只在有數據時創建
        cover_file = os.path.join(TRADE_RECORDS_DIR, f'cover_trades_{today}.json')
        
        cover_trades = load_json_file(cover_file)
        cover_trades.append(cover_record)
        
        if save_json_file(cover_file, cover_trades):
            logger.info(f"✅ 平倉記錄已儲存: {cover_trade_id} - 配對{len(matched_opens)}筆開倉，總損益:{cover_record['total_pnl']}")
            if remaining_to_cover > 0:
                logger.warning(f"⚠️ 有{remaining_to_cover}口無法找到對應開倉記錄")
        else:
            logger.error(f"❌ 平倉記錄儲存失敗: {cover_trade_id}")
            
        return cover_record
        
    except Exception as e:
        logger.error(f"記錄平倉交易失敗: {e}")
        return None

def get_trading_statistics(date_range_days=1):
    """獲取交易統計數據
    
    Args:
        date_range_days: 統計天數（最多支援30天）
        
    Returns:
        dict: 統計數據
    """
    try:
        total_opens = 0
        total_covers = 0
        total_pnl = 0
        contract_pnl = {'TXF': 0, 'MXF': 0, 'TMF': 0}
        
        # 統計指定天數的數據
        for i in range(date_range_days):
            check_date = datetime.now() - timedelta(days=i)
            date_str = check_date.strftime('%Y%m%d')
            
            # 統計開倉
            open_file = os.path.join(TRADE_RECORDS_DIR, f'open_positions_{date_str}.json')
            if os.path.exists(open_file):
                opens = load_json_file(open_file)
                total_opens += len(opens)
            
            # 統計平倉
            cover_file = os.path.join(TRADE_RECORDS_DIR, f'cover_trades_{date_str}.json')
            if os.path.exists(cover_file):
                covers = load_json_file(cover_file)
                total_covers += len(covers)
                
                # 計算各合約損益
                for cover in covers:
                    pnl = cover.get('total_pnl', 0)
                    total_pnl += pnl
                    
                    base_contract = cover['contract_code'][:3]
                    if base_contract in contract_pnl:
                        contract_pnl[base_contract] += pnl
        
        return {
            'total_opens': total_opens,
            'total_covers': total_covers, 
            'total_pnl': round(total_pnl, 2),
            'contract_pnl': {k: round(v, 2) for k, v in contract_pnl.items()}
        }
        
    except Exception as e:
        logger.error(f"獲取交易統計失敗: {e}")
        return {
            'total_opens': 0,
            'total_covers': 0,
            'total_pnl': 0,
            'contract_pnl': {'TXF': 0, 'MXF': 0, 'TMF': 0}
        }

def get_cover_trades_for_report(date_range_days=1):
    """獲取平倉交易明細供報表使用
    
    Returns:
        list: 平倉交易明細列表
    """
    try:
        all_covers = []
        
        for i in range(date_range_days):
            check_date = datetime.now() - timedelta(days=i)
            date_str = check_date.strftime('%Y%m%d')
            cover_file = os.path.join(TRADE_RECORDS_DIR, f'cover_trades_{date_str}.json')
            
            if os.path.exists(cover_file):
                covers = load_json_file(cover_file)
                all_covers.extend(covers)
        
        # 展開為每筆配對的明細
        detailed_covers = []
        for cover in all_covers:
            for match in cover.get('matched_opens', []):
                detailed_covers.append({
                    'cover_timestamp': cover['timestamp'],
                    'cover_order_id': cover['order_id'],
                    'contract_code': cover['contract_code'],
                    'cover_action': cover['action'],
                    'matched_quantity': match['matched_quantity'],
                    'open_price': match['open_price'],
                    'cover_price': cover['price'],
                    'pnl': match['pnl'],
                    'open_timestamp': match['open_timestamp'],
                    'open_trade_id': match['open_trade_id']
                })
        
        return detailed_covers
        
    except Exception as e:
        logger.error(f"獲取平倉明細失敗: {e}")
        return []

def cleanup_old_tx_files():
    """清理超過30天的TX交易記錄檔案"""
    try:
        current_date = datetime.now()
        cutoff_date = current_date - timedelta(days=30)
        
        # 清理TX交易記錄目錄
        for file_pattern in ['open_positions_*.json', 'cover_trades_*.json']:
            pattern_path = os.path.join(TRADE_RECORDS_DIR, file_pattern)
            import glob
            for file_path in glob.glob(pattern_path):
                try:
                    # 從檔名提取日期
                    filename = os.path.basename(file_path)
                    date_str = filename.split('_')[-1].replace('.json', '')
                    file_date = datetime.strptime(date_str, '%Y%m%d')
                    
                    if file_date < cutoff_date:
                        os.remove(file_path)
                        logger.info(f"🗑️ 已清理過期TX記錄檔案: {filename}")
                except Exception as e:
                    logger.warning(f"清理檔案失敗 {file_path}: {e}")
        
        # 清理TXtradedata目錄（如果存在）
        tx_transdata_dir = os.path.join(os.path.dirname(__file__), '..', 'TXtradedata')
        if os.path.exists(tx_transdata_dir):
            for file_name in os.listdir(tx_transdata_dir):
                if file_name.startswith('TXtransdata_') and file_name.endswith('.json'):
                    try:
                        date_str = file_name.replace('TXtransdata_', '').replace('.json', '')
                        file_date = datetime.strptime(date_str, '%Y%m%d')
                        
                        if file_date < cutoff_date:
                            file_path = os.path.join(tx_transdata_dir, file_name)
                            os.remove(file_path)
                            logger.info(f"🗑️ 已清理過期TXtradedata檔案: {file_name}")
                    except Exception as e:
                        logger.warning(f"清理TXtradedata檔案失敗 {file_name}: {e}")
        
        logger.info(f"✅ TX檔案清理完成，保留最近30天數據")
        
    except Exception as e:
        logger.error(f"TX檔案清理失敗: {e}")

def save_tx_transdata(trade_data):
    """保存TX交易數據到TXtradedata目錄
    
    Args:
        trade_data: 交易數據
    """
    try:
        # 創建TXtradedata目錄（有數據時才創建）
        tx_transdata_dir = os.path.join(os.path.dirname(__file__), '..', 'TXtradedata')
        os.makedirs(tx_transdata_dir, exist_ok=True)
        
        # 按日期分檔儲存
        today = get_today_str()
        transdata_file = os.path.join(tx_transdata_dir, f'TXtransdata_{today}.json')
        
        # 載入現有數據
        existing_data = load_json_file(transdata_file)
        
        # 添加新數據
        existing_data.append({
            **trade_data,
            "saved_timestamp": datetime.now().isoformat()
        })
        
        # 儲存
        save_json_file(transdata_file, existing_data)
        logger.info(f"✅ TX交易數據已儲存至TXtradedata: {transdata_file}")
        
        # 執行清理（每次保存時檢查一次，但加入隨機性避免頻繁執行）
        import random
        if random.randint(1, 10) == 1:  # 10%機率執行清理
            cleanup_old_tx_files()
        
    except Exception as e:
        logger.error(f"儲存TX交易數據失敗: {e}")