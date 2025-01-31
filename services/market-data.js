const axios = require('axios');

async function fetchKlines(symbol) {
    try {
        const response = await axios.get('https://www.okx.com/api/v5/market/candles', {
            params: {
                instId: symbol,
                bar: '4H',
                limit: '241'
            }
        });
        
        const candles = response.data.data;
        if (!candles || candles.length < 241) {
            throw new Error(`Not enough kline data for ${symbol}`);
        }

        const reversedCandles = candles.reverse();
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

module.exports = {
    fetchKlines
}; 