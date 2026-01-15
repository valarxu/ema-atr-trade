const fs = require('fs');
const path = require('path');

function ensureLogsDirectory() {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    return logsDir;
}

function logTrade(symbol, type, price, reason) {
    const logsDir = ensureLogsDirectory();
    const date = new Date();
    const logFile = path.join(logsDir, `trades_${symbol}_${date.getFullYear()}_${(date.getMonth() + 1)}.txt`);
    
    const logEntry = `${date.toISOString()} - ${symbol} ${type} @ ${price} USDT - ${reason}\n`;
    
    fs.appendFileSync(logFile, logEntry);
    return logEntry;
}

function logCloseSummary(summary) {
    const logsDir = ensureLogsDirectory();
    const date = new Date();
    const logFile = path.join(logsDir, `trades_summary_${date.getFullYear()}_${(date.getMonth() + 1)}.txt`);
    const {
        symbol,
        side,
        entryPrice,
        exitPrice,
        quantity,
        pnl,
        reason
    } = summary;
    const logEntry = `${date.toISOString()} - ${symbol} ${side} | entry=${Number(entryPrice).toFixed(4)} | exit=${Number(exitPrice).toFixed(4)} | qty=${quantity} | pnl=${Number(pnl).toFixed(2)} USDT | ${reason}\n`;
    fs.appendFileSync(logFile, logEntry);
    return logEntry;
}

module.exports = {
    logTrade,
    logCloseSummary
}; 
