const cron = require('node-cron');
require('dotenv').config();

const { calculateEMA, calculateATR } = require('./utils/technical-indicators');
const { fetchKlines } = require('./services/market-data');
const { logTrade, logCloseSummary } = require('./utils/logger');
const { sendToTelegram, setupTelegramBot } = require('./services/telegram');
const { placeOrder } = require('./okx-open-position');
const { closePosition } = require('./okx-close-position');
const { getPositions } = require('./okx-get-positions');

// 导入合约信息常量
const {
    POSITION_USDT
} = require('./okx-instrumentInfo_const.js');

// 动态开仓金额配置（初始值来自POSITION_USDT）
const dynamicPositionUSDT = {
    'BTC-USDT-SWAP': POSITION_USDT['BTC-USDT-SWAP'],
    'ETH-USDT-SWAP': POSITION_USDT['ETH-USDT-SWAP'],
    'SOL-USDT-SWAP': POSITION_USDT['SOL-USDT-SWAP'],
    'HYPE-USDT-SWAP': POSITION_USDT['HYPE-USDT-SWAP'],
    'SUI-USDT-SWAP': POSITION_USDT['SUI-USDT-SWAP'],
};

// 全局开仓金额倍数 (默认为1)
let globalPositionMultiplier = 1;

// 定义要监控的交易对
const TRADING_PAIRS = [
    'BTC-USDT',
    'ETH-USDT',
    'SOL-USDT',
    'HYPE-USDT',
    'SUI-USDT'
];

// 将现货交易对转换为合约交易对
const SWAP_PAIRS = TRADING_PAIRS.map(pair => `${pair}-SWAP`);

// 为每个交易对维护独立的持仓状态
const positionState = {
    'BTC-USDT': 0,
    'ETH-USDT': 0,
    'SOL-USDT': 0,
    'HYPE-USDT': 0,
    'SUI-USDT': 0,
};

// 为每个交易对维护交易启用状态（默认全部关闭）
const tradingEnabled = {
    'BTC-USDT': false,
    'ETH-USDT': false,
    'SOL-USDT': false,
    'HYPE-USDT': false,
    'SUI-USDT': false,
};

// 新增: 为每个交易对维护是否忽略做空信号的状态
const ignoreShortSignals = {
    'BTC-USDT': false,
    'ETH-USDT': false,
    'SOL-USDT': false,
    'HYPE-USDT': false,
    'SUI-USDT': false,
};

// 新增: 为每个交易对维护只做多模式
const longOnly = {
    'BTC-USDT': false,
    'ETH-USDT': false,
    'SOL-USDT': false,
    'HYPE-USDT': false,
    'SUI-USDT': false,
};

const longEntryPrice = {
    'BTC-USDT': null,
    'ETH-USDT': null,
    'SOL-USDT': null,
    'HYPE-USDT': null,
    'SUI-USDT': null,
};

const longAddedHalfOnce = {
    'BTC-USDT': false,
    'ETH-USDT': false,
    'SOL-USDT': false,
    'HYPE-USDT': false,
    'SUI-USDT': false,
};
// 策略参数
const atrMultiplier = 1.5;
// 新增: 做空止盈ATR倍数
const shortTakeProfitAtrMultiplier = 5.0;

// ==========================================
// Helper Functions (Refactored)
// ==========================================

/**
 * 获取市场数据并计算指标
 */
async function getMarketAnalysis(symbol) {
    const swapSymbol = `${symbol}-SWAP`;
    const { closingPrices, highs, lows, currentClose } = await fetchKlines(swapSymbol);
    
    if (!Array.isArray(closingPrices) || !Array.isArray(highs) || !Array.isArray(lows)) {
        console.error(`数据结构异常: ${swapSymbol} close/high/low 不是数组`);
        throw new Error(`${swapSymbol} K线解析失败: 数组为空`);
    }
    
    const historicalEMA120 = calculateEMA(closingPrices, 120);
    const historicalATR60 = calculateATR(highs, lows, closingPrices, 60);
    const previousClose = closingPrices[closingPrices.length - 1];
    const priceDistance = (previousClose - historicalEMA120) / historicalATR60;

    return {
        symbol,
        swapSymbol,
        closingPrices,
        highs,
        lows,
        currentClose,
        previousClose,
        historicalEMA120,
        historicalATR60,
        priceDistance
    };
}

