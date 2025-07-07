function showPanel(panel) {
    if (panel === 'trade' && sessionStorage.getItem('isLoggedIn') !== '1') {
        // 未登入，強制回到設置面板
        document.getElementById('settings-panel').style.display = '';
        document.getElementById('trade-panel').style.display = 'none';
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        alert('請先登入！');
        return;
    }
    document.getElementById('settings-panel').style.display = (panel === 'settings') ? '' : 'none';
    document.getElementById('trade-panel').style.display = (panel === 'trade') ? '' : 'none';
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-btn')[panel === 'settings' ? 0 : 1].classList.add('active');
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
        updateSinopacApiStatus();
        
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
    window.isLoggedIn = false;
    
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
    loadUploadedFiles();
    ['chat_id', 'cert_start', 'cert_end'].forEach(id => {
        document.getElementById(id).addEventListener('input', checkLoginButton);
    });
    checkLoginButton();
    showPanel('settings');
    
    // 如果已經登入，立即檢查ngrok狀態
    if (sessionStorage.getItem('isLoggedIn') === '1') {
        refreshNgrokStatus();
    }
    
    // 頁面關閉時清理定時器
    window.addEventListener('beforeunload', function() {
        if (window.latencyInterval) {
            clearInterval(window.latencyInterval);
        }
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

// Token顯示/隱藏切換函數
function toggleTokenVisibility() {
    const tokenInput = document.getElementById('ngrok-authtoken');
    const eyeOpen = document.querySelector('.password-toggle-btn .eye-open');
    const eyeClosed = document.querySelector('.password-toggle-btn .eye-closed');
    
    if (tokenInput.type === 'password') {
        // 顯示token
        tokenInput.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
    } else {
        // 隱藏token
        tokenInput.type = 'password';
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
    }
}

// 新的ngrok設置函數
function showNgrokSetupModal() {
    document.getElementById('ngrok-setup-modal').style.display = 'block';
    
    // 短暫延遲確保DOM元素完全可用
    setTimeout(() => {
        const tokenInput = document.getElementById('ngrok-authtoken');
        
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

function closeNgrokSetupModal() {
    document.getElementById('ngrok-setup-modal').style.display = 'none';
    // 關閉modal時更新token狀態顯示
    updateTokenStatus();
}

function setupNgrok() {
    const authtoken = document.getElementById('ngrok-authtoken').value.trim();
    const statusDiv = document.getElementById('setup-status');
    const setupBtn = document.getElementById('setup-ngrok-btn');
    
    if (!authtoken) {
        statusDiv.innerHTML = '<div style="color: red;">請輸入有效的authtoken</div>';
        return;
    }
    
    // 先驗證token格式
    fetch('/api/ngrok/validate_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authtoken: authtoken })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'error') {
            statusDiv.innerHTML = `<div style="color: red;">${data.message}</div>`;
            return;
        }
        
        // 驗證通過，先儲存token到服務器
        return fetch('/api/ngrok/token/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authtoken: authtoken })
        });
    })
    .then(res => {
        if (!res) return; // 如果驗證失敗，不繼續
        return res.json();
    })
    .then(data => {
        if (!data) return; // 如果沒有數據，不繼續
        
        if (data.status !== 'success') {
            statusDiv.innerHTML = `<div style="color: red;">Token保存失敗: ${data.message}</div>`;
            return;
        }
        
        // Token保存成功，立即更新主面板的狀態顯示
        updateTokenStatus();
        
        // 開始設置
        setupBtn.disabled = true;
        setupBtn.textContent = '儲存中...';
        statusDiv.innerHTML = '<div style="color: blue;">正在儲存並設置ngrok，請稍候...</div>';
        
        return fetch('/api/ngrok/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authtoken: authtoken })
        });
    })
    .then(res => {
        if (!res) return; // 如果驗證失敗，不繼續
        return res.json();
    })
    .then(data => {
        if (!data) return; // 如果沒有數據，不繼續
        
        if (data.status === 'success') {
            statusDiv.innerHTML = '<div style="color: green;">儲存並設置成功！ngrok正在啟動中...</div>';
            
            // 5秒後檢查狀態並關閉modal
            setTimeout(() => {
                refreshNgrokStatus();
                closeNgrokSetupModal();
            }, 5000);
            
        } else {
            statusDiv.innerHTML = `<div style="color: red;">儲存失敗: ${data.message}</div>`;
        }
    })
    .catch(error => {
        statusDiv.innerHTML = '<div style="color: red;">設置失敗：網路錯誤</div>';
    })
    .finally(() => {
        setupBtn.disabled = false;
        setupBtn.textContent = '儲存並啟動';
    });
}



// Token管理函數
function clearNgrokToken() {
    if (confirm('確定要清除已儲存的 ngrok token 嗎？')) {
        fetch('/api/ngrok/token/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                // 立即清空輸入框
                const tokenInput = document.getElementById('ngrok-authtoken');
                if (tokenInput) {
                    tokenInput.value = '';
                }
                
                // 更新設置狀態顯示
                const setupStatus = document.getElementById('setup-status');
                if (setupStatus) {
                    setupStatus.innerHTML = '<div style="color: green;">✓ Token 已成功清除</div>';
                    setTimeout(() => {
                        setupStatus.innerHTML = '';
                    }, 3000);
                }
                
                updateTokenStatus();
                alert('Token 已清除');
            } else {
                alert('清除失敗: ' + data.message);
            }
        })
        .catch(error => {
            alert('清除失敗：網路錯誤');
        });
    }
}

