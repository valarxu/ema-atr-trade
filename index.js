const cron = require('node-cron');
require('dotenv').config();

const { calculateEMA, calculateATR } = require('./utils/technical-indicators');
const { fetchKlines } = require('./services/market-data');
const { logTrade } = require('./utils/logger');
const { sendToTelegram, setupTelegramBot } = require('./services/telegram');
const { placeOrder } = require('./okx-open-position');
const { closePosition } = require('./okx-close-position');
const { getPositions } = require('./okx-get-positions');

// 定义要监控的交易对
const TRADING_PAIRS = [
    'BTC-USDT',
    'ETH-USDT',
    'SOL-USDT',
    'ADA-USDT'
];

// 将现货交易对转换为合约交易对
const SWAP_PAIRS = TRADING_PAIRS.map(pair => `${pair}-SWAP`);

// 为每个交易对维护独立的持仓状态
const positionState = {
    'BTC-USDT': 0,
    'ETH-USDT': 0,
    'SOL-USDT': 0,
    'ADA-USDT': 0
};

// 为每个交易对维护交易启用状态（默认全部关闭）
const tradingEnabled = {
    'BTC-USDT': false,
    'ETH-USDT': false,
    'SOL-USDT': false,
    'ADA-USDT': false
};

// 新增: 为每个交易对维护是否忽略做空信号的状态
const ignoreShortSignals = {
    'BTC-USDT': false,
    'ETH-USDT': false,
    'SOL-USDT': false,
    'ADA-USDT': false
};