/**
 * 执行平仓逻辑，包含日志记录和状态重置
 */
async function executeClosePosition(symbol, exitPrice, reason) {
    const swapSymbol = `${symbol}-SWAP`;
    const prePositions = await getPositions([swapSymbol]);
    await closePosition(swapSymbol);
    
    const previousState = positionState[symbol];
    positionState[symbol] = 0;
    
    // 重置多单相关状态
    longEntryPrice[symbol] = null;
    longAddedHalfOnce[symbol] = false;

    // 记录主要交易日志
    // 自动推断方向：如果之前是1(多)则平多，-1(空)则平空
    let actionType = '平多🔵';
    if (previousState === -1) actionType = '平空🔵';
    
    const tradeAction = logTrade(symbol, actionType, exitPrice, reason);

    // 记录详细平仓汇总
    for (const p of prePositions) {
        if (p.pos !== '0') {
            logCloseSummary({
                symbol: symbol,
                side: p.posSide === 'long' ? '多' : '空',
                entryPrice: Number(p.avgPx),
                exitPrice: exitPrice,
                quantity: String(p.pos).startsWith('-') ? String(p.pos).slice(1) : String(p.pos),
                pnl: Number(p.upl),
                reason: reason
            });
        }
    }
    return tradeAction;
}

/**
 * 尝试开仓逻辑
 * @param {Object} marketData - getMarketAnalysis 返回的数据对象
 * @param {string} checkType - 'checkLong' | 'checkShort' | 'both'
 * @param {string} logPrefix - 日志前缀 (如 "平多后")
 * @param {boolean} useCurrentPrice - 是否使用当前价格(currentClose)而不是收盘价(previousClose)
 */
async function attemptOpenPosition(marketData, checkType = 'both', logPrefix = '', useCurrentPrice = false) {
    const { symbol, swapSymbol, currentClose, previousClose, historicalEMA120, historicalATR60 } = marketData;
    
    // 根据场景决定使用收盘价还是当前价
    const priceToCheck = useCurrentPrice ? currentClose : previousClose;
    
    // 重新计算距离 (因为可能使用 currentClose)
    const distance = (priceToCheck - historicalEMA120) / historicalATR60;
    
    let action = null;
    
    // 开多条件
    if ((checkType === 'both' || checkType === 'checkLong') && 
        priceToCheck > historicalEMA120 && 
        distance > atrMultiplier) {
            
        await placeOrder(swapSymbol, priceToCheck, 'long', dynamicPositionUSDT[swapSymbol] * globalPositionMultiplier);
        positionState[symbol] = 1;
        longEntryPrice[symbol] = priceToCheck;
        longAddedHalfOnce[symbol] = false;
        
        // 如果是从忽略做空状态恢复，这里不需要显式重置，因为外面 processSymbol 会处理，或者这里也可以处理
        // 原逻辑中开多会自然覆盖状态
        action = logTrade(symbol, '开多🟢', priceToCheck, `${logPrefix}价格在EMA之上，距离${distance.toFixed(2)}个ATR`);
    }
    // 开空条件
    else if ((checkType === 'both' || checkType === 'checkShort') && 
             priceToCheck < historicalEMA120 && 
             distance < -atrMultiplier && 
             !ignoreShortSignals[symbol] && 
             !longOnly[symbol]) {
                 
        await placeOrder(swapSymbol, priceToCheck, 'short', dynamicPositionUSDT[swapSymbol] * globalPositionMultiplier);
        positionState[symbol] = -1;
        action = logTrade(symbol, '开空🔴', priceToCheck, `${logPrefix}价格在EMA之下，距离${distance.toFixed(2)}个ATR`);
    }
    
    return action;
}

/**
 * 平仓后重新获取数据并尝试反向开仓
 * 这是原代码中重复率最高的模式
 */
