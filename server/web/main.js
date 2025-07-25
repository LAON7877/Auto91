// =========================== 通用工具函數庫 ===========================

// 通用API請求工具
const APIUtils = {
    async request(url, options = {}) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            console.error(`API請求失敗: ${url}`, error);
            return { success: false, error: error.message };
        }
    },
    
    async get(url) {
        return this.request(url);
    },
    
    async post(url, data) {
        return this.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }
};

// 通用API狀態更新函數
async function updateApiStatus(config) {
    const {
        apiEndpoint,
        statusElementId,
        accountElementId,
        versionElementId,
        connectedText = 'API已連線',
        disconnectedText = 'API未連線',
        errorText = 'API連線錯誤'
    } = config;
    
    const result = await APIUtils.get(apiEndpoint);
    const statusElement = document.getElementById(statusElementId);
    const accountElement = document.getElementById(accountElementId);
    const versionElement = document.getElementById(versionElementId);
    
    if (result.success && result.data.connected) {
        if (statusElement) {
            statusElement.textContent = connectedText;
            statusElement.className = 'status connected';
        }
        if (accountElement && result.data.account_id) {
            accountElement.textContent = result.data.account_id;
        }
        if (versionElement && result.data.version) {
            versionElement.textContent = result.data.version;
        }
    } else {
        const displayText = result.success ? disconnectedText : errorText;
        if (statusElement) {
            statusElement.textContent = displayText;
            statusElement.className = 'status error';
        }
        if (accountElement) accountElement.textContent = '-';
        if (versionElement) versionElement.textContent = '-';
    }
}

// 損益顏色工具函數
function getPnLColorClass(value) {
    const numValue = parseFloat(value) || 0;
    if (numValue > 0) return 'pnl-positive';
    if (numValue < 0) return 'pnl-negative';
    return 'pnl-neutral';
}