function updateTokenStatus() {
    // 原本的token狀態顯示元素已移除，此函數現在主要用於其他元件的狀態同步
    // 如果需要，可以在此處添加其他需要更新的元素
    console.log('Token狀態已更新');
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
                updateSinopacApiStatus();
                updateFuturesContracts(); // 登入後更新期貨合約資訊
                updateAccountStatus(); // 登入後更新帳戶狀態
                updatePositionStatus(); // 登入後更新持倉狀態
                
                // 啟動帳戶自動更新
                startAccountAutoUpdate();
            }, 2000); // 延遲2秒
            
            // 立即顯示檢查中狀態，並隱藏延遲時間
            updateNgrokStatus({
                status: 'checking',
                url: '-',
                message: '檢查ngrok狀態...'
            });
            
            // 隱藏延遲時間，直到ngrok真正運行
            document.getElementById('ngrok-latency').textContent = '-';
            
            // 每5000毫秒檢查一次ngrok狀態，直到運行成功
            const statusCheckInterval = setInterval(() => {
                fetch('/api/ngrok/status')
                .then(res => res.json())
                .then(data => {
                    updateNgrokStatus(data);
                    if (data.status === 'running') {
                        clearInterval(statusCheckInterval);
                        // ngrok運行後才開始更新延遲時間
                        updateLatency();
                    }
                })
                .catch(error => {
                    console.error('檢查ngrok狀態失敗：', error);
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
            if (window.latencyInterval) {
                clearInterval(window.latencyInterval);
                window.latencyInterval = null;
            }
            if (window.ttlInterval) {
                clearInterval(window.ttlInterval);
                window.ttlInterval = null;
            }
            if (window.requestsInterval) {
                clearInterval(window.requestsInterval);
                window.requestsInterval = null;
            }
            
            // 停止帳戶自動更新
            stopAccountAutoUpdate();
            
            // 更新永豐API狀態
            updateSinopacApiStatus();
            
            alert('已成功登出！');
        } else {
            alert('登出失敗！');
        }
    })
    .catch(error => {
        console.error('登出失敗：', error);
        alert('登出失敗：' + error.message);
    });
}

// ngrok狀態檢查函數
function refreshNgrokStatus() {
    fetch('/api/ngrok/status')
    .then(res => res.json())
    .then(data => {
        updateNgrokStatus(data);
    })
    .catch(error => {
        console.error('獲取ngrok狀態失敗：', error);
        updateNgrokStatus({
            status: 'error',
            url: '-',
            message: '無法連接到ngrok服務'
        });
    });
    
    // 同時獲取版本信息
    getNgrokVersion();
}

// 獲取ngrok版本信息
function getNgrokVersion() {
    fetch('/api/ngrok/version')
    .then(res => res.json())
    .then(data => {
        const versionElement = document.getElementById('ngrok-version');
        const updateCheckBtn = document.getElementById('update-check-btn');
        const updateAvailableBtn = document.getElementById('update-available-btn');
        
        if (data.current_version) {
            versionElement.textContent = `v${data.current_version}`;
            updateCheckBtn.style.display = 'flex';
            
            if (data.update_available) {
                updateCheckBtn.style.display = 'none';
                updateAvailableBtn.style.display = 'flex';
            } else {
                updateCheckBtn.style.display = 'flex';
                updateAvailableBtn.style.display = 'none';
            }
        } else {
            versionElement.textContent = 'v-';
            updateCheckBtn.style.display = 'none';
            updateAvailableBtn.style.display = 'none';
        }
    })
    .catch(error => {
        console.error('獲取ngrok版本失敗：', error);
        const versionElement = document.getElementById('ngrok-version');
        versionElement.textContent = '-';
    });
}

// 獲取shioaji版本信息
function getSinopacVersion() {
    fetch('/api/sinopac/version')
    .then(res => res.json())
    .then(data => {
        const versionElement = document.getElementById('sinopac-version');
        
        if (data.available && data.version && data.version !== 'unknown') {
            versionElement.textContent = `sj${data.version}`;
        } else if (!data.available) {
            versionElement.textContent = 'sj-N/A';
        } else {
            versionElement.textContent = 'sj-';
        }
        
        // 獲取版本後檢查更新
        // checkSinopacUpdate(); // 移除這行，避免重複檢查
    })
    .catch(error => {
        console.error('獲取shioaji版本失敗：', error);
        document.getElementById('sinopac-version').textContent = 'Error';
    });
}