async function reevaluateAfterClose(symbol, nextCheckType, logReason) {
    try {
        const marketData = await getMarketAnalysis(symbol);
        const { closingPrices, highs, lows, currentClose } = marketData;
        
        console.log(`${logReason}复取${symbol}-SWAP 长度: close=${closingPrices.length}, high=${highs.length}, low=${lows.length}, currentClose=${currentClose}`);
        
        // 注意：原逻辑在平仓后使用的是 currentClose 进行判断，而不是 previousClose
        return await attemptOpenPosition(marketData, nextCheckType, logReason, true);
        
    } catch (error) {
        console.error(`${logReason}重新评估开仓条件时出错: ${error.message}`);
        return null;
    }
}

// ==========================================
// Main Logic
// ==========================================

// 初始化持仓状态
async function initializePositionState() {
    try {
        // 传入合约交易对获取持仓信息
        const positions = await getPositions(SWAP_PAIRS);
        console.log('当前持仓信息:', positions);

        // 重置持仓状态
        for (const symbol of TRADING_PAIRS) {
            positionState[symbol] = 0;
        }

        // 根据实际持仓更新状态
        for (const position of positions) {
            const baseSymbol = position.instId.replace('-SWAP', '');
            if (position.pos !== '0') {
                positionState[baseSymbol] = position.posSide === 'long' ? 1 : -1;
            }
        }

        console.log('初始化持仓状态:', positionState);
        return true;
    } catch (error) {
        console.error('初始化持仓状态失败:', error);
        return false;
    }
}

async function processSymbol(symbol) {
    try {
        // 1. 获取市场数据
        const marketData = await getMarketAnalysis(symbol);
        const { 
            currentClose, previousClose, historicalEMA120, historicalATR60, priceDistance, swapSymbol 
        } = marketData;

        console.log(`收到${swapSymbol} 数据长度: close=${marketData.closingPrices.length}, high=${marketData.highs.length}, low=${marketData.lows.length}, currentClose=${currentClose}`);

        let tradeAction = '无';

        // 2. 检查该交易对是否允许交易
        if (!tradingEnabled[symbol]) {
            console.log(`${symbol}交易已禁用，跳过交易信号执行`);
            return {
                symbol,
                currentClose,
                previousClose,
                historicalEMA120,
                historicalATR60,
                priceDistance,
                positionState: positionState[symbol],
                ignoreShortSignal: ignoreShortSignals[symbol],
                longOnly: longOnly[symbol],
                tradeAction: '交易已禁用',
                tradingEnabled: false
            };
        }

        // 3. 检查是否应该重置忽略做空信号的状态
        if (previousClose > historicalEMA120 && ignoreShortSignals[symbol]) {
            ignoreShortSignals[symbol] = false;
            console.log(`${symbol} 价格回到EMA上方，重置忽略做空信号标志`);
        }

        // 4. 状态机逻辑
        // 空仓状态 (0)
        if (positionState[symbol] === 0) {
            // 尝试开仓 (同时检查多空)
            const action = await attemptOpenPosition(marketData, 'both', '', false);
            if (action) tradeAction = action;
        }
        // 持多仓状态 (1)
        else if (positionState[symbol] === 1) {
            // 平仓条件: 价格跌破EMA
            if (previousClose < historicalEMA120) {
                tradeAction = await executeClosePosition(symbol, previousClose, '价格跌破EMA');
                
                // 平多后检查是否开空
                const reAction = await reevaluateAfterClose(symbol, 'checkShort', '平多后');
                if (reAction) tradeAction = reAction; // 更新最新的动作
            } 
            // 加仓逻辑
            else {
                if (!longAddedHalfOnce[symbol] && longEntryPrice[symbol] != null && currentClose > (longEntryPrice[symbol] + 5 * historicalATR60)) {
                    const addAmount = (dynamicPositionUSDT[swapSymbol] || 0) * globalPositionMultiplier;
                    if (addAmount > 0) {
                        await placeOrder(swapSymbol, currentClose, 'long', addAmount);
                        longAddedHalfOnce[symbol] = true;
                        tradeAction = logTrade(symbol, '加仓🟢', currentClose, `价格较开仓价上升${(5).toFixed(0)}倍ATR60，追加同等金额仓位`);
                    }
                }
            }
        }
        // 持空仓状态 (-1)
        else if (positionState[symbol] === -1) {
            let shouldClose = false;
            let closeReason = '';
            let nextCheck = 'checkLong'; // 默认平空后查多
            let logPrefix = '';

            // 优先检查只做多模式
            if (longOnly[symbol]) {
                shouldClose = true;
                closeReason = '只做多模式关闭空仓';
                logPrefix = '只做多平空后';
            } 
            // 检查止盈条件
            else if (priceDistance < -shortTakeProfitAtrMultiplier) {
                shouldClose = true;
                closeReason = `做空止盈触发，价格偏离${priceDistance.toFixed(2)}个ATR`; 
                
                // 特殊逻辑：止盈后设置忽略做空
                ignoreShortSignals[symbol] = true; 
                logPrefix = '平空止盈后';
            }
            // 检查常规平仓条件 (突破EMA)
            else if (previousClose > historicalEMA120) {
                shouldClose = true;
                closeReason = '价格突破EMA';
                logPrefix = '平空EMA后';
            }

            if (shouldClose) {
                tradeAction = await executeClosePosition(symbol, previousClose, closeReason);
                
                // 平空后检查是否开多
                const reAction = await reevaluateAfterClose(symbol, 'checkLong', logPrefix);
                
                if (reAction) tradeAction = reAction;
            }
        }

        return {
            symbol,
            currentClose,
            previousClose,
            historicalEMA120,
            historicalATR60,
            priceDistance,
            positionState: positionState[symbol],
            ignoreShortSignal: ignoreShortSignals[symbol],
            longOnly: longOnly[symbol],
            tradeAction,
            tradingEnabled: true
        };
    } catch (error) {
        // 如果交易过程中出错，立即同步一次持仓状态
        await checkAndReportPositions();
        throw error;
    }
}

