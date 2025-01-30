// 设置持仓模式
const axios = require('axios');
const CryptoJS = require('crypto-js');
require('dotenv').config();

async function setPositionMode() {
    const timestamp = new Date().toISOString();
    const method = 'POST';
    const requestPath = '/api/v5/account/set-position-mode';
    
    // 设置参数
    const positionData = {
        posMode: 'long_short_mode',  // 双向持仓模式
    };

    // 生成签名
    const signStr = `${timestamp}${method}${requestPath}${JSON.stringify(positionData)}`;
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
            data: positionData,
            headers: {
                'OK-ACCESS-KEY': process.env.OKX_API_KEY,
                'OK-ACCESS-SIGN': signature,
                'OK-ACCESS-TIMESTAMP': timestamp,
                'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('设置持仓模式成功:', response.data);
    } catch (error) {
        console.error('设置持仓模式失败:', error.response ? error.response.data : error.message);
    }
}

setPositionMode(); 