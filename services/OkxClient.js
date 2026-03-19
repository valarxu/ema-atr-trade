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
        this.apiKey = String(config.apiKey || '').trim();
        this.secretKey = String(config.secretKey || '').trim();
        this.passphrase = String(config.passphrase || '').trim();
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

    _maskCredential(value) {
        const text = String(value || '');
        if (!text) return 'empty(len:0)';
        if (text.length <= 6) {
            return `${text.slice(0, 1)}***${text.slice(-1)}(len:${text.length})`;
        }
        return `${text.slice(0, 3)}***${text.slice(-3)}(len:${text.length})`;
    }

    getCredentialFingerprint() {
        return {
            apiKey: this._maskCredential(this.apiKey),
            secretKey: this._maskCredential(this.secretKey),
            passphrase: this._maskCredential(this.passphrase)
        };
    }

    _buildQueryString(params = {}) {
        return Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
    }

    async _request(method, endpoint, data = null, params = null) {
        const queryString = this._buildQueryString(params || {});
        const requestPath = `/api/v5${endpoint}${queryString ? `?${queryString}` : ''}`;
        const body = method === 'GET' ? '' : (data ? JSON.stringify(data) : '');
        const { timestamp, signature } = this._sign(method, requestPath, body);

        try {
            const response = await axios({
                method: method,
                url: `${this.baseUrl}${requestPath}`,
                data: method === 'GET' ? undefined : data,
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

    async _requestPublic(method, endpoint, data = null) {
        const requestPath = `/api/v5${endpoint}`;
        try {
            const response = await axios({
                method: method,
                url: `${this.baseUrl}${requestPath}`,
                data: data
            });
            return response.data;
        } catch (error) {
            const msg = error.response ? JSON.stringify(error.response.data) : error.message;
            throw new Error(`OKX 公共请求失败 [${endpoint}]: ${msg}`);
        }
    }

    async selfCheck() {
        const result = {
            ok: false,
            serverTimeMs: null,
            localTimeMs: Date.now(),
            timeDiffMs: null,
            code: null,
            msg: null,
            summary: '',
            fingerprint: this.getCredentialFingerprint()
        };
        try {
            const timeRes = await this._requestPublic('GET', '/public/time');
            if (timeRes && timeRes.code === '0' && timeRes.data && timeRes.data[0] && timeRes.data[0].ts) {
                result.serverTimeMs = Number(timeRes.data[0].ts);
                result.localTimeMs = Date.now();
                result.timeDiffMs = result.localTimeMs - result.serverTimeMs;
            }
        } catch (e) {}

        try {
            const cfg = await this._request('GET', '/account/config');
            if (cfg.code === '0') {
                result.ok = true;
                result.summary = `鉴权通过${result.timeDiffMs !== null ? `，时间差 ${result.timeDiffMs}ms` : ''}`;
                return result;
            }
            result.code = cfg.code || null;
            result.msg = cfg.msg || '未知错误';
        } catch (e) {
            const raw = String(e.message || '');
            const codeMatch = raw.match(/"code":"(\d+)"/);
            const msgMatch = raw.match(/"msg":"([^"]+)"/);
            result.code = codeMatch ? codeMatch[1] : null;
            result.msg = msgMatch ? msgMatch[1] : raw;
        }

        if (result.code === '50113') {
            result.summary = `签名无效(50113): 请检查 apiKey/secretKey/passphrase 是否一一对应`;
        } else if (result.code === '50102') {
            result.summary = `时间戳异常(50102): 请检查服务器时间同步`;
        } else {
            result.summary = `鉴权失败${result.code ? `(${result.code})` : ''}: ${result.msg || '未知原因'}`;
        }
        if (result.timeDiffMs !== null && Math.abs(result.timeDiffMs) > 30000) {
            result.summary += `；本机与OKX时间差约 ${result.timeDiffMs}ms`;
        }
        return result;
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
    async closePosition(symbol, positions = null, tdMode = 'isolated') {
        const targetPositions = Array.isArray(positions) ? positions : await this.getPositions([symbol]);
        const activePositions = targetPositions.filter(p => p.pos !== '0');

        if (activePositions.length === 0) {
            console.log(`[${symbol}] 无可平仓位`);
            return [];
        }

        const results = [];
        for (const position of activePositions) {
            const rawPos = String(position.pos);
            const szStr = rawPos.startsWith('-') ? rawPos.slice(1) : rawPos;
            const normalizedPosSide = position.posSide === 'long' || position.posSide === 'short'
                ? position.posSide
                : (Number(position.pos) >= 0 ? 'long' : 'short');
            const orderData = {
                instId: position.instId || symbol,
                tdMode,
                side: normalizedPosSide === 'long' ? 'sell' : 'buy',
                ordType: 'market',
                sz: szStr,
                posSide: normalizedPosSide
            };
            console.log(`[${orderData.instId}] 准备平仓: ${orderData.posSide} ${orderData.sz}`);
            const res = await this._request('POST', '/trade/order', orderData);
            results.push(res);
        }
        return results;
    }

    // 获取持仓
    async getPositions(instIds = []) {
        const params = { instType: 'SWAP' };
        if (instIds.length > 0) {
            params.instId = instIds.join(',');
        }

        const res = await this._request('GET', '/account/positions', null, params);
        if (res.code !== '0') throw new Error(`获取持仓失败: ${res.msg}`);
        
        // 如果指定了instIds，在客户端过滤
        if (instIds.length > 0) {
            return res.data.filter(p => instIds.includes(p.instId));
        }
        return res.data;
    }

    // 获取历史成交记录
    async getFills(instType = 'SWAP', instId = '') {
        const params = { instType };
        if (instId) {
            params.instId = instId;
        }
        // OKX /api/v5/trade/fills 返回最近的成交明细
        const res = await this._request('GET', '/trade/fills', null, params);
        if (res.code !== '0') throw new Error(`获取历史成交失败: ${res.msg}`);
        return res.data;
    }
}

module.exports = OkxClient;
