const axios = require('axios');
const CryptoJS = require('crypto-js');
const {
    BTC_USDT_SWAP,
    ETH_USDT_SWAP,
    SOL_USDT_SWAP,
    ADA_USDT_SWAP,
    HYPE_USDT_SWAP,
    SUI_USDT_SWAP,
    POSITION_USDT
} = require('../utils/constants.js');

class OkxClient {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.secretKey = config.secretKey;
        this.passphrase = config.passphrase;
        this.baseUrl = 'https://www.okx.com';
        
        if (!this.apiKey || !this.secretKey || !this.passphrase) {
            throw new Error('OKXClient: 缺少必要的API配置信息');
        }
    }

    _sign(method, requestPath, body = '') {
        const timestamp = new Date().toISOString();
        const signStr = `${timestamp}${method}${requestPath}${body}`;
        const signature = CryptoJS.enc.Base64.stringify(
            CryptoJS.HmacSHA256(signStr, this.secretKey)
        );
        return { timestamp, signature };
    }

    async _request(method, endpoint, data = null) {
        const requestPath = `/api/v5${endpoint}`;
        const body = data ? JSON.stringify(data) : '';
        const { timestamp, signature } = this._sign(method, requestPath, body);

        try {
            const response = await axios({
                method: method,
                url: `${this.baseUrl}${requestPath}`,
                data: data,
                headers: {
                    'OK-ACCESS-KEY': this.apiKey,
                    'OK-ACCESS-SIGN': signature,
                    'OK-ACCESS-TIMESTAMP': timestamp,
                    'OK-ACCESS-PASSPHRASE': this.passphrase,
                    'Content-Type': 'application/json'
                }
            });
            return response.data;
        } catch (error) {
            const msg = error.response ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`OKX API请求失败 [${endpoint}]: ${msg}`);
        }
    }

    // 获取合约信息
    getInstrumentInfo(symbol) {
        const instrumentMap = {
            'BTC-USDT-SWAP': BTC_USDT_SWAP,
            'ETH-USDT-SWAP': ETH_USDT_SWAP,
            'SOL-USDT-SWAP': SOL_USDT_SWAP,
            'ADA-USDT-SWAP': ADA_USDT_SWAP,
            'HYPE-USDT-SWAP': HYPE_USDT_SWAP,
            'SUI-USDT-SWAP': SUI_USDT_SWAP,
        };
        return instrumentMap[symbol];
    }

    // 计算合约张数
    calculateContractSize(instrumentInfo, currentPrice, positionUSDT) {
        const contractValue = parseFloat(instrumentInfo.ctVal) * currentPrice;
        let contractSize = positionUSDT / contractValue;
        
        const lotSize = parseFloat(instrumentInfo.lotSz);
        contractSize = Math.floor(contractSize / lotSize) * lotSize;
        
        const minSize = parseFloat(instrumentInfo.minSz);
        if (contractSize < minSize) {
            contractSize = minSize;
        }
        
        const lotSzStr = String(instrumentInfo.lotSz);
        const decimals = lotSzStr.includes('.') ? lotSzStr.split('.')[1].length : 0;
        return contractSize.toFixed(decimals);
    }

    // 下单
    async placeOrder(symbol, currentPrice, posSide, positionUSDT) {
        const instrumentInfo = this.getInstrumentInfo(symbol);
        if (!instrumentInfo) throw new Error(`不支持的交易对: ${symbol}`);

        const contractSize = this.calculateContractSize(instrumentInfo, currentPrice, positionUSDT);
        
        const orderData = {
            instId: symbol,
            tdMode: 'isolated',
            side: posSide === 'long' ? 'buy' : 'sell',
            ordType: 'market',
            sz: contractSize,
            posSide: posSide
        };

        console.log(`[${symbol}] 准备下单: ${posSide} ${contractSize}张 (约${positionUSDT} USDT)`);
        return await this._request('POST', '/trade/order', orderData);
    }

    // 平仓
    async closePosition(symbol, mgnMode = 'isolated') {
        const orderData = {
            instId: symbol,
            mgnMode: mgnMode
        };
        console.log(`[${symbol}] 准备市价全平`);
        return await this._request('POST', '/trade/close-position', orderData);
    }

    // 获取持仓
    async getPositions(instIds = []) {
        let endpoint = '/account/positions';
        if (instIds.length > 0) {
            endpoint += `?instId=${instIds.join(',')}`; // 注意：API通常只支持单个或特定格式，这里假设只需传instType或单个
            // OKX API GET /api/v5/account/positions 支持 instId 参数
            // 如果有多个，可能需要多次调用或不传instId获取所有
            // 简单起见，如果列表不为空，我们尝试只获取SWAP类型的持仓并过滤
            endpoint = '/account/positions?instType=SWAP'; 
        } else {
             endpoint = '/account/positions?instType=SWAP';
        }
        
        const res = await this._request('GET', endpoint);
        if (res.code !== '0') throw new Error(`获取持仓失败: ${res.msg}`);
        
        // 如果指定了instIds，在客户端过滤
        if (instIds.length > 0) {
            return res.data.filter(p => instIds.includes(p.instId));
        }
        return res.data;
    }
}

module.exports = OkxClient;
