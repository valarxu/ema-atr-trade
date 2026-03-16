const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { startWebServer } = require('./services/web-server');
const StrategyBot = require('./services/StrategyBot');
const { TRADING_PAIRS } = require('./utils/constants.js');

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
                    
                    const coinMessage = `<b>🔸 ${symbol.replace('-USDT', '')} (${result.currentClose.toFixed(2)})</b>\n` +
                        `偏离: ${result.priceDistance.toFixed(2)} | 持仓: ${result.positionState === 0 ? '无' : result.positionState === 1 ? '多🟢' : '空🔴'}\n` +
                        `允许做多: ${result.allowLong ? '是' : '否'} | 允许做空: ${result.allowShort ? '是' : '否'}\n` +
                        `${result.tradeAction !== '无' ? '🔔 信号: ' + result.tradeAction : ''}\n`;
                    
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
                    const selfCheckMsg = bot.lastSelfCheck
                        ? `\n\n自检: ${bot.lastSelfCheck.ok ? '通过' : '失败'} | ${bot.lastSelfCheck.summary}`
                        : '';
                    const msg = initSuccess
                        ? `<b>📌 启动持仓快照</b> (${executionTime})\n\n${bot.buildPositionReport()}${selfCheckMsg}`
                        : `<b>📌 启动持仓快照</b> (${executionTime})\n\n❌ 持仓同步失败（API/网络/权限异常），本次快照不可用${selfCheckMsg}`;
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

    // 3. 启动时仅同步持仓并发送一次持仓快照，不执行交易
    await botManager.syncPositions(true, '启动持仓同步');

    // 4. 设置定时任务
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
