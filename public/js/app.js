let appState = null;
let currentTargetUserId = null;
let isAdminMode = false;
let pnlChart = null;
let lastHistoryData = [];
let editingHistoryId = null;

const container = document.getElementById('cards-container');
const loadingOverlay = document.getElementById('loading-overlay');
const userInfoDisplay = document.getElementById('user-info');
const viewDashboard = document.getElementById('view-dashboard');
const viewHistory = document.getElementById('view-history');
const historyTableBody = document.querySelector('#history-table tbody');
const adminControls = document.getElementById('admin-controls');
const userSelect = document.getElementById('user-select');
const loginContainer = document.getElementById('login-container');
const mainContainer = document.getElementById('main-container');
const loginUser = document.getElementById('login-user');
const loginPass = document.getElementById('login-pass');
const loginSubmit = document.getElementById('login-submit');
const loginError = document.getElementById('login-error');
const historyEditModal = document.getElementById('history-edit-modal');
const historyEditSymbol = document.getElementById('history-edit-symbol');
const historyEditSide = document.getElementById('history-edit-side');
const historyEditEntry = document.getElementById('history-edit-entry');
const historyEditExit = document.getElementById('history-edit-exit');
const historyEditQty = document.getElementById('history-edit-qty');
const historyEditPnl = document.getElementById('history-edit-pnl');
const historyEditReason = document.getElementById('history-edit-reason');
const historyEditCancelBtn = document.getElementById('history-edit-cancel');
const historyEditSaveBtn = document.getElementById('history-edit-save');

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();

    loginSubmit.addEventListener('click', handleLogin);
    loginPass.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.target;
            if (target === 'dashboard') {
                viewDashboard.style.display = 'block';
                viewHistory.style.display = 'none';
                fetchState();
            } else {
                viewDashboard.style.display = 'none';
                viewHistory.style.display = 'block';
                fetchHistory();
            }
        });
    });

    document.getElementById('enable-all').addEventListener('click', () => {
        if (confirm('确定启用所有交易对吗？')) updateSetting('enableAll', {});
    });
    document.getElementById('disable-all').addEventListener('click', () => {
        if (confirm('确定禁用所有交易对吗？')) updateSetting('disableAll', {});
    });
    document.getElementById('enable-all-short').addEventListener('click', () => {
        if (confirm('确定恢复所有交易对的空头信号状态吗？')) updateSetting('resetAllShortSignalState', {});
    });
    document.getElementById('open-all-positions').addEventListener('click', () => {
        if (confirm('确定按已启用交易对执行一键全开吗？')) window.manualOpenAll();
    });
    document.getElementById('close-all-positions').addEventListener('click', () => {
        if (confirm('确定按已启用交易对执行一键全平吗？')) window.manualCloseAll();
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        if (confirm('确定要登出吗？')) logout();
    });

    userSelect.addEventListener('change', (e) => {
        currentTargetUserId = e.target.value;
        if (viewDashboard.style.display !== 'none') fetchState();
        else fetchHistory();
    });
    historyEditCancelBtn.addEventListener('click', closeHistoryEditModal);
    historyEditSaveBtn.addEventListener('click', submitHistoryEdit);
    historyEditModal.addEventListener('click', (e) => {
        if (e.target === historyEditModal) closeHistoryEditModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && historyEditModal.classList.contains('visible')) closeHistoryEditModal();
    });
});

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
        await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch (e) {}
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
        if (!currentTargetUserId && users.length > 0) currentTargetUserId = users[0].id;
    } catch (e) {}
}

