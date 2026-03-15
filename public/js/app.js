// State
let appState = null;
let currentTargetUserId = null; // 用于管理员切换用户
let isAdminMode = false;
let pnlChart = null; // Chart实例

// DOM Elements
const container = document.getElementById('cards-container');
const globalMultiplierInput = document.getElementById('global-multiplier');
const loadingOverlay = document.getElementById('loading-overlay');
const userInfoDisplay = document.getElementById('user-info');

// Views
const viewDashboard = document.getElementById('view-dashboard');
const viewHistory = document.getElementById('view-history');
const historyTableBody = document.querySelector('#history-table tbody');

// Admin Elements
const adminControls = document.getElementById('admin-controls');
const userSelect = document.getElementById('user-select');

// Login Elements
const loginContainer = document.getElementById('login-container');
const mainContainer = document.getElementById('main-container');
const loginUser = document.getElementById('login-user');
const loginPass = document.getElementById('login-pass');
const loginSubmit = document.getElementById('login-submit');
const loginError = document.getElementById('login-error');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    // Login Handling
    loginSubmit.addEventListener('click', handleLogin);
    loginPass.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Tab Handling
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // UI Switch
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const target = btn.dataset.target;
            if (target === 'dashboard') {
                viewDashboard.style.display = 'block';
                viewHistory.style.display = 'none';
                fetchState(); // Refresh dashboard
            } else {
                viewDashboard.style.display = 'none';
                viewHistory.style.display = 'block';
                fetchHistory(); // Load history
            }
        });
    });

    // Global Multiplier Save Button
    document.getElementById('save-multiplier').addEventListener('click', () => {
        const val = parseFloat(globalMultiplierInput.value);
        if (val > 0) {
            updateSetting('setGlobalMultiplier', { value: val });
        } else {
            showToast('倍数必须大于0', 'error');
        }
    });

    // Global Buttons
    document.getElementById('enable-all').addEventListener('click', () => {
        if(confirm('确定启用所有交易对吗？')) updateSetting('enableAll', {});
    });
    document.getElementById('disable-all').addEventListener('click', () => {
        if(confirm('确定禁用所有交易对吗？')) updateSetting('disableAll', {});
    });
    document.getElementById('reset-all-shorts').addEventListener('click', () => {
        if(confirm('确定重置所有忽略做空信号标志吗？')) updateSetting('resetAllShortSignals', {});
    });

    // Logout Button
    document.getElementById('logout-btn').addEventListener('click', () => {
        if(confirm('确定要登出吗？')) {
            logout();
        }
    });

    // Admin User Switch
    userSelect.addEventListener('change', (e) => {
        currentTargetUserId = e.target.value;
        // Refresh current view
        if (viewDashboard.style.display !== 'none') {
            fetchState();
        } else {
            fetchHistory();
        }
    });
});

// --- Auth Functions ---
function getAuthHeaders() {
    const token = localStorage.getItem('trade_bot_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function checkAuth() {
    const token = localStorage.getItem('trade_bot_token');
    if (token) {
        showMain();
        fetchState();
    } else {
        showLogin();
    }
}

async function handleLogin() {
    const username = loginUser.value.trim();
    const password = loginPass.value.trim();
    
    if (!username || !password) {
        loginError.textContent = '请输入用户名和密码';
        return;
    }

    showLoading(true);
    loginError.textContent = '';
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (data.success && data.token) {
            localStorage.setItem('trade_bot_token', data.token);
            loginUser.value = '';
            loginPass.value = '';
            showMain();
            fetchState();
        } else {
            loginError.textContent = data.error || '登录失败';
        }
    } catch (e) {
        loginError.textContent = '网络请求失败';
    } finally {
        showLoading(false);
    }
}

async function logout() {
    try {
        await fetch('/api/logout', { 
            method: 'POST',
            headers: getAuthHeaders()
        });
    } catch(e) {}
    localStorage.removeItem('trade_bot_token');
    showLogin();
}

function showLogin() {
    loginContainer.style.display = 'flex';
    mainContainer.style.display = 'none';
}

function showMain() {
    loginContainer.style.display = 'none';
    mainContainer.style.display = 'block';
}

