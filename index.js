const axios = require('axios');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 初始化 Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 定义要监控的交易对
const TRADING_PAIRS = [
    'BTC-USDT',
    'ETH-USDT',
    'SOL-USDT',
    'XRP-USDT'
];

// 发送消息到Telegram的函数
async function sendToTelegram(message) {
    try {
        await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('发送Telegram消息失败:', error.message);
    }
}

// 获取K线数据的函数修改为支持多币种
async function fetchKlines(symbol) {
    try {
        const response = await axios.get('https://www.okx.com/api/v5/market/candles', {
            params: {
                instId: symbol,
                bar: '4H',
                limit: '122'
            }
        });
        
        const candles = response.data.data;
        if (!candles || candles.length < 122) {
            throw new Error(`Not enough kline data for ${symbol}`);
        }

        // 反转数组为时间正序（旧->新）
        const reversedCandles = candles.reverse();
        
        // 提取价格数据，分离当前K线和历史K线
        const currentCandle = reversedCandles[reversedCandles.length - 1];
        const historicalCandles = reversedCandles.slice(0, -1);
        
        const currentClose = parseFloat(currentCandle[4]);
        
        const closingPrices = [];
        const highs = [];
        const lows = [];
        for (const candle of historicalCandles) {
            closingPrices.push(parseFloat(candle[4])); // 收盘价在索引4
            highs.push(parseFloat(candle[2]));        // 最高价在索引2
            lows.push(parseFloat(candle[3]));         // 最低价在索引3
        }
        
        return { 
            closingPrices, 
            highs, 
            lows,
            currentClose,
        };
    } catch (error) {
        console.error(`获取${symbol}K线数据失败:`, error.message);
        throw error;
    }
}

// 计算EMA
function calculateEMA(data, period) {
    // 确保只使用最后period根K线的数据
    const relevantData = data.slice(-period);
    
    // 计算简单移动平均线 (SMA) 作为首个EMA值
    const sma = relevantData.reduce((sum, val) => sum + val, 0) / period;
    
    // 由于我们只需要最终的EMA值，可以简化计算
    let ema = sma;
    const multiplier = 2 / (period + 1);
    
    // 只计算最后一个EMA值
    for (let i = 0; i < relevantData.length; i++) {
        ema = (relevantData[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// 计算ATR
function calculateATR(highs, lows, closingPrices, period) {
    // 确保只使用最后 period+1 根K线的数据（需要多一根用于计算第一个TR值）
    const relevantHighs = highs.slice(-(period + 1));
    const relevantLows = lows.slice(-(period + 1));
    const relevantClosing = closingPrices.slice(-(period + 1));
    
    const tr = [];
    
    // 计算TR值
    for (let i = 1; i < relevantHighs.length; i++) {
        const prevClose = relevantClosing[i - 1];
        tr.push(Math.max(
            relevantHighs[i] - relevantLows[i],
            Math.abs(relevantHighs[i] - prevClose),
            Math.abs(relevantLows[i] - prevClose)
        ));
    }

    // 计算最终的ATR值（使用简单平均）
    const atr = tr.reduce((sum, val) => sum + val, 0) / period;
    return atr;
}

// 添加创建日志文件夹的函数
function ensureLogsDirectory() {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    return logsDir;
}

// 修改记录交易日志的函数以支持多币种
function logTrade(symbol, type, price, reason) {
    const logsDir = ensureLogsDirectory();
    const date = new Date();
    const logFile = path.join(logsDir, `trades_${symbol}_${date.getFullYear()}_${(date.getMonth() + 1)}.txt`);
    
    const logEntry = `${date.toISOString()} - ${symbol} ${type} @ ${price} USDT - ${reason}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    return logEntry;
}

// 为每个交易对维护独立的持仓状态
const positionState = {
    'BTC-USDT': 0,
    'ETH-USDT': 0,
    'SOL-USDT': 0,
    'XRP-USDT': 0
};

// 修改主函数以处理多个交易对
async function fetchAndCalculate() {
    const executionTime = new Date().toLocaleString();
    console.log('执行时间:', executionTime);
    
    let allMessages = `<b>加密货币监控报告</b> (${executionTime})\n--------------------------------\n`;
    
    try {
        // 依次处理每个交易对
        for (const symbol of TRADING_PAIRS) {
            try {
                // 获取数据
                const { closingPrices, highs, lows, currentClose } = await fetchKlines(symbol);
                
                // 计算指标
                const historicalEMA120 = calculateEMA(closingPrices.slice(-120), 120);
                const historicalATR14 = calculateATR(highs, lows, closingPrices, 14);
                const previousClose = closingPrices[closingPrices.length - 1];
                
                // 计算价格与EMA的距离（以ATR为单位）
                const priceDistance = (previousClose - historicalEMA120) / historicalATR14;
                
                // 策略信号判断
                const atrMultiplier = 1.5;
                let tradeAction = '无';

                // 开仓信号
                if (positionState[symbol] === 0) {
                    if (previousClose > historicalEMA120 && priceDistance > atrMultiplier) {
                        positionState[symbol] = 1;
                        tradeAction = logTrade(symbol, '开多', previousClose, `价格在EMA之上，距离${priceDistance.toFixed(2)}个ATR`);
                    } else if (previousClose < historicalEMA120 && priceDistance < -atrMultiplier) {
                        positionState[symbol] = -1;
                        tradeAction = logTrade(symbol, '开空', previousClose, `价格在EMA之下，距离${priceDistance.toFixed(2)}个ATR`);
                    }
                }
                // 平仓信号
                else if (positionState[symbol] === 1 && previousClose < historicalEMA120) {
                    positionState[symbol] = 0;
                    tradeAction = logTrade(symbol, '平多', previousClose, '价格跌破EMA');
                }
                else if (positionState[symbol] === -1 && previousClose > historicalEMA120) {
                    positionState[symbol] = 0;
                    tradeAction = logTrade(symbol, '平空', previousClose, '价格突破EMA');
                }

                // 构建该币种的消息
                const coinMessage = `
<b>${symbol}</b>
实时报价: ${currentClose.toFixed(2)}
前一根K线收盘价: ${previousClose.toFixed(2)}
EMA120: ${historicalEMA120.toFixed(2)}
ATR14: ${historicalATR14.toFixed(2)} | 1.5ATR: ${(historicalATR14 * 1.5).toFixed(2)}
价格偏离度: ${priceDistance.toFixed(2)}
当前持仓: ${positionState[symbol] === 0 ? '无' : positionState[symbol] === 1 ? '多' : '空'}
${tradeAction !== '无' ? '\n🔔 交易信号:\n' + tradeAction : ''}
--------------------------------\n`;

                allMessages += coinMessage;
                
            } catch (error) {
                console.error(`处理${symbol}时出错:`, error.message);
                allMessages += `\n❌ ${symbol}处理出错: ${error.message}\n--------------------------------\n`;
            }
        }
        
        // 打印到控制台
        console.log(allMessages);
        
        // 发送到Telegram
        await sendToTelegram(allMessages);
        
    } catch (error) {
        const errorMessage = `执行出错: ${error.message}`;
        console.error(errorMessage);
        await sendToTelegram(`❌ ${errorMessage}`);
    }
}

// 设置定时任务
cron.schedule('1 0,4,8,12,16,20 * * *', fetchAndCalculate, {
    timezone: "Asia/Shanghai"  // 设置时区为上海
});

// 程序启动时立即执行一次
console.log('程序启动，开始监控...');
fetchAndCalculate();