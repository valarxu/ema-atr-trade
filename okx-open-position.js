const axios = require('axios');
const CryptoJS = require('crypto-js');
require('dotenv').config();

async function placeOrder() {
    const timestamp = new Date().toISOString();
    const method = 'POST';
    const requestPath = '/api/v5/trade/order';
    
    // 订单参数
    const orderData = {
        instId: 'BTC-USDT',  // 交易对
        tdMode: 'isolated',   // 逐仓模式
        side: 'buy',         // 买入方向
        ordType: 'market',   // 市价单
        sz: '0.001',         // 数量
        posSide: 'long'      // 持仓方向
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
    } catch (error) {
        console.error('开仓失败:', error.response ? error.response.data : error.message);
    }
}

placeOrder(); 