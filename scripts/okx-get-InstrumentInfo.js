const axios = require('axios');

async function getInstrumentInfo() {
  const response = await axios.get('https://www.okx.com/api/v5/public/instruments', {
    params: {
      instType: 'SWAP',  // 永续合约
      instId: 'BTC-USDT-SWAP'
    }
  });
  console.log(response.data.data[0]);
}

getInstrumentInfo();