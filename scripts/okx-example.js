const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

const signStr = `${timestamp}${method}${requestPath}?${queryString}`;
const signature = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(
        signStr,
        process.env.OKX_SECRET_KEY || ''
    )
);

return axios.get(`https://www.okx.com${requestPath}`, {
    params: params,
    headers: {
        'OK-ACCESS-KEY': process.env.OKX_API_KEY,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': process.env.OKX_PASSPHRASE,
        'Content-Type': 'application/json'
    }
});