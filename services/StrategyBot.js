const OkxClient = require('./OkxClient');
const marketService = require('./MarketService');
const { logTrade, logCloseSummary } = require('../utils/logger');
const { sendToTelegram } = require('./telegram');

// 常量定义
const ATR_MULTIPLIER = 1.5;
const SHORT_TAKE_PROFIT_ATR_MULTIPLIER = 5.0;

class StrategyBot {
    constructor(userConfig) {
        this.id = userConfig.id;
        this.name = userConfig.name;
        this.client = new OkxClient(userConfig.okx);
        
        // Telegram配置
        this.tgChatId = userConfig.telegram ? userConfig.telegram.chatId : null;
        
        // 策略状态与配置
        this.settings = userConfig.settings || {};
        this.settings.tradingEnabled = this.settings.tradingEnabled || {};
        this.settings.ignoreShortSignals = this.settings.ignoreShortSignals || {};
        this.settings.longOnly = this.settings.longOnly || {};
        this.settings.multiplier = this.settings.multiplier || 1.0;
        
        // 运行时状态
        this.positionState = {}; // { 'BTC-USDT': 1/0/-1 }
        this.longEntryPrice = {};
        this.longAddedHalfOnce = {};
        this.positionDetails = {}; // 存储详细持仓信息: { 'BTC-USDT': { upl: 0, avgPx: 0, pos: 0 } }
        
        // 默认金额配置 (从常量加载，但允许用户覆盖)
        const { POSITION_USDT } = require('../utils/constants.js');
        this.baseAmounts = { ...POSITION_USDT };
        
        // 如果用户有自定义金额配置，可以在这里覆盖(暂略，假设使用默认值*multiplier)
    }

    // 初始化：同步持仓状态
    async initialize() {
        try {
            console.log(`[${this.name}] 初始化持仓状态...`);
            const positions = await this.client.getPositions(); // 获取所有SWAP持仓
            
            // 重置状态
            this.positionState = {};
            this.positionDetails = {}; // 重置详情
            
            // 填充持仓
            for (const pos of positions) {
                if (pos.pos !== '0') {
                    const symbol = pos.instId.replace('-SWAP', '');
                    this.positionState[symbol] = pos.posSide === 'long' ? 1 : -1;
                    
                    // 存储详细信息
                    this.positionDetails[symbol] = {
                        upl: parseFloat(pos.upl),
                        avgPx: parseFloat(pos.avgPx),
                        pos: parseFloat(pos.pos)
                    };

                    // 如果是多单，尝试恢复开仓价(近似值)
                    if (pos.posSide === 'long') {
                        this.longEntryPrice[symbol] = parseFloat(pos.avgPx);
                    }
                }
            }
            console.log(`[${this.name}] 持仓状态初始化完成:`, this.positionState);
            return true;
        } catch (error) {
            console.error(`[${this.name}] 初始化失败: ${error.message}`);
            return false;
        }
    }

    // 发送消息到Telegram (使用全局bot，发送到用户特定的chatId)
    async notify(message) {
        if (this.tgChatId) {
            // 在消息前加上用户名，方便区分
            const prefix = `👤 <b>${this.name}</b>\n`;
            await sendToTelegram(prefix + message, this.tgChatId);
        }
    }

    // 处理单个交易对的逻辑
    async processSymbol(symbol) {
        try {
            // 1. 获取共享的市场数据
            const marketData = await marketService.getMarketAnalysis(symbol);
            const { 
                currentClose, previousClose, historicalEMA120, historicalATR60, priceDistance, swapSymbol 
            } = marketData;

            // 2. 检查交易开关
            if (!this.settings.tradingEnabled[symbol]) {
                return this._buildResult(symbol, marketData, '交易已禁用');
            }

            // 3. 状态维护：价格回到EMA上方重置忽略做空
            if (previousClose > historicalEMA120 && this.settings.ignoreShortSignals[symbol]) {
                this.settings.ignoreShortSignals[symbol] = false;
                console.log(`[${this.name}] ${symbol} 价格回EMA上方，重置忽略做空`);
            }

            let tradeAction = '无';
            const posState = this.positionState[symbol] || 0;

            // 4. 策略状态机
            if (posState === 0) {
                // 空仓 -> 检查开仓
                tradeAction = await this._attemptOpenPosition(marketData, 'both');
            } 
            else if (posState === 1) {
                // 持多 -> 检查平仓或加仓
                if (previousClose < historicalEMA120) {
                    tradeAction = await this._executeClosePosition(symbol, previousClose, '价格跌破EMA');
                    // 反手检查
                    const reAction = await this._reevaluateAfterClose(symbol, 'checkShort', '平多后');
                    if (reAction) tradeAction = reAction;
                } else {
                    // 检查加仓
                    tradeAction = await this._checkAddPosition(marketData);
                }
            } 
            else if (posState === -1) {
                // 持空 -> 检查平仓
                tradeAction = await this._checkCloseShort(marketData);
            }

            return this._buildResult(symbol, marketData, tradeAction);

        } catch (error) {
            console.error(`[${this.name}] 处理${symbol}出错: ${error.message}`);
            return this._buildResult(symbol, {}, `出错: ${error.message}`);
        }
    }

    // 内部方法：构建返回结果
    _buildResult(symbol, marketData, action) {
        return {
            symbol,
            user: this.name,
            currentClose: marketData.currentClose,
            priceDistance: marketData.priceDistance,
            positionState: this.positionState[symbol] || 0,
            tradingEnabled: this.settings.tradingEnabled[symbol],
            ignoreShortSignal: this.settings.ignoreShortSignals[symbol],
            longOnly: this.settings.longOnly[symbol],
            positionDetail: this.positionDetails[symbol] || null, // 传递详细持仓信息
            tradeAction: action
        };
    }