// 策略参数
const atrMultiplier = 1.5;
// 新增: 做空止盈ATR倍数
const shortTakeProfitAtrMultiplier = 5.0;

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
        const { closingPrices, highs, lows, currentClose } = await fetchKlines(symbol);

        const historicalEMA120 = calculateEMA(closingPrices, 120);
        const historicalATR14 = calculateATR(highs, lows, closingPrices, 14);
        const previousClose = closingPrices[closingPrices.length - 1];

        const priceDistance = (previousClose - historicalEMA120) / historicalATR14;

        let tradeAction = '无';
        const swapSymbol = `${symbol}-SWAP`;

        // 检查该交易对是否允许交易
        if (!tradingEnabled[symbol]) {
            console.log(`${symbol}交易已禁用，跳过交易信号执行`);
            return {
                symbol,
                currentClose,
                previousClose,
                historicalEMA120,
                historicalATR14,
                priceDistance,
                positionState: positionState[symbol],
                ignoreShortSignal: ignoreShortSignals[symbol],
                tradeAction: '交易已禁用',
                tradingEnabled: false
            };
        }

        // 新增: 检查是否应该重置忽略做空信号的状态
        if (previousClose > historicalEMA120 && ignoreShortSignals[symbol]) {
            ignoreShortSignals[symbol] = false;
            console.log(`${symbol} 价格回到EMA上方，重置忽略做空信号标志`);
        }

        // 开仓信号
        if (positionState[symbol] === 0) {
            if (previousClose > historicalEMA120 && priceDistance > atrMultiplier) {
                // 尝试开多仓
                await placeOrder(swapSymbol, previousClose, 'long');
                // 开仓成功后再更新状态
                positionState[symbol] = 1;
                tradeAction = logTrade(symbol, '开多🟢', previousClose, `价格在EMA之上，距离${priceDistance.toFixed(2)}个ATR`);
            } else if (previousClose < historicalEMA120 && priceDistance < -atrMultiplier && !ignoreShortSignals[symbol]) {
                // 新增: 仅在不忽略做空信号时尝试开空仓
                await placeOrder(swapSymbol, previousClose, 'short');
                // 开仓成功后再更新状态
                positionState[symbol] = -1;
                tradeAction = logTrade(symbol, '开空🔴', previousClose, `价格在EMA之下，距离${priceDistance.toFixed(2)}个ATR`);
            }
        }
        // 平仓信号
        else if (positionState[symbol] === 1 && previousClose < historicalEMA120) {
            // 尝试平多仓
            await closePosition(swapSymbol);
            // 平仓成功后再更新状态
            positionState[symbol] = 0;
            tradeAction = logTrade(symbol, '平多🔵', previousClose, '价格跌破EMA');

            // 平仓后重新获取最新数据并评估开仓条件
            try {
                const { closingPrices: newClosingPrices, highs: newHighs, lows: newLows, currentClose: newCurrentClose } = await fetchKlines(symbol);
                const newHistoricalEMA120 = calculateEMA(newClosingPrices, 120);
                const newHistoricalATR14 = calculateATR(newHighs, newLows, newClosingPrices, 14);
                const newPriceDistance = (newCurrentClose - newHistoricalEMA120) / newHistoricalATR14;

                // 使用新数据评估开仓条件
                if (newCurrentClose < newHistoricalEMA120 && newPriceDistance < -atrMultiplier && !ignoreShortSignals[symbol]) {
                    // 尝试开空仓
                    await placeOrder(swapSymbol, newCurrentClose, 'short');
                    positionState[symbol] = -1;
                    tradeAction = logTrade(symbol, '开空🔴', newCurrentClose, `平多后价格在EMA之下，距离${newPriceDistance.toFixed(2)}个ATR`);
                }
            } catch (error) {
                console.error(`平多后重新评估开仓条件时出错: ${error.message}`);
            }
        }
        else if (positionState[symbol] === -1) {
            // 新增: 做空止盈条件
            if (priceDistance < -shortTakeProfitAtrMultiplier) {
                // 做空止盈
                await closePosition(swapSymbol);
                positionState[symbol] = 0;
                ignoreShortSignals[symbol] = true; // 设置忽略做空信号
                tradeAction = logTrade(symbol, '平空🔵', previousClose, `做空止盈触发，价格偏离${priceDistance.toFixed(2)}个ATR`);

                // 平仓后重新获取最新数据并评估开仓条件
                try {
                    const { closingPrices: newClosingPrices, highs: newHighs, lows: newLows, currentClose: newCurrentClose } = await fetchKlines(symbol);
                    const newHistoricalEMA120 = calculateEMA(newClosingPrices, 120);
                    const newHistoricalATR14 = calculateATR(newHighs, newLows, newClosingPrices, 14);
                    const newPriceDistance = (newCurrentClose - newHistoricalEMA120) / newHistoricalATR14;

                    // 使用新数据评估开仓条件
                    if (newCurrentClose > newHistoricalEMA120 && newPriceDistance > atrMultiplier) {
                        // 尝试开多仓
                        await placeOrder(swapSymbol, newCurrentClose, 'long');
                        positionState[symbol] = 1;
                        ignoreShortSignals[symbol] = false; // 重置忽略做空信号状态
                        tradeAction = logTrade(symbol, '开多🟢', newCurrentClose, `平空后价格在EMA之上，距离${newPriceDistance.toFixed(2)}个ATR`);
                    }
                } catch (error) {
                    console.error(`平空后重新评估开仓条件时出错: ${error.message}`);
                }
            }
            // 原始平空条件
            else if (previousClose > historicalEMA120) {
                await closePosition(swapSymbol);
                positionState[symbol] = 0;
                tradeAction = logTrade(symbol, '平空🔵', previousClose, '价格突破EMA');

                // 平仓后重新获取最新数据并评估开仓条件
                try {
                    const { closingPrices: newClosingPrices, highs: newHighs, lows: newLows, currentClose: newCurrentClose } = await fetchKlines(symbol);
                    const newHistoricalEMA120 = calculateEMA(newClosingPrices, 120);
                    const newHistoricalATR14 = calculateATR(newHighs, newLows, newClosingPrices, 14);
                    const newPriceDistance = (newCurrentClose - newHistoricalEMA120) / newHistoricalATR14;

                    // 使用新数据评估开仓条件
                    if (newCurrentClose > newHistoricalEMA120 && newPriceDistance > atrMultiplier) {
                        // 尝试开多仓
                        await placeOrder(swapSymbol, newCurrentClose, 'long');
                        positionState[symbol] = 1;
                        tradeAction = logTrade(symbol, '开多🟢', newCurrentClose, `平空后价格在EMA之上，距离${newPriceDistance.toFixed(2)}个ATR`);
                    }
                } catch (error) {
                    console.error(`平空后重新评估开仓条件时出错: ${error.message}`);
                }
            }
        }

        return {
            symbol,
            currentClose,
            previousClose,
            historicalEMA120,
            historicalATR14,
            priceDistance,
            positionState: positionState[symbol],
            ignoreShortSignal: ignoreShortSignals[symbol],
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
                    `交易状态: ${result.tradingEnabled ? '是' : '否'} | 忽略做空: ${result.ignoreShortSignal ? '是' : '否'}\n` +
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

        if (positions.length === 0) {
            positionMessage += '当前无持仓\n';
        } else {
            for (const position of positions) {
                if (position.pos !== '0') {
                    positionMessage += `<b>🔹 ${position.instId.replace('-USDT-SWAP', '')}</b> | ` +
                        `${position.posSide === 'long' ? '多🟢' : '空🔴'} | ` +
                        `${Number(position.avgPx).toFixed(2)} | ` +
                        `利润: ${Number(position.upl).toFixed(2)}\n`;
                }
            }
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
/全部启用 - 启用所有交易对的交易
/全部禁用 - 禁用所有交易对的交易

<b>状态查询命令:</b>
/状态 - 查看所有交易对的启用/禁用状态
/忽略空信号 BTC-USDT - 手动设置忽略指定交易对的做空信号
/重置空信号 BTC-USDT - 重置指定交易对的忽略做空信号标志
/帮助 - 显示此帮助信息`;
    } else if (action === '/状态') {
        // 返回所有交易对的状态
        let statusMessage = '交易对状态:\n';
        for (const pair of TRADING_PAIRS) {
            statusMessage += `${pair}: ${tradingEnabled[pair] ? '已启用✅' : '已禁用❌'} | 忽略做空信号: ${ignoreShortSignals[pair] ? '是✅' : '否❌'}\n`;
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