const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { startWebServer } = require('./services/web-server');
const StrategyBot = require('./services/StrategyBot');
const { setupTelegramBot } = require('./services/telegram');
const { TRADING_PAIRS } = require('./utils/constants.js');

function normalizeSymbol(input) {
    if (!input) return null;
    const raw = input.trim().toUpperCase();
    if (TRADING_PAIRS.includes(raw)) return raw;
    if (TRADING_PAIRS.includes(`${raw}-USDT`)) return `${raw}-USDT`;
    return null;
}

function getPrimaryBot(botManager) {
    const bots = botManager.getAllBots();
    return bots.length > 0 ? bots[0] : null;
}

function createTelegramCommandHandler(botManager) {
    return (text) => {
        const bot = getPrimaryBot(botManager);
        if (!bot) {
            return '❌ 当前没有可控制的机器人实例';
        }

        const input = (text || '').trim();
        if (!input) {
            return '❌ 命令为空，发送 /帮助 查看用法';
        }

        const [cmd, ...args] = input.split(/\s+/);

        if (cmd === '/帮助' || cmd.toLowerCase() === '/help') {
            return [
                '<b>🧭 控制命令</b>',
                '/状态 [交易对] (含金额)',
                '/模式 交易对 双向|只做多',
                '/空头 交易对 正常|临时忽略',
                '/启用 交易对 开|关',
                '/恢复空头 [交易对|ALL]'
            ].join('\n');
        }

        if (cmd === '/状态') {
            const symbol = normalizeSymbol(args[0]);
            if (args[0] && !symbol) {
                return `❌ 交易对无效: ${args[0]}`;
            }
            const targets = symbol ? [symbol] : TRADING_PAIRS;
            const lines = targets.map((pair) => {
                const enabled = bot.settings.tradingEnabled[pair] ? '开' : '关';
                const mode = bot.settings.tradeMode[pair] === 'long_only' ? '只做多' : '双向';
                const shortState = bot.settings.shortSignalState[pair] === 'ignored_temporarily' ? '临时忽略' : '正常';
                const baseAmount = Number(bot.baseAmounts[`${pair}-SWAP`] || 0);
                const pairMultiplier = Number(bot.settings.pairMultipliers[pair] || 1);
                const openAmount = baseAmount * pairMultiplier;
                const displayBase = baseAmount >= 100 ? baseAmount.toFixed(0) : baseAmount.toFixed(2);
                const displayOpen = openAmount >= 100 ? openAmount.toFixed(0) : openAmount.toFixed(2);
                return `${pair}: 交易=${enabled} | 模式=${mode} | 空头信号=${shortState} | 金额=${displayBase}U×${pairMultiplier.toFixed(2)}=${displayOpen}U`;
            });
            return `<b>📌 当前参数</b>\n${lines.join('\n')}`;
        }

        if (cmd === '/模式') {
            const symbol = normalizeSymbol(args[0]);
            if (!symbol) return '❌ 用法: /模式 交易对 双向|只做多';
            const modeRaw = args[1];
            const modeMap = {
                both: 'both',
                '双向': 'both',
                long_only: 'long_only',
                '只做多': 'long_only'
            };
            const mode = modeMap[modeRaw];
            if (!mode) return '❌ 模式仅支持: 双向 或 只做多';
            bot.settings.tradeMode[symbol] = mode;
            return `✅ ${symbol} 交易模式已更新为: ${mode === 'long_only' ? '只做多' : '双向'}`;
        }

        if (cmd === '/空头') {
            const symbol = normalizeSymbol(args[0]);
            if (!symbol) return '❌ 用法: /空头 交易对 正常|临时忽略';
            const stateRaw = args[1];
            const stateMap = {
                normal: 'normal',
                '正常': 'normal',
                ignored_temporarily: 'ignored_temporarily',
                ignored: 'ignored_temporarily',
                '忽略': 'ignored_temporarily',
                '临时忽略': 'ignored_temporarily'
            };
            const state = stateMap[stateRaw];
            if (!state) return '❌ 空头状态仅支持: 正常 或 临时忽略';
            bot.settings.shortSignalState[symbol] = state;
            return `✅ ${symbol} 空头信号状态已更新为: ${state === 'normal' ? '正常' : '临时忽略'}`;
        }

        if (cmd === '/启用') {
            const symbol = normalizeSymbol(args[0]);
            if (!symbol) return '❌ 用法: /启用 交易对 开|关';
            const statusRaw = args[1];
            const onWords = ['开', 'on', 'true', '1'];
            const offWords = ['关', 'off', 'false', '0'];
            let status = null;
            if (onWords.includes((statusRaw || '').toLowerCase()) || onWords.includes(statusRaw)) status = true;
            if (offWords.includes((statusRaw || '').toLowerCase()) || offWords.includes(statusRaw)) status = false;
            if (typeof status !== 'boolean') return '❌ 启用状态仅支持: 开 或 关';
            bot.settings.tradingEnabled[symbol] = status;
            return `✅ ${symbol} 交易已${status ? '开启' : '关闭'}`;
        }

        if (cmd === '/恢复空头') {
            if (!args[0] || args[0].toUpperCase() === 'ALL') {
                for (const pair of TRADING_PAIRS) {
                    bot.settings.shortSignalState[pair] = 'normal';
                }
                return '✅ 已恢复全部交易对的空头信号状态为正常';
            }
            const symbol = normalizeSymbol(args[0]);
            if (!symbol) return '❌ 用法: /恢复空头 [交易对|ALL]';
            bot.settings.shortSignalState[symbol] = 'normal';
            return `✅ ${symbol} 空头信号状态已恢复为正常`;
        }

        return '❌ 未知命令，发送 /帮助 查看用法';
    };
}