// --- Data Functions ---
async function fetchAdminUsers() {
    try {
        const res = await fetch('/api/users', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const users = await res.json();
        
        userSelect.innerHTML = '';
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.name} (${u.username})`;
            if (currentTargetUserId === u.id) opt.selected = true;
            userSelect.appendChild(opt);
        });
        
        if (!currentTargetUserId && users.length > 0) {
            currentTargetUserId = users[0].id;
        }
    } catch (e) {
        console.error('Failed to fetch users list');
    }
}

async function fetchState() {
    showLoading(true);
    try {
        let url = '/api/status';
        if (isAdminMode && currentTargetUserId) {
            url += `?userId=${currentTargetUserId}`;
        }

        const res = await fetch(url, {
            headers: getAuthHeaders()
        });
        
        if (res.status === 401) {
            logout();
            return;
        }
        
        if (!res.ok) throw new Error('Failed to fetch state');
        appState = await res.json();
        
        // Admin Mode Setup
        if (appState.isGlobalAdmin && !isAdminMode) {
            isAdminMode = true;
            adminControls.style.display = 'flex';
            if (!currentTargetUserId) currentTargetUserId = appState.id;
            await fetchAdminUsers();
        } else if (!appState.isGlobalAdmin) {
            isAdminMode = false;
            adminControls.style.display = 'none';
        }

        render();
    } catch (err) {
        showToast('加载状态失败: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function updateSetting(action, payload) {
    showLoading(true);
    try {
        const headers = { 
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        };

        const bodyData = { action, ...payload };
        if (isAdminMode && currentTargetUserId) {
            bodyData.userId = currentTargetUserId;
        }

        const res = await fetch('/api/update', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(bodyData)
        });
        
        if (res.status === 401) {
            logout();
            return;
        }

        const data = await res.json();
        if (data.success) {
            showToast('设置已保存', 'success');
            // Refresh dashboard
            fetchState(); 
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
        showLoading(false);
    }
}

// --- History Functions ---
async function fetchHistory() {
    showLoading(true);
    try {
        let url = '/api/history';
        if (isAdminMode && currentTargetUserId) {
            url += `?userId=${currentTargetUserId}`;
        }
        
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (res.status === 401) return logout();
        
        const history = await res.json();
        renderHistoryTable(history);
        renderHistoryChart(history);
    } catch (e) {
        console.error('Fetch history failed', e);
        showToast('加载历史失败', 'error');
    } finally {
        showLoading(false);
    }
}

function renderHistoryTable(history) {
    historyTableBody.innerHTML = '';
    
    if (history.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#666;">暂无记录</td></tr>';
        return;
    }
    
    history.forEach(item => {
        const row = document.createElement('tr');
        const time = new Date(item.timestamp).toLocaleString();
        const pnl = parseFloat(item.pnl);
        const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
        
        row.innerHTML = `
            <td>${time}</td>
            <td>${item.symbol}</td>
            <td><span class="${item.side === '多' ? 'pnl-positive' : 'pnl-negative'}">${item.side}</span></td>
            <td>${item.entryPrice.toFixed(4)}</td>
            <td>${item.exitPrice.toFixed(4)}</td>
            <td>${item.quantity}</td>
            <td class="${pnlClass}">${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}</td>
            <td>${item.reason}</td>
        `;
        historyTableBody.appendChild(row);
    });
}

function renderHistoryChart(history) {
    const ctx = document.getElementById('pnlChart').getContext('2d');
    
    // Process data for chart
    // Sort by time ascending
    const sorted = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    let cumulativePnl = 0;
    const labels = [];
    const dataPoints = [];
    
    sorted.forEach(item => {
        cumulativePnl += parseFloat(item.pnl);
        labels.push(new Date(item.timestamp).toLocaleDateString());
        dataPoints.push(cumulativePnl);
    });
    
    if (pnlChart) {
        pnlChart.destroy();
    }
    
    pnlChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '累计盈亏 (USDT)',
                data: dataPoints,
                borderColor: '#4caf50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#ccc' }
                }
            },
            scales: {
                y: {
                    grid: { color: '#333' },
                    ticks: { color: '#aaa' }
                },
                x: {
                    grid: { color: '#333' },
                    ticks: { color: '#aaa' }
                }
            }
        }
    });
}

function render() {
    if (!appState) return;

    // Render User Info
    if (userInfoDisplay) {
        userInfoDisplay.textContent = `当前用户: ${appState.name}`;
    }

    // Render Global Settings
    globalMultiplierInput.value = appState.globalPositionMultiplier;

    // Render Cards
    container.innerHTML = '';
    
    appState.tradingPairs.forEach(symbol => {
        const card = createCard(symbol);
        container.appendChild(card);
    });
}

function createCard(symbol) {
    const card = document.createElement('div');
    card.className = 'card';
    
    // Data extraction
    const isEnabled = appState.tradingEnabled[symbol];
    const isLongOnly = appState.longOnly[symbol];
    const isIgnoreShort = appState.ignoreShortSignals[symbol];
    const posState = appState.positionState[symbol]; // 0, 1, -1
    const baseAmount = appState.baseAmounts[`${symbol}-SWAP`] || 0;
    const posDetail = appState.positionDetails ? appState.positionDetails[symbol] : null;
    
    // Status Badge
    let statusClass = 'status-none';
    let statusText = '空仓';
    let positionHtml = '';

    if (posState === 1) { 
        statusClass = 'status-long'; 
        statusText = '持多'; 
    }
    if (posState === -1) { 
        statusClass = 'status-short'; 
        statusText = '持空'; 
    }

    // 构建持仓详情 HTML
    if (posState !== 0 && posDetail) {
        const pnlClass = posDetail.upl >= 0 ? 'pnl-positive' : 'pnl-negative';
        const pnlSign = posDetail.upl >= 0 ? '+' : '';
        
        positionHtml = `
            <div class="position-info ${posState === 1 ? 'long' : 'short'}">
                <div class="info-row">
                    <span>持仓量:</span>
                    <span>${posDetail.pos} 张</span>
                </div>
                <div class="info-row">
                    <span>开仓均价:</span>
                    <span>${posDetail.avgPx}</span>
                </div>
                <div class="info-row">
                    <span>未实现盈亏:</span>
                    <span class="${pnlClass}">${pnlSign}${posDetail.upl} U</span>
                </div>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="card-header">
            <span class="symbol">${symbol}</span>
            <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        
        ${positionHtml}

        <div class="form-row">
            <label>启用交易</label>
            <label class="switch">
                <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="togglePair('${symbol}', 'tradingEnabled', this.checked)">
                <span class="slider"></span>
            </label>
        </div>

        <div class="form-row">
            <label>只做多模式</label>
            <label class="switch">
                <input type="checkbox" ${isLongOnly ? 'checked' : ''} onchange="togglePair('${symbol}', 'longOnly', this.checked)">
                <span class="slider"></span>
            </label>
        </div>

        <div class="form-row">
            <label>忽略做空信号</label>
            <label class="switch">
                <input type="checkbox" ${isIgnoreShort ? 'checked' : ''} onchange="togglePair('${symbol}', 'ignoreShortSignals', this.checked)">
                <span class="slider"></span>
            </label>
        </div>

        <div class="form-row" style="margin-top: 15px; border-top: 1px solid #333; padding-top: 10px;">
            <label>基础金额 (USDT)</label>
            <input type="number" value="${baseAmount}" id="amount-${symbol}">
        </div>
        
        <div class="form-row" style="justify-content: flex-end; gap: 8px;">
            <button class="small primary" onclick="saveAmount('${symbol}')">保存金额</button>
            <button class="small" onclick="resetAmount('${symbol}')" title="重置">重置</button>
        </div>
        
        ${isIgnoreShort ? `
        <div class="form-row" style="justify-content: flex-end; margin-top: 10px;">
            <button class="small danger" onclick="resetShortSignal('${symbol}')">重置做空信号</button>
        </div>
        ` : ''}
    `;

    return card;
}

// Global scope functions for inline event handlers
window.togglePair = (symbol, key, value) => {
    let action = '';
    if (key === 'tradingEnabled') action = 'setPairEnabled';
    if (key === 'longOnly') action = 'setPairLongOnly';
    if (key === 'ignoreShortSignals') action = 'setPairIgnoreShort';
    
    updateSetting(action, { symbol, value });
};

window.saveAmount = (symbol) => {
    const input = document.getElementById(`amount-${symbol}`);
    const val = parseFloat(input.value);
    if (val > 0) {
        updateSetting('setPairAmount', { symbol, value: val });
    } else {
        showToast('金额必须大于0', 'error');
    }
};

window.resetAmount = (symbol) => {
    if(confirm(`确定重置 ${symbol} 的开仓金额吗？`)) {
        updateSetting('resetPairAmount', { symbol });
    }
};

window.resetShortSignal = (symbol) => {
    updateSetting('resetPairShortSignal', { symbol });
};

// UI Helpers
function showLoading(show) {
    if (show) loadingOverlay.classList.add('visible');
    else loadingOverlay.classList.remove('visible');
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    toast.offsetHeight;
    toast.classList.add('visible');
    
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