async function fetchState() {
    showLoading(true);
    try {
        let url = '/api/status';
        if (isAdminMode && currentTargetUserId) url += `?userId=${currentTargetUserId}`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (res.status === 401) return logout();
        if (!res.ok) throw new Error('加载失败');
        appState = await res.json();

        if (appState.isGlobalAdmin) {
            isAdminMode = true;
            adminControls.style.display = 'flex';
            if (!currentTargetUserId) currentTargetUserId = appState.id;
            await fetchAdminUsers();
        } else {
            isAdminMode = false;
            adminControls.style.display = 'none';
        }

        render();
    } catch (err) {
        showToast(`加载状态失败: ${err.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function updateSetting(action, payload) {
    showLoading(true);
    try {
        const bodyData = { action, ...payload };
        if (isAdminMode && currentTargetUserId) bodyData.userId = currentTargetUserId;
        const res = await fetch('/api/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(bodyData)
        });
        if (res.status === 401) return logout();
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '保存失败');
        showToast('设置已保存', 'success');
        fetchState();
    } catch (err) {
        showToast(`保存失败: ${err.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function fetchHistory() {
    showLoading(true);
    try {
        let url = '/api/history';
        if (isAdminMode && currentTargetUserId) url += `?userId=${currentTargetUserId}`;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (res.status === 401) return logout();
        const history = await res.json();
        lastHistoryData = history;
        renderHistoryTable(history);
        renderHistoryChart(history);
    } catch (e) {
        showToast('加载历史失败', 'error');
    } finally {
        showLoading(false);
    }
}

function renderHistoryTable(history) {
    historyTableBody.innerHTML = '';
    if (history.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#666;">暂无记录</td></tr>';
        return;
    }
    history.forEach(item => {
        const row = document.createElement('tr');
        const time = new Date(item.timestamp).toLocaleString();
        const pnl = Number(item.pnl);
        row.innerHTML = `
            <td>${time}</td>
            <td>${item.symbol}</td>
            <td>${item.side}</td>
            <td>${Number(item.entryPrice).toFixed(4)}</td>
            <td>${Number(item.exitPrice).toFixed(4)}</td>
            <td>${item.quantity}</td>
            <td class="${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</td>
            <td>${item.reason}</td>
            <td><button class="small" onclick="editHistory('${item.id}')">编辑</button></td>
        `;
        historyTableBody.appendChild(row);
    });
}

async function saveHistoryEdit(payload) {
    showLoading(true);
    try {
        const bodyData = { ...payload };
        if (isAdminMode && currentTargetUserId) bodyData.userId = currentTargetUserId;
        const res = await fetch('/api/history/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(bodyData)
        });
        if (res.status === 401) return logout();
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '保存失败');
        showToast('交易记录已更新', 'success');
        await fetchHistory();
        return true;
    } catch (err) {
        showToast(`更新失败: ${err.message}`, 'error');
        return false;
    } finally {
        showLoading(false);
    }
}

async function requestManualAction(url, payload, successText) {
    showLoading(true);
    try {
        const bodyData = { ...payload };
        if (isAdminMode && currentTargetUserId) bodyData.userId = currentTargetUserId;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(bodyData)
        });
        if (res.status === 401) return logout();
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '执行失败');
        showToast(data.message || successText || '执行成功', 'success');
        await fetchState();
    } catch (err) {
        showToast(`执行失败: ${err.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

function openHistoryEditModal(source) {
    editingHistoryId = source.id;
    historyEditSymbol.value = source.symbol || '';
    historyEditSide.value = source.side === '空' ? '空' : '多';
    historyEditEntry.value = source.entryPrice ?? '';
    historyEditExit.value = source.exitPrice ?? '';
    historyEditQty.value = source.quantity ?? '';
    historyEditPnl.value = source.pnl ?? '';
    historyEditReason.value = source.reason || '';
    historyEditModal.classList.add('visible');
}

function closeHistoryEditModal() {
    editingHistoryId = null;
    historyEditModal.classList.remove('visible');
}

async function submitHistoryEdit() {
    if (!editingHistoryId) return;
    const symbol = String(historyEditSymbol.value || '').trim().toUpperCase();
    const side = String(historyEditSide.value || '').trim();
    const entryPrice = Number(historyEditEntry.value);
    const exitPrice = Number(historyEditExit.value);
    const quantity = Number(historyEditQty.value);
    const pnl = Number(historyEditPnl.value);
    const reason = String(historyEditReason.value || '').trim();

    if (!symbol) {
        showToast('交易对不能为空', 'error');
        return;
    }
    if (side !== '多' && side !== '空') {
        showToast('方向仅支持 多 或 空', 'error');
        return;
    }
    if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(quantity) || !Number.isFinite(pnl)) {
        showToast('价格/数量/盈亏必须是数字', 'error');
        return;
    }
    if (quantity <= 0) {
        showToast('数量必须大于0(单位:张)', 'error');
        return;
    }

    const ok = await saveHistoryEdit({ id: editingHistoryId, symbol, side, entryPrice, exitPrice, quantity, pnl, reason });
    if (ok) closeHistoryEditModal();
}

function renderHistoryChart(history) {
    const ctx = document.getElementById('pnlChart').getContext('2d');
    const sorted = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let cumulative = 0;
    const labels = [];
    const points = [];
    sorted.forEach(item => {
        cumulative += Number(item.pnl);
        labels.push(new Date(item.timestamp).toLocaleDateString());
        points.push(cumulative);
    });
    if (pnlChart) pnlChart.destroy();
    pnlChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: '累计盈亏 (USDT)',
                data: points,
                borderColor: '#4caf50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                tension: 0.2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#ccc' } } },
            scales: {
                y: { grid: { color: '#333' }, ticks: { color: '#aaa' } },
                x: { grid: { color: '#333' }, ticks: { color: '#aaa' } }
            }
        }
    });
}

function render() {
    if (!appState) return;
    userInfoDisplay.textContent = `当前用户: ${appState.name}`;
    container.innerHTML = '';
    appState.tradingPairs.forEach(symbol => container.appendChild(createCard(symbol)));
}

function createCard(symbol) {
    const card = document.createElement('div');
    card.className = 'card';
    const enabled = !!appState.tradingEnabled[symbol];
    const tradeMode = appState.tradeMode[symbol] || 'both';
    const shortSignalState = appState.shortSignalState[symbol] || 'normal';
    const posState = appState.positionState[symbol] || 0;
    const baseAmount = Number(appState.baseAmounts[`${symbol}-SWAP`] || 0);
    const pairMultiplier = Number(appState.pairMultipliers[symbol] || 1);
    const posDetail = appState.positionDetails ? appState.positionDetails[symbol] : null;

    let statusClass = 'status-none';
    let statusText = '空仓';
    if (posState === 1) { statusClass = 'status-long'; statusText = '持多'; }
    if (posState === -1) { statusClass = 'status-short'; statusText = '持空'; }

    let positionHtml = '';
    if (posState !== 0 && posDetail) {
        const pnl = Number(posDetail.upl || 0);
        positionHtml = `
            <div class="position-info ${posState === 1 ? 'long' : 'short'}">
                <div class="info-row"><span>持仓量</span><span>${posDetail.pos}</span></div>
                <div class="info-row"><span>开仓均价</span><span>${Number(posDetail.avgPx).toFixed(4)}</span></div>
                <div class="info-row"><span>未实现盈亏</span><span class="${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} U</span></div>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="card-header">
            <span class="symbol">${symbol}</span>
            <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        ${positionHtml}
        <div class="form-row"><label>启用交易</label><label class="switch"><input type="checkbox" ${enabled ? 'checked' : ''} onchange="togglePair('${symbol}','enabled',this.checked)"><span class="slider"></span></label></div>
        <div class="form-row compact-split">
            <label>交易模式</label>
            <select id="mode-${symbol}" onchange="togglePair('${symbol}','tradeMode',this.value)">
                <option value="both" ${tradeMode === 'both' ? 'selected' : ''}>双向</option>
                <option value="long_only" ${tradeMode === 'long_only' ? 'selected' : ''}>只做多</option>
            </select>
        </div>
        <div class="form-row compact-split">
            <label>空头信号</label>
            <select id="short-state-${symbol}" onchange="togglePair('${symbol}','shortSignalState',this.value)">
                <option value="normal" ${shortSignalState === 'normal' ? 'selected' : ''}>正常</option>
                <option value="ignored_temporarily" ${shortSignalState === 'ignored_temporarily' ? 'selected' : ''}>临时忽略</option>
            </select>
        </div>
        <div class="form-row compact-split">
            <label>基础金额</label>
            <input type="number" value="${baseAmount}" id="amount-${symbol}">
        </div>
        <div class="form-row compact-split">
            <label>开仓倍数</label>
            <input type="number" step="0.1" min="0.1" value="${pairMultiplier}" id="multiplier-${symbol}">
        </div>
        <div class="form-row actions">
            <button class="small primary" onclick="savePair('${symbol}')">保存</button>
            <button class="small" onclick="resetAmount('${symbol}')">重置金额</button>
            <button class="small" onclick="resetShortSignalState('${symbol}')">恢复空头信号</button>
            <button class="small primary" onclick="manualOpenPair('${symbol}')" ${enabled ? '' : 'disabled'}>开仓</button>
            <button class="small danger" onclick="manualClosePair('${symbol}')" ${enabled ? '' : 'disabled'}>平仓</button>
        </div>
    `;
    return card;
}

window.togglePair = (symbol, key, value) => {
    if (key === 'enabled') return updateSetting('setPairEnabled', { symbol, value });
    if (key === 'tradeMode') return updateSetting('setPairTradeMode', { symbol, value });
    if (key === 'shortSignalState') return updateSetting('setPairShortSignalState', { symbol, value });
};

window.savePair = (symbol) => {
    const amountVal = Number(document.getElementById(`amount-${symbol}`).value);
    const multiplierVal = Number(document.getElementById(`multiplier-${symbol}`).value);
    if (amountVal > 0) updateSetting('setPairAmount', { symbol, value: amountVal });
    if (multiplierVal > 0) updateSetting('setPairMultiplier', { symbol, value: multiplierVal });
};

window.resetAmount = (symbol) => updateSetting('resetPairAmount', { symbol });
window.resetShortSignalState = (symbol) => updateSetting('resetPairShortSignalState', { symbol });
window.manualOpenPair = (symbol) => requestManualAction('/api/position/open', { symbol }, `${symbol} 开仓已提交`);
window.manualClosePair = (symbol) => requestManualAction('/api/position/close', { symbol }, `${symbol} 平仓已提交`);
window.manualOpenAll = () => requestManualAction('/api/position/open-all', {}, '一键全开已提交');
window.manualCloseAll = () => requestManualAction('/api/position/close-all', {}, '一键全平已提交');
window.editHistory = (id) => {
    if (!id) return;
    const source = lastHistoryData.find(h => h.id === id);
    if (!source) {
        showToast('未找到记录', 'error');
        return;
    }
    openHistoryEditModal(source);
};

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
    }, 2500);
}