// 檢查ngrok更新
function checkNgrokUpdate() {
    const updateCheckBtn = document.getElementById('update-check-btn');
    const originalText = updateCheckBtn.innerHTML;
    
    // 顯示載入狀態
    updateCheckBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="animation: spin 1s linear infinite;">
            <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
        </svg>
    `;
    updateCheckBtn.disabled = true;
    
    fetch('/api/ngrok/check_update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const updateInfo = data.data;
            if (updateInfo.update_available) {
                addSystemLog(`發現ngrok更新: ${updateInfo.current_version} -> ${updateInfo.latest_version}`, 'info');
                
                // 顯示更新可用按鈕
                updateCheckBtn.style.display = 'none';
                document.getElementById('update-available-btn').style.display = 'flex';
                
                // 儲存下載URL供稍後使用
                window.ngrokUpdateInfo = updateInfo;
            } else {
                addSystemLog(`ngrok已是最新版本: ${updateInfo.current_version}`, 'success');
            }
        } else {
            addSystemLog(`檢查ngrok更新失敗: ${data.message}`, 'error');
        }
    })
    .catch(error => {
        console.error('檢查ngrok更新失敗：', error);
        addSystemLog('檢查ngrok更新失敗', 'error');
    })
    .finally(() => {
        // 恢復按鈕狀態
        updateCheckBtn.innerHTML = originalText;
        updateCheckBtn.disabled = false;
    });
}

// 更新ngrok
function updateNgrok() {
    // 顯示更新提醒模態框，讓用戶決定是否更新
    showNgrokUpdateModal();
}

function showNgrokUpdateModal() {
    const modal = document.getElementById('ngrok-update-modal');
    const updateInfo = document.getElementById('ngrok-update-info');
    const updateActions = document.getElementById('ngrok-update-actions');
    
    // 顯示模態框
    modal.style.display = 'block';
    updateInfo.style.display = 'block';
    updateActions.style.display = 'none';
    updateInfo.innerHTML = '<p>檢查更新中...</p>';
    
    // 檢查更新
    fetch('/api/ngrok/check_update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const updateData = data.data;
            
            if (updateData.update_available) {
                // 顯示更新資訊
                document.getElementById('ngrok-current-version').textContent = updateData.current_version;
                document.getElementById('ngrok-latest-version').textContent = updateData.latest_version;
                
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
        console.error('檢查ngrok更新失敗:', error);
        updateInfo.innerHTML = '<p>檢查更新失敗，請稍後再試。</p>';
    });
}

function closeNgrokUpdateModal() {
    document.getElementById('ngrok-update-modal').style.display = 'none';
}

function startNgrokUpdate() {
    const updateModal = document.getElementById('ngrok-update-modal');
    const progressModal = document.getElementById('ngrok-update-progress-modal');
    
    // 切換到進度模態框
    updateModal.style.display = 'none';
    progressModal.style.display = 'block';
    
    // 開始進度動畫
    const progressFill = document.getElementById('ngrok-progress-fill');
    const updateStatus = document.getElementById('ngrok-update-status');
    const updateOutput = document.getElementById('ngrok-update-output');
    const updateLog = document.getElementById('ngrok-update-log');
    
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90;
        progressFill.style.width = progress + '%';
    }, 500);
    
    // 執行更新
    fetch('/api/ngrok/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
    })
    .then(res => res.json())
    .then(data => {
        clearInterval(progressInterval);
        progressFill.style.width = '100%';
        
        if (data.status === 'success') {
            updateStatus.textContent = '更新成功！';
            
            // 顯示更新日誌
            updateOutput.style.display = 'block';
            updateLog.textContent = data.message || '更新完成';
            
            // 延遲關閉模態框並重新檢查版本
            setTimeout(() => {
                progressModal.style.display = 'none';
                addSystemLog('ngrok更新完成', 'success');
                
                // 重新檢查版本
                getNgrokVersion();
                
                // 重新啟動ngrok
                setTimeout(() => {
                    refreshNgrokStatus();
                }, 2000);
            }, 2000);
        } else {
            updateStatus.textContent = '更新失敗';
            updateOutput.style.display = 'block';
            updateLog.textContent = data.message || '更新過程中發生錯誤';
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

function updateNgrokStatus(statusData) {
    const statusElement = document.getElementById('ngrok-status');
    const latencyElement = document.getElementById('ngrok-latency');
    const ttlElement = document.getElementById('ngrok-ttl');
    const urlsContainer = document.getElementById('ngrok-urls-container');
    
    // 檢查狀態是否改變，避免不必要的更新
    const currentStatus = statusElement.getAttribute('data-status');
    const newStatusText = getStatusText(statusData.status);
    
    if (currentStatus !== statusData.status) {
        // 狀態改變時才更新
        statusElement.textContent = newStatusText;
        statusElement.className = 'status-value ' + statusData.status;
        statusElement.setAttribute('data-status', statusData.status);
    }
    
    // 根據狀態處理延遲時間和TTL顯示
    if (statusData.status === 'checking') {
        latencyElement.textContent = '-';
        ttlElement.textContent = '-';
        // 清除延遲更新定時器
        if (window.latencyInterval) {
            clearInterval(window.latencyInterval);
            window.latencyInterval = null;
        }
        if (window.ttlInterval) {
            clearInterval(window.ttlInterval);
            window.ttlInterval = null;
        }
    } else if (statusData.status === 'running') {
        // 只有在運行狀態才更新延遲時間和TTL
        if (!window.latencyInterval) {
            updateLatency(); // 立即更新一次
            // 每30秒更新一次Latency（與頁面初始化保持一致）
            window.latencyInterval = setInterval(updateLatency, 30000);
        }
        if (!window.ttlInterval) {
            updateTTL(); // 立即更新一次
            // 每30秒更新一次TTL（與頁面初始化保持一致）
            window.ttlInterval = setInterval(updateTTL, 30000);
        }
        
        // 更新請求日誌
        updateRequestsLog();
        // 每10秒更新一次請求日誌（與頁面初始化保持一致）
        if (!window.requestsInterval) {
            window.requestsInterval = setInterval(updateRequestsLog, 10000);
        }
    } else {
        // offline 或其他狀態，立即獲取一次延遲時間和TTL
        updateLatency();
        updateTTL();
        
        // 清除請求日誌更新定時器
        if (window.requestsInterval) {
            clearInterval(window.requestsInterval);
            window.requestsInterval = null;
        }
    }
    
    // 更新URL列表
    urlsContainer.innerHTML = '';
    
    if (statusData.urls && statusData.urls.length > 0) {
        statusData.urls.forEach((urlInfo, index) => {
            const urlItem = document.createElement('div');
            urlItem.className = 'url-item';
            
            const urlValue = document.createElement('span');
            urlValue.className = 'url-value';
            urlValue.textContent = urlInfo.url;
            
            const copyBtn = document.createElement('button');
            copyBtn.className = 'url-copy-btn';
            copyBtn.textContent = '複製';
            copyBtn.onclick = function() {
                copyToClipboard(urlInfo.url, this);
            };
            
            urlItem.appendChild(urlValue);
            urlItem.appendChild(copyBtn);
            urlsContainer.appendChild(urlItem);
        });
    } else {
        const noUrlsMsg = document.createElement('div');
        noUrlsMsg.className = 'url-item';
        noUrlsMsg.textContent = '無外網連結';
        noUrlsMsg.style.justifyContent = 'center';
        noUrlsMsg.style.color = '#6c757d';
        urlsContainer.appendChild(noUrlsMsg);
    }
    
    // 更新請求日誌
    updateRequestsLog();
}

// 更新Latency的獨立函數
function updateLatency() {
    fetch('/api/ngrok/latency')
    .then(res => res.json())
    .then(data => {
        document.getElementById('ngrok-latency').textContent = data.latency;
    })
    .catch(error => {
        console.error('獲取ngrok延遲信息失敗：', error);
    });
}

// 更新TTL的獨立函數
function updateTTL() {
    fetch('/api/ngrok/connections')
    .then(res => res.json())
    .then(data => {
        document.getElementById('ngrok-ttl').textContent = data.ttl;
    })
    .catch(error => {
        console.error('獲取ngrok TTL信息失敗：', error);
    });
}

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
    return statusTexts[status] || status;
}

function updateRequestsLog() {
    fetch('/api/ngrok/requests')
    .then(res => res.json())
    .then(data => {
        const requestsContainer = document.getElementById('requests-container');
        
        if (data.requests && data.requests.length > 0) {
            // 只顯示 webhook 請求（type=webhook 或 uri=/webhook）
            const webhookRequests = data.requests.filter(req => 
                req.type === 'webhook' || req.uri === '/webhook'
            );
            
            if (webhookRequests.length > 0) {
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
                    requestItem.innerHTML = `
                        <span class="request-timestamp">${req.timestamp}</span>
                        <span class="request-method ${req.method.toLowerCase()}">${req.method}</span>
                        <span class="request-uri">${req.uri}</span>
                        <span class="request-status ${statusClass}">${req.status} ${req.status_text}</span>
                    `;
                    
                    requestsContainer.appendChild(requestItem);
                });
                
                // 保持在頂部位置顯示最新的記錄
                requestsContainer.scrollTop = 0;
            } else {
                requestsContainer.innerHTML = '';
                const noRequestsMsg = document.createElement('div');
                noRequestsMsg.className = 'request-item';
                noRequestsMsg.textContent = '無請求記錄';
                noRequestsMsg.style.justifyContent = 'center';
                noRequestsMsg.style.color = '#666';
                requestsContainer.appendChild(noRequestsMsg);
            }
        } else {
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

// 系統日誌相關函數
let systemLogs = []; // 儲存系統日誌的陣列

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
    
    // 添加到日誌陣列
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

// 新增：從後端同步系統日誌
function updateSystemLogsFromBackend() {
    fetch('/api/ngrok/requests')
        .then(res => res.json())
        .then(data => {
            if (data.requests && data.requests.length > 0) {
                // 過濾 type=custom 的日誌（後端送來的系統日誌）
                const customLogs = data.requests
                    .filter(log => log.type === 'custom' || log.type === 'webhook')
                    .map(log => {
                        // 解析後端日誌格式
                        let message = '';
                        let type = 'info';
                        
                        // 檢查 extra_info 中的 message 和 type
                        if (log.extra_info && log.extra_info.message) {
                            message = log.extra_info.message;
                            type = log.extra_info.type || 'info';
                        } else if (log.message) {
                            message = log.message;
                            type = 'info';
                        } else {
                            message = log.uri || '';
                            type = log.status >= 400 ? 'error' : (log.status >= 300 ? 'warning' : 'info');
                        }
                        
                        // 格式化時間戳為 時:分:秒 格式
                        let formattedTimestamp = '';
                        if (log.timestamp) {
                            try {
                                // 解析 ngrok 格式的時間戳 (HH:MM:SS.mmm CST)
                                if (log.timestamp.includes(' CST')) {
                                    const timePart = log.timestamp.replace(' CST', '');
                                    const timeComponents = timePart.split('.')[0]; // 移除毫秒
                                    formattedTimestamp = timeComponents;
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
                            message: message,
                            type: type
                        };
                    });
                
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
                        
                        // 按時間戳排序（假設時間戳格式為 HH:MM:SS）
                        allLogs.sort((a, b) => {
                            const timeA = a.timestamp || '';
                            const timeB = b.timestamp || '';
                            return timeA.localeCompare(timeB);
                        });
                        
                        // 保留最新的100條記錄
                        systemLogs = allLogs.slice(-100);
                        updateSystemLogsDisplay();
                        console.log('同步後端系統日誌成功，新增', newLogs.length, '條日誌');
                    }
                }
            }
        })
        .catch(error => {
            console.error('同步後端系統日誌失敗：', error);
        });
}

function updateSystemLogsDisplay() {
    const logsContainer = document.getElementById('system-logs-content');
    if (!logsContainer) return;
    
    if (systemLogs.length > 0) {
        logsContainer.innerHTML = '';
        systemLogs.forEach((log, index) => {
            const logItem = document.createElement('div');
            logItem.className = 'log-item';
            
            // 根據日誌類型設置顏色
            let typeClass = '';
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

// 更新連線時長
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
                
                // 格式化顯示
                let durationText = `${durationHours.toFixed(1)}H`;
                
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
                console.log('交易日14:50 - 執行合約和保證金更新');
                updateFuturesContracts();
            }
            // 非交易日時不輸出任何訊息
        })
        .catch(error => {
            // API錯誤時也不輸出訊息，靜默處理
        });
    }
}

// 更新本地時間顯示
function updateCurrentTime() {
    const datetimeElement = document.getElementById('current-datetime');
    const weekdayElement = document.getElementById('weekday-status');
    
    if (datetimeElement) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        
        // 更新時間
        datetimeElement.textContent = `${year}/${month}/${day} ${hour}:${minute}:${second}`;
        
        // 更新星期幾
        if (weekdayElement) {
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            const weekday = weekdays[now.getDay()];
            weekdayElement.textContent = weekday;
            weekdayElement.className = 'ngrok-latency';
        }
        
        console.log('現在時間:', datetimeElement.textContent);
    } else {
        console.log('找不到current-datetime元素');
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
    
    // 載入已上傳的檔案狀態
    loadUploadedFiles();
    
    // 初始化token管理狀態
    initializeTokenManagement();
    
    // 開始定期更新 ngrok 狀態和請求日誌
    refreshNgrokStatus();
    setInterval(refreshNgrokStatus, 30000); // 改為每30秒更新一次
    updateRequestsLog();
    setInterval(updateRequestsLog, 10000); // 改為每10秒更新一次
    updateLatency();
    setInterval(updateLatency, 30000); // 改為每30秒更新一次
    updateTTL();
    setInterval(updateTTL, 30000); // 改為每30秒更新一次
    
    // 初始化系統資訊
    updateSystemInfo();
    setInterval(updateSystemInfo, 1000); // 每秒更新一次
    
    // 初始化永豐API狀態和期貨合約資訊
    updateSinopacApiStatus();
    updateFuturesContracts(); // 頁面載入時更新期貨合約資訊
    getSinopacVersion(); // 頁面載入時獲取shioaji版本
    getNgrokVersion(); // 頁面載入時獲取ngrok版本
    updateCurrentTime(); // 頁面載入時立即顯示本地時間
    updateTradingStatus(); // 頁面載入時更新交易狀態
    setInterval(updateSinopacApiStatus, 5000); // 每5秒更新一次永豐API狀態
    setInterval(updateCurrentTime, 1000); // 每秒更新一次本地時間
    setInterval(updateTradingStatus, 30000); // 每30秒更新一次交易狀態
    
    // 延遲檢查更新，避免影響頁面載入
    setTimeout(() => {
        // 檢查ngrok更新
        if (!window.ngrokUpdateChecked) {
            checkNgrokUpdate();
            window.ngrokUpdateChecked = true;
        }
    }, 2000);
    
    // 設置定時更新（每分鐘檢查一次是否需要定時更新）
    setInterval(() => {
        checkScheduledUpdate();
    }, 60000); // 每分鐘檢查一次
    
    // 移除自動初始化帳戶狀態和持倉狀態，讓它們只在登入後才被調用
    // updateAccountStatus();
    // updatePositionStatus();
    
    // 初始化系統日誌
    updateSystemLogsDisplay();
    
    // 啟動系統日誌同步（從後端拉取）
    updateSystemLogsFromBackend();
    setInterval(updateSystemLogsFromBackend, 5000); // 每5秒同步一次後端系統日誌
    
    // 添加初始系統日誌
    addSystemLog('Auto91 交易系統已啟動', 'success');
    
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
    
    // 檢查是否已登入，如果已登入則啟動智能更新
    if (window.isLoggedIn) {
        // 如果已登入，延遲啟動自動更新，讓API有時間連接
        setTimeout(() => {
            startAccountAutoUpdate();
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
            console.log('交易時段內且為交易日，執行帳戶狀態和持倉狀態自動更新');
            updateAccountStatus();
            updatePositionStatus();
        } else {
            console.log('非交易時段或非交易日，跳過帳戶狀態和持倉狀態自動更新');
        }
    }, 300000); // 每五分鐘檢查一次
    
    console.log('帳戶自動更新已啟動');
}

// 停止帳戶自動更新
function stopAccountAutoUpdate() {
    if (window.accountUpdateInterval) {
        clearInterval(window.accountUpdateInterval);
        window.accountUpdateInterval = null;
        console.log('帳戶自動更新已停止');
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
        
        console.log(`交易日狀態檢查: ${data.is_trading_day ? '交易日' : '非交易日'}`);
        
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
    console.log('執行帳戶狀態更新...');
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
                
                // 如果當前處於隱藏狀態，保存真實值但顯示隱藏符號
                if (accountAmountHidden && ['account-equity', 'account-equity-amount', 'account-today-balance', 'account-yesterday-balance', 'account-available-margin', 'account-initial-margin', 'account-maintenance-margin', 'account-risk-indicator', 'account-fee', 'account-tax', 'account-settle-profit'].includes(id)) {
                    // 檢查是否有實際數值（不是空值）
                    if (displayValue && displayValue !== '-') {
                        element.dataset.originalValue = displayValue;
                        element.dataset.originalClass = element.className;
                        element.className = 'account-value'; // 隱藏時只保留基本樣式
                        element.textContent = '●●●●●';
                    } else {
                        element.textContent = displayValue;
                        element.dataset.originalValue = displayValue;
                    }
                } else {
                    element.textContent = displayValue;
                    element.dataset.originalValue = displayValue; // 同時保存原始值
                }
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
            
            // 本日平倉損益 - 根據數值設置顏色，可隱藏
            const profitElement = document.getElementById('account-settle-profit');
            const profitValue = parseFloat(accountData['本日平倉損益']);
            const profitDisplay = formatNumber(accountData['本日平倉損益']) + ' TWD';
            
            profitElement.className = 'account-value';
            profitElement.dataset.originalValue = profitDisplay;
            
            if (accountAmountHidden && profitDisplay !== '-') {
                profitElement.dataset.originalClass = profitElement.className;
                profitElement.className = 'account-value'; // 隱藏時只保留基本樣式
                profitElement.textContent = '●●●●●';
            } else {
                profitElement.textContent = profitDisplay;
                if (profitValue > 0) {
                    profitElement.classList.add('positive');
                } else if (profitValue < 0) {
                    profitElement.classList.add('negative');
                } else {
                    profitElement.classList.add('neutral');
                }
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
                'account-tax', 'account-settle-profit'
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

// 格式化數字顯示（添加千分位分隔符）
function formatNumber(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) {
        return '0';
    }
    
    const num = parseFloat(value);
    return num.toLocaleString('zh-TW');
}

// 更新持倉狀態
function updatePositionStatus() {
    console.log('執行持倉狀態更新...');
    fetch('/api/position/status')
    .then(res => res.json())
    .then(data => {
        if (data.status === 'success') {
            const positionData = data.data;
            
            // 更新三種合約的持倉資訊
            const contractTypes = ['TXF', 'MXF', 'TMF'];
            const contractNames = ['txf', 'mxf', 'tmf'];
            
            contractTypes.forEach((contractType, index) => {
                const contractName = contractNames[index];
                const contractData = positionData[contractType];
                
                // 動作 - 不隱藏
                const actionElement = document.getElementById(`position-${contractName}-action`);
                actionElement.textContent = contractData['動作'];
                actionElement.className = 'position-table-value';
                actionElement.dataset.originalValue = contractData['動作'];
                if (contractData['動作'] === '多單') {
                    actionElement.classList.add('long');
                } else if (contractData['動作'] === '空單') {
                    actionElement.classList.add('short');
                }
                
                // 數量 - 可隱藏
                const quantityElement = document.getElementById(`position-${contractName}-quantity`);
                const quantityValue = contractData['數量'];
                quantityElement.dataset.originalValue = quantityValue;
                if (positionAmountHidden && quantityValue !== '-') {
                    quantityElement.dataset.originalClass = quantityElement.className;
                    quantityElement.className = 'position-table-value';
                    quantityElement.textContent = '●●●●●';
                } else {
                    quantityElement.textContent = quantityValue;
                }
                
                // 均價 - 可隱藏
                const avgPriceElement = document.getElementById(`position-${contractName}-avg-price`);
                const avgPriceValue = contractData['均價'];
                avgPriceElement.dataset.originalValue = avgPriceValue;
                if (positionAmountHidden && avgPriceValue !== '-') {
                    avgPriceElement.dataset.originalClass = avgPriceElement.className;
                    avgPriceElement.className = 'position-table-value';
                    avgPriceElement.textContent = '●●●●●';
                } else {
                    avgPriceElement.textContent = avgPriceValue;
                }
                
                // 市價 - 可隱藏
                const lastPriceElement = document.getElementById(`position-${contractName}-last-price`);
                const lastPriceValue = contractData['市價'];
                lastPriceElement.dataset.originalValue = lastPriceValue;
                if (positionAmountHidden && lastPriceValue !== '-') {
                    lastPriceElement.dataset.originalClass = lastPriceElement.className;
                    lastPriceElement.className = 'position-table-value';
                    lastPriceElement.textContent = '●●●●●';
                } else {
                    lastPriceElement.textContent = lastPriceValue;
                }
                
                // 未實現盈虧 - 可隱藏
                const pnlElement = document.getElementById(`position-${contractName}-unrealized-pnl`);
                const pnlText = contractData['未實現盈虧'];
                
                if (pnlText !== '-') {
                    const pnlValue = parseFloat(pnlText.replace(/,/g, ''));
                    const pnlDisplay = formatNumber(pnlValue) + ' TWD';
                    
                    pnlElement.dataset.originalValue = pnlDisplay;
                    pnlElement.className = 'position-table-value';
                    
                    if (positionAmountHidden) {
                        pnlElement.dataset.originalClass = pnlElement.className;
                        pnlElement.className = 'position-table-value';
                        pnlElement.textContent = '●●●●●';
                    } else {
                        pnlElement.textContent = pnlDisplay;
                        if (pnlValue > 0) {
                            pnlElement.classList.add('positive');
                        } else if (pnlValue < 0) {
                            pnlElement.classList.add('negative');
                        } else if (pnlValue === 0) {
                            pnlElement.classList.add('neutral');
                        }
                    }
                } else {
                    pnlElement.textContent = '-';
                    pnlElement.className = 'position-table-value';
                    pnlElement.dataset.originalValue = '-';
                }
            });
            
            // 更新總損益 - 不隱藏
            const totalPnlElement = document.getElementById('position-total-pnl');
            const totalPnlDisplay = data.total_pnl || '-';
            const totalPnlValue = data.total_pnl_value || 0;
            
            totalPnlElement.textContent = totalPnlDisplay;
            totalPnlElement.className = 'position-total-value';
            totalPnlElement.dataset.originalValue = totalPnlDisplay;
            
            if (data.has_positions && totalPnlValue !== 0) {
                if (totalPnlValue > 0) {
                    totalPnlElement.classList.add('positive');
                } else if (totalPnlValue < 0) {
                    totalPnlElement.classList.add('negative');
                } else {
                    totalPnlElement.classList.add('neutral');
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

// 帳戶狀態金額隱藏狀態
let accountAmountHidden = false;

// 切換帳戶狀態金額顯示/隱藏
function toggleAccountAmountVisibility() {
    accountAmountHidden = !accountAmountHidden;
    
    const hideBtn = document.getElementById('hide-account-btn');
    const eyeOpen = hideBtn.querySelector('.eye-open');
    const eyeClosed = hideBtn.querySelector('.eye-closed');
    
    // 切換眼睛圖標
    if (accountAmountHidden) {
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
    } else {
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
    }
    
    // 需要隱藏的帳戶狀態欄位（包含本日平倉損益）
    const accountFieldsToHide = [
        'account-equity',
        'account-equity-amount', 
        'account-today-balance',
        'account-yesterday-balance',
        'account-available-margin',
        'account-initial-margin',
        'account-maintenance-margin',
        'account-risk-indicator',
        'account-fee',
        'account-tax',
        'account-settle-profit'
    ];
    
    accountFieldsToHide.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element) {
            if (accountAmountHidden) {
                // 只隱藏有數值的欄位，空值"-"不隱藏
                const currentText = element.textContent.trim();
                if (currentText && currentText !== '-') {
                    // 保存原始值並隱藏
                    if (!element.dataset.originalValue) {
                        element.dataset.originalValue = currentText;
                    }
                    if (!element.dataset.originalClass) {
                        element.dataset.originalClass = element.className;
                    }
                    // 隱藏時移除所有顏色樣式，只保留基本樣式
                    element.className = 'account-value';
                    element.textContent = '●●●●●';
                }
            } else {
                // 恢復原始值和樣式
                if (element.dataset.originalValue) {
                    element.textContent = element.dataset.originalValue;
                }
                if (element.dataset.originalClass) {
                    element.className = element.dataset.originalClass;
                }
            }
        }
    });
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

// 持倉狀態金額隱藏狀態
let positionAmountHidden = false;

// 切換持倉狀態金額顯示/隱藏
function togglePositionAmountVisibility() {
    positionAmountHidden = !positionAmountHidden;
    
    const hideBtn = document.getElementById('hide-position-btn');
    const eyeOpen = hideBtn.querySelector('.eye-open');
    const eyeClosed = hideBtn.querySelector('.eye-closed');
    
    // 切換眼睛圖標
    if (positionAmountHidden) {
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
    } else {
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
    }
    
    // 需要隱藏的持倉狀態欄位（排除未實現總損益）
    const contractNames = ['txf', 'mxf', 'tmf'];
    const fieldsToHide = ['quantity', 'avg-price', 'last-price', 'unrealized-pnl'];
    
    contractNames.forEach(contractName => {
        fieldsToHide.forEach(field => {
            const element = document.getElementById(`position-${contractName}-${field}`);
            if (element) {
                if (positionAmountHidden) {
                    // 只隱藏有數值的欄位，空值"-"不隱藏
                    const currentText = element.textContent.trim();
                    if (currentText && currentText !== '-') {
                        // 保存原始值並隱藏
                        if (!element.dataset.originalValue) {
                            element.dataset.originalValue = currentText;
                        }
                        if (!element.dataset.originalClass) {
                            element.dataset.originalClass = element.className;
                        }
                        // 隱藏時移除所有顏色樣式，只保留基本樣式
                        element.className = 'position-table-value';
                        element.textContent = '●●●●●';
                    }
                } else {
                    // 恢復原始值和樣式
                    if (element.dataset.originalValue) {
                        element.textContent = element.dataset.originalValue;
                    }
                    if (element.dataset.originalClass) {
                        element.className = element.dataset.originalClass;
                    }
                }
            }
        });
    });
    
    // 注意：未實現總損益不隱藏，所以不處理 position-total-pnl
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
                        console.log('應用程式關閉請求已發送');
                    })
                    .catch(() => {
                        // 如果後端 API 失敗，嘗試關閉視窗
                        console.log('嘗試關閉視窗');
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

function restartApplication() {
    // 此函數已移除，不再需要自動重啟功能
}

// 頁面載入時檢查shioaji更新
document.addEventListener('DOMContentLoaded', function() {
    // 延遲檢查更新，避免影響頁面載入
    setTimeout(() => {
        // 只在頁面載入時檢查一次，避免重複檢查
        if (!window.sinopacUpdateChecked) {
            checkSinopacUpdate();
            window.sinopacUpdateChecked = true;
        }
    }, 3000);
});

// 重新整理合約資訊
async function refreshContractInfo() {
    const refreshBtn = document.getElementById('refresh-contract-btn');
    
    // 如果按鈕已經被禁用，直接返回
    if (refreshBtn.disabled) return;
    
    try {
        // 禁用按鈕並添加loading類
        refreshBtn.disabled = true;
        refreshBtn.classList.add('loading');
        
        console.log('開始重新整理合約資訊...');

        // 重新獲取合約資訊
        const response = await fetch('/api/futures/contracts');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        console.log('合約資訊更新成功:', data);

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
            console.log('合約資訊更新完成');
        }, 500);
    }
}

// 測試功能相關函數已移除