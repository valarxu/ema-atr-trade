const express = require('express');
const path = require('path');
const crypto = require('crypto');

// 简单的内存会话存储
const sessions = new Map();

/**
 * 启动Web控制面板
 * @param {number} port - 端口号
 * @param {Object} botManager - 机器人管理器
 */
function startWebServer(port, botManager) {
    const app = express();
    
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));

    // API: 登录
    app.post('/api/login', (req, res) => {
        const { username, password } = req.body;
        const bots = botManager.getAllBots();
        const user = bots.find(bot => bot.username === username && bot.password === password);
        
        let isValid = false;
        let isAdmin = false;

        if (user) {
            isValid = true;
        } else if (username === process.env.WEB_USER && password === process.env.WEB_PASS) {
            isValid = true;
            isAdmin = true;
        }

        if (isValid) {
            // 生成一个随机 token
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, { username, isAdmin });
            res.json({ success: true, token });
        } else {
            res.status(401).json({ error: '账号或密码错误' });
        }
    });

    // API: 登出
    app.post('/api/logout', (req, res) => {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            sessions.delete(token);
        }
        res.json({ success: true });
    });

    // 认证中间件
    const authMiddleware = (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未登录' });
        }

        const token = authHeader.split(' ')[1];
        const session = sessions.get(token);

        if (!session) {
            return res.status(401).json({ error: '会话已过期，请重新登录' });
        }

        const bots = botManager.getAllBots();
        if (session.isAdmin) {
            req.currentUser = bots[0]; 
            req.isGlobalAdmin = true;
        } else {
            const userBot = bots.find(b => b.username === session.username);
            if (userBot) {
                req.currentUser = userBot;
            } else {
                return res.status(401).json({ error: '用户不存在' });
            }
        }
        next();
    };

    // API: 获取当前登录用户的状态
    app.get('/api/status', authMiddleware, async (req, res) => {
        try {
            const bot = req.currentUser;
            if (!bot) return res.status(404).json({ error: '未找到关联的机器人实例' });

            const { TRADING_PAIRS } = require('../utils/constants');
            
            const state = {
                id: bot.id,
                name: bot.name,
                username: bot.username,
                tradingPairs: TRADING_PAIRS,
                tradingEnabled: bot.settings.tradingEnabled,
                positionState: bot.positionState,
                positionDetails: bot.positionDetails || {}, // 新增：传递详细持仓数据
                ignoreShortSignals: bot.settings.ignoreShortSignals,
                longOnly: bot.settings.longOnly,
                baseAmounts: bot.baseAmounts,
                globalPositionMultiplier: bot.settings.multiplier,
                isGlobalAdmin: !!req.isGlobalAdmin
            };
            res.json(state);
        } catch (error) {
            console.error('获取状态失败:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // API: 更新配置
    app.post('/api/update', authMiddleware, async (req, res) => {
        try {
            const { action, symbol, value } = req.body;
            const bot = req.currentUser;
            
            if (!bot) return res.status(404).json({ error: '用户未关联机器人' });

            console.log(`Web端更新请求[${bot.username}]: action=${action}, symbol=${symbol}, value=${value}`);
            
            const { TRADING_PAIRS, POSITION_USDT } = require('../utils/constants.js');

            switch (action) {
                case 'setGlobalMultiplier':
                    if (value > 0) bot.settings.multiplier = value;
                    break;
                case 'enableAll':
                    for (const p of TRADING_PAIRS) bot.settings.tradingEnabled[p] = true;
                    break;
                case 'disableAll':
                    for (const p of TRADING_PAIRS) bot.settings.tradingEnabled[p] = false;
                    break;
                case 'resetAllShortSignals':
                    for (const p of TRADING_PAIRS) bot.settings.ignoreShortSignals[p] = false;
                    break;
                case 'setPairEnabled':
                    if (TRADING_PAIRS.includes(symbol)) bot.settings.tradingEnabled[symbol] = value;
                    break;
                case 'setPairLongOnly':
                    if (TRADING_PAIRS.includes(symbol)) bot.settings.longOnly[symbol] = value;
                    break;
                case 'setPairIgnoreShort':
                    if (TRADING_PAIRS.includes(symbol)) bot.settings.ignoreShortSignals[symbol] = value;
                    break;
                case 'setPairAmount':
                    const swapKey = `${symbol}-SWAP`;
                    if (bot.baseAmounts.hasOwnProperty(swapKey)) bot.baseAmounts[swapKey] = value;
                    break;
                case 'resetPairAmount':
                    const swapK = `${symbol}-SWAP`;
                    if (POSITION_USDT.hasOwnProperty(swapK)) bot.baseAmounts[swapK] = POSITION_USDT[swapK];
                    break;
                case 'resetPairShortSignal':
                    if (TRADING_PAIRS.includes(symbol)) bot.settings.ignoreShortSignals[symbol] = false;
                    break;
                default:
                    throw new Error(`未知的操作类型: ${action}`);
            }
            
            res.json({ success: true });
        } catch (error) {
            console.error('更新状态失败:', error);
            res.status(400).json({ error: error.message });
        }
    });

    app.listen(port, () => {
        console.log(`Web控制面板已启动: http://localhost:${port}`);
    });
}

module.exports = { startWebServer };