async function fetchAndCalculate() {
    const executionTime = new Date().toLocaleString();
    console.log('执行时间:', executionTime);

    let allMessages = `<b>📊 监控报告</b> (${executionTime})\n\n`;

    try {
        for (const symbol of TRADING_PAIRS) {
            try {
                const result = await processSymbol(symbol);

                const coinMessage = `<b>🔸 ${symbol.replace('-USDT', '')} (${result.currentClose.toFixed(2)})</b>\n` +
                    `价格偏离度: ${result.priceDistance.toFixed(2)} | 当前持仓: ${result.positionState === 0 ? '无' : result.positionState === 1 ? '多🟢' : '空🔴'}\n` +
                    `交易状态: ${result.tradingEnabled ? '是' : '否'} | 忽略做空: ${result.ignoreShortSignal ? '是' : '否'} | 只做多: ${result.longOnly ? '是' : '否'}\n` +
                    `${result.tradeAction !== '无' ? '🔔 交易信号:\n' + result.tradeAction : ''}\n`;

                allMessages += coinMessage;

            } catch (error) {
                console.error(`处理${symbol}时出错:`, error.message);
                allMessages += `\n❌ <b>${symbol}处理出错</b>: ${error.message}${'━━━━━━━━━━'}\n`;
            }
        }

        console.log(allMessages);
        await sendToTelegram(allMessages);

    } catch (error) {
        const errorMessage = `执行出错: ${error.message}`;
        console.error(errorMessage);
        await sendToTelegram(`❌ ${errorMessage}`);
    }
}

