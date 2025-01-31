// 计算EMA
function calculateEMA(data, period) {
    if (data.length < period) {
        throw new Error('数据长度不足以计算EMA');
    }
    
    let ema = data.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    const multiplier = 2 / (period + 1);
    
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// 计算ATR
function calculateATR(highs, lows, closingPrices, period) {
    if (highs.length < period + 1 || lows.length < period + 1 || closingPrices.length < period + 1) {
        throw new Error('数据长度不足以计算ATR');
    }

    const trValues = [];
    for (let i = 1; i < closingPrices.length; i++) {
        const high = highs[i];
        const low = lows[i];
        const prevClose = closingPrices[i - 1];
        
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trValues.push(tr);
    }

    let atr = trValues.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
    
    for (let i = period; i < trValues.length; i++) {
        atr = ((period - 1) * atr + trValues[i]) / period;
    }
    
    return atr;
}

module.exports = {
    calculateEMA,
    calculateATR
}; 