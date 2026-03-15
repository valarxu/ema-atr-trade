const fs = require('fs');
const path = require('path');

function ensureLogsDirectory() {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    return logsDir;
}

function ensureDataDirectory() {
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
    }
    return dataDir;
}

function logTrade(symbol, type, price, reason) {
    const logsDir = ensureLogsDirectory();
    const date = new Date();
    const logFile = path.join(logsDir, `trades_${symbol}_${date.getFullYear()}_${(date.getMonth() + 1)}.txt`);
    
    const logEntry = `${date.toISOString()} - ${symbol} ${type} @ ${price} USDT - ${reason}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    return logEntry;
}

function saveTradeHistory(tradeData) {
    const dataDir = ensureDataDirectory();
    const historyFile = path.join(dataDir, 'trades_history.json');
    
    let history = [];
    if (fs.existsSync(historyFile)) {
        try {
            history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        } catch (e) {
            console.error('读取交易历史失败，重置为空', e);
        }
    }
    
    // 添加时间戳和ID
    const record = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        ...tradeData
    };
    
    history.push(record);
    
    // 只保留最近1000条记录 (可选)
    if (history.length > 1000) history = history.slice(-1000);
    
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    return record;
}

function logCloseSummary(summary) {
    const logsDir = ensureLogsDirectory();
    const date = new Date();
    const logFile = path.join(logsDir, `trades_summary_${date.getFullYear()}_${(date.getMonth() + 1)}.txt`);
    const {
        symbol,
        user, // 增加用户字段
        side,
        entryPrice,
        exitPrice,
        quantity,
        pnl,
        reason
    } = summary;
    
    // 写入文本日志
    const logEntry = `${date.toISOString()} - [${user}] ${symbol} ${side} | entry=${Number(entryPrice).toFixed(4)} | exit=${Number(exitPrice).toFixed(4)} | qty=${quantity} | pnl=${Number(pnl).toFixed(2)} USDT | ${reason}\n`;
    fs.appendFileSync(logFile, logEntry);
    
    // 保存到JSON历史
    saveTradeHistory({
        user,
        symbol,
        side,
        entryPrice: Number(entryPrice),
        exitPrice: Number(exitPrice),
        quantity: Number(quantity),
        pnl: Number(pnl),
        reason
    });
    
    return logEntry;
}

function getTradeHistory() {
    const dataDir = ensureDataDirectory();
    const historyFile = path.join(dataDir, 'trades_history.json');
    if (fs.existsSync(historyFile)) {
        try {
            return JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

module.exports = {
    logTrade,
    logCloseSummary,
    getTradeHistory
}; 