// 統一的系統日誌管理工具
const SystemLogManager = {
    // 統一的日誌更新函數
    async updateSystemLogs(systemType = 'tx') {
        const apiEndpoint = systemType === 'btc' ? '/api/btc_system_log' : '/api/system_log';
        const globalLogsArray = systemType === 'btc' ? 'btcSystemLogs' : 'systemLogs';
        
        try {
            const result = await APIUtils.get(apiEndpoint);
            if (result.success && result.data && result.data.logs) {
                const filterCondition = systemType === 'btc' ? 
                    (log => log.uri === '/api/btc_system_log' || (log.extra_info && log.extra_info.system === 'BTC')) :
                    (log => (log.type === 'custom' || log.type === 'webhook') && !log.uri.includes('btc'));
                
                const filteredLogs = result.data.logs.filter(filterCondition);
                
                // 更新全域變數
                window[globalLogsArray] = filteredLogs;
                
                // 更新顯示
                this.updateSystemLogsDisplay(systemType);
            }
        } catch (error) {
            console.error(`更新${systemType.toUpperCase()}系統日誌失敗:`, error);
        }
    },
    
    // 統一的日誌顯示函數
    updateSystemLogsDisplay(systemType = 'tx') {
        const containerId = systemType === 'btc' ? 'system-logs-content-btc' : 'system-logs-content';
        const logsArray = window[systemType === 'btc' ? 'btcSystemLogs' : 'systemLogs'] || [];
        const container = document.getElementById(containerId);
        
        if (!container) return;
        
        if (logsArray.length === 0) {
            container.innerHTML = '<div class="log-item empty">目前沒有系統日誌</div>';
            return;
        }
        
        const logItems = logsArray.slice(-10).reverse().map(log => {
            const typeClass = this.getLogTypeClass(log.type);
            const typeText = this.getLogTypeText(log.type);
            const timestamp = this.formatLogTimestamp(log.timestamp);
            
            return `
                <div class="log-item ${typeClass}">
                    <div class="log-header">
                        <span class="log-type">${typeText}</span>
                        <span class="log-time">${timestamp}</span>
                    </div>
                    <div class="log-message">${log.message}</div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = logItems;
        container.scrollTop = 0; // 滾動到最新日誌
    },
    
    // 工具方法
    getLogTypeClass(type) {
        const typeMap = {
            'success': 'log-success',
            'error': 'log-error', 
            'warning': 'log-warning',
            'info': 'log-info'
        };
        return typeMap[type] || 'log-info';
    },
    
    getLogTypeText(type) {
        const typeMap = {
            'success': '成功',
            'error': '錯誤',
            'warning': '警告', 
            'info': '資訊'
        };
        return typeMap[type] || '資訊';
    },
    
    formatLogTimestamp(timestamp) {
        try {
            const date = new Date(timestamp);
            return date.toLocaleString('zh-TW', {
                month: '2-digit',
                day: '2-digit', 
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch {
            return timestamp || '';
        }
    }
};

function updateDOMElement(id, value, useInnerHTML = false) {
    const element = document.getElementById(id);
    if (element) {
        if (useInnerHTML) {
            element.innerHTML = value;
        } else {
            element.textContent = value;
        }
    }
}

function updateDOMElements(elements, useInnerHTML = false) {
    Object.entries(elements).forEach(([id, value]) => {
        updateDOMElement(id, value, useInnerHTML);
    });
}

function showPanel(panel) {
    if (panel === 'trade' && sessionStorage.getItem('isLoggedIn') !== '1') {
        // 未登入，強制回到設置面板
        document.getElementById('settings-panel').style.display = '';
        document.getElementById('trade-panel').style.display = 'none';
        document.getElementById('btc-trade-panel').style.display = 'none';
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        alert('請先登入TX帳戶！');
        return;
    }
    
    if (panel === 'btc-trade' && sessionStorage.getItem('isBtcLoggedIn') !== '1') {
        // BTC未登入，強制回到設置面板
        document.getElementById('settings-panel').style.display = '';
        document.getElementById('trade-panel').style.display = 'none';
        document.getElementById('btc-trade-panel').style.display = 'none';
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        alert('請先登入BTC帳戶！');
        return;
    }
    
    // 控制面板顯示
    document.getElementById('settings-panel').style.display = (panel === 'settings') ? '' : 'none';
    document.getElementById('trade-panel').style.display = (panel === 'trade') ? '' : 'none';
    document.getElementById('btc-trade-panel').style.display = (panel === 'btc-trade') ? '' : 'none';
    
    // 更新標籤狀態（頂部和側邊欄）
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
    
    if (panel === 'settings') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.querySelector('.sidebar-btn[data-panel="settings"]').classList.add('active');
    } else if (panel === 'trade') {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.querySelector('.sidebar-btn[data-panel="trade"]').classList.add('active');
    } else if (panel === 'btc-trade') {
        document.querySelectorAll('.tab-btn')[2].classList.add('active');
        document.querySelector('.sidebar-btn[data-panel="btc-trade"]').classList.add('active');
    }
}

function copyUsername() {
    const username = document.getElementById('bot-username').value;
    navigator.clipboard.writeText(username).then(() => {
        alert('已複製 Bot ID ！！！\n請至Telegram 加入好友，並向它發起訊息：/start');
    });
}

function showTgIdHelp() {
    // 創建提示窗元素
    const tooltip = document.createElement('div');
    tooltip.className = 'tg-help-tooltip';
    tooltip.innerHTML = `
        <div class="tooltip-content">
            <h4>如何取得 Telegram ID</h4>
            <p>1. 請至Telegram 加入好友 ​@userinfobot</p>
            <p>2. 向他發起訊息：/start</p>
            <p>3. 記下ID輸入上來</p>
            <p><strong>此ID才是唯一識別碼，並非您的用戶名！</strong></p>
            <div class="tooltip-buttons">
                <button onclick="window.open('https://t.me/userinfobot', '_blank')" class="tooltip-btn primary">前往Telegram</button>
                <button onclick="closeTgHelpTooltip()" class="tooltip-btn secondary">關閉</button>
            </div>
        </div>
    `;
    
    // 添加到頁面
    document.body.appendChild(tooltip);
    
    // 顯示動畫
    setTimeout(() => {
        tooltip.classList.add('show');
    }, 10);
}

function closeTgHelpTooltip() {
    const tooltip = document.querySelector('.tg-help-tooltip');
    if (tooltip) {
        tooltip.classList.remove('show');
        setTimeout(() => {
            tooltip.remove();
        }, 300);
    }
}

function refreshBotUsername() {
    const botUsernameInput = document.getElementById('bot-username');
    
    // 顯示載入狀態
    botUsernameInput.value = '查詢中...';
    
    // 直接從後端獲取token，不需要前端輸入
    fetch('/api/bot_username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}) // 不需要傳送token，後端會自動獲取
    })
    .then(res => res.json())
    .then(data => {
        if (data.username) {
            botUsernameInput.value = data.username;
        } else if (data.error) {
            botUsernameInput.value = '查詢失敗';
        } else {
            botUsernameInput.value = '查無 Bot ID';
        }
    })
    .catch(() => {
        botUsernameInput.value = '查詢失敗';
    });
}

function autoSetCertEnd() {
    const startInput = document.getElementById('cert_start');
    const endInput = document.getElementById('cert_end');
    const val = startInput.value;
    if (!val) return;
    const startDate = new Date(val);
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 2);
    endDate.setHours(23, 59, 0, 0);
    // 格式 YYYY-MM-DD HH:MM:SS
    const y = endDate.getFullYear();
    const m = String(endDate.getMonth() + 1).padStart(2, '0');
    const d = String(endDate.getDate()).padStart(2, '0');
    const h = String(endDate.getHours()).padStart(2, '0');
    const min = String(endDate.getMinutes()).padStart(2, '0');
    endInput.value = `${y}-${m}-${d} ${h}:${min}:00`;
}

// 上傳台股日曆
const holidayFile = document.getElementById('holiday_file');
holidayFile.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    fetch('/api/upload/holiday', {
        method: 'POST',
        body: formData
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.error || '上傳失敗');
            });
        }
        return res.json();
    })
    .then(data => {
        document.getElementById('holiday-upload-status').innerText = '上傳成功！！！';
        setTimeout(() => document.getElementById('holiday-upload-status').innerText = '', 2000);
    })
    .catch(error => {
        document.getElementById('holiday-upload-status').innerText = `上傳失敗: ${error.message}`;
        setTimeout(() => document.getElementById('holiday-upload-status').innerText = '', 3000);
    });
});

// 上傳憑證檔案
const caFile = document.getElementById('ca_file');
caFile.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    fetch('/api/upload/certificate', {
        method: 'POST',
        body: formData
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.error || '上傳失敗');
            });
        }
        return res.json();
    })
    .then(data => {
        document.getElementById('ca-upload-status').innerText = '上傳成功！！！';
        setTimeout(() => document.getElementById('ca-upload-status').innerText = '', 2000);
    })
    .catch(error => {
        document.getElementById('ca-upload-status').innerText = `上傳失敗: ${error.message}`;
        setTimeout(() => document.getElementById('ca-upload-status').innerText = '', 3000);
    });
});

function maskApiKey(val) {
    if (!val) return '';
    if (val.length <= 10) return '●'.repeat(val.length);
    return val.slice(0, 5) + '●'.repeat(val.length - 10) + val.slice(-5);
}
function maskPersonId(val) {
    if (!val) return '';
    if (val.length <= 7) return '●'.repeat(val.length);
    return val.slice(0, 3) + '●'.repeat(val.length - 7) + val.slice(-4);
}
function maskPassword(val) {
    if (!val) return '';
    if (val.length <= 1) return val;
    return val.slice(0, 1) + '●'.repeat(val.length - 1);
}

function setMaskedFields() {
    const apiKey = document.getElementById('api_key');
    const secretKey = document.getElementById('secret_key');
    const personId = document.getElementById('person_id');
    const caPasswd = document.getElementById('ca_passwd');
    
    // 只有有值的欄位才應用遮擋
    const apiKeyRaw = apiKey.dataset.raw || sessionStorage.getItem('api_key_raw') || '';
    const secretKeyRaw = secretKey.dataset.raw || sessionStorage.getItem('secret_key_raw') || '';
    const personIdRaw = personId.dataset.raw || sessionStorage.getItem('person_id_raw') || '';
    const caPasswdRaw = caPasswd.dataset.raw || sessionStorage.getItem('ca_passwd_raw') || '';
    
    if (apiKeyRaw && apiKeyRaw.trim()) {
        sessionStorage.setItem('api_key_raw', apiKeyRaw);
        apiKey.value = maskApiKey(apiKeyRaw);
        apiKey.readOnly = false;
    } else {
        apiKey.value = '';
        apiKey.readOnly = false;
    }
    
    if (secretKeyRaw && secretKeyRaw.trim()) {
        sessionStorage.setItem('secret_key_raw', secretKeyRaw);
        secretKey.value = maskApiKey(secretKeyRaw);
        secretKey.readOnly = false;
    } else {
        secretKey.value = '';
        secretKey.readOnly = false;
    }
    
    if (personIdRaw && personIdRaw.trim()) {
        sessionStorage.setItem('person_id_raw', personIdRaw);
        personId.value = maskPersonId(personIdRaw);
        personId.readOnly = false;
    } else {
        personId.value = '';
        personId.readOnly = false;
    }
    
    if (caPasswdRaw && caPasswdRaw.trim()) {
        sessionStorage.setItem('ca_passwd_raw', caPasswdRaw);
        caPasswd.value = maskPassword(caPasswdRaw);
        caPasswd.readOnly = false;
    } else {
        caPasswd.value = '';
        caPasswd.readOnly = false;
    }
}

function setBtcMaskedFields() {
    const btcApiKey = document.getElementById('binance_api_key');
    const btcSecretKey = document.getElementById('binance_secret_key');
    
    // 只有有值的欄位才應用遮擋
    const btcApiKeyRaw = btcApiKey.dataset.raw || sessionStorage.getItem('binance_api_key_raw') || '';
    const btcSecretKeyRaw = btcSecretKey.dataset.raw || sessionStorage.getItem('binance_secret_key_raw') || '';
    
    if (btcApiKeyRaw && btcApiKeyRaw.trim()) {
        sessionStorage.setItem('binance_api_key_raw', btcApiKeyRaw);
        btcApiKey.value = maskApiKey(btcApiKeyRaw);
        btcApiKey.readOnly = false;
    } else {
        btcApiKey.value = '';
        btcApiKey.readOnly = false;
    }
    
    if (btcSecretKeyRaw && btcSecretKeyRaw.trim()) {
        sessionStorage.setItem('binance_secret_key_raw', btcSecretKeyRaw);
        btcSecretKey.value = maskApiKey(btcSecretKeyRaw);
        btcSecretKey.readOnly = false;
    } else {
        btcSecretKey.value = '';
        btcSecretKey.readOnly = false;
    }
}

// 驗證身分證字號格式
function validatePersonId(personId) {
    if (!personId) return false;
    // 格式：1個英文字母 + 9個數字
    const pattern = /^[A-Za-z]\d{9}$/;
    return pattern.test(personId);
}

// 驗證API Key和Secret Key長度
function validateApiKey(key) {
    if (!key) return false;
    return key.length === 44;
}

// 驗證輸入欄位
function validateInputs() {
    const apiKey = sessionStorage.getItem('api_key_raw') || document.getElementById('api_key').dataset.raw || '';
    const secretKey = sessionStorage.getItem('secret_key_raw') || document.getElementById('secret_key').dataset.raw || '';
    const personId = sessionStorage.getItem('person_id_raw') || document.getElementById('person_id').dataset.raw || '';
    
    const errors = [];
    
    // 清除之前的錯誤樣式
    document.getElementById('api_key').classList.remove('error');
    document.getElementById('secret_key').classList.remove('error');
    document.getElementById('person_id').classList.remove('error');
    
    if (apiKey && !validateApiKey(apiKey)) {
        errors.push('永豐 API Key 必須是44碼');
        document.getElementById('api_key').classList.add('error');
    }
    
    if (secretKey && !validateApiKey(secretKey)) {
        errors.push('永豐 Secret Key 必須是44碼');
        document.getElementById('secret_key').classList.add('error');
    }
    
    if (personId && !validatePersonId(personId)) {
        errors.push('身分證字號格式錯誤：必須是1個英文字母後接9個數字');
        document.getElementById('person_id').classList.add('error');
    }
    
    return errors;
}

// 修改事件監聽器，儲存後可以修改但保持遮擋
['api_key', 'secret_key', 'person_id', 'ca_passwd'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('focus', function() {
        // 不顯示原始值，保持遮擋狀態，但允許編輯
        // 不需要做任何改變，保持當前的遮擋顯示
    });
    input.addEventListener('blur', function() {
        // 失去焦點時恢復遮擋
        const rawValue = sessionStorage.getItem(`${id}_raw`) || input.dataset.raw;
        if (rawValue && rawValue.trim()) {
            if (id === 'api_key' || id === 'secret_key') {
                input.value = maskApiKey(rawValue);
            } else if (id === 'person_id') {
                input.value = maskPersonId(rawValue);
            } else if (id === 'ca_passwd') {
                input.value = maskPassword(rawValue);
            }
        }
    });
    input.addEventListener('input', function() {
        // 更新原始值到sessionStorage
        sessionStorage.setItem(`${id}_raw`, input.value);
        // 標記為未儲存狀態
        input.dataset.saved = 'false';
        
        // 即時驗證
        const errors = validateInputs();
        const saveBtn = document.getElementById('save-btn');
        if (errors.length > 0) {
            saveBtn.disabled = true;
            saveBtn.title = errors.join('\n');
        } else {
            saveBtn.disabled = false;
            saveBtn.title = '';
        }
    });
});

// 為BTC API欄位添加事件監聽器
['binance_api_key', 'binance_secret_key'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('focus', function() {
        // 不顯示原始值，保持遮擋狀態，但允許編輯
        // 不需要做任何改變，保持當前的遮擋顯示
    });
    input.addEventListener('blur', function() {
        // 失去焦點時恢復遮擋
        const rawValue = sessionStorage.getItem(`${id}_raw`) || input.dataset.raw;
        if (rawValue && rawValue.trim()) {
            input.value = maskApiKey(rawValue);
        }
    });
    input.addEventListener('input', function() {
        // 更新原始值到sessionStorage
        sessionStorage.setItem(`${id}_raw`, input.value);
        // 標記為未儲存狀態
        input.dataset.saved = 'false';
    });
});

async function checkLoginButton() {
    const loginBtn = document.getElementById('login-btn');
    loginBtn.disabled = true; // 預設禁用

    // 取得env
    const res = await fetch('/api/load_env');
    const env = await res.json();

    // 必填欄位
    const requiredFields = [
        'CHAT_ID', 'API_KEY', 'SECRET_KEY', 'PERSON_ID', 'CA_PASSWD', 'CERT_START', 'CERT_END'
    ];
    let allFilled = true;
    for (const key of requiredFields) {
        if (!env[key] || !env[key].trim()) {
            allFilled = false;
            break;
        }
    }

    if (allFilled) {
        loginBtn.disabled = false;
    } else {
        // 如果有空值，確保用戶已登出
        if (sessionStorage.getItem('isLoggedIn') === '1') {
            sessionStorage.removeItem('isLoggedIn');
            window.isLoggedIn = false;
            showPanel('settings');
        }
    }
}

async function checkBtcLoginButton() {
    const loginBtn = document.getElementById('login-btn-btc');
    if (!loginBtn) return; // 如果元素不存在就返回
    
    loginBtn.disabled = true; // 預設禁用

    try {
        // 取得BTC env
        const res = await fetch('/api/load_btc_env');
        const env = await res.json();

        // 必填欄位
        const requiredFields = [
            'CHAT_ID_BTC', 'BINANCE_API_KEY', 'BINANCE_SECRET_KEY', 'BINANCE_USER_ID', 'TRADING_PAIR', 'LEVERAGE', 'POSITION_SIZE', 'MARGIN_TYPE', 'CONTRACT_TYPE'
        ];
        let allFilled = true;
        for (const key of requiredFields) {
            const value = env[key];
            if (!value || !value.toString().trim()) {
                allFilled = false;
                break;
            }
        }

        if (allFilled) {
            loginBtn.disabled = false;
        } else {
            // 如果有空值，確保用戶已登出
            if (sessionStorage.getItem('isBtcLoggedIn') === '1') {
                sessionStorage.removeItem('isBtcLoggedIn');
                window.isBtcLoggedIn = false;
                showPanel('btc-settings');
            }
        }
    } catch (error) {
        console.error('檢查BTC登入按鈕狀態失敗:', error);
        loginBtn.disabled = true;
    }
}

// 修改saveEnv，儲存後呼叫checkLoginButton
function saveEnv(e) {
    if (e) e.preventDefault();
    
    // 驗證輸入
    const errors = validateInputs();
    if (errors.length > 0) {
        alert('驗證失敗：\n' + errors.join('\n'));
        return;
    }
    
    const form = document.getElementById('envForm');
    const certStart = form.cert_start.value ? form.cert_start.value.replace('T', ' ') : '';
    
    // 優先使用sessionStorage的值（包括空值），如果沒有則使用dataset.raw
    const getValue = (id) => {
        const sessionValue = sessionStorage.getItem(`${id}_raw`);
        if (sessionValue !== null) {
            return sessionValue; // 包括空字串
        }
        return document.getElementById(id).dataset.raw || '';
    };
    
    const data = {
        CHAT_ID: form.chat_id.value,
        API_KEY: getValue('api_key'),
        SECRET_KEY: getValue('secret_key'),
        HOLIDAY_DIR: 'Desktop/AutoTX/holiday',
        CA_PATH: 'Desktop/AutoTX/certificate',
        CA_PASSWD: getValue('ca_passwd'),
        PERSON_ID: getValue('person_id'),
        CERT_START: certStart,
        CERT_END: form.cert_end.value
    };
    
    // 顯示儲存中狀態
    const saveBtn = document.getElementById('save-btn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '儲存中...';
    saveBtn.disabled = true;
    
    fetch('/api/save_env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(data => {
        document.getElementById('save-status').innerText = '儲存成功！';
        setTimeout(() => document.getElementById('save-status').innerText = '', 2000);
        // 儲存後，將sessionStorage的值同步到dataset.raw
        const apiKey = document.getElementById('api_key');
        const secretKey = document.getElementById('secret_key');
        const personId = document.getElementById('person_id');
        const caPasswd = document.getElementById('ca_passwd');
        apiKey.dataset.raw = sessionStorage.getItem('api_key_raw') || '';
        secretKey.dataset.raw = sessionStorage.getItem('secret_key_raw') || '';
        personId.dataset.raw = sessionStorage.getItem('person_id_raw') || '';
        caPasswd.dataset.raw = sessionStorage.getItem('ca_passwd_raw') || '';
        ['api_key', 'secret_key', 'person_id', 'ca_passwd'].forEach(id => {
            const input = document.getElementById(id);
            input.dataset.saved = 'true';
        });
        setMaskedFields();
        checkLoginButton();
        
        // 更新永豐API狀態
        // 使用統一的API狀態更新函數
        updateApiStatus({
            apiEndpoint: '/api/sinopac/status',
            statusElementId: 'sinopac-api-status',
            accountElementId: 'sinopac-account-id',
            connectedText: 'API已連線',
            disconnectedText: 'API未連線'
        });
        
        // 檢查是否有空值被儲存
        if (data.has_empty_fields) {
            // 自動登出
            sessionStorage.removeItem('isLoggedIn');
            window.isLoggedIn = false;
            showPanel('settings');
            alert('檢測到有欄位為空！請填寫完所有資料後才能登入。');
        } else {
        alert('儲存成功！！！');
        }
    })
    .catch(() => {
        document.getElementById('save-status').innerText = '儲存失敗';
    })
    .finally(() => {
        // 恢復按鈕狀態
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    });
}

window.onload = function() {
    // 重整後自動登出
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('isBtcLoggedIn');
    window.isLoggedIn = false;
    window.isBtcLoggedIn = false;
    
    fetch('/api/load_env')
    .then(res => res.json())
    .then(env => {
        document.getElementById('chat_id').value = env.CHAT_ID || '';
        document.getElementById('api_key').dataset.raw = env.API_KEY || '';
        document.getElementById('secret_key').dataset.raw = env.SECRET_KEY || '';
        document.getElementById('person_id').dataset.raw = env.PERSON_ID || '';
        document.getElementById('ca_passwd').dataset.raw = env.CA_PASSWD || '';
        document.getElementById('cert_start').value = env.CERT_START || '';
        document.getElementById('cert_end').value = env.CERT_END || '';
        
        // 同步sessionStorage，確保空值也被正確處理
        sessionStorage.setItem('api_key_raw', env.API_KEY || '');
        sessionStorage.setItem('secret_key_raw', env.SECRET_KEY || '');
        sessionStorage.setItem('person_id_raw', env.PERSON_ID || '');
        sessionStorage.setItem('ca_passwd_raw', env.CA_PASSWD || '');
        
        ['api_key', 'secret_key', 'person_id', 'ca_passwd'].forEach(id => {
            const input = document.getElementById(id);
            input.dataset.saved = 'true';
        });
        setMaskedFields();
        
        // 檢查是否有空值，如果有則確保登出狀態
        const requiredFields = ['CHAT_ID', 'API_KEY', 'SECRET_KEY', 'PERSON_ID', 'CA_PASSWD', 'CERT_START', 'CERT_END'];
        let hasEmptyFields = false;
        for (const key of requiredFields) {
            if (!env[key] || !env[key].trim()) {
                hasEmptyFields = true;
                break;
            }
        }
        
        if (hasEmptyFields) {
            // 確保登出狀態
            sessionStorage.removeItem('isLoggedIn');
            window.isLoggedIn = false;
            showPanel('settings');
        }
        
        checkLoginButton();
    });
    
    // 載入BTC環境變量
    fetch('/api/load_btc_env')
    .then(res => res.json())
    .then(btcEnv => {
        document.getElementById('chat_id_btc').value = btcEnv.CHAT_ID_BTC || '';
        document.getElementById('binance_api_key').dataset.raw = btcEnv.BINANCE_API_KEY || '';
        document.getElementById('binance_secret_key').dataset.raw = btcEnv.BINANCE_SECRET_KEY || '';
        document.getElementById('binance_user_id').value = btcEnv.BINANCE_USER_ID || '';
        document.getElementById('trading_pair').value = btcEnv.TRADING_PAIR || 'BTCUSDT';
        document.getElementById('leverage').value = btcEnv.LEVERAGE || '20';
        document.getElementById('position_size').value = btcEnv.POSITION_SIZE || '80';
        document.getElementById('margin_type').value = btcEnv.MARGIN_TYPE || 'CROSS';
        document.getElementById('contract_type').value = btcEnv.CONTRACT_TYPE || 'PERPETUAL';
        
        // 同步sessionStorage，確保空值也被正確處理
        sessionStorage.setItem('binance_api_key_raw', btcEnv.BINANCE_API_KEY || '');
        sessionStorage.setItem('binance_secret_key_raw', btcEnv.BINANCE_SECRET_KEY || '');
        
        ['binance_api_key', 'binance_secret_key'].forEach(id => {
            const input = document.getElementById(id);
            input.dataset.saved = 'true';
        });
        setBtcMaskedFields();
        
        // BTC登入狀態由使用者手動操作，不自動恢復（與TX一致）
        
        // 檢查BTC登入按鈕狀態
        checkBtcLoginButton();
    })
    .catch(error => {
        console.error('載入BTC環境變量失敗:', error);
    });
    
    // 獲取BTC Bot正確的用戶名
    fetch('/api/btc_bot_username')
    .then(res => res.json())
    .then(data => {
        if (data.username) {
            document.getElementById('bot-username-btc').value = data.username;
        }
    })
    .catch(error => {
        console.error('獲取BTC Bot用戶名失敗:', error);
    });
    
    loadUploadedFiles();
    ['chat_id', 'cert_start', 'cert_end'].forEach(id => {
        document.getElementById(id).addEventListener('input', checkLoginButton);
    });
    // 為BTC欄位添加輸入事件監聽器
    ['chat_id_btc', 'binance_api_key', 'binance_secret_key', 'binance_user_id', 'trading_pair', 'leverage', 'contract_type'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', checkBtcLoginButton);
        }
    });
    checkLoginButton();
    checkBtcLoginButton();
    showPanel('settings');
    
    // 如果已經登入，立即檢查ngrok狀態
    if (sessionStorage.getItem('isLoggedIn') === '1') {
        refreshNgrokStatus();
    }
    
    // 頁面關閉時清理定時器
    window.addEventListener('beforeunload', function() {
        // 已移除延遲監控定時器清理 - Cloudflare Tunnel 不需要這些功能
    });
    
    // 初始化token管理
    initializeTokenManagement();
}

// 載入已上傳的檔案名稱
function loadUploadedFiles() {
    fetch('/api/uploaded_files')
    .then(res => res.json())
    .then(data => {
        if (data.holiday_file) {
            const holidayInput = document.getElementById('holiday_file');
            // 創建一個新的 FileList 物件來模擬已選擇的檔案
            const file = new File([], data.holiday_file, { type: 'text/csv' });
            const dt = new DataTransfer();
            dt.items.add(file);
            holidayInput.files = dt.files;
            document.getElementById('holiday-upload-status').innerText = `已選擇: ${data.holiday_file}`;
        }
        if (data.certificate_file) {
            const certInput = document.getElementById('ca_file');
            const file = new File([], data.certificate_file, { type: 'application/octet-stream' });
            const dt = new DataTransfer();
            dt.items.add(file);
            certInput.files = dt.files;
            document.getElementById('ca-upload-status').innerText = `已選擇: ${data.certificate_file}`;
        }
    })
    .catch(error => {
        // 靜默處理錯誤
    });
}

function downloadHoliday() {
    // 創建Modal元素
    const modal = document.createElement('div');
    modal.className = 'tg-help-tooltip'; // 使用相同的CSS類名
    modal.innerHTML = `
        <div class="tooltip-content">
            <h4>如何下載台股日曆</h4>
            <p>請按照以下步驟下載台股日曆：</p>
            <ol>
                <li>點擊下方按鈕前往台灣證券交易所</li>
                <li>下拉選單點選今年年份</li>
                <li>點擊「查詢」按鈕</li>
                <li>下載CSV檔案</li>
            </ol>
            <div class="tooltip-buttons">
                <button onclick="window.open('https://www.twse.com.tw/zh/trading/holiday.html', '_blank')" class="tooltip-btn primary">前往證交所</button>
                <button onclick="closeHolidayModal()" class="tooltip-btn secondary">關閉</button>
            </div>
        </div>
    `;
    
    // 添加到頁面
    document.body.appendChild(modal);
    
    // 顯示動畫
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
}

function closeHolidayModal() {
    const modal = document.querySelector('.tg-help-tooltip');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}


// 新的隧道設置函數
function showTunnelSetupModal(tunnelType = 'tx') {
    // 保存隧道類型到全局變量
    window.currentTunnelType = tunnelType;
    // 直接調用管理隧道設置
    showTunnelSetup();
}

function showNgrokSetupModalOld() {
    document.getElementById('ngrok-setup-modal').style.display = 'block';
    
    // 短暫延遲確保DOM元素完全可用
    setTimeout(() => {
        const tokenInput = document.getElementById('ngrok-authtoken-old');
        
                 // 從服務器載入已儲存的token
        fetch('/api/ngrok/token/load')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success' && data.authtoken && tokenInput) {
                tokenInput.value = data.authtoken;
            } else {
                if (tokenInput) {
                    tokenInput.value = '';
                }
            }
        })
        .catch(error => {
            if (tokenInput) {
                tokenInput.value = '';
            }
        });
        
        // 重置為隱藏狀態
        const eyeOpen = document.querySelector('.password-toggle-btn .eye-open');
        const eyeClosed = document.querySelector('.password-toggle-btn .eye-closed');
        
        if (tokenInput) {
            tokenInput.type = 'password';
        }
        if (eyeOpen) eyeOpen.style.display = 'block';
        if (eyeClosed) eyeClosed.style.display = 'none';
        
        const statusDiv = document.getElementById('setup-status');
        if (statusDiv) {
            statusDiv.innerHTML = '';
        }
    }, 100); // 100ms延遲
}

function closeTunnelSetupModal() {
    document.getElementById('tunnel-setup-modal').style.display = 'none';
    // 關閉modal時更新token狀態顯示  
    updateTokenStatus();
}

function setupNgrok() {
    const authtoken = document.getElementById('ngrok-authtoken-old').value.trim();
    const statusDiv = document.getElementById('setup-status-old');
    const setupBtn = document.getElementById('setup-ngrok-btn');
    
    if (!authtoken) {
        statusDiv.innerHTML = '<div style="color: red;">請輸入有效的 Cloudflare Tunnel token</div>';
        return;
    }
    
    setupBtn.disabled = true;
    setupBtn.textContent = '設置中...';
    statusDiv.innerHTML = '<div style="color: blue;">正在設置 Cloudflare Tunnel，請稍候...</div>';
    
    // 直接設置 Cloudflare Tunnel
    fetch('/api/ngrok/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authtoken: authtoken })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            statusDiv.innerHTML = '<div style="color: green;">設置成功！Cloudflare Tunnel 正在啟動中...</div>';
            
            // 延遲關閉模態窗口
            setTimeout(() => {
                closeNgrokSetupModal();
            }, 2000);
        } else {
            statusDiv.innerHTML = `<div style="color: red;">設置失敗：${data.message}</div>`;
        }
    })
    .catch(error => {
        statusDiv.innerHTML = `<div style="color: red;">設置失敗：${error.message}</div>`;
    })
    .finally(() => {
        setupBtn.disabled = false;
        setupBtn.textContent = '儲存並啟動';
    });
}



// Token管理函數
function clearNgrokToken() {
    if (confirm('確定要清除已儲存的 Cloudflare Tunnel token 嗎？')) {
        // 直接清空輸入框
        const tokenInput = document.getElementById('ngrok-authtoken-old');
        if (tokenInput) {
            tokenInput.value = '';
        }
        
        // 更新設置狀態顯示
        const setupStatus = document.getElementById('setup-status-old');
        if (setupStatus) {
            setupStatus.innerHTML = '<div style="color: green;">✓ Token 已清除</div>';
            setTimeout(() => {
                setupStatus.innerHTML = '';
            }, 3000);
        }
    }
}

function updateTokenStatus() {
    // 原本的token狀態顯示元素已移除，此函數現在主要用於其他元件的狀態同步
    // 如果需要，可以在此處添加其他需要更新的元素
}

// 頁面載入時更新token狀態
function initializeTokenManagement() {
    updateTokenStatus();
}

// 保留原registerNgrok函數作為備用（開啟註冊頁面）
function registerNgrok() {
    window.open('https://ngrok.com/signup', '_blank');
}

function login() {
    // 調用後端登入API
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'ok') {
            // 登入成功，立即設置前端狀態並切換面板
            sessionStorage.setItem('isLoggedIn', '1');
            window.isLoggedIn = true;
            showPanel('trade');
            
            // 延遲更新永豐API狀態，讓背景線程有時間完成登入
            setTimeout(() => {
                // 使用統一的API狀態更新函數
        updateApiStatus({
            apiEndpoint: '/api/sinopac/status',
            statusElementId: 'sinopac-api-status',
            accountElementId: 'sinopac-account-id',
            connectedText: 'API已連線',
            disconnectedText: 'API未連線'
        });
                updateFuturesContracts(); // 登入後更新期貨合約資訊
                updateAccountStatus(); // 登入後更新帳戶狀態
                updatePositionStatus(); // 登入後更新持倉狀態
                
                // 啟動帳戶自動更新
                startAccountAutoUpdate();
            }, 2000); // 延遲2秒
            
            // 自動啟動臨時隧道
            fetch('/api/tunnel/tx/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'temporary',
                    token: ''
                })
            })
            .then(res => res.json())
            .then(tunnelData => {
            })
            .catch(error => {
                console.error('TX隧道啟動失敗:', error);
            });
            
            // 立即顯示檢查中狀態
            updateTunnelStatus({
                status: 'checking',
                url: '-',
                message: '啟動隧道中...'
            });
            
            // 已移除延遲時間顯示 - Cloudflare Tunnel 不需要延遲監控
            
            // 每5000毫秒檢查一次隧道狀態，直到運行成功
            const statusCheckInterval = setInterval(() => {
                fetch('/api/ngrok/status')
                .then(res => res.json())
                .then(data => {
                    updateTunnelStatus(data);
                    if (data.status === 'running') {
                        clearInterval(statusCheckInterval);
                        // TX隧道啟動完成（不顯示系統日誌）
                        // 已移除延遲時間更新 - Cloudflare Tunnel 不需要延遲監控
                    }
                })
                .catch(error => {
                    console.error('檢查隧道狀態失敗：', error);
                });
            }, 5000);
        } else {
            alert('登入失敗！');
        }
    })
    .catch(error => {
        console.error('登入失敗：', error);
        alert('登入失敗：' + error.message);
    });
}

function logout() {
    // 調用後端登出API
    fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'ok') {
            // 登出成功，清除前端狀態並切換面板
            sessionStorage.removeItem('isLoggedIn');
            window.isLoggedIn = false;
            showPanel('settings');
            
            // 清除所有定時器
            // 已移除延遲和TTL監控定時器清理 - Cloudflare Tunnel 不需要這些功能
            if (window.requestsInterval) {
                clearInterval(window.requestsInterval);
                window.requestsInterval = null;
            }
            
            // 停止帳戶自動更新
            stopAccountAutoUpdate();
            
            // 更新永豐API狀態
            // 使用統一的API狀態更新函數
        updateApiStatus({
            apiEndpoint: '/api/sinopac/status',
            statusElementId: 'sinopac-api-status',
            accountElementId: 'sinopac-account-id',
            connectedText: 'API已連線',
            disconnectedText: 'API未連線'
        });
            
            alert('已成功登出TX帳戶！');
        } else {
            alert('登出失敗！');
        }
    })
    .catch(error => {
        console.error('登出失敗：', error);
        alert('登出失敗：' + error.message);
    });
}

// Cloudflare Tunnel 狀態檢查函數（保持原 ngrok 函數名以維持兼容性）
function refreshNgrokStatus() {
    refreshTunnelStatus('tx');
}

function refreshTunnelStatus(tunnelType = 'tx') {
    // 根據隧道類型使用不同的API端點
    const apiEndpoint = tunnelType === 'tx' ? '/api/ngrok/status' : `/api/tunnel/${tunnelType}/status`;
    
    fetch(apiEndpoint)
    .then(res => res.json())
    .then(data => {
        updateTunnelStatus(data, tunnelType);
    })
    .catch(error => {
        console.error(`獲取${tunnelType.toUpperCase()}隧道狀態失敗：`, error);
        updateTunnelStatus({
            status: 'stopped',
            url: '-',
            message: '隧道未啟動'
        }, tunnelType);
    });
}

// BTC面板切換函數
function toggleAvailablePairs() {
    const contractsList = document.getElementById('available-contracts-btc');
    const toggleIcon = document.getElementById('toggle-available-btc');
    
    if (contractsList.style.display === 'none') {
        contractsList.style.display = 'block';
        toggleIcon.classList.remove('collapsed');
        toggleIcon.classList.add('expanded');
    } else {
        contractsList.style.display = 'none';
        toggleIcon.classList.remove('expanded');
        toggleIcon.classList.add('collapsed');
    }
}

function toggleAccountInfo() {
    const accountInfo = document.getElementById('account-info-btc');
    const toggleIcon = document.getElementById('toggle-account-btc');
    
    if (accountInfo.style.display === 'none') {
        accountInfo.style.display = 'block';
        toggleIcon.classList.remove('collapsed');
        toggleIcon.classList.add('expanded');
    } else {
        accountInfo.style.display = 'none';
        toggleIcon.classList.remove('expanded');
        toggleIcon.classList.add('collapsed');
    }
}


// 獲取shioaji版本信息
function getSinopacVersion() {
    fetch('/api/sinopac/version')
    .then(res => res.json())
    .then(data => {
        const versionElement = document.getElementById('sinopac-version');
        
        if (data.available && data.version && data.version !== 'unknown') {
            versionElement.textContent = `sj${data.version}`;
            // 移除初啟動時的版本日誌記錄，只有更新檢查時才記錄
        } else if (!data.available) {
            versionElement.textContent = 'sj-N/A';
            // 移除初啟動時的警告日誌，只有更新檢查時才記錄
        } else {
            versionElement.textContent = 'sj-';
            // 移除初啟動時的警告日誌，只有更新檢查時才記錄
        }
        
        // 獲取版本後檢查更新
        // checkSinopacUpdate(); // 移除這行，避免重複檢查
    })
    .catch(error => {
        console.error('獲取shioaji版本失敗：', error);
        document.getElementById('sinopac-version').textContent = 'Error';
    });
}






function updateTunnelStatus(statusData, tunnelType = 'tx') {
    const statusElement = document.getElementById(tunnelType === 'btc' ? 'tunnel-status-btc' : 'tunnel-status');
    // 已移除延遲和TTL元素引用 - Cloudflare Tunnel 不需要這些監控
    const urlsContainer = document.getElementById(tunnelType === 'btc' ? 'tunnel-urls-container-btc' : 'tunnel-urls-container');
    
    // 檢查狀態是否改變，避免不必要的更新
    const currentStatus = statusElement.getAttribute('data-status');
    const newStatusText = getStatusText(statusData.status);
    
    if (currentStatus !== statusData.status) {
        // 狀態改變時才更新
        statusElement.textContent = newStatusText;
        statusElement.className = 'status-value ' + statusData.status;
        statusElement.setAttribute('data-status', statusData.status);
    }
    
    // 處理隧道狀態變化
    if (statusData.status === 'checking') {
        // 清除指定類型的定時器
        const intervalKey = `requestsInterval_${tunnelType}`;
        if (window[intervalKey]) {
            clearInterval(window[intervalKey]);
            window[intervalKey] = null;
        }
    } else if (statusData.status === 'running') {
        // 更新指定類型的請求日誌
        updateRequestsLog(tunnelType);
        // 每10秒更新一次請求日誌（與頁面初始化保持一致）
        const intervalKey = `requestsInterval_${tunnelType}`;
        if (!window[intervalKey]) {
            window[intervalKey] = setInterval(() => updateRequestsLog(tunnelType), 10000);
        }
    } else {
        // offline 或其他狀態，清除指定類型的請求日誌更新定時器
        const intervalKey = `requestsInterval_${tunnelType}`;
        if (window[intervalKey]) {
            clearInterval(window[intervalKey]);
            window[intervalKey] = null;
        }
    }
    
    // 更新URL列表
    urlsContainer.innerHTML = '';
    
    // 統一處理單個URL格式（優先）
    let url = null;
    
    // 優先檢查單個URL格式（排除'-'值）
    if ((statusData.public_url && statusData.public_url !== '-') || (statusData.url && statusData.url !== '-')) {
        url = statusData.public_url || statusData.url;
    }
    // 其次檢查tunnels陣列格式（兼容舊格式）
    else if (statusData.tunnels && statusData.tunnels.length > 0) {
        url = statusData.tunnels[0].public_url;
    }
    
    if (url) {
        const urlItem = document.createElement('div');
        urlItem.className = 'url-item';
        
        const urlValue = document.createElement('span');
        urlValue.className = 'url-value';
        urlValue.textContent = url;
        
        const copyBtn = document.createElement('button');
        copyBtn.className = 'url-copy-btn';
        copyBtn.textContent = '複製';
        copyBtn.onclick = function() {
            copyToClipboard(url, this);
        };
        
        urlItem.appendChild(urlValue);
        urlItem.appendChild(copyBtn);
        urlsContainer.appendChild(urlItem);
    } else {
        const noUrlsMsg = document.createElement('div');
        noUrlsMsg.className = 'url-item';
        noUrlsMsg.textContent = '無外網連結';
        noUrlsMsg.style.justifyContent = 'center';
        noUrlsMsg.style.color = '#6c757d';
        urlsContainer.appendChild(noUrlsMsg);
    }
    
    // 更新指定類型的請求日誌
    updateRequestsLog(tunnelType);
}

// 已移除延遲監控功能 - Cloudflare Tunnel 不需要延遲監控

// 已移除TTL監控功能 - Cloudflare Tunnel 不需要TTL監控

// 複製到剪貼板的函數
function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(function() {
        // 顯示複製成功
        const originalText = button.textContent;
        button.textContent = '已複製';
        button.classList.add('copied');
        
        setTimeout(function() {
            button.textContent = originalText;
            button.classList.remove('copied');
        }, 2000);
    }).catch(function(err) {
        console.error('複製失敗: ', err);
        alert('複製失敗，請手動複製');
    });
}

function getStatusText(status) {
    const statusTexts = {
        'stopped': 'offline',
        'checking': 'checking',
        'running': 'online',
        'error': 'offline',
        'online': 'online',
        'offline': 'offline'
    };
    return statusTexts[status] || status.toLowerCase();
}

function updateRequestsLog(tunnelType = 'tx') {
    // 根據隧道類型選擇API端點和DOM元素
    const apiEndpoint = tunnelType === 'tx' ? '/api/ngrok/requests' : `/api/tunnel/${tunnelType}/requests`;
    const requestsContainer = document.getElementById(tunnelType === 'btc' ? 'requests-container-btc' : 'requests-container');
    const requestsCount = document.getElementById(tunnelType === 'btc' ? 'requests-count-btc' : 'requests-count');
    
    fetch(apiEndpoint)
    .then(res => res.json())
    .then(data => {
        
        if (data.requests && data.requests.length > 0) {
            // 只顯示 webhook 請求（type=webhook 或 uri=/webhook）
            const webhookRequests = data.requests.filter(req => 
                req.type === 'webhook' || req.uri === '/webhook'
            );
            
            if (webhookRequests.length > 0) {
                // 更新請求數量顯示
                if (requestsCount) {
                    requestsCount.textContent = `${webhookRequests.length}`;
                }
                
                // 限制最多顯示50條記錄，並反轉順序（新的在上面）
                const limitedRequests = webhookRequests.slice(-50).reverse();
                
                requestsContainer.innerHTML = '';
                limitedRequests.forEach((req, index) => {
                    const requestItem = document.createElement('div');
                    requestItem.className = 'request-item';
                    
                    // 設置狀態顏色類別
                    let statusClass = 'success';
                    if (req.status >= 400) {
                        statusClass = 'error';
                    } else if (req.status >= 300) {
                        statusClass = 'warning';
                    }
                    
                    // 使用 ngrok 格式：時間戳 方法 URI 狀態碼 狀態文字
                    const displayTime = req.display_timestamp || req.timestamp;
                    requestItem.innerHTML = `
                        <span class="request-timestamp">${displayTime}</span>
                        <span class="request-method ${req.method.toLowerCase()}">${req.method}</span>
                        <span class="request-uri">${req.uri}</span>
                        <span class="request-status ${statusClass}">${req.status} ${req.status_text}</span>
                    `;
                    
                    requestsContainer.appendChild(requestItem);
                });
                
                // 保持在頂部位置顯示最新的記錄
                requestsContainer.scrollTop = 0;
            } else {
                // 沒有webhook請求但有其他請求
                if (requestsCount) {
                    requestsCount.textContent = '0';
                }
                requestsContainer.innerHTML = '';
                const noRequestsMsg = document.createElement('div');
                noRequestsMsg.className = 'request-item';
                noRequestsMsg.textContent = '無請求記錄';
                noRequestsMsg.style.justifyContent = 'center';
                noRequestsMsg.style.color = '#666';
                requestsContainer.appendChild(noRequestsMsg);
            }
        } else {
            // 完全沒有請求
            if (requestsCount) {
                requestsCount.textContent = '0';
            }
            requestsContainer.innerHTML = '';
            const noRequestsMsg = document.createElement('div');
            noRequestsMsg.className = 'request-item';
            noRequestsMsg.textContent = '無請求記錄';
            noRequestsMsg.style.justifyContent = 'center';
            noRequestsMsg.style.color = '#666';
            requestsContainer.appendChild(noRequestsMsg);
        }
    })
    .catch(error => {
        console.error('獲取請求日誌失敗：', error);
        const requestsContainer = document.getElementById('requests-container');
        requestsContainer.innerHTML = '<div class="request-item" style="color: #666; text-align: center;">無法獲取請求日誌</div>';
    });
}

function formatRequestTime(timestamp) {
    if (!timestamp) return '';
    
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        
        if (diffMins < 1) {
            return '剛剛';
        } else if (diffMins < 60) {
            return `${diffMins}分鐘前`;
        } else if (diffHours < 24) {
            return `${diffHours}小時前`;
        } else {
            return date.toLocaleString('zh-TW', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    } catch (e) {
        return '';
    }
}

// TX系統日誌相關函數
let systemLogs = []; // 儲存TX系統日誌的陣列

// BTC系統日誌相關函數
let btcSystemLogs = []; // 儲存BTC系統日誌的陣列

function addSystemLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-TW', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const logEntry = {
        timestamp: timestamp,
        message: message,
        type: type
    };
    
    systemLogs.push(logEntry);
    
    // 限制最多100條記錄
    if (systemLogs.length > 100) {
        systemLogs = systemLogs.slice(-100);
    }
    
    // 更新顯示
    updateSystemLogsDisplay();
    
    // 發送日誌到後端API（靜默處理，不阻塞前端）
    fetch('/api/system_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, type: type })
    }).catch(() => {
        // 靜默處理錯誤，不影響前端功能
    });
}

function addBtcSystemLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-TW', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const logEntry = {
        timestamp: timestamp,
        message: message,
        type: type
    };
    
    btcSystemLogs.push(logEntry);
    
    // 限制最多100條記錄
    if (btcSystemLogs.length > 100) {
        btcSystemLogs = btcSystemLogs.slice(-100);
    }
    
    // 更新顯示
    updateBtcSystemLogsDisplay();
    
    // 發送日誌到後端API（靜默處理，不阻塞前端）
    fetch('/api/btc_system_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message, type: type })
    }).catch(() => {
        // 靜默處理錯誤，不影響前端功能
    });
}

// 新增：從後端同步BTC系統日誌
function updateBtcSystemLogsFromBackend() {
    fetch('/api/ngrok/requests')
        .then(res => res.json())
        .then(data => {
            if (data.requests && data.requests.length > 0) {
                // 過濾 BTC 系統日誌
                const btcCustomLogs = data.requests
                    .filter(log => {
                        // 只接受明確標記為 BTC 系統日誌的記錄
                        const isBtcLog = log.uri === '/api/btc_system_log' ||
                                       (log.extra_info && log.extra_info.system === 'BTC');
                        return isBtcLog;
                    })
                    .map(log => {
                        // 解析後端日誌格式
                        let message = '';
                        let type = 'info';
                        
                        // 優先檢查 extra_info 中的 message 和 type
                        if (log.extra_info && log.extra_info.message) {
                            message = log.extra_info.message;
                            type = log.extra_info.type || 'info';
                        } else if (log.message) {
                            message = log.message;
                            type = 'info';
                        } else if (log.uri === '/api/btc_system_log') {
                            // 跳過沒有訊息內容的 API 請求日誌
                            return null;
                        } else {
                            message = log.uri || '';
                            type = log.status >= 400 ? 'error' : (log.status >= 300 ? 'warning' : 'info');
                        }
                        
                        // 格式化時間戳為 時:分:秒 格式
                        let formattedTimestamp = '';
                        if (log.display_timestamp) {
                            formattedTimestamp = log.display_timestamp.replace(' CST', '').split('.')[0];
                        } else if (log.timestamp) {
                            try {
                                if (log.timestamp.includes(' CST')) {
                                    const timePart = log.timestamp.replace(' CST', '');
                                    if (timePart.includes(' ') && timePart.length > 12) {
                                        const timeOnly = timePart.split(' ')[1];
                                        formattedTimestamp = timeOnly.split('.')[0];
                                    } else {
                                        formattedTimestamp = timePart.split('.')[0];
                                    }
                                } else {
                                    formattedTimestamp = log.timestamp;
                                }
                            } catch (e) {
                                formattedTimestamp = log.timestamp;
                            }
                        }
                        
                        return {
                            timestamp: formattedTimestamp,
                            fullTimestamp: log.timestamp,
                            message: message,
                            type: type
                        };
                    })
                    .filter(log => log !== null);
                
                // 合併本地和後端BTC日誌
                if (btcCustomLogs.length > 0) {
                    const existingMessages = new Set(btcSystemLogs.map(log => `${log.timestamp}-${log.message}`));
                    const newLogs = btcCustomLogs.filter(log => {
                        const logKey = `${log.timestamp}-${log.message}`;
                        return !existingMessages.has(logKey);
                    });
                    
                    if (newLogs.length > 0) {
                        const allLogs = [...btcSystemLogs, ...newLogs];
                        
                        // 按完整時間戳排序
                        allLogs.sort((a, b) => {
                            const timeA = a.fullTimestamp || a.timestamp || '';
                            const timeB = b.fullTimestamp || b.timestamp || '';
                            
                            if (timeA.includes('-') && timeB.includes('-')) {
                                const dateA = new Date(timeA.replace(' CST', ''));
                                const dateB = new Date(timeB.replace(' CST', ''));
                                return dateA.getTime() - dateB.getTime();
                            }
                            
                            return timeA.localeCompare(timeB);
                        });
                        
                        btcSystemLogs = allLogs.slice(-100);
                        updateBtcSystemLogsDisplay();
                    }
                }
            }
        })
        .catch(error => {
            // 靜默處理錯誤
        });
}

// 新增：從後端同步TX系統日誌
function updateSystemLogsFromBackend() {
    fetch('/api/ngrok/requests')
        .then(res => res.json())
        .then(data => {
            if (data.requests && data.requests.length > 0) {
                // 過濾 TX 系統日誌（排除 BTC 相關日誌）
                const customLogs = data.requests
                    .filter(log => {
                        const isSystemLog = (log.type === 'custom' || log.type === 'webhook') || 
                                          (log.uri === '/api/system_log') || 
                                          (log.extra_info && log.extra_info.message);
                        
                        // 排除 BTC 相關日誌
                        const isBtcLog = log.uri === '/api/btc_system_log' ||
                                       (log.extra_info && log.extra_info.system === 'BTC');
                        
                        // 排除 webhook 相關日誌
                        const isWebhookLog = log.uri === '/webhook' || 
                                           log.uri === '/webhook/btc' || 
                                           log.uri === '/api/btc/webhook' ||
                                           (log.extra_info && log.extra_info.message && 
                                            (log.extra_info.message.includes('來自webhook') ||
                                             log.extra_info.message.includes('webhook')));
                        
                        return isSystemLog && !isBtcLog && !isWebhookLog;
                    })
                    .map(log => {
                        // 解析後端日誌格式
                        let message = '';
                        let type = 'info';
                        
                        // 優先檢查 extra_info 中的 message 和 type（系統日誌的正確格式）
                        if (log.extra_info && log.extra_info.message) {
                            message = log.extra_info.message;
                            type = log.extra_info.type || 'info';
                        } else if (log.message) {
                            message = log.message;
                            type = 'info';
                        } else if (log.uri === '/api/system_log') {
                            // 如果是系統日誌API但沒有message，跳過
                            return null;
                        } else {
                            message = log.uri || '';
                            type = log.status >= 400 ? 'error' : (log.status >= 300 ? 'warning' : 'info');
                        }
                        
                        // 格式化時間戳為 時:分:秒 格式
                        let formattedTimestamp = '';
                        if (log.display_timestamp) {
                            // 使用顯示用時間戳（已經只有時分秒）
                            formattedTimestamp = log.display_timestamp.replace(' CST', '').split('.')[0];
                        } else if (log.timestamp) {
                            try {
                                // 解析 ngrok 格式的時間戳 (YYYY-MM-DD HH:MM:SS.mmm CST 或 HH:MM:SS.mmm CST)
                                if (log.timestamp.includes(' CST')) {
                                    const timePart = log.timestamp.replace(' CST', '');
                                    
                                    // 檢查是否包含日期
                                    if (timePart.includes(' ') && timePart.length > 12) {
                                        // 格式: YYYY-MM-DD HH:MM:SS.mmm - 只取時間部分
                                        const timeOnly = timePart.split(' ')[1]; // 取第二部分（時間）
                                        formattedTimestamp = timeOnly.split('.')[0]; // 移除毫秒
                                    } else {
                                        // 格式: HH:MM:SS.mmm - 直接處理
                                        formattedTimestamp = timePart.split('.')[0]; // 移除毫秒
                                    }
                                } else {
                                    // 如果是其他格式，嘗試解析
                                    const date = new Date(log.timestamp);
                                    formattedTimestamp = date.toLocaleTimeString('zh-TW', {
                                        hour12: false,
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit'
                                    });
                                }
                            } catch (e) {
                                formattedTimestamp = log.timestamp;
                            }
                        }
                        
                        return {
                            timestamp: formattedTimestamp,
                            fullTimestamp: log.timestamp, // 保留完整時間戳用於排序
                            message: message,
                            type: type
                        };
                    })
                    .filter(log => log !== null); // 過濾掉null值
                
                // 合併本地和後端日誌，保留最新的100條
                if (customLogs.length > 0) {
                    // 合併本地和後端日誌，避免重複
                    const existingMessages = new Set(systemLogs.map(log => `${log.timestamp}-${log.message}`));
                    const newLogs = customLogs.filter(log => {
                        const logKey = `${log.timestamp}-${log.message}`;
                        return !existingMessages.has(logKey);
                    });
                    
                    if (newLogs.length > 0) {
                        // 合併並按時間戳排序
                        const allLogs = [...systemLogs, ...newLogs];
                        
                        // 按完整時間戳排序（包含年月日）
                        allLogs.sort((a, b) => {
                            // 嘗試從原始時間戳提取完整日期時間進行排序
                            const timeA = a.fullTimestamp || a.timestamp || '';
                            const timeB = b.fullTimestamp || b.timestamp || '';
                            
                            // 如果有完整時間戳，使用Date對象比較
                            if (timeA.includes('-') && timeB.includes('-')) {
                                const dateA = new Date(timeA.replace(' CST', ''));
                                const dateB = new Date(timeB.replace(' CST', ''));
                                return dateA.getTime() - dateB.getTime();
                            }
                            
                            // 否則使用字符串比較
                            return timeA.localeCompare(timeB);
                        });
                        
                        // 保留最新的100條記錄
                        systemLogs = allLogs.slice(-100);
                        updateSystemLogsDisplay();
                    }
                }
            }
        })
        .catch(error => {
            // 靜默處理錯誤，不影響前端功能
        });
}

function updateSystemLogsDisplay() {
    const logsContainer = document.getElementById('system-logs-content');
    if (!logsContainer) return;
    
    if (systemLogs.length > 0) {
        // 按照完整時間戳排序（年月日時分秒）- 最新的在下方
        const sortedLogs = [...systemLogs].sort((a, b) => {
            // 生成完整時間戳用於排序
            const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
            const timeA = `${today} ${a.timestamp}`;
            const timeB = `${today} ${b.timestamp}`;
            return new Date(timeA) - new Date(timeB);
        });
        
        logsContainer.innerHTML = '';
        sortedLogs.forEach((log, index) => {
            const logItem = document.createElement('div');
            logItem.className = 'log-item';
            
            // 根據日誌類型和內容設置顏色
            let typeClass = '';
            
            // 特殊處理API連線異常訊息，顯示為橘色
            if (log.message && log.message.includes('API連線異常')) {
                typeClass = 'warning';
            } else {
                switch(log.type) {
                    case 'error':
                        typeClass = 'error';
                        break;
                    case 'warning':
                        typeClass = 'warning';
                        break;
                    case 'success':
                        typeClass = 'success';
                        break;
                    default:
                        typeClass = 'info';
                }
            }
            
            logItem.innerHTML = `
                <span class="log-timestamp">${log.timestamp}</span>
                <span class="log-message ${typeClass}">${log.message}</span>
            `;
            
            logsContainer.appendChild(logItem);
        });
        
        // 自動捲動到最底部顯示最新的記錄
        const systemLogsContainer = logsContainer.parentElement;
        systemLogsContainer.scrollTop = systemLogsContainer.scrollHeight;
    } else {
        logsContainer.innerHTML = '';
        const noLogsMsg = document.createElement('div');
        noLogsMsg.className = 'log-item';
        noLogsMsg.style.justifyContent = 'center';
        noLogsMsg.style.color = '#666';
        noLogsMsg.style.textAlign = 'center';
        noLogsMsg.style.width = '100%';
        noLogsMsg.textContent = '無系統日誌';
        logsContainer.appendChild(noLogsMsg);
    }
}

function updateBtcSystemLogsDisplay() {
    const logsContainer = document.getElementById('system-logs-content-btc');
    if (!logsContainer) return;
    
    if (btcSystemLogs.length > 0) {
        // 按照完整時間戳排序（年月日時分秒）- 最新的在下方
        const sortedLogs = [...btcSystemLogs].sort((a, b) => {
            // 生成完整時間戳用於排序
            const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
            const timeA = `${today} ${a.timestamp}`;
            const timeB = `${today} ${b.timestamp}`;
            return new Date(timeA) - new Date(timeB);
        });
        
        logsContainer.innerHTML = '';
        sortedLogs.forEach((log, index) => {
            const logItem = document.createElement('div');
            logItem.className = 'log-item';
            
            // 根據日誌類型和內容設置顏色
            let typeClass = '';
            
            // 特殊處理API連線異常訊息，顯示為橘色
            if (log.message && log.message.includes('API連線異常')) {
                typeClass = 'warning';
            } else {
                switch(log.type) {
                    case 'error':
                        typeClass = 'error';
                        break;
                    case 'warning':
                        typeClass = 'warning';
                        break;
                    case 'success':
                        typeClass = 'success';
                        break;
                    default:
                        typeClass = 'info';
                }
            }
            
            logItem.innerHTML = `
                <span class="log-timestamp">${log.timestamp}</span>
                <span class="log-message ${typeClass}">${log.message}</span>
            `;
            
            logsContainer.appendChild(logItem);
        });
        
        // 自動捲動到最底部顯示最新的記錄
        const btcSystemLogsContainer = logsContainer.parentElement;
        btcSystemLogsContainer.scrollTop = btcSystemLogsContainer.scrollHeight;
    } else {
        logsContainer.innerHTML = '';
        const noLogsMsg = document.createElement('div');
        noLogsMsg.className = 'log-item';
        noLogsMsg.style.justifyContent = 'center';
        noLogsMsg.style.color = '#666';
        noLogsMsg.style.textAlign = 'center';
        noLogsMsg.style.width = '100%';
        noLogsMsg.textContent = '無系統日誌';
        logsContainer.appendChild(noLogsMsg);
    }
}

// 更新右側系統資訊
function updateSystemInfo() {
    // 更新啟動時間
    const startTimeElement = document.getElementById('start-time');
    if (startTimeElement && !startTimeElement.dataset.initialized) {
        const now = new Date();
        const timeString = now.toLocaleDateString('zh-TW') + ' ' + now.toLocaleTimeString('zh-TW');
        startTimeElement.textContent = timeString;
        startTimeElement.dataset.initialized = 'true';
        startTimeElement.dataset.startTime = now.getTime();
    }
    
    // 更新運行時間
    const uptimeElement = document.getElementById('uptime');
    if (uptimeElement && startTimeElement && startTimeElement.dataset.startTime) {
        const startTime = parseInt(startTimeElement.dataset.startTime);
        const currentTime = new Date().getTime();
        const uptimeMs = currentTime - startTime;
        const uptimeSeconds = Math.floor(uptimeMs / 1000);
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        uptimeElement.textContent = `${hours}時${minutes}分${seconds}秒`;
    }
    
    // 更新永豐API狀態和帳戶ID
    updateSinopacApiStatus();
    
    // 更新連接狀態
    const connectionStatusElement = document.getElementById('connection-status');
    if (connectionStatusElement) {
        // 根據 ngrok 狀態更新連接狀態
        const ngrokStatus = document.getElementById('ngrok-status');
        if (ngrokStatus && ngrokStatus.textContent.includes('運行中')) {
            connectionStatusElement.textContent = '已連接';
            connectionStatusElement.style.color = '#27ae60';
        } else {
            connectionStatusElement.textContent = '本機模式';
            connectionStatusElement.style.color = '#f39c12';
        }
    }
}

// 更新永豐API狀態
async function updateSinopacApiStatus() {
    try {
        const response = await fetch('/api/sinopac/status');
        const data = await response.json();
        
        const statusElement = document.getElementById('sinopac-api-status');
        const accountElement = document.getElementById('sinopac-account-id');
        const durationElement = document.getElementById('connection-duration');
        
        if (statusElement && accountElement) {
            // 更新連線狀態 (三種狀態)
            if (data.connected && data.api_ready) {
                statusElement.textContent = 'API已連線';
                statusElement.className = 'status-value running';  // 綠色
                
                // 顯示連線時長
                if (durationElement) {
                    durationElement.style.display = 'inline';
                    updateConnectionDuration();
                }
            } else if (data.connected) {
                statusElement.textContent = 'API連線中';
                statusElement.className = 'status-value checking';  // 灰色，與ngrok的online狀態一樣
                
                // 顯示連線時長（但可能顯示「未連線」）
                if (durationElement) {
                    durationElement.style.display = 'inline';
                    updateConnectionDuration();
                }
            } else {
                statusElement.textContent = 'API未連線';
                statusElement.className = 'status-value stopped';  // 紅色
                
                // 顯示連線時長（顯示「-」）
                if (durationElement) {
                    durationElement.style.display = 'inline';
                    durationElement.textContent = '-';
                    durationElement.style.color = '#6c757d'; // 正常灰色
                }
            }
            
            // 更新期貨帳號 (三種狀態)
            accountElement.textContent = data.futures_account;
        }
        
    } catch (error) {
        // 發生錯誤時顯示未連線
        const statusElement = document.getElementById('sinopac-api-status');
        const accountElement = document.getElementById('sinopac-account-id');
        const durationElement = document.getElementById('connection-duration');
        
        if (statusElement && accountElement) {
            statusElement.textContent = '未連線';
            statusElement.className = 'status-value stopped';
            accountElement.textContent = '未獲取帳戶';
        }
        
        // 顯示連線時長（顯示「-」）
        if (durationElement) {
            durationElement.style.display = 'inline';
            durationElement.textContent = '-';
            durationElement.style.color = '#6c757d'; // 正常灰色
        }
    }
}

// 更新幣安API狀態
async function updateBinanceApiStatus() {
    try {
        const response = await fetch('/api/btc/trading/status');
        const data = await response.json();
        
        const statusElement = document.getElementById('binance-api-status');
        const accountElement = document.getElementById('binance-account-id');
        const versionElement = document.getElementById('binance-version');
        
        if (statusElement && accountElement) {
            // 更新連線狀態
            if (data.success && data.status === 'connected') {
                statusElement.textContent = 'API已連線';
                statusElement.className = 'status-value running';  // 綠色
                
                // 從btc.env獲取幣安用戶ID
                fetch('/api/load_btc_env')
                .then(res => res.json())
                .then(btcEnv => {
                    const binanceUserId = btcEnv.BINANCE_USER_ID;
                    if (binanceUserId && binanceUserId.trim()) {
                        accountElement.textContent = binanceUserId;
                    } else {
                        accountElement.textContent = '無幣安帳戶';
                    }
                })
                .catch(() => {
                    accountElement.textContent = '無幣安帳戶';
                });
            } else if (data.status === 'disconnected' || data.status === 'no_account_info') {
                statusElement.textContent = 'API未連線';
                statusElement.className = 'status-value stopped';  // 紅色
                accountElement.textContent = '無幣安帳戶';
            } else {
                statusElement.textContent = 'API連線中';
                statusElement.className = 'status-value checking';  // 灰色
                accountElement.textContent = '檢查中...';
            }
        }
        
        // 更新版本信息
        if (versionElement) {
            if (data.success && data.status === 'connected') {
                const versionResponse = await fetch('/api/btc/version');
                const versionData = await versionResponse.json();
                if (versionData.success) {
                    versionElement.textContent = versionData.version;
                } else {
                    versionElement.textContent = '-';
                }
            } else {
                versionElement.textContent = '-';
            }
        }
        
    } catch (error) {
        // 發生錯誤時顯示未連線
        const statusElement = document.getElementById('binance-api-status');
        const accountElement = document.getElementById('binance-account-id');
        const versionElement = document.getElementById('binance-version');
        
        if (statusElement && accountElement) {
            statusElement.textContent = 'API未連線';
            statusElement.className = 'status-value stopped';
            accountElement.textContent = '無幣安帳戶';
        }
        
        if (versionElement) {
            versionElement.textContent = '-';
        }
    }
}

// 更新連線時長 - TX
async function updateConnectionDuration() {
    try {
        const response = await fetch('/api/connection/duration');
        const data = await response.json();
        
        const durationElement = document.getElementById('connection-duration');
        if (durationElement) {
            if (data.status === 'success') {
                const durationHours = data.duration_hours;
                const remainingHours = data.remaining_hours;
                
                // 檢查是否未連線
                if (durationHours === -1) {
                    durationElement.textContent = '-';
                    durationElement.style.color = '#6c757d'; // 正常灰色
                    return;
                }
                
                // 格式化顯示 - 與BTC保持一致的格式
                let durationText;
                if (durationHours < 1) {
                    const durationMinutes = Math.floor(durationHours * 60);
                    durationText = `${durationMinutes}M`;
                } else {
                    durationText = `${durationHours.toFixed(1)}H`;
                }
                
                // 如果剩餘時間少於1小時，顯示警告顏色
                if (remainingHours < 1) {
                    durationElement.style.color = '#FF9800'; // 橙色警告
                } else {
                    durationElement.style.color = '#6c757d'; // 正常灰色
                }
                
                durationElement.textContent = durationText;
            } else {
                // API返回錯誤狀態
                durationElement.textContent = '-';
                durationElement.style.color = '#6c757d'; // 正常灰色
            }
        }
    } catch (error) {
        // API調用失敗時顯示「-」
        const durationElement = document.getElementById('connection-duration');
        if (durationElement) {
            durationElement.textContent = '-';
            durationElement.style.color = '#6c757d'; // 正常灰色
        }
        console.error('獲取連線時長失敗:', error);
    }
}

// 更新BTC連線時長 - 基於登入時間計算
function updateBtcConnectionDuration() {
    const btcDurationElement = document.getElementById('connection-duration-btc');
    if (!btcDurationElement) return;
    
    const btcLoginTime = sessionStorage.getItem('btcLoginTime');
    const isBtcLoggedIn = sessionStorage.getItem('isBtcLoggedIn');
    
    if (isBtcLoggedIn === '1' && btcLoginTime) {
        const loginTime = new Date(btcLoginTime);
        const currentTime = new Date();
        const durationMs = currentTime - loginTime;
        const durationHours = durationMs / (1000 * 60 * 60);
        
        // 格式化顯示
        let durationText;
        if (durationHours < 1) {
            const durationMinutes = Math.floor(durationMs / (1000 * 60));
            durationText = `${durationMinutes}M`;
        } else {
            durationText = `${durationHours.toFixed(1)}H`;
        }
        
        btcDurationElement.textContent = durationText;
        btcDurationElement.style.color = '#6c757d'; // 正常灰色
    } else {
        btcDurationElement.textContent = '-';
        btcDurationElement.style.color = '#6c757d'; // 正常灰色
    }
}

// 更新今日請求統計
function updateTodayRequests() {
    const todayRequestsElement = document.getElementById('today-requests');
    if (todayRequestsElement) {
        // 從 ngrok 請求日誌中計算
        const requestsContainer = document.getElementById('requests-container');
        if (requestsContainer) {
            const requestItems = requestsContainer.querySelectorAll('.request-item');
            // 排除 "無請求記錄" 的訊息項目
            const actualRequests = Array.from(requestItems).filter(item => 
                !item.textContent.includes('無請求記錄') && 
                !item.textContent.includes('無法獲取請求日誌')
            );
            todayRequestsElement.textContent = actualRequests.length.toString();
        }
    }
}

// 更新活躍會話數
function updateActiveSessions() {
    const activeSessionsElement = document.getElementById('active-sessions');
    if (activeSessionsElement) {
        // 檢查 ngrok 連接狀態來模擬活躍會話
        const ngrokStatus = document.getElementById('ngrok-status');
        if (ngrokStatus && ngrokStatus.textContent.includes('運行中')) {
            activeSessionsElement.textContent = '1';
        } else {
            activeSessionsElement.textContent = '0';
        }
    }
}

function updateFuturesContracts() {
    fetch('/api/futures/contracts')
    .then(res => res.json())
    .then(data => {
        if (data.selected_contracts) {
            // 更新選用合約顯示
            document.getElementById('txf-contract').textContent = data.selected_contracts.TXF;
            document.getElementById('mxf-contract').textContent = data.selected_contracts.MXF;
            document.getElementById('tmf-contract').textContent = data.selected_contracts.TMF;
        }
        
        if (data.available_contracts) {
            // 更新可用合約列表
            updateAvailableContracts('TXF', data.available_contracts.TXF);
            updateAvailableContracts('MXF', data.available_contracts.MXF);
            updateAvailableContracts('TMF', data.available_contracts.TMF);
        }
    })
    .catch(error => {
        console.error('獲取期貨合約資訊失敗：', error);
        // 錯誤時顯示 "-"
        document.getElementById('txf-contract').textContent = '-';
        document.getElementById('mxf-contract').textContent = '-';
        document.getElementById('tmf-contract').textContent = '-';
    });
}

function updateAvailableContracts(code, contracts) {
    const containerId = `${code.toLowerCase()}-available`;
    const container = document.getElementById(containerId);
    
    if (!container) return;
    
    if (!contracts || contracts.length === 0) {
        container.innerHTML = '<div class="contract-item">無可用合約</div>';
        return;
    }
    
    container.innerHTML = '';
    contracts.forEach(contract => {
        const contractDiv = document.createElement('div');
        contractDiv.className = 'contract-item';
        contractDiv.innerHTML = `
            <span class="contract-code">${contract.code}</span>
            <span class="contract-details">交割日期: ${contract.delivery_date}｜交割月份: ${contract.delivery_month}｜名稱: ${contract.name}</span>
        `;
        container.appendChild(contractDiv);
    });
}

// 切換可用合約顯示/隱藏
function toggleAvailableContracts() {
    const contractsDiv = document.getElementById('available-contracts');
    const toggleIcon = document.getElementById('toggle-available');
    
    if (contractsDiv.style.display === 'none') {
        contractsDiv.style.display = 'block';
        toggleIcon.classList.remove('collapsed');
    } else {
        contractsDiv.style.display = 'none';
        toggleIcon.classList.add('collapsed');
    }
}

// 切換選用合約顯示/隱藏
function toggleSelectedContracts() {
    const containerDiv = document.getElementById('system-info-container');
    const toggleIcon = document.getElementById('toggle-selected');
    
    if (containerDiv.style.display === 'none') {
        containerDiv.style.display = 'block';
        toggleIcon.classList.remove('collapsed');
    } else {
        containerDiv.style.display = 'none';
        toggleIcon.classList.add('collapsed');
    }
}

// 檢查是否需要定時更新合約資訊（每個交易日14:50）
function checkScheduledUpdate() {
    const now = new Date();
    const currentTime = now.getHours() * 100 + now.getMinutes(); // HHMM格式
    
    // 只有在交易日的14:50才更新
    if (currentTime === 1450) {
        // 檢查今天是否為交易日
        fetch('/api/trading/status')
        .then(res => res.json())
        .then(data => {
            if (data.is_trading_day) {
                        updateFuturesContracts();
            }
            // 非交易日時不輸出任何訊息
        })
        .catch(error => {
            // API錯誤時也不輸出訊息，靜默處理
        });
    }
}

// 更新本地時間顯示 - TX和BTC共用同一個時間源
function updateCurrentTime() {
    const datetimeElement = document.getElementById('current-datetime');
    const btcDatetimeElement = document.getElementById('current-datetime-btc');
    const weekdayElement = document.getElementById('weekday-status');
    const btcWeekdayElement = document.getElementById('weekday-status-btc');
    
    // 生成時間字符串 - 只計算一次
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const timeString = `${year}/${month}/${day} ${hour}:${minute}:${second}`;
    
    // 星期幾字符串 - 只計算一次
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];
    
    // 更新TX時間
    if (datetimeElement) {
        datetimeElement.textContent = timeString;
    }
    
    // 更新BTC時間 - 使用相同的時間源
    if (btcDatetimeElement) {
        btcDatetimeElement.textContent = timeString;
    }
    
    // 更新TX星期幾
    if (weekdayElement) {
        weekdayElement.textContent = weekday;
        weekdayElement.className = 'ngrok-latency';
    }
    
    // 更新BTC星期幾
    if (btcWeekdayElement) {
        btcWeekdayElement.textContent = weekday;
        btcWeekdayElement.className = 'ngrok-latency';
    }
}

// 更新交割日和交易日狀態
function updateTradingStatus() {
    fetch('/api/trading/status')
    .then(res => res.json())
    .then(data => {
        const deliveryElement = document.getElementById('delivery-status');
        const tradingElement = document.getElementById('trading-status');
        const marketElement = document.getElementById('market-status');
        
        if (deliveryElement && tradingElement && marketElement) {
            // 更新交割日狀態
            deliveryElement.textContent = data.delivery_day_status;
            deliveryElement.className = 'ngrok-latency';
            
            // 更新交易日狀態
            tradingElement.textContent = data.trading_day_status;
            tradingElement.className = 'ngrok-latency';
            
            // 更新開市/關市狀態
            marketElement.textContent = data.market_status;
            marketElement.className = 'ngrok-latency';
        }
    })
    .catch(error => {
        console.error('獲取交易狀態失敗：', error);
        const deliveryElement = document.getElementById('delivery-status');
        const tradingElement = document.getElementById('trading-status');
        const marketElement = document.getElementById('market-status');
        
        if (deliveryElement) {
            deliveryElement.textContent = '-';
            deliveryElement.className = 'ngrok-latency';
        }
        
        if (tradingElement) {
            tradingElement.textContent = '-';
            tradingElement.className = 'ngrok-latency';
        }
        
        if (marketElement) {
            marketElement.textContent = '-';
            marketElement.className = 'ngrok-latency';
        }
    });
}

// 載入環境變數
function loadEnv() {
    fetch('/api/load_env')
    .then(res => res.json())
    .then(env => {
        document.getElementById('chat_id').value = env.CHAT_ID || '';
        document.getElementById('api_key').dataset.raw = env.API_KEY || '';
        document.getElementById('secret_key').dataset.raw = env.SECRET_KEY || '';
        document.getElementById('person_id').dataset.raw = env.PERSON_ID || '';
        document.getElementById('ca_passwd').dataset.raw = env.CA_PASSWD || '';
        document.getElementById('cert_start').value = env.CERT_START || '';
        document.getElementById('cert_end').value = env.CERT_END || '';
        
        // 同步sessionStorage，確保空值也被正確處理
        sessionStorage.setItem('api_key_raw', env.API_KEY || '');
        sessionStorage.setItem('secret_key_raw', env.SECRET_KEY || '');
        sessionStorage.setItem('person_id_raw', env.PERSON_ID || '');
        sessionStorage.setItem('ca_passwd_raw', env.CA_PASSWD || '');
        
        ['api_key', 'secret_key', 'person_id', 'ca_passwd'].forEach(id => {
            const input = document.getElementById(id);
            input.dataset.saved = 'true';
        });
        setMaskedFields();
        
        // 檢查是否有空值，如果有則確保登出狀態
        const requiredFields = ['CHAT_ID', 'API_KEY', 'SECRET_KEY', 'PERSON_ID', 'CA_PASSWD', 'CERT_START', 'CERT_END'];
        let hasEmptyFields = false;
        for (const key of requiredFields) {
            if (!env[key] || !env[key].trim()) {
                hasEmptyFields = true;
                break;
            }
        }
        
        if (hasEmptyFields) {
            // 確保登出狀態
            sessionStorage.removeItem('isLoggedIn');
            window.isLoggedIn = false;
            showPanel('settings');
        }
        
        checkLoginButton();
    })
    .catch(error => {
        console.error('載入環境變數失敗：', error);
    });
}

// 載入程式版本信息
function loadAppVersion() {
    fetch('/api/app/version')
    .then(res => res.json())
    .then(data => {
        const versionElement = document.getElementById('app-version');
        if (versionElement) {
            versionElement.textContent = `v${data.version}`;
            versionElement.title = `版本: ${data.version}\n建置: ${data.build}\n發佈日期: ${data.release_date}\n說明: ${data.description}`;
        }
    })
    .catch(error => {
        console.error('載入版本信息失敗：', error);
        const versionElement = document.getElementById('app-version');
        if (versionElement) {
            versionElement.textContent = 'v?.?.?';
            versionElement.title = '版本信息載入失敗';
        }
    });
}

// 頁面載入時的初始化
document.addEventListener('DOMContentLoaded', () => {
    // 顯示設置面板
    showPanel('settings');
    
    // 更新儲存按鈕狀態
    loadEnv();
    
    // 立即檢查登入按鈕狀態
    checkLoginButton();
    
    // 定期檢查登入按鈕狀態
    setInterval(checkLoginButton, 1000);
    setInterval(checkBtcLoginButton, 1000);
    
    // 載入已上傳的檔案狀態
    loadUploadedFiles();
    
    // 載入程式版本信息
    loadAppVersion();
    
    // 定期檢查版本更新 (每5分鐘檢查一次)
    setInterval(loadAppVersion, 300000);
    
    // 當頁面重新獲得焦點時重新載入版本
    window.addEventListener('focus', loadAppVersion);
    
    // 初始化token管理狀態
    initializeTokenManagement();
    
    // 預設選擇免費臨時域名模式
    if (typeof setDomainMode === 'function') {
        setDomainMode('temporary');
    }
    
    // 初始化側邊欄滾動檢測
    initSidebarScrollDetection();
    
    // 開始定期更新隧道狀態和請求日誌
    // TX隧道狀態檢查
    refreshTunnelStatus('tx');
    setInterval(() => refreshTunnelStatus('tx'), 30000);
    
    // BTC隧道狀態檢查
    refreshTunnelStatus('btc');
    setInterval(() => refreshTunnelStatus('btc'), 30000);
    
    // 請求日誌更新 - 為TX和BTC分別更新
    updateRequestsLog('tx');
    updateRequestsLog('btc');
    setInterval(() => {
        updateRequestsLog('tx');
        updateRequestsLog('btc');
    }, 10000);
    // 已移除延遲和TTL監控的初始化 - Cloudflare Tunnel 不需要這些功能
    
    // 初始化系統資訊
    updateSystemInfo();
    setInterval(updateSystemInfo, 1000); // 每秒更新一次
    
    // 初始化永豐API狀態和期貨合約資訊
    updateSinopacApiStatus();
    updateBinanceApiStatus();
    updateFuturesContracts(); // 頁面載入時更新期貨合約資訊
    getSinopacVersion(); // 頁面載入時獲取shioaji版本
    updateCurrentTime(); // 頁面載入時立即顯示本地時間
    updateTradingStatus(); // 頁面載入時更新交易狀態
    setInterval(updateSinopacApiStatus, 5000); // 每5秒更新一次永豐API狀態
    setInterval(updateBinanceApiStatus, 300000); // 每5分鐘更新一次幣安API狀態
    
    // BTC帳戶資訊和持倉狀態定期更新 - 已移至智能更新機制
    setInterval(updateCurrentTime, 1000); // 每秒更新一次本地時間
    setInterval(updateTradingStatus, 30000); // 每30秒更新一次交易狀態
    
    // BTC連線時長更新
    updateBtcConnectionDuration(); // 立即更新一次
    setInterval(updateBtcConnectionDuration, 60000); // 每分鐘更新一次
    
    // BTC實時數據更新 - 與TX相同的更新頻率
    setInterval(() => {
        if (sessionStorage.getItem('isBtcLoggedIn') === '1') {
            updateBtcRealtimeData();
        }
    }, 300000); // 每5分鐘更新一次實時數據
    
    
    
    // 設置定時更新（每分鐘檢查一次是否需要定時更新）
    setInterval(() => {
        checkScheduledUpdate();
    }, 60000); // 每分鐘檢查一次
    
    // 移除自動初始化帳戶狀態和持倉狀態，讓它們只在登入後才被調用
    // updateAccountStatus();
    // updatePositionStatus();
    
    // 初始化系統日誌
    updateSystemLogsDisplay();
    updateBtcSystemLogsDisplay();
    
    // 啟動系統日誌同步（從後端拉取）
    updateSystemLogsFromBackend();
    setInterval(updateSystemLogsFromBackend, 5000); // 每5秒同步一次TX系統日誌
    
    // 啟動BTC系統日誌同步
    updateBtcSystemLogsFromBackend();
    setInterval(updateBtcSystemLogsFromBackend, 5000); // 每5秒同步一次BTC系統日誌
    
    
    // 移除了不必要的系統啟動日誌
    
    // 初始化連線時長顯示
    const durationElement = document.getElementById('connection-duration');
    if (durationElement) {
        durationElement.style.display = 'inline';
        durationElement.textContent = '-';
        durationElement.style.color = '#6c757d'; // 正常灰色
    }
    
    // 智能更新機制：只在登入後且在交易時段內的交易日每五分鐘自動更新
    // 將定時器ID存儲在全局變數中，以便登出時停止
    window.accountUpdateInterval = null;
    window.btcAccountUpdateInterval = null;
    
    // 檢查是否已登入，如果已登入則啟動智能更新
    if (window.isLoggedIn) {
        // 如果已登入，延遲啟動自動更新，讓API有時間連接
        setTimeout(() => {
            startAccountAutoUpdate();
        }, 3000);
    }
    
    // 檢查BTC是否已登入，如果已登入則啟動BTC智能更新
    if (sessionStorage.getItem('isBtcLoggedIn') === '1') {
        // 如果已登入，延遲啟動BTC自動更新，讓API有時間連接
        setTimeout(() => {
            startBtcAccountAutoUpdate();
        }, 3000);
    }
    
    // 設置連線時長更新（每分鐘更新一次）
    setInterval(updateConnectionDuration, 60000);
});

// 緩存交易日狀態，避免頻繁API請求
let tradingDayCache = {
    date: null,
    isTradingDay: false,
    lastUpdated: null
};

// 啟動帳戶自動更新
function startAccountAutoUpdate() {
    // 如果已經有定時器在運行，先停止它
    stopAccountAutoUpdate();
    
    // 啟動新的定時器
    window.accountUpdateInterval = setInterval(async () => {
        const shouldUpdate = await shouldUpdateAccountStatus();
        if (shouldUpdate) {
            updateAccountStatus();
            updatePositionStatus();
        } else {
        }
    }, 300000); // 每五分鐘檢查一次
    
}

// 停止帳戶自動更新
function stopAccountAutoUpdate() {
    if (window.accountUpdateInterval) {
        clearInterval(window.accountUpdateInterval);
        window.accountUpdateInterval = null;
    }
}

// 啟動BTC帳戶自動更新
function startBtcAccountAutoUpdate() {
    // 如果已經有定時器在運行，先停止它
    stopBtcAccountAutoUpdate();
    
    // 啟動新的定時器 - BTC是24小時交易，不需要交易時段限制
    // 使用內部函數進行靜默更新（不顯示loading）
    window.btcAccountUpdateInterval = setInterval(() => {
        if (sessionStorage.getItem('isBtcLoggedIn') === '1') {
            updateBtcAccountInfo(); // 靜默更新，無UI反饋
            updateBtcPositionInfo(); // 靜默更新，無UI反饋
        }
    }, 300000); // 每五分鐘檢查一次
}

// 停止BTC帳戶自動更新
function stopBtcAccountAutoUpdate() {
    if (window.btcAccountUpdateInterval) {
        clearInterval(window.btcAccountUpdateInterval);
        window.btcAccountUpdateInterval = null;
    }
}

// 判斷是否應該更新帳戶狀態（只在交易時段內的交易日更新）
async function shouldUpdateAccountStatus() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 100 + currentMinute; // HHMM格式
    const today = now.toDateString();
    
    // 檢查當前時間是否在交易時段內
    // 早盤：8:45-13:45
    const morningStart = 845;
    const morningEnd = 1345;
    
    // 午盤：14:50-次日05:01
    const afternoonStart = 1450;
    const afternoonEnd = 501; // 次日05:01
    
    // 判斷是否在交易時段
    let inTradingHours = false;
    
    if (currentTime >= morningStart && currentTime <= morningEnd) {
        // 早盤時段
        inTradingHours = true;
    } else if (currentTime >= afternoonStart || currentTime <= afternoonEnd) {
        // 午盤時段（跨日）
        inTradingHours = true;
    }
    
    // 如果不在交易時段，直接返回false
    if (!inTradingHours) {
        return false;
    }
    
    // 檢查交易日狀態緩存
    if (tradingDayCache.date === today && tradingDayCache.lastUpdated) {
        // 緩存有效，使用緩存的結果
        return tradingDayCache.isTradingDay;
    }
    
    // 緩存過期或無效，調用API檢查交易日狀態
    try {
        const response = await fetch('/api/trading/status');
        const data = await response.json();
        
        // 更新緩存
        tradingDayCache.date = today;
        tradingDayCache.isTradingDay = data.is_trading_day;
        tradingDayCache.lastUpdated = now;
        
            
        return data.is_trading_day;
    } catch (error) {
        console.error('獲取交易日狀態失敗：', error);
        // API失敗時，快速檢查：週日直接返回false（週六有夜盤交易到凌晨05:00，所以週六是交易日）
        const dayOfWeek = now.getDay(); // 0=週日, 6=週六
        return !(dayOfWeek === 0); // 只有週日是非交易日
    }
}

// 更新帳戶狀態
function updateAccountStatus() {
    fetch('/api/account/status')
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const accountData = data.data;
            
            // 更新帳戶資訊
            const updateField = (id, value, isRisk = false) => {
                const element = document.getElementById(id);
                if (!element) return;
                
                let displayValue = formatNumber(value);
                
                // 特殊處理風險指標
                if (isRisk) {
                    const riskValue = parseFloat(value);
                    element.className = 'account-value';
                    if (riskValue > 100) {
                        element.classList.add('risk-high');
                    } else if (riskValue === 100) {
                        element.classList.add('risk-normal');
                    } else {
                        element.classList.add('risk-low');
                    }
                    displayValue = `${displayValue}%`;
                } else {
                    element.className = 'account-value';
                }
                
                // 直接更新數值，隱藏效果由CSS blur處理
                element.textContent = displayValue;
            };
            
            updateField('account-equity', accountData['權益總值']);
            updateField('account-equity-amount', accountData['權益總額']);
            updateField('account-today-balance', accountData['今日餘額']);
            updateField('account-yesterday-balance', accountData['昨日餘額']);
            updateField('account-available-margin', accountData['可用保證金']);
            updateField('account-initial-margin', accountData['原始保證金']);
            updateField('account-maintenance-margin', accountData['維持保證金']);
            updateField('account-risk-indicator', accountData['風險指標'], true);
            updateField('account-fee', accountData['手續費']);
            updateField('account-tax', accountData['期交稅']);
            
            // 檢查帳戶總值是否低於維持保證金
            checkMarginRequirement(accountData);
            
            // 處理未實現盈虧
            if (accountData['未實現盈虧'] !== undefined) {
                updateField('account-unrealized-pnl', accountData['未實現盈虧']);
            }
            
            // 本日平倉損益 - 根據數值設置顏色，可隱藏
            const profitElement = document.getElementById('account-settle-profit');
            const profitValue = parseFloat(accountData['本日平倉損益']);
            const profitDisplay = formatNumber(accountData['本日平倉損益']) + ' <span class="unit">TWD</span>';
            
            profitElement.className = 'account-value';
            profitElement.dataset.originalValue = profitDisplay;
            
            // 直接更新數值，隱藏效果由CSS blur處理
            profitElement.innerHTML = profitDisplay;
            if (profitValue > 0) {
                profitElement.classList.add('tx-positive');
            } else if (profitValue < 0) {
                profitElement.classList.add('tx-negative');
            } else {
                profitElement.classList.add('tx-neutral');
            }
            
            // 更新固定顯示項目
            // updatePinnedItems();
        } else {
            // API未連線或錯誤時顯示提示訊息
            const errorMessage = data.status === 'disconnected' ? '-' : '-';
            
            // 重置所有元素的顏色樣式
            const elements = [
                'account-equity', 'account-equity-amount', 'account-today-balance',
                'account-yesterday-balance', 'account-available-margin', 'account-initial-margin',
                'account-maintenance-margin', 'account-risk-indicator', 'account-fee',
                'account-tax', 'account-settle-profit', 'account-unrealized-pnl'
            ];
            
            elements.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.textContent = errorMessage;
                    element.className = 'account-value'; // 重置為默認樣式
                    element.dataset.originalValue = errorMessage;
                }
            });
        }
    })
    .catch(error => {
        console.error('獲取帳戶狀態失敗：', error);
        // 錯誤時顯示錯誤訊息
        const elements = [
            'account-equity', 'account-equity-amount', 'account-today-balance',
            'account-yesterday-balance', 'account-available-margin', 'account-initial-margin',
            'account-maintenance-margin', 'account-risk-indicator', 'account-fee',
            'account-tax', 'account-settle-profit'
        ];
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '-';
                element.className = 'account-value'; // 重置為默認樣式
            }
        });
    });
}

// 手動重新整理帳戶狀態（隨時可用，不受交易時段限制）
function refreshAccountStatus() {
    const refreshBtn = document.getElementById('refresh-account-btn');
    
    // 防止重複點擊，設置10秒緩衝期
    if (refreshBtn.disabled) return;
    
    refreshBtn.disabled = true;
    
    // 手動更新不受交易時段限制，隨時可以執行
    updateAccountStatus();
    
    // 10秒後恢復按鈕
    setTimeout(() => {
        refreshBtn.disabled = false;
    }, 10000);
}

// 檢查保證金要求並發送TG通知
function checkMarginRequirement(accountData) {
    const equity = parseFloat(accountData['權益總值']) || 0;
    const maintenanceMargin = parseFloat(accountData['維持保證金']) || 0;
    const initialMargin = parseFloat(accountData['原始保證金']) || 0;
    
    // 檢查帳戶總值是否低於維持保證金
    if (equity > 0 && maintenanceMargin > 0 && equity < maintenanceMargin) {
        // 檢查是否在短時間內已發送過通知（避免重複發送）
        const lastNotifyTime = sessionStorage.getItem('lastMarginNotifyTime');
        const currentTime = new Date().getTime();
        
        // 10分鐘內不重複發送
        if (!lastNotifyTime || (currentTime - parseInt(lastNotifyTime)) > 600000) {
            sendMarginInsufficientNotification(equity, initialMargin, maintenanceMargin);
            sessionStorage.setItem('lastMarginNotifyTime', currentTime.toString());
        }
    }
}

// 發送保證金不足TG通知
function sendMarginInsufficientNotification(equity, initialMargin, maintenanceMargin) {
    const message = `⚠️ 帳戶總值低於維持保證金！！！
帳戶總值$${formatNumber(equity)}
原始保證金$${formatNumber(initialMargin)}
維持保證金$${formatNumber(maintenanceMargin)}
請儘速補足至原始保證金並注意權益數變化！！！`;

    // 發送TG通知
    fetch('/api/send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            // 記錄到前端日誌
            addSystemLog('Telegram［保證金不足］訊息發送成功！！！', 'success');
        } else {
            addSystemLog('Telegram［保證金不足］訊息發送失敗', 'error');
        }
    })
    .catch(error => {
        console.error('發送TG通知失敗:', error);
        addSystemLog('Telegram［保證金不足］訊息發送失敗', 'error');
    });
}

// 格式化數字顯示（添加千分位分隔符）
function formatNumber(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) {
        return '0';
    }
    
    const num = parseFloat(value);
    // 如果是整數，去掉 .0；如果是小數，保留小數位
    if (num === Math.floor(num)) {
        return Math.floor(num).toLocaleString('zh-TW');
    } else {
        return num.toLocaleString('zh-TW');
    }
}

// 更新持倉狀態
function updatePositionStatus() {
    fetch('/api/position/status')
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const positionData = data.data;
            
            // 更新三種合約的持倉資訊
            const contractTypes = ['TXF', 'MXF', 'TMF'];
            const contractNames = ['txf', 'mxf', 'tmf'];
            
            contractTypes.forEach((contractType, index) => {
                try {
                    const contractName = contractNames[index];
                    const contractData = positionData[contractType];
                    
                
                // 動作 - 不隱藏
                const actionElement = document.getElementById(`position-${contractName}-action`);
                if (actionElement) {
                    actionElement.textContent = contractData['動作'];
                    actionElement.className = 'position-table-value';
                    actionElement.dataset.originalValue = contractData['動作'];
                }
                if (actionElement) {
                    if (contractData['動作'] === '多單') {
                        actionElement.classList.add('long');
                    } else if (contractData['動作'] === '空單') {
                        actionElement.classList.add('short');
                    }
                }
                
                // 數量 - 可隱藏
                const quantityElement = document.getElementById(`position-${contractName}-quantity`);
                if (quantityElement) {
                    const quantityValue = contractData['數量'];
                    quantityElement.dataset.originalValue = quantityValue;
                    quantityElement.textContent = quantityValue;
                }
                
                // 均價 - 可隱藏
                const avgPriceElement = document.getElementById(`position-${contractName}-avg-price`);
                if (avgPriceElement) {
                    const avgPriceValue = contractData['均價'];
                    avgPriceElement.dataset.originalValue = avgPriceValue;
                    avgPriceElement.textContent = avgPriceValue;
                }
                
                // 市價 - 可隱藏
                const lastPriceElement = document.getElementById(`position-${contractName}-last-price`);
                if (lastPriceElement) {
                    const lastPriceValue = contractData['市價'];
                    lastPriceElement.dataset.originalValue = lastPriceValue;
                    lastPriceElement.textContent = lastPriceValue;
                }
                
                // 未實現盈虧 - 可隱藏
                const pnlElement = document.getElementById(`position-${contractName}-unrealized-pnl`);
                if (pnlElement) {
                    const pnlText = contractData['未實現損益'];
                    
                    if (pnlText && pnlText !== '-' && pnlText !== undefined) {
                        const pnlValue = parseFloat(pnlText.replace(/,/g, ''));
                        const pnlDisplay = formatNumber(pnlValue) + ' <span class="unit">TWD</span>';
                        
                        pnlElement.dataset.originalValue = pnlDisplay;
                        pnlElement.className = 'position-table-value';
                        pnlElement.innerHTML = pnlDisplay;
                        
                        if (pnlValue > 0) {
                            pnlElement.classList.add('tx-positive');
                        } else if (pnlValue < 0) {
                            pnlElement.classList.add('tx-negative');
                        } else if (pnlValue === 0) {
                            pnlElement.classList.add('tx-neutral');
                        }
                    } else {
                        pnlElement.textContent = '-';
                        pnlElement.className = 'position-table-value';
                        pnlElement.dataset.originalValue = '-';
                    }
                }
                
                } catch (error) {
                    console.error(`處理 ${contractType} 持倉時發生錯誤:`, error);
                }
            });
            
            // 更新總損益 - 不隱藏
            const totalPnlElement = document.getElementById('position-total-pnl');
            const totalPnlDisplay = data.total_pnl || '-';
            const totalPnlValue = data.total_pnl_value || 0;
            
            totalPnlElement.innerHTML = totalPnlDisplay;
            totalPnlElement.className = 'position-total-value';
            totalPnlElement.dataset.originalValue = totalPnlDisplay;
            
            if (data.has_positions && totalPnlValue !== 0) {
                if (totalPnlValue > 0) {
                    totalPnlElement.classList.add('tx-positive');
                } else if (totalPnlValue < 0) {
                    totalPnlElement.classList.add('tx-negative');
                } else {
                    totalPnlElement.classList.add('tx-neutral');
                }
            }
        } else {
            // API未連線或錯誤時顯示提示訊息
            resetPositionDisplay();
        }
    })
    .catch(error => {
        console.error('獲取持倉狀態失敗：', error);
        // 錯誤時重置顯示
        resetPositionDisplay();
    });
}

// 重置持倉顯示
function resetPositionDisplay() {
    const contractNames = ['txf', 'mxf', 'tmf'];
    const fields = ['action', 'quantity', 'avg-price', 'last-price', 'unrealized-pnl'];
    
    contractNames.forEach(contractName => {
        fields.forEach(field => {
            const element = document.getElementById(`position-${contractName}-${field}`);
            if (element) {
                element.textContent = '-';
                element.className = 'position-table-value'; // 重置為默認樣式
            }
        });
    });
    
    // 重置總損益
    const totalPnlElement = document.getElementById('position-total-pnl');
    if (totalPnlElement) {
        totalPnlElement.textContent = '-';
        totalPnlElement.className = 'position-total-value';
    }
}

// 手動重新整理持倉狀態（隨時可用，不受交易時段限制）
function refreshPositionStatus() {
    const refreshBtn = document.getElementById('refresh-position-btn');
    
    // 防止重複點擊，設置10秒緩衝期
    if (refreshBtn.disabled) return;
    
    refreshBtn.disabled = true;
    
    // 手動更新不受交易時段限制，隨時可以執行
    updatePositionStatus();
    
    // 10秒後恢復按鈕
    setTimeout(() => {
        refreshBtn.disabled = false;
    }, 10000);
}

// 切換持倉狀態顯示/隱藏
function togglePositionStatus() {
    const containerDiv = document.getElementById('position-info-container');
    const toggleIcon = document.getElementById('toggle-position');
    
    if (containerDiv.style.display === 'none') {
        containerDiv.style.display = 'block';
        toggleIcon.classList.remove('collapsed');
    } else {
        containerDiv.style.display = 'none';
        toggleIcon.classList.add('collapsed');
    }
}

// 切換帳戶狀態顯示/隱藏
function toggleAccountStatus() {
    const containerDiv = document.getElementById('account-info-container');
    const toggleIcon = document.getElementById('toggle-account');
    
    if (containerDiv.classList.contains('collapsed')) {
        // 展開：顯示所有項目
        containerDiv.classList.remove('collapsed');
        toggleIcon.classList.remove('collapsed');
    } else {
        // 收起：隱藏未勾選的項目，勾選的項目會在固定顯示區域顯示
        containerDiv.classList.add('collapsed');
        toggleIcon.classList.add('collapsed');
    }
    
    // 更新收起狀態下最後一個項目的樣式
    updatePinnedItemsBorder();
}

// 帳戶狀態金額隱藏功能（使用CSS blur效果）

// 切換帳戶狀態金額顯示/隱藏 - 使用模糊效果
function toggleAccountAmountVisibility() {
    const hideBtn = document.getElementById('hide-account-btn');
    const eyeOpen = hideBtn.querySelector('.eye-open');
    const eyeClosed = hideBtn.querySelector('.eye-closed');
    const accountValues = document.querySelectorAll('#account-info-container .account-value');
    
    const isHidden = eyeOpen.style.display === 'none';
    
    if (isHidden) {
        // 顯示數值
        eyeOpen.style.display = '';
        eyeClosed.style.display = 'none';
        accountValues.forEach(element => {
            element.style.filter = '';
        });
    } else {
        // 隱藏數值（使用模糊效果）
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = '';
        accountValues.forEach(element => {
            element.style.filter = 'blur(4px)';
        });
    }
}

// 處理帳戶項目勾選邏輯
function toggleAccountItemVisibility(checkbox) {
    const accountItem = checkbox.closest('.account-item');
    const isChecked = checkbox.checked;
    
    if (isChecked) {
        // 勾選：標記為固定顯示
        accountItem.classList.add('pinned');
    } else {
        // 取消勾選：移除固定顯示標記
        accountItem.classList.remove('pinned');
    }
    
    // 更新收起狀態下最後一個項目的樣式
    updatePinnedItemsBorder();
}

// 更新收起狀態下最後一個勾選項目的邊框樣式
function updatePinnedItemsBorder() {
    const accountContainer = document.getElementById('account-info-container');
    const pinnedItems = accountContainer.querySelectorAll('.account-item.pinned');
    
    // 重置所有勾選項目的邊框
    pinnedItems.forEach(item => {
        item.style.borderBottom = '1px solid #e9ecef';
    });
    
    // 如果容器處於收起狀態且有勾選項目，移除最後一個的邊框
    if (accountContainer.classList.contains('collapsed') && pinnedItems.length > 0) {
        const lastPinnedItem = pinnedItems[pinnedItems.length - 1];
        lastPinnedItem.style.borderBottom = 'none';
    }
}

// 持倉狀態金額隱藏功能（使用CSS blur效果）

// 切換持倉狀態金額顯示/隱藏 - 使用模糊效果
function togglePositionAmountVisibility() {
    const hideBtn = document.getElementById('hide-position-btn');
    const eyeOpen = hideBtn.querySelector('.eye-open');
    const eyeClosed = hideBtn.querySelector('.eye-closed');
    
    // 獲取所有持倉數值元素（排除未實現總損益）
    const positionValues = [];
    const contractNames = ['txf', 'mxf', 'tmf'];
    const fieldsToHide = ['quantity', 'avg-price', 'last-price', 'unrealized-pnl'];
    
    contractNames.forEach(contractName => {
        fieldsToHide.forEach(field => {
            const element = document.getElementById(`position-${contractName}-${field}`);
            if (element) {
                positionValues.push(element);
            }
        });
    });
    
    const isHidden = eyeOpen.style.display === 'none';
    
    if (isHidden) {
        // 顯示數值
        eyeOpen.style.display = '';
        eyeClosed.style.display = 'none';
        positionValues.forEach(element => {
            element.style.filter = '';
        });
    } else {
        // 隱藏數值（使用模糊效果）
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = '';
        positionValues.forEach(element => {
            element.style.filter = 'blur(4px)';
        });
    }
}

// shioaji 更新相關函數
function checkSinopacUpdate() {
    const checkBtn = document.getElementById('sinopac-update-check-btn');
    const availableBtn = document.getElementById('sinopac-update-available-btn');
    const originalText = checkBtn.innerHTML;
    
    // 顯示載入狀態（與 ngrok 相同的動畫）
    checkBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="animation: spin 1s linear infinite;">
            <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
        </svg>
    `;
    checkBtn.disabled = true;
    
    // 顯示檢查中狀態
    checkBtn.style.display = 'inline-flex';
    availableBtn.style.display = 'none';
    
    fetch('/api/sinopac/check_update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const updateData = data.data;
            if (updateData.update_available) {
                // 有更新可用 - 隱藏檢查按鈕，顯示更新按鈕
                checkBtn.style.display = 'none';
                availableBtn.style.display = 'inline-flex';
                availableBtn.title = `有更新可用: ${updateData.current_version} → ${updateData.latest_version}`;
                // 儲存更新資訊供稍後使用
                window.sinopacUpdateInfo = updateData;
                addSystemLog(`發現shioaji有新版本: ${updateData.current_version} -> ${updateData.latest_version}`, 'info');
            } else {
                // 已是最新版本 - 顯示檢查按鈕，隱藏更新按鈕
                checkBtn.style.display = 'inline-flex';
                availableBtn.style.display = 'none';
                checkBtn.title = '已是最新版本';
                addSystemLog(`shioaji已是最新版本: ${updateData.current_version}`, 'success');
            }
        } else {
            // 檢查失敗 - 顯示檢查按鈕，隱藏更新按鈕
            checkBtn.style.display = 'inline-flex';
            availableBtn.style.display = 'none';
            checkBtn.title = '檢查更新失敗';
            addSystemLog(`檢查shioaji更新失敗: ${data.message}`, 'error');
        }
    })
    .catch(error => {
        console.error('檢查shioaji更新失敗:', error);
        // 檢查失敗 - 顯示檢查按鈕，隱藏更新按鈕
        checkBtn.style.display = 'inline-flex';
        availableBtn.style.display = 'none';
        checkBtn.title = '檢查更新失敗';
        addSystemLog('檢查shioaji更新失敗', 'error');
    })
    .finally(() => {
        // 恢復按鈕狀態
        checkBtn.innerHTML = originalText;
        checkBtn.disabled = false;
    });
}

// 直接執行 shioaji 更新（類似 ngrok 的行為）
function updateSinopac() {
    // 顯示更新提醒模態框，讓用戶決定是否更新
    showSinopacUpdateModal();
}

function showSinopacUpdateModal() {
    const modal = document.getElementById('sinopac-update-modal');
    const updateInfo = document.getElementById('sinopac-update-info');
    const updateActions = document.getElementById('sinopac-update-actions');
    
    // 顯示模態框
    modal.style.display = 'block';
    updateInfo.style.display = 'block';
    updateActions.style.display = 'none';
    updateInfo.innerHTML = '<p>檢查更新中...</p>';
    
    // 檢查更新
    fetch('/api/sinopac/check_update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const updateData = data.data;
            
            if (updateData.update_available) {
                // 顯示更新資訊
                document.getElementById('sinopac-current-version').textContent = updateData.current_version;
                document.getElementById('sinopac-latest-version').textContent = updateData.latest_version;
                
                updateInfo.style.display = 'none';
                updateActions.style.display = 'block';
            } else {
                // 已是最新版本
                updateInfo.innerHTML = '<p>已是最新版本，無需更新。</p>';
            }
        } else {
            updateInfo.innerHTML = `<p>檢查更新失敗: ${data.message}</p>`;
        }
    })
    .catch(error => {
        console.error('檢查shioaji更新失敗:', error);
        updateInfo.innerHTML = '<p>檢查更新失敗，請稍後再試。</p>';
    });
}

