const axios = require('axios');
const CryptoJS = require('crypto-js');
require('dotenv').config();

// 导入合约信息常量
const {
    BTC_USDT_SWAP,
    ETH_USDT_SWAP,
    SOL_USDT_SWAP,
    POSITION_USDT
} = require('./okx-instrumentInfo_const.js');

// 获取合约信息
function getInstrumentInfo(symbol) {
    const instrumentMap = {
        'BTC-USDT-SWAP': BTC_USDT_SWAP,
        'ETH-USDT-SWAP': ETH_USDT_SWAP,
        'SOL-USDT-SWAP': SOL_USDT_SWAP
    };
    return instrumentMap[symbol];
}

// 计算合约张数
function calculateContractSize(instrumentInfo, currentPrice, positionUSDT) {
    // 一张合约的价值 = 合约面值 * 当前价格
    const contractValue = parseFloat(instrumentInfo.ctVal) * currentPrice;
    
    // 需要的合约张数 = 预期仓位价值 / 每张合约价值
    let contractSize = positionUSDT / contractValue;
    
    // 确保合约张数符合最小变动单位
    const lotSize = parseFloat(instrumentInfo.lotSz);
    contractSize = Math.floor(contractSize / lotSize) * lotSize;
    
    // 确保合约张数符合最小交易量
    const minSize = parseFloat(instrumentInfo.minSz);
    if (contractSize < minSize) {
        contractSize = minSize;
    }
    
    return contractSize.toString();
}

async function placeOrder(symbol = 'BTC-USDT-SWAP', currentPrice = 65000, posSide = 'long') {
    const instrumentInfo = getInstrumentInfo(symbol);
    if (!instrumentInfo) {
        throw new Error('不支持的交易对');
    }

    const contractSize = calculateContractSize(instrumentInfo, currentPrice, POSITION_USDT);
    console.log(`预期开仓价值: ${POSITION_USDT} USDT`);
    console.log(`当前币价: ${currentPrice} USDT`);
    console.log(`计算得到合约张数: ${contractSize} 张`);
    console.log(`持仓方向: ${posSide}`);
    
    const timestamp = new Date().toISOString();
    const method = 'POST';
    const requestPath = '/api/v5/trade/order';
    
    // 订单参数
    const orderData = {
        instId: symbol,           // 交易对
        tdMode: 'isolated',       // 逐仓模式
        side: posSide === 'long' ? 'buy' : 'sell',  // 做多买入，做空卖出
        ordType: 'market',        // 市价单
        sz: contractSize,         // 计算得到的合约张数
        posSide: posSide         // 持仓方向
    };

    // 生成签名
    const signStr = `${timestamp}${method}${requestPath}${JSON.stringify(orderData)}`;
    const signature = CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(
            signStr,
            process.env.OKX_SECRET_KEY || ''
        )
    );

    try {
        console.log('准备开仓:', {
            交易对: orderData.instId,
            持仓方向: orderData.posSide,
            开仓方向: orderData.side,
            开仓数量: orderData.sz
        });

        const response = await axios({
            method: method,
            url: `https://www.okx.com${requestPath}`,
            data: orderData,
            headers: {
                'OK-ACCESS-KEY': process.env.OKX_API_KEY,
                'OK-ACCESS-SIGN': signature,
                'OK-ACCESS-TIMESTAMP': timestamp,
                'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('开仓成功:', response.data);
        return response.data;
    } catch (error) {
        console.error('开仓失败:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// 导出方法
module.exports = {
    placeOrder
};