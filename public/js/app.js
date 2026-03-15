// State
let appState = null;

// DOM Elements
const container = document.getElementById('cards-container');
const globalMultiplierInput = document.getElementById('global-multiplier');
const loadingOverlay = document.getElementById('loading-overlay');
const userInfoDisplay = document.getElementById('user-info');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchState();
    
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
});

async function fetchState() {
    showLoading(true);
    try {
        const res = await fetch('/api/status');
        if (res.status === 401) {
            // Reload to trigger basic auth prompt
            window.location.reload();
            return;
        }
        if (!res.ok) throw new Error('Failed to fetch state');
        appState = await res.json();
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
        const res = await fetch('/api/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action, 
                ...payload 
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('设置已保存', 'success');
            fetchState(); 
        } else {
            throw new Error(data.error || 'Unknown error');
        }
    } catch (err) {
        showToast('保存失败: ' + err.message, 'error');
        showLoading(false);
    }
}

function render() {
    if (!appState) return;

    // Render User Info
    if (userInfoDisplay) {
        userInfoDisplay.textContent = `当前用户: ${appState.name} (${appState.username})`;
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
