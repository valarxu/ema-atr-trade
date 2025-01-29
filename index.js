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
    'SOL-USDT'
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
                limit: '241'    // 保持获取241根K线
            }
        });
        
        const candles = response.data.data;
        if (!candles || candles.length < 241) {
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
            closingPrices.push(parseFloat(candle[4]));
            highs.push(parseFloat(candle[2]));
            lows.push(parseFloat(candle[3]));
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
    if (data.length < period) {
        throw new Error('数据长度不足以计算EMA');
    }
    
    // 计算第一个EMA值（使用SMA作为起点）
    let ema = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    
    // 计算乘数
    const multiplier = 2 / (period + 1);
    
    // 从period位置开始，逐个计算EMA
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// 修改 calculateATR 函数
function calculateATR(highs, lows, closingPrices, period) {
    if (highs.length < period + 1 || lows.length < period + 1 || closingPrices.length < period + 1) {
        throw new Error('数据长度不足以计算ATR');
    }

    // 计算TR序列
    const trValues = [];
    for (let i = 1; i < closingPrices.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = closingPrices[i - 1];
        
        const tr = Math.max(
            high - low,                  // 当日价格范围
            Math.abs(high - prevClose),  // 当日最高与前收盘的范围
            Math.abs(low - prevClose)    // 当日最低与前收盘的范围
        );
        trValues.push(tr);
    }

    // 计算第一个ATR值（使用前period个TR的简单平均）
    let atr = trValues.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
    
    // 使用Wilder的方法计算后续ATR值（相当于period*2/(period+1)的EMA）
    // Wilder的平滑系数 = 1/period
    for (let i = period; i < trValues.length; i++) {
        atr = ((period - 1) * atr + trValues[i]) / period;
    }
    
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
    'SOL-USDT': 0
};

// 修改主函数以处理多个交易对
async function fetchAndCalculate() {
    const executionTime = new Date().toLocaleString();
    console.log('执行时间:', executionTime);
    
    let allMessages = `<b>监控报告</b> (${executionTime})\n--------------------------------\n`;
    
    try {
        // 依次处理每个交易对
        for (const symbol of TRADING_PAIRS) {
            try {
                // 获取数据
                const { closingPrices, highs, lows, currentClose } = await fetchKlines(symbol);
                
                // 使用完整的历史数据计算 EMA
                const historicalEMA120 = calculateEMA(closingPrices, 120);
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
                const coinMessage = `<b>${symbol}</b>
实时: ${currentClose.toFixed(2)} | 前k收盘: ${previousClose.toFixed(2)}
EMA120: ${historicalEMA120.toFixed(2)} | ATR14: ${historicalATR14.toFixed(2)}
1.5ATR: ${(historicalATR14 * 1.5).toFixed(2)} | 价格偏离度: ${priceDistance.toFixed(2)}
当前持仓: ${positionState[symbol] === 0 ? '无' : positionState[symbol] === 1 ? '多' : '空'}
${tradeAction !== '无' ? '\n🔔 交易信号:\n' + tradeAction : ''}\n`;

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