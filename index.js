const axios = require('axios');

// 获取K线数据
async function fetchKlines() {
    try {
        const response = await axios.get('https://www.okx.com/api/v5/market/candles', {
            params: {
                instId: 'BTC-USDT', // 可修改交易对
                bar: '4H',
                limit: '121'       // 获取121根用于正确计算EMA120
            }
        });
        
        const candles = response.data.data;
        if (!candles || candles.length < 121) {
            throw new Error('Not enough kline data');
        }

        // 反转数组为时间正序（旧->新）
        const reversedCandles = candles.reverse();
        
        // 提取价格数据
        const closingPrices = [];
        const highs = [];
        const lows = [];
        for (const candle of reversedCandles) {
            closingPrices.push(parseFloat(candle[4])); // 收盘价在索引4
            highs.push(parseFloat(candle[2]));        // 最高价在索引2
            lows.push(parseFloat(candle[3]));         // 最低价在索引3
        }
        
        return { closingPrices, highs, lows };
    } catch (error) {
        console.error('获取K线数据失败:', error.message);
        process.exit(1);
    }
}

// 计算EMA
function calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    const ema = [];
    
    // 计算初始SMA（前period个数据）
    const sma = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    ema.push(sma);

    // 计算后续EMA
    for (let i = period; i < data.length; i++) {
        const currentEMA = (data[i] - ema[i - period]) * multiplier + ema[i - period];
        ema.push(currentEMA);
    }
    
    return ema;
}

// 计算ATR
function calculateATR(highs, lows, closingPrices, period) {
    const tr = [];
    
    // 计算TR值
    for (let i = 0; i < highs.length; i++) {
        if (i === 0) {
            tr.push(highs[i] - lows[i]);
        } else {
            const prevClose = closingPrices[i - 1];
            tr.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - prevClose),
                Math.abs(lows[i] - prevClose)
            ));
        }
    }

    // 计算ATR
    const atr = [];
    let sumTR = tr.slice(0, period).reduce((sum, val) => sum + val, 0);
    atr.push(sumTR / period); // 初始ATR

    for (let i = period; i < tr.length; i++) {
        const currentATR = (atr[i - period] * (period - 1) + tr[i]) / period;
        atr.push(currentATR);
    }
    
    return atr;
}

async function main() {
    // 获取数据
    const { closingPrices, highs, lows } = await fetchKlines();
    
    // 计算指标
    const ema120 = calculateEMA(closingPrices, 120);
    const atr14 = calculateATR(highs, lows, closingPrices, 14);
    
    // 获取最新值（最后一个数据点）
    const latestClose = closingPrices[closingPrices.length - 1];
    const latestEMA120 = ema120[ema120.length - 1];
    const latestATR14 = atr14[atr14.length - 1];
    
    // 打印结果
    console.log('最近收盘价:', latestClose.toFixed(4));
    console.log('EMA120:', latestEMA120.toFixed(4));
    console.log('ATR14:', latestATR14.toFixed(4));
    console.log('ATR14×1.5:', (latestATR14 * 1.5).toFixed(4));
}

main();