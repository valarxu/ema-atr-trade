const express = require('express');
const path = require('path');
const crypto = require('crypto');
const marketService = require('./MarketService');

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
            req.isGlobalAdmin = true;
            // 如果请求中指定了 userId，且存在该用户，则以该用户视角操作
            const targetUserId = req.query.userId || (req.body && req.body.userId);
            if (targetUserId) {
                const targetBot = bots.find(b => b.id === targetUserId);
                req.currentUser = targetBot || bots[0];
            } else {
                req.currentUser = bots[0]; 
            }
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

    // API: 获取所有用户列表 (仅限管理员)
    app.get('/api/users', authMiddleware, (req, res) => {
        if (!req.isGlobalAdmin) {
            return res.status(403).json({ error: '权限不足' });
        }
        const bots = botManager.getAllBots();
        const list = bots.map(b => ({
            id: b.id,
            name: b.name,
            username: b.username
        }));
        res.json(list);
    });

    // API: 获取交易历史
    app.get('/api/history', authMiddleware, (req, res) => {
        const { getTradeHistory } = require('../utils/logger');
        const history = getTradeHistory();
        
        // 过滤当前用户的历史
        // 如果是管理员且指定了userId，则过滤该用户的
        // 如果是管理员且没指定，显示所有？或者显示当前选中的？
        // 这里的逻辑跟 status 保持一致，req.currentUser 已经是目标用户了
        
        // 但是 req.currentUser 在管理员模式下，如果没有指定 userId，默认是第一个用户。
        // 这可能导致管理员看不到所有人的历史。
        // 让我们稍微调整一下：
        // 如果是管理员，且 query 中没有 userId，则返回所有历史？或者前端传 userId。
        // 前端 app.js 在 fetchState 时会传 userId。
        // 让我们约定：前端也会传 userId 给 history 接口。
        
        let targetUser = req.currentUser;
        
        // 过滤
        const userHistory = history.filter(h => h.user === targetUser.name).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json(userHistory);
    });

    app.post('/api/history/update', authMiddleware, (req, res) => {
        try {
            const { updateTradeHistoryRecord } = require('../utils/logger');
            const bot = req.currentUser;
            if (!bot) return res.status(404).json({ success: false, error: '用户未关联机器人' });

            const payload = req.body || {};
            const id = String(payload.id || '').trim();
            const symbol = String(payload.symbol || '').trim().toUpperCase();
            const side = String(payload.side || '').trim();
            const reason = String(payload.reason || '').trim();
            const entryPrice = Number(payload.entryPrice);
            const exitPrice = Number(payload.exitPrice);
            const quantity = Number(payload.quantity);
            const pnl = Number(payload.pnl);

            if (!id) return res.status(400).json({ success: false, error: '缺少记录ID' });
            if (!symbol) return res.status(400).json({ success: false, error: '交易对不能为空' });
            if (side !== '多' && side !== '空') return res.status(400).json({ success: false, error: '方向仅支持多或空' });
            if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || !Number.isFinite(quantity) || !Number.isFinite(pnl)) {
                return res.status(400).json({ success: false, error: '价格、数量、盈亏必须是数字' });
            }
            if (quantity <= 0) return res.status(400).json({ success: false, error: '数量必须大于0(单位:张)' });

            const updated = updateTradeHistoryRecord({
                id,
                user: bot.name,
                symbol,
                side,
                entryPrice,
                exitPrice,
                quantity,
                pnl,
                reason
            });
            res.json({ success: true, record: updated });
        } catch (error) {
            console.error('更新交易记录失败:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

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
                positionDetails: bot.positionDetails || {},
                tradeMode: bot.settings.tradeMode,
                shortSignalState: bot.settings.shortSignalState,
                baseAmounts: bot.baseAmounts,
                pairMultipliers: bot.settings.pairMultipliers,
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
                case 'setPairMultiplier':
                    if (TRADING_PAIRS.includes(symbol) && value > 0) bot.settings.pairMultipliers[symbol] = value;
                    break;
                case 'enableAll':
                    for (const p of TRADING_PAIRS) bot.settings.tradingEnabled[p] = true;
                    break;
                case 'disableAll':
                    for (const p of TRADING_PAIRS) bot.settings.tradingEnabled[p] = false;
                    break;
                case 'resetAllShortSignalState':
                    for (const p of TRADING_PAIRS) bot.settings.shortSignalState[p] = 'normal';
                    break;
                case 'setPairEnabled':
                    if (TRADING_PAIRS.includes(symbol)) bot.settings.tradingEnabled[symbol] = value;
                    break;
                case 'setPairTradeMode':
                    if (TRADING_PAIRS.includes(symbol) && (value === 'both' || value === 'long_only')) {
                        bot.settings.tradeMode[symbol] = value;
                    }
                    break;
                case 'setPairShortSignalState':
                    if (TRADING_PAIRS.includes(symbol) && (value === 'normal' || value === 'ignored_temporarily')) {
                        bot.settings.shortSignalState[symbol] = value;
                    }
                    break;
                case 'setPairAmount':
                    const swapKey = `${symbol}-SWAP`;
                    if (bot.baseAmounts.hasOwnProperty(swapKey)) bot.baseAmounts[swapKey] = value;
                    break;
                case 'resetPairAmount':
                    const swapK = `${symbol}-SWAP`;
                    if (POSITION_USDT.hasOwnProperty(swapK)) bot.baseAmounts[swapK] = POSITION_USDT[swapK];
                    break;
                case 'resetPairShortSignalState':
                    if (TRADING_PAIRS.includes(symbol)) bot.settings.shortSignalState[symbol] = 'normal';
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

    app.post('/api/position/open', authMiddleware, async (req, res) => {
        try {
            const { TRADING_PAIRS } = require('../utils/constants.js');
            const bot = req.currentUser;
            if (!bot) return res.status(404).json({ success: false, error: '用户未关联机器人' });
            const symbol = String(req.body.symbol || '').trim().toUpperCase();
            if (!TRADING_PAIRS.includes(symbol)) return res.status(400).json({ success: false, error: '无效交易对' });
            if (!bot.settings.tradingEnabled[symbol]) return res.status(400).json({ success: false, error: `${symbol} 未启用交易` });
            const swapSymbol = `${symbol}-SWAP`;
            const positions = await bot.client.getPositions([swapSymbol]);
            if (positions.some(p => p.pos !== '0')) return res.status(400).json({ success: false, error: `${symbol} 已有持仓，请先平仓` });
            const marketData = await marketService.getMarketAnalysis(symbol);
            const amount = Number(bot.baseAmounts[swapSymbol] || 0) * Number(bot.settings.pairMultipliers[symbol] || 1);
            if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: `${symbol} 开仓金额无效` });
            await bot.client.placeOrder(swapSymbol, marketData.currentClose, 'long', amount);
            await bot.initialize();
            res.json({ success: true, message: `${symbol} 开仓已提交` });
        } catch (error) {
            console.error('手动开仓失败:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    app.post('/api/position/close', authMiddleware, async (req, res) => {
        try {
            const { TRADING_PAIRS } = require('../utils/constants.js');
            const bot = req.currentUser;
            if (!bot) return res.status(404).json({ success: false, error: '用户未关联机器人' });
            const symbol = String(req.body.symbol || '').trim().toUpperCase();
            if (!TRADING_PAIRS.includes(symbol)) return res.status(400).json({ success: false, error: '无效交易对' });
            if (!bot.settings.tradingEnabled[symbol]) return res.status(400).json({ success: false, error: `${symbol} 未启用交易` });
            const swapSymbol = `${symbol}-SWAP`;
            const positions = await bot.client.getPositions([swapSymbol]);
            if (!positions.some(p => p.pos !== '0')) return res.status(400).json({ success: false, error: `${symbol} 当前无持仓` });
            await bot.client.closePosition(swapSymbol, positions);
            await bot.initialize();
            res.json({ success: true, message: `${symbol} 平仓已提交` });
        } catch (error) {
            console.error('手动平仓失败:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    app.post('/api/position/open-all', authMiddleware, async (req, res) => {
        try {
            const { TRADING_PAIRS } = require('../utils/constants.js');
            const bot = req.currentUser;
            if (!bot) return res.status(404).json({ success: false, error: '用户未关联机器人' });
            const enabledSymbols = TRADING_PAIRS.filter(symbol => !!bot.settings.tradingEnabled[symbol]);
            if (enabledSymbols.length === 0) return res.status(400).json({ success: false, error: '没有已启用的交易对' });

            const opened = [];
            const skipped = [];
            for (const symbol of enabledSymbols) {
                const swapSymbol = `${symbol}-SWAP`;
                const positions = await bot.client.getPositions([swapSymbol]);
                if (positions.some(p => p.pos !== '0')) {
                    skipped.push(`${symbol}:已有持仓`);
                    continue;
                }
                const marketData = await marketService.getMarketAnalysis(symbol);
                const amount = Number(bot.baseAmounts[swapSymbol] || 0) * Number(bot.settings.pairMultipliers[symbol] || 1);
                if (!Number.isFinite(amount) || amount <= 0) {
                    skipped.push(`${symbol}:金额无效`);
                    continue;
                }
                await bot.client.placeOrder(swapSymbol, marketData.currentClose, 'long', amount);
                opened.push(symbol);
            }

            await bot.initialize();
            res.json({ success: true, message: `全开完成，成功${opened.length}个，跳过${skipped.length}个`, opened, skipped });
        } catch (error) {
            console.error('一键全开失败:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    app.post('/api/position/close-all', authMiddleware, async (req, res) => {
        try {
            const { TRADING_PAIRS } = require('../utils/constants.js');
            const bot = req.currentUser;
            if (!bot) return res.status(404).json({ success: false, error: '用户未关联机器人' });
            const enabledSymbols = TRADING_PAIRS.filter(symbol => !!bot.settings.tradingEnabled[symbol]);
            if (enabledSymbols.length === 0) return res.status(400).json({ success: false, error: '没有已启用的交易对' });

            const closed = [];
            const skipped = [];
            for (const symbol of enabledSymbols) {
                const swapSymbol = `${symbol}-SWAP`;
                const positions = await bot.client.getPositions([swapSymbol]);
                if (!positions.some(p => p.pos !== '0')) {
                    skipped.push(`${symbol}:无持仓`);
                    continue;
                }
                await bot.client.closePosition(swapSymbol, positions);
                closed.push(symbol);
            }

            await bot.initialize();
            res.json({ success: true, message: `全平完成，成功${closed.length}个，跳过${skipped.length}个`, closed, skipped });
        } catch (error) {
            console.error('一键全平失败:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    });

    app.listen(port, () => {
        console.log(`Web控制面板已启动: http://localhost:${port}`);
    });
}

module.exports = { startWebServer };
