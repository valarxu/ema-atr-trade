const axios = require('axios');
const CryptoJS = require('crypto-js');
require('dotenv').config();

async function setLeverage() {
    const timestamp = new Date().toISOString();
    const method = 'POST';
    const requestPath = '/api/v5/account/set-leverage';
    
    // 设置参数
    const leverageData = {
        instId: 'BTC-USDT-SWAP',     // 产品ID
        lever: '10',                  // 杠杆倍数
        mgnMode: 'isolated',          // 保证金模式：isolated(逐仓)
        posSide: 'long'               // 持仓方向：long(多仓)
    };

    // 生成签名
    const signStr = `${timestamp}${method}${requestPath}${JSON.stringify(leverageData)}`;
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
            data: leverageData,
            headers: {
                'OK-ACCESS-KEY': process.env.OKX_API_KEY,
                'OK-ACCESS-SIGN': signature,
                'OK-ACCESS-TIMESTAMP': timestamp,
                'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('设置杠杆倍数成功:', response.data);
    } catch (error) {
        console.error('设置杠杆倍数失败:', error.response ? error.response.data : error.message);
    }
}

setLeverage(); 