function closeSinopacUpdateModal() {
    document.getElementById('sinopac-update-modal').style.display = 'none';
}

function startSinopacUpdate() {
    const updateModal = document.getElementById('sinopac-update-modal');
    const progressModal = document.getElementById('sinopac-update-progress-modal');
    
    // 切換到進度模態框
    updateModal.style.display = 'none';
    progressModal.style.display = 'block';
    
    // 開始進度動畫
    const progressFill = document.getElementById('sinopac-progress-fill');
    const updateStatus = document.getElementById('sinopac-update-status');
    const updateOutput = document.getElementById('sinopac-update-output');
    const updateLog = document.getElementById('sinopac-update-log');
    
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90;
        progressFill.style.width = progress + '%';
    }, 500);
    
    // 執行更新
    fetch('/api/sinopac/auto_update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        clearInterval(progressInterval);
        progressFill.style.width = '100%';
        
        if (data.status === 'success') {
            updateStatus.textContent = '更新成功！';
            
            // 顯示更新日誌
            updateOutput.style.display = 'block';
            updateLog.textContent = data.output || '更新完成';
            
            // 延遲顯示重啟提示並關閉程式
            setTimeout(() => {
                progressModal.style.display = 'none';
                alert('shioaji更新成功！\n\n程式將關閉，請重新啟動應用程序以應用新版本。');
                addSystemLog('shioaji更新完成，程式將關閉', 'success');
                
                // 關閉程式 - 使用後端 API 來關閉整個應用程式
                setTimeout(() => {
                    // 嘗試使用後端 API 關閉程式
                    fetch('/api/close_application', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    })
                    .then(() => {
                        // 如果後端 API 成功，程式會關閉
                                        })
                    .catch(() => {
                        // 如果後端 API 失敗，嘗試關閉視窗
                                        if (window.close) {
                            window.close();
                        }
                    });
                }, 2000);
            }, 2000);
        } else {
            updateStatus.textContent = '更新失敗';
            updateOutput.style.display = 'block';
            updateLog.textContent = data.error || '更新過程中發生錯誤';
        }
    })
    .catch(error => {
        clearInterval(progressInterval);
        progressFill.style.width = '100%';
        updateStatus.textContent = '更新失敗';
        updateOutput.style.display = 'block';
        updateLog.textContent = '網絡錯誤: ' + error.message;
    });
}

