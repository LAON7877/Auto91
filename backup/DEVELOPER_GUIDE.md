# 開發者指南

## 系統架構

### 交易日判斷架構（重要）

#### 源頭設計
- **唯一源頭**：`main.py` 中的 `is_trading_day_advanced()` 函數
- **設計原則**：避免重複實現，統一邏輯來源
- **調用方式**：所有交易日判斷都通過 API 調用此函數

#### 核心邏輯
```python
def is_trading_day_advanced(check_date=None):
    # 1. 週日檢查
    if check_date.weekday() == 6:  # 週日
        return False
    
    # 2. 假期檔案檢查
    # 支援民國年格式：holidaySchedule_114.csv
    # 備註欄位：'o'=交易日，其他=非交易日
    
    # 3. 預設為交易日
    return True
```

#### 調用鏈
```
web/main.js → /api/trading/status → main.py (源頭)
```

### 檔案結構
- `main.py` - Web服務器和交易日判斷源頭
- `TXserver.py` - 獨立交易服務器
- `web/main.js` - 前端邏輯，通過API調用後端
- `holiday/` - 假期檔案目錄（民國年格式）

## 開發規範

### 交易日判斷
- **嚴禁**在其他地方重複實現交易日判斷邏輯
- **必須**通過 API 調用 `main.py` 的結果
- **統一**使用民國年假期檔案格式

### 代碼維護
- 交易日邏輯修改只限於 `main.py`
- 保持架構清晰，避免循環依賴
- 定期更新文檔反映架構變更

---

如需協作請先 fork 並發 PR，或聯絡原作者。 