const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');

/**
 * 启动Web控制面板
 * @param {number} port - 端口号
 * @param {Object} botManager - 机器人管理器
 */
function startWebServer(port, botManager) {
    const app = express();
    
    // 自定义认证逻辑：从BotManager中获取所有用户的账号密码
    const getUnauthorizedResponse = (req) => {
        return req.auth
            ? ('Credentials rejected')
            : ('No credentials provided');
    };

    app.use(basicAuth({
        authorizer: (username, password) => {
            const bots = botManager.getAllBots();
            // 查找匹配的用户
            const user = bots.find(bot => bot.username === username && bot.password === password);
            if (user) {
                return true;
            }
            // 同时也支持 .env 中的全局管理员账号(如果配置了的话)
            const globalUser = process.env.WEB_USER;
            const globalPass = process.env.WEB_PASS;
            if (globalUser && globalPass && username === globalUser && password === globalPass) {
                return true;
            }
            return false;
        },
        challenge: true,
        realm: 'TradeBotControlPanel',
        unauthorizedResponse: getUnauthorizedResponse
    }));

    // 中间件：将当前登录的用户绑定到 req.currentUser
    app.use((req, res, next) => {
        const auth = req.auth;
        if (auth) {
            const bots = botManager.getAllBots();
            const userBot = bots.find(bot => bot.username === auth.user);
            if (userBot) {
                req.currentUser = userBot;
            } else {
                // 如果是全局管理员登录，可能没有对应的bot实例，或者赋予超级权限
                // 这里简单处理：如果是全局管理员，默认取第一个bot或者全部权限
                // 为了简化，我们假设全局管理员也可以管理所有，但在单用户视图下，我们默认展示第一个启用的Bot
                if (auth.user === process.env.WEB_USER) {
                    req.currentUser = bots[0]; 
                    req.isGlobalAdmin = true;
                }
            }
        }
        next();
    });

    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));

    // API: 获取当前登录用户的状态
    app.get('/api/status', async (req, res) => {
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
    app.post('/api/update', async (req, res) => {
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
