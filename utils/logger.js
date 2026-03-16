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
    const MAX_RECORDS = 5000;
    
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
    
    // 归档逻辑
    if (history.length >= MAX_RECORDS) {
        // 生成归档文件名: trades_history_archive_YYYY-MM-DD_HH-mm.json
        const date = new Date();
        const dateStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 16); // 2026-03-16T12-30
        const archiveFile = path.join(dataDir, `trades_history_archive_${dateStr}.json`);
        
        try {
            // 将旧记录写入归档文件
            fs.writeFileSync(archiveFile, JSON.stringify(history, null, 2));
            console.log(`交易记录已达到${MAX_RECORDS}条，已归档至: ${archiveFile}`);
            
            // 重置当前历史记录为空（或者保留最新的一条？）
            // 通常归档意味着清空当前主文件，重新开始记录
            history = []; 
        } catch (err) {
            console.error('归档失败:', err);
            // 如果归档失败，为了防止数据丢失，我们暂时保留数据，只切片
            history = history.slice(-MAX_RECORDS); 
        }
    }
    
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