// 检查持仓状态并发送报告
async function checkAndReportPositions() {
    try {
        const positions = await getPositions(SWAP_PAIRS);
        const executionTime = new Date().toLocaleString();

        let positionMessage = `<b>📈 持仓状态报告</b> (${executionTime})\n\n`;
        let totalProfit = 0; // 新增：总利润计数器

        if (positions.length === 0) {
            positionMessage += '当前无持仓\n';
        } else {
            for (const position of positions) {
                if (position.pos !== '0') {
                    const profit = Number(position.upl);
                    totalProfit += profit; // 累加每个持仓的利润

                    positionMessage += `<b>🔹 ${position.instId.replace('-USDT-SWAP', '')}</b> | ` +
                        `${position.posSide === 'long' ? '多🟢' : '空🔴'} | ` +
                        `${Number(position.avgPx).toFixed(2)} | ` +
                        `利润: ${profit.toFixed(2)}\n`;
                }
            }

            // 在所有持仓信息后添加总计
            positionMessage += `\n<b>💰 总计利润: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT</b>`;
        }

        console.log(positionMessage);
        await sendToTelegram(positionMessage);

        // 更新持仓状态
        for (const symbol of TRADING_PAIRS) {
            positionState[symbol] = 0;
        }

        for (const position of positions) {
            const baseSymbol = position.instId.replace('-SWAP', '');
            if (position.pos !== '0') {
                positionState[baseSymbol] = position.posSide === 'long' ? 1 : -1;
            }
        }

        console.log('更新后的持仓状态:', positionState);
    } catch (error) {
        const errorMessage = `检查持仓状态失败: ${error.message}`;
        console.error(errorMessage);
        await sendToTelegram(`❌ ${errorMessage}`);
    }
}

