const axios = require('axios');
const CryptoJS = require('crypto-js');
require('dotenv').config();

async function getPositions(instIds = []) {
    const timestamp = new Date().toISOString();
    const method = 'GET';
    const requestPath = '/api/v5/account/positions';
    
    // 查询参数
    const params = {
        instType: 'SWAP'           // 产品类型：SWAP(永续合约)
    };
    
    // 如果指定了具体交易对，则添加到查询参数中
    if (instIds.length > 0) {
        // OKX API支持用逗号分隔多个交易对
        params.instId = instIds.join(',');
    }

    // 将查询参数转换为查询字符串
    const queryString = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join('&');

    // 生成签名
    const signStr = `${timestamp}${method}${requestPath}?${queryString}`;
    const signature = CryptoJS.enc.Base64.stringify(
        CryptoJS.HmacSHA256(
            signStr,
            process.env.OKX_SECRET_KEY || ''
        )
    );

    try {
        const response = await axios({
            method: method,
            url: `https://www.okx.com${requestPath}?${queryString}`,
            headers: {
                'OK-ACCESS-KEY': process.env.OKX_API_KEY,
                'OK-ACCESS-SIGN': signature,
                'OK-ACCESS-TIMESTAMP': timestamp,
                'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data.data || [];
    } catch (error) {
        console.error('获取持仓信息失败:', error.response ? error.response.data : error.message);
        return [];
    }
}

// 导出方法
module.exports = {
    getPositions
}; 