const BTC_USDT_SWAP = {
    instId: 'BTC-USDT-SWAP',
    ctVal: '0.01',
    ctValCcy: 'BTC',
    lotSz: '0.01',
    minSz: '0.01',
};

const ETH_USDT_SWAP = {
    instId: 'ETH-USDT-SWAP',
    ctVal: '0.1',
    ctValCcy: 'ETH',
    lotSz: '0.01',
    minSz: '0.01',
};

const SOL_USDT_SWAP = {
    instId: 'SOL-USDT-SWAP',
    ctVal: '1',
    ctValCcy: 'SOL',
    lotSz: '0.01',
    minSz: '0.01',
};

const ADA_USDT_SWAP = {
    instId: 'ADA-USDT-SWAP',
    ctVal: '100',
    ctValCcy: 'ADA',
    lotSz: '0.1',
    minSz: '0.1',
};

const POSITION_USDT = {
    'BTC-USDT-SWAP': 6000,
    'ETH-USDT-SWAP': 3000,
    'SOL-USDT-SWAP': 3000,
    'ADA-USDT-SWAP': 3000
};

// 导出所有常量
module.exports = {
    BTC_USDT_SWAP,
    ETH_USDT_SWAP,
    SOL_USDT_SWAP,
    ADA_USDT_SWAP,
    POSITION_USDT
};