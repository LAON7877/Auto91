# 文檔導航索引

- [README.md](README.md) 系統概況與功能
- [QUICK_START.md](QUICK_START.md) 5 分鐘快速上手
- [API_REFERENCE.md](API_REFERENCE.md) API 技術參考
- [CHANGELOG.md](CHANGELOG.md) 版本變更紀錄
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) 故障排除
- [DEPLOYMENT.md](DEPLOYMENT.md) 生產部署指南
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) 開發者指南
- [MAINTENANCE.md](MAINTENANCE.md) 維護運營指南

## 重點功能文檔

### ngrok 自動管理
- **自動啟動/關閉**：程式啟動時自動啟動 ngrok，退出時自動清理
- **自動重啟機制**：檢測異常時自動重啟，確保服務持續可用
- **版本管理**：自動檢查和升級 ngrok 版本
- **錯誤恢復**：處理 4040 API 錯誤，自動重試機制

### 交易日判斷系統
- **統一源頭**：`main.py` 中的交易日判斷邏輯
- **民國年支援**：假期檔案使用民國年格式
- **週六夜盤**：正確處理週六夜盤交易日判斷

### API 系統
- **ngrok 管理 API**：完整的 ngrok 狀態監控和管理
- **交易日狀態 API**：統一的交易日判斷接口
- **系統日誌 API**：前端日誌與 ngrok 請求日誌整合 