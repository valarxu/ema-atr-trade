const axios = require('axios');
const { calculateEMA, calculateATR } = require('../utils/technical-indicators');

/**
 * 市场数据服务 (单例)
 * 负责统一拉取K线数据并计算指标，供所有用户实例共享
 */
class MarketService {
    constructor() {
        this.cache = {}; // 缓存最新一次计算结果
        this.lastFetchTime = {};
    }

    /**
     * 获取指定交易对的市场分析数据
     * 如果在短时间内已经拉取过，则直接返回缓存（防止多用户重复请求）
     */
    async getMarketAnalysis(symbol) {
        const swapSymbol = `${symbol}-SWAP`;
        const now = Date.now();
        
        // 简单的缓存机制：如果数据在10秒内更新过，直接返回
        if (this.cache[symbol] && (now - this.lastFetchTime[symbol] < 10000)) {
            return this.cache[symbol];
        }

        try {
            const klineData = await this._fetchKlines(swapSymbol);
            const indicators = this._calculateIndicators(klineData);
            
            const result = {
                symbol,
                swapSymbol,
                ...klineData,
                ...indicators
            };

            this.cache[symbol] = result;
            this.lastFetchTime[symbol] = now;
            
            return result;
        } catch (error) {
            console.error(`[MarketService] 获取${symbol}数据失败: ${error.message}`);
            throw error;
        }
    }

    async _fetchKlines(instId) {
        // console.log(`[MarketService] 拉取 ${instId} K线...`);
        const response = await axios.get('https://www.okx.com/api/v5/market/candles', {
            params: {
                instId: instId,
                bar: '4H',
                limit: '241'
            }
        });

        const candles = response.data && response.data.data;
        if (!Array.isArray(candles) || candles.length < 241) {
            throw new Error(`K线数据不足或格式错误: ${instId}`);
        }

        // 原始数据是时间倒序（最新的在最前），需要反转为时间正序
        const reversedCandles = candles.reverse();
        
        // 分离当前未收盘K线和历史K线
        // 注意：OKX返回的最新一条是当前正在进行中的K线
        const currentCandle = reversedCandles[reversedCandles.length - 1];
        const historicalCandles = reversedCandles.slice(0, -1);
        
        const currentClose = parseFloat(currentCandle[4]);
        
        const closingPrices = [];
        const highs = [];
        const lows = [];

        for (const candle of historicalCandles) {
            // [ts, o, h, l, c, vol, volCcy]
            highs.push(parseFloat(candle[2]));
            lows.push(parseFloat(candle[3]));
            closingPrices.push(parseFloat(candle[4]));
        }

        return {
            closingPrices,
            highs,
            lows,
            currentClose
        };
    }

    _calculateIndicators(data) {
        const { closingPrices, highs, lows } = data;
        
        const historicalEMA120 = calculateEMA(closingPrices, 120);
        const historicalATR60 = calculateATR(highs, lows, closingPrices, 60);
        
        const previousClose = closingPrices[closingPrices.length - 1];
        const priceDistance = (previousClose - historicalEMA120) / historicalATR60;

        return {
            previousClose,
            historicalEMA120,
            historicalATR60,
            priceDistance
        };
    }
}

// 导出单例
module.exports = new MarketService();
