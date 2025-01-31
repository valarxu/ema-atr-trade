const axios = require('axios');
const CryptoJS = require('crypto-js');
const { getPositions } = require('./okx-get-positions');
require('dotenv').config();

async function closePosition(instId) {
    // 获取持仓信息
    const positions = await getPositions(instId);
    
    if (!positions.length) {
        console.log(`没有找到 ${instId} 的持仓信息`);
        return;
    }

    // 遍历所有需要平仓的仓位
    for (const position of positions) {
        if (position.pos === '0') continue; // 跳过空仓位
        
        const timestamp = new Date().toISOString();
        const method = 'POST';
        const requestPath = '/api/v5/trade/order';
        
        // 订单参数
        const orderData = {
            instId: position.instId,
            tdMode: 'isolated',
            side: position.posSide === 'long' ? 'sell' : 'buy',  // 持多仓就卖出，持空仓就买入
            ordType: 'market',
            sz: Math.abs(parseFloat(position.pos)).toString(),    // 确保数量为正数
            posSide: position.posSide
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
            console.log(`准备平仓:`, {
                交易对: orderData.instId,
                持仓方向: orderData.posSide,
                平仓方向: orderData.side,
                平仓数量: orderData.sz
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
            
            console.log('平仓成功:', response.data);
        } catch (error) {
            console.error('平仓失败:', error.response ? error.response.data : error.message);
        }
    }
}

// 导出方法
module.exports = {
    closePosition
}; 