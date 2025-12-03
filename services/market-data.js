const axios = require('axios');

async function fetchKlines(symbol) {
    try {
        console.log(`开始拉取${symbol} 4H K线, limit=241`);
        const response = await axios.get('https://www.okx.com/api/v5/market/candles', {
            params: {
                instId: symbol,
                bar: '4H',
                limit: '241'
            }
        });
        const code = response.data && response.data.code;
        const candles = response.data && response.data.data;
        console.log(`拉取${symbol}返回 code=${code}, candles条数=${candles ? candles.length : 'null'}`);
        if (!Array.isArray(candles) || candles.length < 241) {
            const preview = JSON.stringify(response.data || {}).slice(0, 500);
            console.error(`K线数据异常 ${symbol}: 结构预览=${preview}`);
            throw new Error(`Not enough kline data for ${symbol}`);
        }

        const reversedCandles = candles.reverse();
        console.log(`解析${symbol} K线: reversed长度=${reversedCandles.length}`);
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
        console.log(`构建${symbol} 数组: close=${closingPrices.length}, high=${highs.length}, low=${lows.length}, currentClose=${currentClose}`);
        return { 
            closingPrices, 
            highs, 
            lows,
            currentClose,
        };
    } catch (error) {
        const extra = error.response && error.response.data ? JSON.stringify(error.response.data).slice(0, 500) : '';
        console.error(`获取${symbol}K线数据失败: ${error.message} ${extra}`);
        throw error;
    }
}

module.exports = {
    fetchKlines
}; 
