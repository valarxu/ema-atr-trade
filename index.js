const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { startWebServer } = require('./services/web-server');
const StrategyBot = require('./services/StrategyBot');
const { TRADING_PAIRS } = require('./utils/constants.js');
const { sendToTelegram } = require('./services/telegram');

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
                    const initSuccess = await bot.initialize();
                    
                    // 无论初始化是否成功（API可能暂时错误/密钥错误），我们都将机器人加入管理器
                    // 这样Web端依然可以登录并修改配置
                    this.bots.set(bot.id, bot);
                    
                    if (initSuccess) {
                        console.log(`✅ 机器人 ${bot.name} 初始化成功`);
                    } else {
                        console.error(`⚠️ 机器人 ${bot.name} 初始化失败 (API验证失败或网络错误)`);
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

        // 按交易对遍历，而不是按用户遍历
        // 这样可以确保每个交易对的行情只获取一次（由MarketService缓存控制），然后分发给所有用户
        // 但为了逻辑清晰，我们还是按用户遍历，依赖MarketService的缓存机制
        
        for (const bot of this.bots.values()) {
            console.log(`\n--- 执行用户: ${bot.name} ---`);
            
            // 关键修正：每次执行策略前，先同步最新的持仓状态
            // 这确保了如果用户手动操作了仓位，或者程序重启，状态能保持一致
            try {
                await bot.initialize();
            } catch (initError) {
                console.error(`[${bot.name}] 同步持仓失败，跳过本次执行: ${initError.message}`);
                continue;
            }

            let report = `<b>📊 ${bot.name} 监控报告</b> (${executionTime})\n\n`;
            let hasError = false;

            for (const symbol of TRADING_PAIRS) {
                try {
                    const result = await bot.processSymbol(symbol);
                    
                    const coinMessage = `<b>🔸 ${symbol.replace('-USDT', '')} (${result.currentClose.toFixed(2)})</b>\n` +
                        `偏离: ${result.priceDistance.toFixed(2)} | 持仓: ${result.positionState === 0 ? '无' : result.positionState === 1 ? '多🟢' : '空🔴'}\n` +
                        `${result.tradeAction !== '无' ? '🔔 信号: ' + result.tradeAction : ''}\n`;
                    
                    report += coinMessage;
                } catch (error) {
                    console.error(`[${bot.name}] 处理${symbol}失败: ${error.message}`);
                    report += `❌ ${symbol}: ${error.message}\n`;
                    hasError = true;
                }
            }

            // 发送报告
            console.log(report.replace(/<[^>]+>/g, '')); // 打印无HTML标签的日志
            await bot.notify(report);
            
            if (hasError) await bot.notify(`⚠️ 检测到执行错误，请检查日志`);
        }
        console.log(`=== 任务执行结束 ===\n`);
    },

    // 检查持仓并报告
    async checkAndReportPositions() {
        const executionTime = new Date().toLocaleString();
        console.log(`\n=== 检查持仓状态 [${executionTime}] ===`);

        for (const bot of this.bots.values()) {
            try {
                // 重新同步持仓
                await bot.initialize();
                
                let msg = `<b>📈 持仓日报</b> (${executionTime})\n\n`;
                let totalProfit = 0;
                let hasPosition = false;

                // 由于bot.initialize已经获取了最新持仓并更新了state，这里直接再次获取详情有点冗余
                // 但为了获取准确的upl(未实现盈亏)，还是调一次API比较稳妥，或者在initialize里存下来
                // 简单起见，这里直接调API获取
                const positions = await bot.client.getPositions();
                
                for (const p of positions) {
                    if (p.pos !== '0') {
                        hasPosition = true;
                        const profit = parseFloat(p.upl);
                        totalProfit += profit;
                        msg += `<b>🔹 ${p.instId.replace('-USDT-SWAP', '')}</b> | ${p.posSide==='long'?'多🟢':'空🔴'} | 盈亏: ${profit.toFixed(2)}\n`;
                    }
                }

                if (!hasPosition) msg += "当前无持仓\n";
                else msg += `\n<b>💰 总盈亏: ${totalProfit > 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT</b>`;

                await bot.notify(msg);

            } catch (error) {
                console.error(`[${bot.name}] 持仓检查失败: ${error.message}`);
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

    // 3. 立即执行一次
    await botManager.executeAllStrategies();

    // 4. 设置定时任务
    // 策略执行: 4小时一次
    cron.schedule('15 0 0,4,8,12,16,20 * * *', () => {
        botManager.executeAllStrategies();
    }, { timezone: "Asia/Shanghai" });

    // 持仓报告: 每天多次
    cron.schedule('0 59 3,7,11,15,19,23 * * *', () => {
        botManager.checkAndReportPositions();
    }, { timezone: "Asia/Shanghai" });

    console.log('系统启动完成，定时任务已就绪');
}

startup();