function showSinopacRestartModal() {
    // 此函數已移除，不再需要自動重啟功能
}

function closeSinopacRestartModal() {
    // 此函數已移除，不再需要自動重啟功能
}

// 無用的重啟函數已移除

// 第二個DOMContentLoaded已合併到主要初始化函數中

// 重新整理合約資訊
async function refreshContractInfo() {
    const refreshBtn = document.getElementById('refresh-contract-btn');
    
    // 如果按鈕已經被禁用，直接返回
    if (refreshBtn.disabled) return;
    
    try {
        // 禁用按鈕並添加loading類
        refreshBtn.disabled = true;
        refreshBtn.classList.add('loading');
        
    
        // 重新獲取合約資訊
        const response = await fetch('/api/futures/contracts');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();


        // 更新合約資訊顯示
        if (data.selected_contracts) {
            document.getElementById('txf-contract').textContent = data.selected_contracts.TXF || '-';
            document.getElementById('mxf-contract').textContent = data.selected_contracts.MXF || '-';
            document.getElementById('tmf-contract').textContent = data.selected_contracts.TMF || '-';
        }

        // 更新可用合約列表
        if (data.available_contracts) {
            updateAvailableContracts('TXF', data.available_contracts.TXF);
            updateAvailableContracts('MXF', data.available_contracts.MXF);
            updateAvailableContracts('TMF', data.available_contracts.TMF);
        }
        
    } catch (error) {
        console.error('更新合約資訊失敗:', error);
    } finally {
        // 延遲500ms後移除loading類並恢復按鈕狀態，確保用戶能看到動畫
        setTimeout(() => {
            refreshBtn.classList.remove('loading');
            refreshBtn.disabled = false;
            }, 500);
    }
}

