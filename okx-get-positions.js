const axios = require('axios');
const CryptoJS = require('crypto-js');
require('dotenv').config();

async function getPositions() {
    const timestamp = new Date().toISOString();
    const method = 'GET';
    const requestPath = '/api/v5/account/positions';
    
    // 查询参数
    const params = {
        instType: 'SWAP',           // 产品类型：SWAP(永续合约)
        instId: 'BTC-USDT-SWAP'    // 产品ID
    };

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
        
        // 格式化输出持仓信息
        if (response.data.data && response.data.data.length > 0) {
            console.log('\n当前持仓信息:');
            response.data.data.forEach(position => {
                console.log('\n----------------------------------------');
                console.log(`交易对: ${position.instId}`);
                console.log(`持仓方向: ${position.posSide}`);
                console.log(`持仓数量: ${position.pos}`);
                console.log(`开仓均价: ${position.avgPx}`);
                console.log(`未实现收益: ${position.upl}`);
                console.log(`杠杆倍数: ${position.lever}x`);
                console.log(`保证金模式: ${position.mgnMode}`);
                console.log(`仓位市值: ${position.notionalUsd} USD`);
                console.log('----------------------------------------\n');
            });
        } else {
            console.log('\n当前没有持仓\n');
        }
    } catch (error) {
        console.error('获取持仓信息失败:', error.response ? error.response.data : error.message);
    }
}

getPositions(); 