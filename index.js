const cron = require('node-cron');
require('dotenv').config();

const { calculateEMA, calculateATR } = require('./utils/technical-indicators');
const { fetchKlines } = require('./services/market-data');
const { logTrade } = require('./utils/logger');
const { sendToTelegram } = require('./services/telegram');
const { placeOrder } = require('./okx-open-position');
const { closePosition } = require('./okx-close-position');

// 定义要监控的交易对
const TRADING_PAIRS = [
    'BTC-USDT',
    'ETH-USDT',
    'SOL-USDT'
];

// 为每个交易对维护独立的持仓状态
const positionState = {
    'BTC-USDT': 0,
    'ETH-USDT': 0,
    'SOL-USDT': 0
};

async function processSymbol(symbol) {
    const { closingPrices, highs, lows, currentClose } = await fetchKlines(symbol);
    
    const historicalEMA120 = calculateEMA(closingPrices, 120);
    const historicalATR14 = calculateATR(highs, lows, closingPrices, 14);
    const previousClose = closingPrices[closingPrices.length - 1];
    
    const priceDistance = (previousClose - historicalEMA120) / historicalATR14;
    
    const atrMultiplier = 1.5;
    let tradeAction = '无';
    const swapSymbol = `${symbol}-SWAP`;

    // 开仓信号
    if (positionState[symbol] === 0) {
        if (previousClose > historicalEMA120 && priceDistance > atrMultiplier) {
            positionState[symbol] = 1;
            tradeAction = logTrade(symbol, '开多🟢', previousClose, `价格在EMA之上，距离${priceDistance.toFixed(2)}个ATR`);
            await placeOrder(swapSymbol, previousClose, 'long');
        } else if (previousClose < historicalEMA120 && priceDistance < -atrMultiplier) {
            positionState[symbol] = -1;
            tradeAction = logTrade(symbol, '开空🔴', previousClose, `价格在EMA之下，距离${priceDistance.toFixed(2)}个ATR`);
            await placeOrder(swapSymbol, previousClose, 'short');
        }
    }
    // 平仓信号
    else if (positionState[symbol] === 1 && previousClose < historicalEMA120) {
        positionState[symbol] = 0;
        tradeAction = logTrade(symbol, '平多🔵', previousClose, '价格跌破EMA');
        await closePosition(swapSymbol);
    }
    else if (positionState[symbol] === -1 && previousClose > historicalEMA120) {
        positionState[symbol] = 0;
        tradeAction = logTrade(symbol, '平空🔵', previousClose, '价格突破EMA');
        await closePosition(swapSymbol);
    }

    return {
        symbol,
        currentClose,
        previousClose,
        historicalEMA120,
        historicalATR14,
        priceDistance,
        positionState: positionState[symbol],
        tradeAction
    };
}

async function fetchAndCalculate() {
    const executionTime = new Date().toLocaleString();
    console.log('执行时间:', executionTime);
    
    let allMessages = `<b>监控报告</b> (${executionTime})\n--------------------------------\n`;
    
    try {
        for (const symbol of TRADING_PAIRS) {
            try {
                const result = await processSymbol(symbol);
                
                const coinMessage = `<b>${symbol}(${result.currentClose.toFixed(2)})</b>
前k收盘: ${result.previousClose.toFixed(2)} | EMA120: ${result.historicalEMA120.toFixed(2)}
1.5ATR14: ${(result.historicalATR14 * 1.5).toFixed(2)} | 价格偏离度: ${result.priceDistance.toFixed(2)}
当前持仓: ${result.positionState === 0 ? '无' : result.positionState === 1 ? '多🟢' : '空🔴'}
${result.tradeAction !== '无' ? '\n🔔 交易信号:\n' + result.tradeAction : ''}\n`;

                allMessages += coinMessage;
                
            } catch (error) {
                console.error(`处理${symbol}时出错:`, error.message);
                allMessages += `\n❌ ${symbol}处理出错: ${error.message}\n--------------------------------\n`;
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

// 设置定时任务
cron.schedule('1 0,4,8,12,16,20 * * *', fetchAndCalculate, {
    timezone: "Asia/Shanghai"
});

// 程序启动时立即执行一次
console.log('程序启动，开始监控...');
fetchAndCalculate();