// 測試功能相關函數已移除

// 新的隧道設置函數
function showTunnelSetup() {
    document.getElementById('tunnel-setup-modal').style.display = 'block';
    
    // 載入已儲存的token
    loadTunnelTokens();
}

function loadTunnelTokens() {
    fetch('/api/ngrok/token/load')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                const cfToken = document.getElementById('cloudflare-token');
                
                if (cfToken && data.authtoken) {
                    cfToken.value = data.authtoken;
                }
                
                // Cloudflare 配置已經預設顯示
            }
        })
        .catch(error => {
            console.error('載入 token 失敗:', error);
        });
}

// 已移除 onTunnelServiceTypeChange 函數，因為不再需要選擇隧道服務類型

let selectedDomainMode = 'temporary'; // 預設為免費臨時域名（最可靠）

function setDomainMode(mode, event = null) {
    selectedDomainMode = mode;
    const instructionsDiv = document.getElementById('setup-instructions');
    const tokenInput = document.getElementById('cloudflare-token');
    
    // 更新選中狀態
    document.querySelectorAll('.domain-option').forEach(option => {
        option.style.borderColor = '#e0e0e0';
    });
    
    // 只有在有事件對象時才設定邊框顏色
    if (event && event.target && event.target.parentElement) {
        event.target.parentElement.style.borderColor = '#2196F3';
    } else {
        // 當直接調用時，根據模式找到對應的選項
        const targetOption = document.querySelector(`[onclick*="${mode}"]`);
        if (targetOption) {
            targetOption.parentElement.style.borderColor = '#2196F3';
        }
    }
    
    switch(mode) {
        case 'workers':
            instructionsDiv.innerHTML = `
                <h6>固定域名設置：</h6>
                <p style="margin-bottom: 15px; background: #e8f5e8; padding: 10px; border-radius: 5px;">
                    注意：此功能需要 Cloudflare 帳戶設置，建議有經驗的使用者選擇。
                </p>
                <ol>
                    <li>前往 <a href="https://dash.cloudflare.com/sign-up" target="_blank">Cloudflare 註冊免費帳戶</a></li>
                    <li>登入後，左側選單找到「Zero Trust」</li>
                    <li>點選「網路」→「Tunnels」</li>
                    <li>點選「建立通道」，選擇「Cloudflared」</li>
                    <li>輸入通道名稱（如：my-trading-app）</li>
                    <li>在「安裝連接器」頁面，複製 Token（以 eyJ 開頭的長字串）</li>
                    <li>回到此頁面，選擇「自訂域名」模式並貼上 Token</li>
                    <li>在 Cloudflare 中設置「Public hostname」指向 localhost:5000</li>
                </ol>
                <p style="color: #2196F3;">如不熟悉上述流程，建議選擇「臨時域名（立即可用）」</p>
            `;
            tokenInput.value = 'workers-mode';
            break;
            
        case 'custom':
            instructionsDiv.innerHTML = `
                <h6>自訂域名設置：</h6>
                <ol>
                    <li>前往 <a href="https://dash.cloudflare.com/sign-up" target="_blank">Cloudflare 註冊</a></li>
                    <li>在 Zero Trust → 網路 → Tunnels → 新增通道 → 選取Cloudflared → 命名通道名稱後儲存通道</li>
                    <li>複製 Token（以 eyJ 開頭）</li>
                    <li>在 Public hostname 設置您的域名</li>
                </ol>
                <div style="margin: 10px 0;">
                    <label>請輸入您的 Cloudflare Token：</label>
                    <input type="text" id="custom-token" placeholder="eyJ..." style="width: 100%; padding: 8px; margin: 5px 0;">
                </div>
            `;
            break;
            
        case 'temporary':
            instructionsDiv.innerHTML = `
                <h6>免費域名設置：</h6>
                <ol>
                    <li>無需任何準備工作</li>
                    <li>無需註冊帳戶</li>
                    <li>直接點選「儲存並啟動」</li>
                    <li>立即獲得可用域名</li>
                </ol>
                <p style="color: #2196F3;">完全免費，立即可用</p>
            `;
            tokenInput.value = 'temporary-mode';
            break;
    }
    
    instructionsDiv.style.display = 'block';
}