// 机器人管理器
const botManager = {
    bots: new Map(),

    // 加载配置并初始化机器人
    async initialize() {
        try {
            const configPath = path.join(__dirname, 'config/users.json');
            if (!fs.existsSync(configPath)) {
                throw new Error('配置文件 config/users.json 不存在');
            }

            const users = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            console.log(`加载了 ${users.length} 个用户配置`);

            for (const userConfig of users) {
                if (!userConfig.enabled) {
                    console.log(`用户 ${userConfig.name} (${userConfig.id}) 未启用，跳过`);
                    continue;
                }

                try {
                    const bot = new StrategyBot(userConfig);
                    const check = await bot.runStartupSelfCheck();
                    const initSuccess = await bot.initialize();
                    
                    // 无论初始化是否成功（API可能暂时错误/密钥错误），我们都将机器人加入管理器
                    // 这样Web端依然可以登录并修改配置
                    this.bots.set(bot.id, bot);
                    
                    if (initSuccess && check.ok) {
                        console.log(`✅ 机器人 ${bot.name} 初始化成功`);
                    } else {
                        console.error(`⚠️ 机器人 ${bot.name} 初始化异常`);
                        if (!check.ok) {
                            console.error(`⚠️ ${bot.name} 启动自检: ${check.summary}`);
                        }
                        console.log(`⚠️ ${bot.name} 将处于离线状态，但您仍可通过Web控制台修改其配置。`);
                    }
                } catch (e) {
                    console.error(`❌ 创建机器人 ${userConfig.name} 失败: ${e.message}`);
                }
            }
        } catch (error) {
            console.error('初始化机器人管理器失败:', error);
            process.exit(1);
        }
    },

    getAllBots() {
        return Array.from(this.bots.values());
    },

    getBotById(id) {
        return this.bots.get(id);
    },
    
    // 执行所有机器人的策略
    async executeAllStrategies() {
        const executionTime = new Date().toLocaleString();
        console.log(`\n=== 开始执行策略任务 [${executionTime}] ===`);
        
        for (const bot of this.bots.values()) {
            console.log(`\n--- 执行用户: ${bot.name} ---`);
            try {
                await bot.initialize();
            } catch (initError) {
                console.error(`[${bot.name}] 同步持仓失败，跳过本次执行: ${initError.message}`);
                continue;
            }

            let monitorSection = `<b>📊 监控报告</b> (${executionTime})\n\n`;
            let hasError = false;

            for (const symbol of TRADING_PAIRS) {
                try {
                    const result = await bot.processSymbol(symbol);
                    const coinMessage = `<b>🔸 ${symbol.replace('-USDT', '')} (${result.currentClose.toFixed(2)}) | 偏离: ${result.priceDistance.toFixed(2)}</b>\n` +
                        `模式: ${result.tradeMode === 'long_only' ? '只做多' : '双向'} | 空头信号: ${result.shortSignalState === 'ignored_temporarily' ? '临时忽略' : '正常'}\n` +
                        `操作: ${result.tradeAction || '无'}\n`;
                    
                    monitorSection += coinMessage;
                } catch (error) {
                    console.error(`[${bot.name}] 处理${symbol}失败: ${error.message}`);
                    monitorSection += `❌ ${symbol}: ${error.message}\n`;
                    hasError = true;
                }
            }

            await bot.initialize();
            const positionSection = bot.buildPositionReport();
            const fullReport = `${monitorSection}\n${positionSection}`;
            
            console.log(fullReport.replace(/<[^>]+>/g, ''));
            await bot.notify(fullReport);
            
            if (hasError) await bot.notify(`⚠️ 检测到执行错误，请检查日志`);
        }
        console.log(`=== 任务执行结束 ===\n`);
    },

    async syncPositions(sendReport = false, title = '持仓同步') {
        const executionTime = new Date().toLocaleString();
        console.log(`\n=== ${title} [${executionTime}] ===`);

        for (const bot of this.bots.values()) {
            try {
                const initSuccess = await bot.initialize();
                if (sendReport) {
                    if (!initSuccess) {
                        await bot.runStartupSelfCheck();
                    }
                    const msg = initSuccess
                        ? `<b>📌 启动持仓快照</b> (${executionTime})\n\n${bot.buildPositionReport()}`
                        : `<b>📌 启动持仓快照</b> (${executionTime})\n\n❌ 持仓同步失败（API/网络/权限异常），本次快照不可用`;
                    await bot.notify(msg);
                }
            } catch (error) {
                console.error(`[${bot.name}] 持仓同步失败: ${error.message}`);
            }
        }
    }
};

// 主程序启动
async function startup() {
    console.log('正在启动多用户交易系统...');
    
    // 1. 初始化所有机器人
    await botManager.initialize();

    if (botManager.getAllBots().length === 0) {
        console.error('⚠️ 没有加载到任何用户配置。请检查 config/users.json。');
        // 不再直接退出，允许启动Web服务以便用户排查
    }

    // 2. 启动Web服务器
    startWebServer(3020, botManager);

    // 3. 启动Telegram命令控制
    setupTelegramBot(createTelegramCommandHandler(botManager));

    // 4. 启动时仅同步持仓并发送一次持仓快照，不执行交易
    await botManager.syncPositions(true, '启动持仓同步');

    // 5. 设置定时任务
    // 策略执行: 4小时一次
    cron.schedule('15 0 0,4,8,12,16,20 * * *', () => {
        botManager.executeAllStrategies();
    }, { timezone: "Asia/Shanghai" });

    // 59分只做持仓同步，不发送消息
    cron.schedule('0 59 3,7,11,15,19,23 * * *', () => {
        botManager.syncPositions(false, '定时持仓同步');
    }, { timezone: "Asia/Shanghai" });

    console.log('系统启动完成，定时任务已就绪');
}

startup();