    // 内部方法：尝试开仓
    async _attemptOpenPosition(marketData, checkType, useCurrentPrice = false) {
        const { symbol, swapSymbol, currentClose, previousClose, historicalEMA120, historicalATR60 } = marketData;
        const priceToCheck = useCurrentPrice ? currentClose : previousClose;
        const distance = (priceToCheck - historicalEMA120) / historicalATR60;
        
        // 计算下单金额
        const baseAmount = this.baseAmounts[swapSymbol] || 1000;
        const amount = baseAmount * this.settings.multiplier;

        // 开多
        if ((checkType === 'both' || checkType === 'checkLong') && 
            priceToCheck > historicalEMA120 && distance > ATR_MULTIPLIER) {
            
            await this.client.placeOrder(swapSymbol, priceToCheck, 'long', amount);
            this.positionState[symbol] = 1;
            this.longEntryPrice[symbol] = priceToCheck;
            this.longAddedHalfOnce[symbol] = false;
            
            const msg = `开多🟢 价格在EMA之上，距离${distance.toFixed(2)}个ATR`;
            logTrade(symbol, `[${this.name}] 开多`, priceToCheck, msg);
            return msg;
        }
        
        // 开空
        if ((checkType === 'both' || checkType === 'checkShort') && 
            priceToCheck < historicalEMA120 && distance < -ATR_MULTIPLIER &&
            !this.settings.ignoreShortSignals[symbol] && 
            !this.settings.longOnly[symbol]) {
            
            await this.client.placeOrder(swapSymbol, priceToCheck, 'short', amount);
            this.positionState[symbol] = -1;
            
            const msg = `开空🔴 价格在EMA之下，距离${distance.toFixed(2)}个ATR`;
            logTrade(symbol, `[${this.name}] 开空`, priceToCheck, msg);
            return msg;
        }
        
        return null;
    }

    // 内部方法：执行平仓
    async _executeClosePosition(symbol, exitPrice, reason) {
        const swapSymbol = `${symbol}-SWAP`;
        
        // 获取平仓前的持仓详情用于日志
        let prePositions = [];
        try { prePositions = await this.client.getPositions([swapSymbol]); } catch(e){}

        await this.client.closePosition(swapSymbol);
        
        const prevState = this.positionState[symbol];
        this.positionState[symbol] = 0;
        this.longEntryPrice[symbol] = null;
        this.longAddedHalfOnce[symbol] = false;
        
        const actionType = prevState === 1 ? '平多🔵' : '平空🔵';
        logTrade(symbol, `[${this.name}] ${actionType}`, exitPrice, reason);

        // 详细日志
        if (prePositions.length > 0) {
            const p = prePositions[0];
            logCloseSummary({
                symbol,
                user: this.name,
                side: p.posSide === 'long' ? '多' : '空',
                entryPrice: Number(p.avgPx),
                exitPrice: exitPrice,
                pnl: Number(p.upl),
                reason
            });
        }

        return `${actionType} (${reason})`;
    }

    // 内部方法：检查加仓
    async _checkAddPosition(marketData) {
        const { symbol, swapSymbol, currentClose, historicalATR60 } = marketData;
        
        if (!this.longAddedHalfOnce[symbol] && 
            this.longEntryPrice[symbol] && 
            currentClose > (this.longEntryPrice[symbol] + 5 * historicalATR60)) {
            
            const baseAmount = this.baseAmounts[swapSymbol] || 1000;
            const amount = baseAmount * this.settings.multiplier;
            
            if (amount > 0) {
                await this.client.placeOrder(swapSymbol, currentClose, 'long', amount);
                this.longAddedHalfOnce[symbol] = true;
                const msg = `加仓🟢 价格较开仓价上升5倍ATR，追加仓位`;
                logTrade(symbol, `[${this.name}] 加仓`, currentClose, msg);
                return msg;
            }
        }
        return '无';
    }

    // 内部方法：检查空单平仓
    async _checkCloseShort(marketData) {
        const { symbol, previousClose, historicalEMA120, priceDistance } = marketData;
        let shouldClose = false;
        let reason = '';
        let nextCheck = 'checkLong';
        let logPrefix = '';

        if (this.settings.longOnly[symbol]) {
            shouldClose = true;
            reason = '只做多模式关闭空仓';
            logPrefix = '只做多平空后';
        } else if (priceDistance < -SHORT_TAKE_PROFIT_ATR_MULTIPLIER) {
            shouldClose = true;
            reason = `做空止盈触发，偏离${priceDistance.toFixed(2)}ATR`;
            this.settings.ignoreShortSignals[symbol] = true;
            logPrefix = '平空止盈后';
        } else if (previousClose > historicalEMA120) {
            shouldClose = true;
            reason = '价格突破EMA';
            logPrefix = '平空EMA后';
        }

        if (shouldClose) {
            let action = await this._executeClosePosition(symbol, previousClose, reason);
            const reAction = await this._reevaluateAfterClose(symbol, nextCheck, logPrefix);
            if (reAction) action += ` -> ${reAction}`;
            return action;
        }
        return '无';
    }

    // 内部方法：平仓后重新评估
    async _reevaluateAfterClose(symbol, nextCheckType, logReason) {
        try {
            // 重新获取最新数据(这里其实可以复用marketData，但为了获取最新的实时价格，还是建议重新获取或使用currentClose)
            // 原逻辑是平仓后立即判断是否反手
            const marketData = await marketService.getMarketAnalysis(symbol);
            return await this._attemptOpenPosition(marketData, nextCheckType, true); // true表示使用currentClose
        } catch (e) {
            console.error(`[${this.name}] 反手评估失败: ${e.message}`);
            return null;
        }
    }
}

module.exports = StrategyBot;