function setupTunnel() {
    const setupBtn = document.getElementById('setup-tunnel-btn');
    const statusDiv = document.getElementById('setup-status');
    
    // 獲取當前隧道類型，默認為 tx
    const tunnelType = window.currentTunnelType || 'tx';
    
    let token = 'temporary-mode'; // 預設值
    
    if (selectedDomainMode === 'custom') {
        const customToken = document.getElementById('custom-token');
        if (!customToken || !customToken.value.trim()) {
            statusDiv.innerHTML = '<div style="color: red;">請輸入 Cloudflare Token</div>';
            return;
        }
        token = customToken.value.trim();
        
        // 驗證token格式
        if (!token.startsWith('eyJ') || token.length < 50) {
            statusDiv.innerHTML = '<div style="color: red;">Token 格式不正確！請確認您複製的是正確的 Cloudflare Tunnel Token</div>';
            return;
        }
    } else if (selectedDomainMode === 'temporary') {
        token = 'temporary-mode';
    }
    
    setupBtn.disabled = true;
    setupBtn.textContent = '設置中...';
    statusDiv.innerHTML = `<div style="color: blue;">正在設置${tunnelType.toUpperCase()}隧道服務，請稍候...</div>`;
    
    // 先設置隧道配置，再啟動
    fetch('/api/ngrok/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            authtoken: token,
            mode: selectedDomainMode
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            statusDiv.innerHTML = `<div style="color: blue;">設置成功！正在啟動${tunnelType.toUpperCase()}隧道...</div>`;
            
            // 啟動指定類型的隧道
            return fetch(`/api/tunnel/${tunnelType}/start`, {
                method: 'POST'
            });
        } else {
            throw new Error(data.message);
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            statusDiv.innerHTML = `<div style="color: green;">${tunnelType.toUpperCase()}隧道啟動成功！</div>`;
            
            // 延遲關閉模態窗口
            setTimeout(() => {
                closeTunnelSetupModal();
            }, 2000);
        } else {
            statusDiv.innerHTML = `<div style="color: red;">隧道啟動失敗：${data.error || '未知錯誤'}</div>`;
        }
    })
    .catch(error => {
        statusDiv.innerHTML = `<div style="color: red;">設置失敗：${error.message}</div>`;
    })
    .finally(() => {
        setupBtn.disabled = false;
        setupBtn.textContent = '儲存並啟動';
    });
}