// 处理来自Telegram的命令
function processTelegramCommand(command) {
    const parts = command.split(' ');
    const action = parts[0];
    
    // 处理不需要参数的命令
    if (action === '/帮助' || action === '/help') {
        // 返回所有可用命令的帮助信息
        return `📋 <b>可用命令列表</b>\n
<b>交易对控制命令:</b>
/启用 BTC-USDT - 启用指定交易对的交易，并立即处理一次
/禁用 BTC-USDT - 禁用指定交易对的交易
/只做多 BTC-USDT - 启用只做多模式（该币种不做空）
/取消只做多 BTC-USDT - 取消只做多模式
/全部启用 - 启用所有交易对的交易
/全部禁用 - 禁用所有交易对的交易

<b>状态查询命令:</b>
/状态 - 查看所有交易对的启用/禁用状态
/忽略空信号 BTC-USDT - 手动设置忽略指定交易对的做空信号
/重置空信号 BTC-USDT - 重置指定交易对的忽略做空信号标志
/全部忽略空信号 - 对所有交易对设置忽略做空信号
/全部重置空信号 - 重置所有交易对的忽略做空信号标志

<b>开仓金额管理命令:</b>
/查看金额 - 查看所有交易对的开仓金额
/设置金额 BTC 5000 ETH 4000 - 批量设置基础金额(USDT)
/重置金额 BTC-USDT - 重置指定交易对的基础金额为初始值
/设置倍数 1.5 - 设置全局开仓金额倍数
/帮助 - 显示此帮助信息`;
    } else if (action === '/状态') {
        // 返回所有交易对的状态
        let statusMessage = '交易对状态:\n';
        for (const pair of TRADING_PAIRS) {
            statusMessage += `${pair}: ${tradingEnabled[pair] ? '已启用✅' : '已禁用❌'} | 忽略做空信号: ${ignoreShortSignals[pair] ? '是✅' : '否❌'} | 只做多: ${longOnly[pair] ? '是✅' : '否❌'}\n`;
        }
        return statusMessage;
    } else if (action === '/全部启用') {
        // 启用所有交易对
        for (const pair of TRADING_PAIRS) {
            tradingEnabled[pair] = true;
        }
        return '已启用所有交易对';
    } else if (action === '/全部禁用') {
        // 禁用所有交易对
        for (const pair of TRADING_PAIRS) {
            tradingEnabled[pair] = false;
        }
        return '已禁用所有交易对';
    } else if (action === '/全部忽略空信号') {
        for (const pair of TRADING_PAIRS) {
            ignoreShortSignals[pair] = true;
        }
        return '已为所有交易对设置忽略做空信号';
    } else if (action === '/全部重置空信号') {
        for (const pair of TRADING_PAIRS) {
            ignoreShortSignals[pair] = false;
        }
        return '已重置所有交易对的忽略做空信号标志';
    } else if (action === '/查看金额') {
        // 查看所有交易对的开仓金额
        let amountMessage = `📊 <b>开仓金额配置 (当前倍数: ${globalPositionMultiplier}x):</b>\n`;
        for (const pair of TRADING_PAIRS) {
            const swapPair = `${pair}-SWAP`;
            const currentAmount = dynamicPositionUSDT[swapPair];
            const initialAmount = POSITION_USDT[swapPair];
            const isModified = currentAmount !== initialAmount;
            const finalAmount = currentAmount * globalPositionMultiplier;
            amountMessage += `${pair}: 基础 ${currentAmount}${isModified ? '(已改)' : ''} * ${globalPositionMultiplier} = 实际 ${finalAmount} USDT\n`;
        }
        return amountMessage;
    } else if (action === '/设置倍数') {
        if (parts.length < 2) {
            return '命令格式错误。正确格式: /设置倍数 1.5';
        }
        const multiplier = parseFloat(parts[1]);
        if (isNaN(multiplier) || multiplier <= 0) {
            return '倍数必须是大于0的数字';
        }
        globalPositionMultiplier = multiplier;
        return `已将全局开仓金额倍数设置为 ${globalPositionMultiplier}x`;
    } else if (action === '/设置金额') {
        // 支持批量设置: /设置金额 BTC 5000 ETH 4000
        if (parts.length < 3 || parts.length % 2 === 0) {
            return '命令格式错误。正确格式: /设置金额 BTC 5000 或 /设置金额 BTC 5000 ETH 4000';
        }

        let resultMessage = '⚙️ <b>金额设置结果:</b>\n';
        
        // 从索引1开始遍历，每次跳过2个（币种+金额）
        for (let i = 1; i < parts.length; i += 2) {
            let symbolInput = parts[i].toUpperCase();
            const amountStr = parts[i + 1];
            
            // 自动补全后缀
            let symbol = symbolInput;
            if (!symbol.includes('-USDT')) {
                // 尝试查找匹配的交易对
                const match = TRADING_PAIRS.find(p => p.startsWith(`${symbol}-USDT`) || p === `${symbol}-USDT`);
                if (match) {
                    symbol = match;
                } else if (TRADING_PAIRS.includes(`${symbol}-USDT`)) {
                     symbol = `${symbol}-USDT`;
                }
            }

            // 检查交易对是否存在
            if (!TRADING_PAIRS.includes(symbol)) {
                resultMessage += `❌ ${symbolInput}: 未知交易对\n`;
                continue;
            }

            const amount = parseFloat(amountStr);
            if (isNaN(amount) || amount <= 0) {
                resultMessage += `❌ ${symbol}: 金额 "${amountStr}" 无效\n`;
                continue;
            }
            
            if (amount > 50000) {
                resultMessage += `⚠️ ${symbol}: 金额 ${amount} 超过上限50000，已跳过\n`;
                continue;
            }

            const swapSymbol = `${symbol}-SWAP`;
            const oldAmount = dynamicPositionUSDT[swapSymbol];
            dynamicPositionUSDT[swapSymbol] = amount;
            resultMessage += `✅ ${symbol}: ${oldAmount} ➔ ${amount} USDT\n`;
        }
        
        return resultMessage;
    }
    
    // 处理需要参数的命令
    if (parts.length < 2) {
        return '命令格式错误。正确格式: /禁用 BTC-USDT 或 /启用 ETH-USDT\n发送 /帮助 查看所有命令';
    }
    
    const symbol = parts[1];

    // 检查交易对是否存在
    if (!TRADING_PAIRS.includes(symbol)) {
        return `交易对 ${symbol} 不存在。可用交易对: ${TRADING_PAIRS.join(', ')}`;
    }

    if (action === '/禁用') {
        tradingEnabled[symbol] = false;
        return `已禁用 ${symbol} 的交易`;
    } else if (action === '/启用') {
        tradingEnabled[symbol] = true;
        
        // 立即处理该交易对
        setTimeout(async () => {
            try {
                const result = await processSymbol(symbol);
                const message = `${symbol} 立即处理结果:\n` +
                    `价格: ${result.currentClose.toFixed(2)}\n` +
                    `EMA120: ${result.historicalEMA120.toFixed(2)}\n` +
                    `价格偏离度: ${result.priceDistance.toFixed(2)}\n` +
                    `持仓状态: ${result.positionState === 0 ? '无' : result.positionState === 1 ? '多🟢' : '空🔴'}\n` +
                    `忽略做空信号: ${result.ignoreShortSignal ? '是✅' : '否❌'}\n` +
                    `只做多: ${result.longOnly ? '是✅' : '否❌'}\n` +
                    `${result.tradeAction !== '无' ? '交易信号: ' + result.tradeAction : '未触发交易信号'}`;
                
                sendToTelegram(message);
            } catch (error) {
                sendToTelegram(`处理 ${symbol} 时出错: ${error.message}`);
            }
        }, 0);
        
        return `已启用 ${symbol} 的交易，正在立即处理...`;
    } else if (action === '/忽略空信号') {
        // 手动设置忽略做空信号
        ignoreShortSignals[symbol] = true;
        return `已设置忽略 ${symbol} 的做空信号，该币种将不会执行新的做空`;
    } else if (action === '/重置空信号') {
        // 重置指定交易对的忽略做空信号标志
        ignoreShortSignals[symbol] = false;
        return `已重置 ${symbol} 的忽略做空信号标志`;
    } else if (action === '/只做多') {
        longOnly[symbol] = true;
        // 如果当前为空仓则不处理；如果当前持有空仓则立即平空
        if (positionState[symbol] === -1) {
            setTimeout(async () => {
                try {
                    // 获取最新价格用于平仓日志
                    const marketData = await getMarketAnalysis(symbol); 
                    
                    // 执行平仓
                    await executeClosePosition(symbol, marketData.currentClose, '命令只做多关闭空仓'); 
                    
                    // 尝试开多
                    const reAction = await attemptOpenPosition(marketData, 'checkLong', '只做多平空后', true); 
                    
                    let msg = `${symbol} 已启用只做多模式并处理持仓`;
                    if (reAction) msg += `，触发反手: ${reAction}`;
                    
                    sendToTelegram(msg);
                } catch (error) {
                    sendToTelegram(`${symbol} 启用只做多时处理持仓出错: ${error.message}`);
                }
            }, 0);
        }
        return `已为 ${symbol} 启用只做多模式`;
    } else if (action === '/取消只做多') {
        longOnly[symbol] = false;
        return `已取消 ${symbol} 的只做多模式`;
    } else if (action === '/重置金额') {
        // 重置指定交易对的开仓金额为初始值
        const swapSymbol = `${symbol}-SWAP`;
        const oldAmount = dynamicPositionUSDT[swapSymbol];
        const initialAmount = POSITION_USDT[swapSymbol];
        dynamicPositionUSDT[swapSymbol] = initialAmount;
        return `已重置 ${symbol} 的开仓金额从 ${oldAmount} USDT 恢复为初始值 ${initialAmount} USDT`;
    } else {
        return '未知命令。发送 /帮助 查看所有可用命令';
    }
}

// 程序启动流程
async function startup() {
    console.log('程序启动，初始化持仓状态...');

    // 设置Telegram机器人以处理命令
    setupTelegramBot(processTelegramCommand);

    // 尝试初始化持仓状态，最多重试3次
    for (let i = 0; i < 3; i++) {
        if (await initializePositionState()) {
            console.log('持仓状态初始化成功，开始监控...');
            // 初始化成功后执行第一次数据获取和计算
            await fetchAndCalculate();

            // 设置K线数据获取和策略执行的定时任务
            cron.schedule('15 0 0,4,8,12,16,20 * * *', fetchAndCalculate, {
                timezone: "Asia/Shanghai"
            });

            // 设置持仓状态检查的定时任务
            cron.schedule('0 59 3,7,11,15,19,23 * * *', checkAndReportPositions, {
                timezone: "Asia/Shanghai"
            });

            return;
        }
        console.log(`初始化失败，第${i + 1}次重试...`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒后重试
    }

    console.error('持仓状态初始化失败，程序退出');
    process.exit(1);
}

// 启动程序
startup();