function clearTunnelToken() {
    // 現在只支援 Cloudflare Tunnel
    document.getElementById('cloudflare-token').value = '';
    document.getElementById('setup-status').innerHTML = '';
}

function closeTunnelSetupModal() {
    document.getElementById('tunnel-setup-modal').style.display = 'none';
}

function toggleTokenVisibility(inputId) {
    const input = document.getElementById(inputId);
    const button = input.nextElementSibling;
    const eyeOpen = button.querySelector('.eye-open');
    const eyeClosed = button.querySelector('.eye-closed');
    
    if (input.type === 'password') {
        input.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
    } else {
        input.type = 'password';
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
    }
}

// ========================== BTC 相關函數 ==========================

function saveBtcEnv(e) {
    if (e) e.preventDefault();
    
    const form = document.getElementById('btcEnvForm');
    
    // 獲取API Key的原始值（未遮蔽的）
    const getBtcValue = (id) => {
        const sessionValue = sessionStorage.getItem(`${id}_raw`);
        if (sessionValue !== null) {
            return sessionValue; // 包括空字串
        }
        return document.getElementById(id).dataset.raw || '';
    };
    
    const data = {
        CHAT_ID_BTC: form.chat_id_btc.value,
        BINANCE_API_KEY: getBtcValue('binance_api_key'),
        BINANCE_SECRET_KEY: getBtcValue('binance_secret_key'),
        BINANCE_USER_ID: form.binance_user_id.value,
        TRADING_PAIR: form.trading_pair.value,
        LEVERAGE: form.leverage.value,
        POSITION_SIZE: form.position_size.value,
        MARGIN_TYPE: form.margin_type.value,
        CONTRACT_TYPE: form.contract_type.value
    };
    
    // 顯示儲存中狀態
    const saveBtn = document.getElementById('save-btn-btc');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '儲存中...';
    saveBtn.disabled = true;
    
    fetch('/api/save_btc_env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(data => {
        document.getElementById('save-status-btc').innerText = '儲存成功！';
        setTimeout(() => document.getElementById('save-status-btc').innerText = '', 2000);
        
        // 儲存後，將sessionStorage的值同步到dataset.raw
        const btcApiKey = document.getElementById('binance_api_key');
        const btcSecretKey = document.getElementById('binance_secret_key');
        btcApiKey.dataset.raw = sessionStorage.getItem('binance_api_key_raw') || '';
        btcSecretKey.dataset.raw = sessionStorage.getItem('binance_secret_key_raw') || '';
        ['binance_api_key', 'binance_secret_key'].forEach(id => {
            const input = document.getElementById(id);
            input.dataset.saved = 'true';
        });
        setBtcMaskedFields();
        
        // 調用檢查登入按鈕狀態
        checkBtcLoginButton();
        
        // 檢查是否有空值被儲存
        if (data.has_empty_fields) {
            // 自動登出BTC
            sessionStorage.removeItem('isBtcLoggedIn');
            window.isBtcLoggedIn = false;
            showPanel('settings');
            alert('檢測到有欄位為空！請填寫完所有資料後才能登入。');
        } else {
            alert('儲存成功！！！');
        }
    })
    .catch(() => {
        document.getElementById('save-status-btc').innerText = '儲存失敗';
    })
    .finally(() => {
        // 恢復按鈕狀態
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    });
}

function loginBtc() {
    const loginBtn = document.getElementById('login-btn-btc');
    const originalText = loginBtn.innerHTML;
    
    // 禁用按鈕並顯示載入狀態
    loginBtn.disabled = true;
    loginBtn.innerHTML = '登入中...';
    
    fetch('/api/btc/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            sessionStorage.setItem('isBtcLoggedIn', '1');
            sessionStorage.setItem('btcLoginTime', new Date().toISOString());
            
            // 刷新帳戶和持倉信息（登入時使用靜默更新）
            updateBtcAccountInfo();
            updateBtcPositionInfo();
            
            // 啟動BTC帳戶自動更新
            startBtcAccountAutoUpdate();
            
            // 立即更新API狀態和交易對顯示
            setTimeout(() => {
                updateBinanceApiStatus();
                fetch('/api/load_btc_env')
                .then(res => res.json())
                .then(config => {
                    updateBtcTradingPairDisplay(config);
                })
                .catch(err => console.error('載入BTC配置失敗:', err));
                
                // BTC啟動通知改為只在每天9:00發送，登入時不發送
            }, 1000);
            
            // 延遲啟動BTC隧道（避免與TX隧道同時啟動導致429錯誤）
            setTimeout(() => {
                fetch('/api/tunnel/btc/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mode: 'temporary',
                        token: ''
                    })
                })
                .then(res => res.json())
                .then(tunnelData => {
                    })
                .catch(error => {
                    console.error('BTC隧道啟動失敗:', error);
                });
            }, 3000);
            
            showPanel('btc-trade');
        } else {
            alert('BTC登入失敗：' + data.message);
        }
    })
    .catch(error => {
        console.error('BTC登入請求失敗：', error);
        alert('BTC登入請求失敗，請檢查網路連線');
    })
    .finally(() => {
        // 恢復按鈕狀態
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalText;
    });
}

function logoutBtc() {
    fetch('/api/btc/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
    .then(res => res.json())
    .then(data => {
        sessionStorage.removeItem('isBtcLoggedIn');
        sessionStorage.removeItem('btcLoginTime');
        
        // 停止BTC帳戶自動更新
        stopBtcAccountAutoUpdate();
        
        showPanel('settings');
        alert('已成功登出BTC帳戶！');
        
        // 重置連線時長顯示
        updateBtcConnectionDuration();
    })
    .catch(error => {
        console.error('BTC登出請求失敗：', error);
        sessionStorage.removeItem('isBtcLoggedIn');
        
        // 停止BTC帳戶自動更新
        stopBtcAccountAutoUpdate();
        
        showPanel('settings');
        alert('已成功登出BTC帳戶！');
    });
}

function copyUsernameBtc() {
    const username = document.getElementById('bot-username-btc').value;
    navigator.clipboard.writeText(username).then(() => {
        alert('已複製 Bot ID ！！！\n請至Telegram 加入好友，並向它發起訊息：/start');
    });
}

function refreshBotUsernameBtc() {
    const botUsernameInput = document.getElementById('bot-username-btc');
    
    // 顯示載入狀態
    botUsernameInput.value = '查詢中...';
    
    // 直接從後端獲取token，不需要前端輸入
    fetch('/api/btc_bot_username', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.username) {
            botUsernameInput.value = data.username;
        } else if (data.error) {
            botUsernameInput.value = '查詢失敗';
        } else {
            botUsernameInput.value = '查無 Bot ID';
        }
    })
    .catch(() => {
        botUsernameInput.value = '查詢失敗';
    });
}

// 載入BTC環境配置
function loadBtcConfig() {
    fetch('/api/btc/get_config')
    .then(res => res.json())
    .then(data => {
        if (data.success && data.config) {
            const config = data.config;
            
            // 填充基本配置欄位
            const fields = {
                'chat_id_btc': config.CHAT_ID_BTC || '',
                'binance_api_key': config.BINANCE_API_KEY || '',
                'binance_secret_key': config.BINANCE_SECRET_KEY || '',
                'binance_user_id': config.BINANCE_USER_ID || '',
                'trading_pair': config.TRADING_PAIR || 'BTCUSDT',
                'leverage': config.LEVERAGE || '20',
                'position_size': config.POSITION_SIZE || '80',
                'margin_type': config.MARGIN_TYPE || 'CROSS',
                'contract_type': config.CONTRACT_TYPE || 'PERPETUAL'
            };
            
            Object.entries(fields).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) {
                    element.value = value;
                }
            });
            
            // 更新登入按鈕狀態
            const loginBtn = document.getElementById('login-btn-btc');
            if (loginBtn) {
                if (config.BINANCE_API_KEY && config.BINANCE_SECRET_KEY) {
                    loginBtn.disabled = false;
                } else {
                    loginBtn.disabled = true;
                }
            }
            
            // 檢查登入狀態
            if (config.LOGIN_BTC === '1') {
                sessionStorage.setItem('isBtcLoggedIn', '1');
            } else {
                sessionStorage.removeItem('isBtcLoggedIn');
            }
            
            // 更新交易對資訊顯示
            updateBtcTradingPairDisplay(config);
            
        } else {
            console.error('載入BTC配置失敗：', data.error);
        }
    })
    .catch(error => {
        console.error('載入BTC配置請求失敗：', error);
    });
}

// 更新BTC交易對資訊顯示
function updateBtcTradingPairDisplay(config) {
    const elements = {
        'btc-trading-pair': config.TRADING_PAIR || '-',
        'btc-leverage': config.LEVERAGE ? `${config.LEVERAGE}x` : '-',
        'btc-position-size': config.POSITION_SIZE ? `${config.POSITION_SIZE}%` : '-',
        'btc-margin-type': config.MARGIN_TYPE === 'CROSS' ? '全倉' : config.MARGIN_TYPE === 'ISOLATED' ? '逐倉' : '-',
        'btc-contract-type': config.CONTRACT_TYPE === 'PERPETUAL' ? 'PERPETUAL 永續合約' : config.CONTRACT_TYPE || '-'
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });
}

// BTC實時數據更新函數
function updateBtcRealtimeData() {
    fetch('/api/btc/realtime')
    .then(res => res.json())
    .then(data => {
        if (data.success && data.data) {
            const realtimeData = data.data;
            
            // 更新實時價格顯示
            const priceElement = document.getElementById('btc-current-price');
            if (priceElement && realtimeData.price) {
                const price = realtimeData.price;
                const priceChange = realtimeData.price_change || 0;
                
                priceElement.textContent = `$${price.toFixed(2)}`;
                
                // 根據漲跌設置顏色
                if (priceChange > 0) {
                    priceElement.style.color = '#27ae60'; // 綠色
                } else if (priceChange < 0) {
                    priceElement.style.color = '#e74c3c'; // 紅色
                } else {
                    priceElement.style.color = '#6c757d'; // 灰色
                }
            }
            
            // 更新24小時變化
            const changeElement = document.getElementById('btc-price-change');
            if (changeElement && realtimeData.price_change !== undefined) {
                const change = realtimeData.price_change;
                changeElement.textContent = `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
                changeElement.style.color = change > 0 ? '#27ae60' : (change < 0 ? '#e74c3c' : '#6c757d');
            }
            
            // 更新其他實時數據
            updateElementIfExists('btc-high-price', realtimeData.high_price, price => `$${price.toFixed(2)}`);
            updateElementIfExists('btc-low-price', realtimeData.low_price, price => `$${price.toFixed(2)}`);
            updateElementIfExists('btc-volume', realtimeData.volume, vol => `${(vol/1000).toFixed(1)}K`);
        }
    })
    .catch(error => {
        console.error('更新BTC實時數據失敗:', error);
    });
}


// 輔助函數：更新元素內容
function updateElementIfExists(elementId, value, formatter) {
    const element = document.getElementById(elementId);
    if (element && value !== undefined && value !== null) {
        element.textContent = formatter ? formatter(value) : value;
    }
}


// Complex calculation functions removed - all calculations moved to backend

// BTC帳戶資訊函數 - 新版本支援完整格式化
// BTC帳戶信息更新 - 恢復原始格式化樣式
function updateBtcAccountInfo() {
    if (sessionStorage.getItem('isBtcLoggedIn') !== '1') {
        return;
    }
    
    fetch('/api/btc/account_info')
    .then(res => res.json())
    .then(data => {
        if (data.success && data.account) {
            const account = data.account;
            console.log('BTC Account updated (with formatting):', account);
            
            // 指定小數位數的欄位更新函數
            const updateFieldWithDecimals = (id, value, unit = '', decimals = 2, isPnL = false, isPercentage = false) => {
                const element = document.getElementById(id);
                if (!element) return;
                
                let numValue = parseFloat(value) || 0;
                let displayValue = numValue.toFixed(decimals);
                
                // 重置className
                element.className = 'account-value';
                
                if (isPnL) {
                    // 盈虧類欄位添加顏色
                    if (numValue > 0) {
                        element.classList.add('positive');
                        displayValue = '+' + displayValue;
                    } else if (numValue < 0) {
                        element.classList.add('negative');
                    } else {
                        element.classList.add('neutral');
                    }
                }
                
                if (isPercentage) {
                    // 百分比類欄位
                    if (numValue === 0) {
                        element.classList.add('neutral'); // 0.00% 顯示灰色
                    } else if (numValue > 0) {
                        element.classList.add('positive'); // 正數顯示綠色
                    } else {
                        element.classList.add('negative'); // 負數顯示紅色
                    }
                    displayValue = displayValue + '%';
                } else if (unit) {
                    // 帶單位的欄位
                    element.innerHTML = `${displayValue} <span class="unit">${unit}</span>`;
                    return;
                }
                
                element.textContent = displayValue;
            };
            
            // 指定小數位數的盈虧欄位更新函數
            const updatePnLFieldWithDecimals = (id, amount, percentage, decimals = 2) => {
                const element = document.getElementById(id);
                if (!element) return;
                
                let numValue = parseFloat(amount) || 0;
                let percentValue = parseFloat(percentage) || 0;
                let displayAmount = numValue.toFixed(decimals);
                
                // 重置className
                element.className = 'account-value';
                
                // 盈虧顏色邏輯
                if (numValue > 0) {
                    element.classList.add('positive');
                    displayAmount = '+' + displayAmount;
                } else if (numValue < 0) {
                    element.classList.add('negative');
                } else {
                    element.classList.add('neutral');
                }
                
                // 組合顯示：金額 (百分比)
                let displayText = `${displayAmount} USDT`;
                if (Math.abs(percentValue) > 0.01) { // 百分比大於0.01%才顯示
                    const percentSign = percentValue >= 0 ? '+' : '';
                    displayText += ` (${percentSign}${percentValue.toFixed(2)}%)`;
                }
                
                element.innerHTML = `${displayText.replace('USDT', '<span class="unit">USDT</span>')}`;
            };
            
            // 恢復完整格式化，與TX版本保持一致的樣式
            const updateField = (id, value, unit = '', isPnL = false, isPercentage = false) => {
                const element = document.getElementById(id);
                if (!element) return;
                
                let numValue = parseFloat(value) || 0;
                let displayValue = formatNumber(numValue);
                
                // 重置className
                element.className = 'account-value';
                
                if (isPnL) {
                    // 盈虧類欄位添加顏色
                    if (numValue > 0) {
                        element.classList.add('positive');
                        displayValue = '+' + displayValue;
                    } else if (numValue < 0) {
                        element.classList.add('negative');
                    } else {
                        element.classList.add('neutral');
                    }
                }
                
                if (isPercentage) {
                    // 百分比類欄位 - 修正邏輯：初始0.00%是灰色，有值才有顏色
                    if (numValue === 0) {
                        element.classList.add('neutral'); // 0.00% 顯示灰色
                    } else if (numValue > 0) {
                        element.classList.add('positive'); // 正數顯示綠色
                    } else {
                        element.classList.add('negative'); // 負數顯示紅色
                    }
                    displayValue = displayValue + '%';
                } else if (unit) {
                    // 帶單位的欄位
                    element.innerHTML = `${displayValue} <span class="unit">${unit}</span>`;
                    return;
                }
                
                element.textContent = displayValue;
            };
            
            // 盈虧欄位更新函數 - 同時顯示金額和百分比
            const updatePnLField = (id, amount, percentage) => {
                const element = document.getElementById(id);
                if (!element) return;
                
                let numValue = parseFloat(amount) || 0;
                let percentValue = parseFloat(percentage) || 0;
                let displayAmount = formatNumber(numValue);
                
                // 重置className
                element.className = 'account-value';
                
                // 盈虧顏色邏輯
                if (numValue > 0) {
                    element.classList.add('positive');
                    displayAmount = '+' + displayAmount;
                } else if (numValue < 0) {
                    element.classList.add('negative');
                } else {
                    element.classList.add('neutral');
                }
                
                // 組合顯示：金額 (百分比)
                let displayText = `${displayAmount} USDT`;
                if (Math.abs(percentValue) > 0.01) { // 百分比大於0.01%才顯示
                    const percentSign = percentValue >= 0 ? '+' : '';
                    displayText += ` (${percentSign}${percentValue.toFixed(2)}%)`;
                }
                
                element.innerHTML = `${displayText.replace('USDT', '<span class="unit">USDT</span>')}`;
            };
            
            // 更新各欄位，使用指定的小數位數格式
            // 錢包餘額、可供轉帳、保證金餘額、未實現盈虧、交易手續費：小數點後8位
            updateFieldWithDecimals('btc-wallet-balance', account.walletBalance, 'USDT', 8);
            updateFieldWithDecimals('btc-available-balance', account.availableBalance, 'USDT', 8);
            updateFieldWithDecimals('btc-margin-balance', account.marginBalance, 'USDT', 8);
            updateFieldWithDecimals('btc-unrealized-pnl', account.unrealizedProfit, 'USDT', 8, true);
            updateFieldWithDecimals('btc-today-commission', account.todayCommission, 'USDT', 8);
            
            // 保證金比率、槓桿使用率：小數點後2位
            updateFieldWithDecimals('btc-margin-ratio', account.marginRatio, '', 2, false, true);
            updateFieldWithDecimals('btc-leverage-usage', account.leverageUsage, '', 2, false, true);
            
            // 本日盈虧、7天盈虧、30天盈虧：小數點後2位
            updatePnLFieldWithDecimals('btc-today-pnl', account.todayPnl, account.todayPnlPercent, 2);
            updatePnLFieldWithDecimals('btc-week-pnl', account.weekPnl, account.weekPnlPercent, 2);
            updatePnLFieldWithDecimals('btc-month-pnl', account.monthPnl, account.monthPnlPercent, 2);
        }
    })
    .catch(error => {
        console.error('BTC帳戶資訊更新失敗：', error);
    });
}

// BTC手動重新整理帳戶信息（與TX一致，無loading動畫）
function refreshBtcAccountInfo() {
    if (sessionStorage.getItem('isBtcLoggedIn') !== '1') {
        return;
    }
    
    // 防止重複點擊，設置10秒緩衝期（與TX完全相同）
    const refreshBtn = document.getElementById('refresh-account-btn-btc');
    if (refreshBtn) {
        // 防止重複點擊，設置10秒緩衝期
        if (refreshBtn.disabled) return;
        
        refreshBtn.disabled = true;
        // 不添加loading效果，與TX保持一致
    }
    
    // 調用內部更新函數
    updateBtcAccountInfo();
    
    // 10秒後恢復按鈕（與TX相同）
    setTimeout(() => {
        const refreshBtn = document.getElementById('refresh-account-btn-btc');
        if (refreshBtn) {
            refreshBtn.disabled = false;
        }
    }, 10000);
}

function toggleBtcAccountInfo() {
    const containerDiv = document.getElementById('btc-account-info-container');
    const toggleIcon = document.getElementById('toggle-account-btc');
    
    if (containerDiv.classList.contains('collapsed')) {
        // 展開：顯示所有項目
        containerDiv.classList.remove('collapsed');
        toggleIcon.classList.remove('collapsed');
    } else {
        // 收起：隱藏未勾選的項目，勾選的項目會在固定顯示區域顯示
        containerDiv.classList.add('collapsed');
        toggleIcon.classList.add('collapsed');
    }
    
    // 更新收起狀態下最後一個項目的樣式
    updateBtcPinnedItemsBorder();
}

function toggleBtcAccountAmountVisibility() {
    const hideBtn = document.getElementById('hide-account-btn-btc');
    const eyeOpen = hideBtn.querySelector('.eye-open');
    const eyeClosed = hideBtn.querySelector('.eye-closed');
    const accountValues = document.querySelectorAll('#btc-account-info-container .account-value');
    
    const isHidden = eyeOpen.style.display === 'none';
    
    if (isHidden) {
        eyeOpen.style.display = '';
        eyeClosed.style.display = 'none';
        accountValues.forEach(element => {
            element.style.filter = '';
        });
    } else {
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = '';
        accountValues.forEach(element => {
            element.style.filter = 'blur(4px)';
        });
    }
}

function toggleBtcAccountItemVisibility(checkbox) {
    const accountItem = checkbox.closest('.account-item');
    const isChecked = checkbox.checked;
    
    if (isChecked) {
        // 勾選：標記為固定顯示
        accountItem.classList.add('pinned');
    } else {
        // 取消勾選：移除固定顯示標記
        accountItem.classList.remove('pinned');
    }
    
    // 更新收起狀態下最後一個項目的樣式
    updateBtcPinnedItemsBorder();
}

// 更新BTC收起狀態下最後一個勾選項目的邊框樣式
function updateBtcPinnedItemsBorder() {
    const accountContainer = document.getElementById('btc-account-info-container');
    const pinnedItems = accountContainer.querySelectorAll('.account-item.pinned');
    
    // 重置所有勾選項目的邊框
    pinnedItems.forEach(item => {
        item.style.borderBottom = '1px solid #e9ecef';
    });
    
    // 如果容器處於收起狀態且有勾選項目，移除最後一個的邊框
    if (accountContainer.classList.contains('collapsed') && pinnedItems.length > 0) {
        const lastPinnedItem = pinnedItems[pinnedItems.length - 1];
        lastPinnedItem.style.borderBottom = 'none';
    }
}

// 發送BTC啟動通知
function sendBtcStartupNotification() {
    fetch('/api/btc/startup_notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log('BTC啟動通知發送成功');
        } else {
            console.error('BTC啟動通知發送失敗:', data.error || data.message);
        }
    })
    .catch(error => {
        console.error('發送BTC啟動通知時發生錯誤:', error);
    });
}

// 發送BTC交易統計通知
function sendBtcTradingStatistics(date = null) {
    const requestBody = {};
    if (date) {
        requestBody.date = date;
    }
    
    fetch('/api/btc/trading_statistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log('BTC交易統計通知發送成功');
        } else {
            console.error('BTC交易統計通知發送失敗:', data.error || data.message);
        }
    })
    .catch(error => {
        console.error('發送BTC交易統計通知時發生錯誤:', error);
    });
}

// 生成BTC日報
function generateBtcDailyReport(date = null) {
    const requestBody = {};
    if (date) {
        requestBody.date = date;
    }
    
    fetch('/api/btc/generate_daily_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log('BTC日報生成成功:', data.filename);
            alert(`BTC日報生成成功！\n文件名：${data.filename}\n日期：${data.date}`);
        } else {
            console.error('BTC日報生成失敗:', data.error || data.message);
            alert(`BTC日報生成失敗：${data.error || data.message}`);
        }
    })
    .catch(error => {
        console.error('生成BTC日報時發生錯誤:', error);
        alert(`生成BTC日報時發生錯誤：${error}`);
    });
}

// 生成BTC月報
function generateBtcMonthlyReport(year = null, month = null) {
    const requestBody = {};
    if (year) requestBody.year = year;
    if (month) requestBody.month = month;
    
    fetch('/api/btc/generate_monthly_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log('BTC月報生成成功:', data.filename);
            alert(`BTC月報生成成功！\n文件名：${data.filename}\n年月：${data.year}年${data.month}月`);
        } else {
            console.error('BTC月報生成失敗:', data.error || data.message);
            alert(`BTC月報生成失敗：${data.error || data.message}`);
        }
    })
    .catch(error => {
        console.error('生成BTC月報時發生錯誤:', error);
        alert(`生成BTC月報時發生錯誤：${error}`);
    });
}

// BTC手動下單
function btcManualOrder(quantity, action, side, orderType = 'MARKET') {
    const orderData = {
        quantity: quantity,
        action: action,     // new, cover
        side: side,         // buy, sell
        order_type: orderType
    };
    
    fetch('/api/btc/manual_order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log('BTC手動下單成功:', data);
            // 如果有成交價格，可以調用成交通知
            if (data.order_result && data.order_result.price) {
                // 模擬成交通知
                btcOrderFillNotification({
                    order_id: data.order_id,
                    quantity: data.quantity,
                    price: data.order_result.price || '0.00',
                    action: data.action,
                    direction: data.direction,
                    order_type: data.order_type,
                    is_auto: data.is_auto
                });
            }
        } else {
            console.error('BTC手動下單失敗:', data.error || data.message);
            alert(`BTC手動下單失敗：${data.error || data.message}`);
        }
    })
    .catch(error => {
        console.error('BTC手動下單時發生錯誤:', error);
        alert(`BTC手動下單時發生錯誤：${error}`);
    });
}

// BTC訂單成交通知
function btcOrderFillNotification(fillData) {
    fetch('/api/btc/order_fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fillData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log('BTC成交通知處理成功');
        } else {
            console.error('BTC成交通知處理失敗:', data.error || data.message);
        }
    })
    .catch(error => {
        console.error('BTC成交通知處理時發生錯誤:', error);
    });
}

// BTC快速交易按鈕函數
function btcQuickLongOpen(quantity = 0.00140000) {
    btcManualOrder(quantity, 'new', 'buy', 'MARKET');
}

function btcQuickLongClose(quantity = 0.00140000) {
    btcManualOrder(quantity, 'cover', 'sell', 'MARKET');
}

function btcQuickShortOpen(quantity = 0.00140000) {
    btcManualOrder(quantity, 'new', 'sell', 'MARKET');
}

function btcQuickShortClose(quantity = 0.00140000) {
    btcManualOrder(quantity, 'cover', 'buy', 'MARKET');
}

// BTC持倉信息更新 - 內部函數（無UI反饋，簡化版本）
function updateBtcPositionInfo() {
    if (sessionStorage.getItem('isBtcLoggedIn') !== '1') {
        return;
    }
    
    // 獲取帳戶信息和持倉信息
    Promise.all([
        fetch('/api/btc/positions').then(res => {
            if (!res.ok) {
                console.error('BTC positions API failed:', res.status, res.statusText);
                return { success: false, error: `HTTP ${res.status}` };
            }
            return res.json();
        }),
        fetch('/api/btc/account_info').then(res => {
            if (!res.ok) {
                console.error('BTC account API failed:', res.status, res.statusText);
                return { success: false, error: `HTTP ${res.status}` };
            }
            return res.json();
        })
    ])
    .then(([positionData, accountData]) => {
        console.log('API responses:', { positionData, accountData });
        console.log('AccountData structure:', Object.keys(accountData));
        console.log('AccountData maintMargin:', accountData.maintMargin);
        console.log('AccountData marginBalance:', accountData.marginBalance);
        
        if (positionData.success && positionData.positions) {
            console.log('BTC Position updated (silent):', positionData.positions);
            
            const positions = positionData.positions;
            if (positions.length > 0 && accountData.success) {
                const position = positions[0];
                const account = accountData.account || accountData;
                const positionAmt = parseFloat(position.positionAmt || 0);
                
                // 更新多空徽章
                const directionBadge = document.getElementById('position-direction-badge');
                if (directionBadge) {
                    if (positionAmt > 0) {
                        directionBadge.textContent = '多';
                        directionBadge.className = 'position-direction-badge long';
                    } else if (positionAmt < 0) {
                        directionBadge.textContent = '空';
                        directionBadge.className = 'position-direction-badge short';
                    } else {
                        directionBadge.textContent = '無';
                        directionBadge.className = 'position-direction-badge';
                    }
                }
                
                // 更新交易對主要信息
                const tradingPairMain = document.getElementById('trading-pair-main');
                if (tradingPairMain) {
                    tradingPairMain.textContent = position.symbol || 'BTCUSDT';
                }
                
                // 更新合約類型和保證金模式
                const tradingPairType = document.getElementById('trading-pair-type');
                const tradingPairMargin = document.getElementById('trading-pair-margin');
                const tradingPairInfo = document.getElementById('trading-pair-info');
                
                if (tradingPairType) {
                    tradingPairType.textContent = '永續';
                }
                
                if (tradingPairMargin) {
                    // 從配置或API獲取槓桿信息
                    const leverage = position.leverage || '20';
                    tradingPairMargin.textContent = `全倉${leverage}x`;
                }
                
                if (tradingPairInfo) {
                    tradingPairInfo.style.display = 'block';
                }
                
                // 獲取幣安API的真實數據
                const entryPrice = parseFloat(position.entryPrice || 0);
                const markPrice = parseFloat(position.markPrice || 0);
                const liquidationPrice = parseFloat(position.liquidationPrice || 0);
                const unrealizedPnl = parseFloat(position.unRealizedProfit || 0);
                const leverage = parseFloat(position.leverage || 20); // 預設20倍槓桿
                
                // 持倉數量：直接顯示幣安API的真實BTC持倉數量
                const positionSize = Math.abs(positionAmt);
                
                // 持倉價值（用於保證金計算，使用開倉價格）
                const positionValueForMargin = positionSize * entryPrice;
                
                // 動態持倉價值（用於顯示，使用標記價格）
                const currentPositionValue = positionSize * markPrice;
                
                // 保證金計算：持倉數量 ÷ 槓桿倍數 (USDT價值)
                const margin = currentPositionValue / leverage;
                
                // 保證金比例：維持保證金 / 保證金餘額 × 100%
                // 保證金比例越低風險越小，100%時強平
                // 使用帳戶API的維持保證金和保證金餘額
                const maintMargin = parseFloat(account.maintMargin || 0);
                const marginBalance = parseFloat(account.marginBalance || 0);
                
                // 計算保證金比例
                const marginRatio = marginBalance > 0 ? (maintMargin / marginBalance) * 100 : 0;
                
                // 調試：輸出API字段值
                console.log('Margin calculation with account data:', {
                    account_maintMargin: account.maintMargin,
                    account_marginBalance: account.marginBalance,
                    calculated_margin: margin,
                    marginRatio_calculated: marginRatio,
                    maintMargin_parsed: maintMargin,
                    marginBalance_parsed: marginBalance
                });
                
                // 計算收益率：未實現盈虧 ÷ 初始保證金 × 100%
                // 初始保證金 = 標記價格計算的保證金 = 當前持倉價值 ÷ 槓桿倍數
                const initialMargin = currentPositionValue / leverage;
                const roe = initialMargin > 0 ? (unrealizedPnl / initialMargin) * 100 : 0;
                
                console.log('ROE calculation:', {
                    unrealizedPnl: unrealizedPnl,
                    initialMargin: initialMargin,
                    currentPositionValue: currentPositionValue,
                    leverage: leverage,
                    roe_calculated: roe
                });
                
                // 更新持倉數量 - 顯示BTC數量和動態USDT價值
                const sizeElement = document.getElementById('position-btc-size');
                if (sizeElement) {
                    sizeElement.innerHTML = `${positionSize.toFixed(8)} <small>BTC</small><div class="position-amount-separator"></div>${currentPositionValue.toFixed(8)} <small>USDT</small>`;
                }
                
                // 更新保證金比例 - 保證金保持灰色，比例根據風險變色
                const marginElement = document.getElementById('position-btc-margin-ratio');
                if (marginElement) {
                    if (margin > 0) {
                        // 決定保證金比例的風險顏色類別
                        let ratioColorClass = 'neutral'; // 預設灰色
                        if (marginRatio <= 0) {
                            ratioColorClass = 'neutral';  // 0.00% 灰色
                        } else if (marginRatio <= 50) {
                            ratioColorClass = 'safe';     // 0.01~50.00% 綠色
                        } else if (marginRatio <= 75) {
                            ratioColorClass = 'warning';  // 50.01~75.00% 橙色
                        } else {
                            ratioColorClass = 'danger';   // 75.01~100.00% 紅色
                        }
                        
                        // 分別設置保證金(灰色)和比例(風險顏色)
                        const marginDisplay = `${margin.toFixed(2)} <small>USDT</small> (<span class="${ratioColorClass}">${marginRatio.toFixed(2)}%</span>)`;
                        marginElement.innerHTML = marginDisplay;
                        marginElement.className = 'position-table-value';
                    } else {
                        marginElement.innerHTML = '-';
                        marginElement.className = 'position-table-value neutral';
                    }
                }
                
                // 更新未實現盈虧 - 按照要求的格式顯示
                const pnlElement = document.getElementById('position-total-pnl-btc');
                if (pnlElement) {
                    let pnlDisplay = '';
                    if (unrealizedPnl > 0) {
                        pnlDisplay = `+${unrealizedPnl.toFixed(2)} <small>USDT</small> (+${roe.toFixed(2)}%)`;
                    } else if (unrealizedPnl < 0) {
                        pnlDisplay = `${unrealizedPnl.toFixed(2)} <small>USDT</small> (${roe.toFixed(2)}%)`;
                    } else {
                        pnlDisplay = `0.00 <small>USDT</small> (0.00%)`;
                    }
                    
                    pnlElement.innerHTML = pnlDisplay;
                    
                    // 添加顏色樣式
                    pnlElement.className = 'position-table-value';
                    if (unrealizedPnl > 0) {
                        pnlElement.classList.add('positive');
                    } else if (unrealizedPnl < 0) {
                        pnlElement.classList.add('negative');
                    } else {
                        pnlElement.classList.add('neutral');
                    }
                }
                
                // 更新價格欄位 - 使用HTML格式讓單位比數字小
                const priceElements = {
                    'position-btc-entry-price': entryPrice.toFixed(2),
                    'position-btc-mark-price': markPrice.toFixed(2),
                    'position-btc-liquidation-price': liquidationPrice.toFixed(2)
                };
                
                Object.keys(priceElements).forEach(id => {
                    const element = document.getElementById(id);
                    if (element) {
                        element.innerHTML = `${priceElements[id]} <small>USDT</small>`;
                    }
                });
                
                // 更新動作（多空方向）
                const sideElement = document.getElementById('position-btc-side');
                if (sideElement) {
                    sideElement.textContent = position.side || '-';
                }
            } else {
                // 無持倉時重置顯示
                const directionBadge = document.getElementById('position-direction-badge');
                const tradingPairMain = document.getElementById('trading-pair-main');
                const tradingPairInfo = document.getElementById('trading-pair-info');
                
                if (directionBadge) {
                    directionBadge.textContent = '無';
                    directionBadge.className = 'position-direction-badge';
                }
                
                if (tradingPairMain) {
                    tradingPairMain.textContent = 'BTCUSDT';
                }
                
                if (tradingPairInfo) {
                    tradingPairInfo.style.display = 'none';
                }
                
                const resetElements = [
                    'position-btc-side', 'position-btc-size', 'position-btc-margin-ratio', 
                    'position-total-pnl-btc', 'position-btc-entry-price', 'position-btc-mark-price', 
                    'position-btc-liquidation-price'
                ];
                
                resetElements.forEach(id => {
                    const element = document.getElementById(id);
                    if (element) {
                        element.textContent = '-';
                    }
                });
            }
        }
    })
    .catch(error => {
        console.error('BTC持倉資訊更新失敗：', error);
    });
}

// BTC手動重新整理持倉信息（與TX一致，無loading動畫）
function refreshBtcPositionInfo() {
    if (sessionStorage.getItem('isBtcLoggedIn') !== '1') {
        return;
    }
    
    // 防止重複點擊，設置10秒緩衝期（與TX完全相同）
    const refreshBtn = document.getElementById('refresh-position-btn-btc');
    if (refreshBtn) {
        // 防止重複點擊，設置10秒緩衝期
        if (refreshBtn.disabled) return;
        
        refreshBtn.disabled = true;
        // 不添加loading效果，與TX保持一致
    }
    
    // 調用內部更新函數
    updateBtcPositionInfo();
    
    // 10秒後恢復按鈕（與TX相同）
    setTimeout(() => {
        const refreshBtn = document.getElementById('refresh-position-btn-btc');
        if (refreshBtn) {
            refreshBtn.disabled = false;
        }
    }, 10000);
}

function toggleBtcPositionInfo() {
    const container = document.getElementById('position-info-container-btc');
    const toggle = document.getElementById('toggle-position-btc');
    
    if (container && toggle) {
        const isVisible = container.style.display !== 'none';
        container.style.display = isVisible ? 'none' : '';
        toggle.classList.toggle('collapsed', isVisible);
    }
}

function toggleBtcPositionAmountVisibility() {
    const hideBtn = document.getElementById('hide-position-btn-btc');
    const eyeOpen = hideBtn.querySelector('.eye-open');
    const eyeClosed = hideBtn.querySelector('.eye-closed');
    const positionValues = document.querySelectorAll('#position-info-container-btc .position-table-value');
    const totalPnL = document.getElementById('position-total-pnl-btc');
    
    const isHidden = eyeOpen.style.display === 'none';
    
    if (isHidden) {
        eyeOpen.style.display = '';
        eyeClosed.style.display = 'none';
        positionValues.forEach(element => {
            element.style.filter = '';
        });
        if (totalPnL) totalPnL.style.filter = '';
    } else {
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = '';
        positionValues.forEach(element => {
            // 不模糊持倉方向欄位
            if (element.id !== 'position-btc-side') {
                element.style.filter = 'blur(4px)';
            }
        });
        if (totalPnL) totalPnL.style.filter = 'blur(4px)';
    }
}

function toggleAvailablePairs() {
    const container = document.getElementById('available-contracts-btc');
    const toggle = document.getElementById('toggle-available-btc');
    
    if (container && toggle) {
        const isVisible = container.style.display !== 'none';
        container.style.display = isVisible ? 'none' : '';
        toggle.classList.toggle('collapsed', isVisible);
    }
}

function toggleAccountInfo() {
    toggleBtcAccountInfo();
}

// 格式化貨幣顯示
function formatCurrency(amount, currency = 'USDT') {
    const num = parseFloat(amount || 0);
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// 格式化損益顯示
function formatPnL(amount) {
    const num = parseFloat(amount || 0);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

// 側邊欄顯示控制 - 使用現代 Intersection Observer API
function initSidebarScrollDetection() {
    const sidebar = document.getElementById('sidebar-tabs');
    const tabs = document.querySelector('.tabs');
    
    if (!sidebar || !tabs) return;

    // 創建 Intersection Observer 來監測上方按鈕的可見性
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach(entry => {
                // entry.isIntersecting = true 表示上方按鈕可見
                // entry.isIntersecting = false 表示上方按鈕不可見
                if (entry.isIntersecting) {
                    // 上方按鈕可見 → 隱藏側邊欄
                    sidebar.classList.remove('show');
                } else {
                    // 上方按鈕不可見 → 顯示側邊欄
                    sidebar.classList.add('show');
                }
            });
        },
        {
            // 精確的觸發條件：
            // threshold: 0 表示目標元素任何部分進入或離開視窗時觸發
            // rootMargin: 負值可以提早觸發
            threshold: 0,
            rootMargin: '0px 0px 0px 0px'
        }
    );

    // 開始觀察上方按鈕區域
    observer.observe(tabs);
    
    // 返回 observer，以便後續可以清理
    return observer;
}

// 第三個DOMContentLoaded已合併到主要初始化函數中
