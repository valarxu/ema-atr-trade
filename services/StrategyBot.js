const OkxClient = require('./OkxClient');
const marketService = require('./MarketService');
const { logTrade, logCloseSummary } = require('../utils/logger');
const { sendToTelegram } = require('./telegram');
const { TRADING_PAIRS, POSITION_USDT } = require('../utils/constants.js');

// 常量定义
const ATR_MULTIPLIER = 1.5;
const SHORT_TAKE_PROFIT_ATR_MULTIPLIER = 5.0;

class StrategyBot {
    constructor(userConfig) {
        this.id = userConfig.id;
        this.name = userConfig.name;
        this.username = userConfig.username;
        this.password = userConfig.password;
        this.client = new OkxClient(userConfig.okx);
        
        this.tgChatId = userConfig.telegram ? userConfig.telegram.chatId : null;
        
        this.settings = userConfig.settings || {};
        this.settings.tradingEnabled = this.settings.tradingEnabled || {};
        this.settings.tradeMode = this.settings.tradeMode || {};
        this.settings.shortSignalState = this.settings.shortSignalState || {};
        this.settings.pairMultipliers = this.settings.pairMultipliers || {};

        const legacyGlobalMultiplier = this.settings.multiplier || 1.0;
        for (const symbol of TRADING_PAIRS) {
            if (this.settings.tradeMode[symbol] !== 'both' && this.settings.tradeMode[symbol] !== 'long_only') {
                this.settings.tradeMode[symbol] = 'both';
            }
            if (this.settings.shortSignalState[symbol] !== 'normal' && this.settings.shortSignalState[symbol] !== 'ignored_temporarily') {
                this.settings.shortSignalState[symbol] = 'normal';
            }
            if (!this.settings.pairMultipliers[symbol] || this.settings.pairMultipliers[symbol] <= 0) {
                this.settings.pairMultipliers[symbol] = legacyGlobalMultiplier;
            }
        }
        
        this.positionState = {};
        this.longEntryPrice = {};
        this.longAddedHalfOnce = {};
        this.positionDetails = {};
        this.baseAmounts = { ...POSITION_USDT };
        this.lastSelfCheck = null;
    }

    async runStartupSelfCheck() {
        const check = await this.client.selfCheck();
        this.lastSelfCheck = check;
        const fp = check.fingerprint
            ? `apiKey=${check.fingerprint.apiKey}, secretKey=${check.fingerprint.secretKey}, passphrase=${check.fingerprint.passphrase}`
            : '';
        if (check.ok) {
            console.log(`[${this.name}] OKX 启动自检通过: ${check.summary}`);
            if (fp) console.log(`[${this.name}] OKX 凭据指纹: ${fp}`);
        } else {
            console.error(`[${this.name}] OKX 启动自检失败: ${check.summary}`);
            if (fp) console.error(`[${this.name}] OKX 凭据指纹: ${fp}`);
        }
        return check;
    }

    async initialize() {
        try {
            console.log(`[${this.name}] 初始化持仓状态...`);

            const oldState = { ...this.positionState };
            const oldDetails = { ...this.positionDetails };

            const positions = await this.client.getPositions();
            console.log(`[${this.name}] 交易所返回持仓条数: ${positions.length}`);
            
            this.positionState = {};
            this.positionDetails = {};
            
            for (const pos of positions) {
                if (pos.pos !== '0') {
                    const symbol = pos.instId.replace(/-SWAP$/, '');
                    const posSize = parseFloat(pos.pos);
                    const posState = pos.posSide === 'long'
                        ? 1
                        : pos.posSide === 'short'
                            ? -1
                            : (posSize >= 0 ? 1 : -1);
                    this.positionState[symbol] = posState;
                    
                    this.positionDetails[symbol] = {
                        upl: parseFloat(pos.upl),
                        avgPx: parseFloat(pos.avgPx),
                        pos: posSize,
                        posSide: pos.posSide
                    };

                    this.longEntryPrice[symbol] = parseFloat(pos.avgPx);
                }
            }

            if (Object.keys(oldState).length > 0) {
                for (const symbol of Object.keys(oldState)) {
                    if (oldState[symbol] !== 0 && !this.positionState[symbol]) {
                        const detail = oldDetails[symbol];
                        if (detail) {
                            const side = oldState[symbol] === 1 ? '多' : '空';
                            const entryPrice = detail.avgPx;
                            const estimatedExitPrice = oldState[symbol] === 1 ? entryPrice * 0.9 : entryPrice * 1.1;
                            const quantity = parseFloat(detail.pos);
                            const pnl = (oldState[symbol] === 1 ? -0.1 : -0.1) * entryPrice * quantity;

                            console.log(`[${this.name}] ⚠️ 检测到仓位异常消失(可能强平): ${symbol} (${side})`);
                            
                            logCloseSummary({
                                symbol,
                                user: this.name,
                                side,
                                entryPrice,
                                exitPrice: estimatedExitPrice,
                                quantity,
                                pnl,
                                reason: '异常平仓(强平/止损)'
                            });
                        }
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

    async notify(message) {
        if (this.tgChatId) {
            const prefix = `👤 <b>${this.name}</b>\n`;
            await sendToTelegram(prefix + message, this.tgChatId);
        }
    }

    buildPositionReport() {
        let report = `<b>📈 持仓状态</b>\n`;
        let totalProfit = 0;
        let hasPosition = false;
        const details = this.positionDetails || {};

        for (const symbol of Object.keys(details)) {
            const detail = details[symbol];
            if (!detail || !detail.pos || detail.pos === 0) {
                continue;
            }
            hasPosition = true;
            const profit = Number(detail.upl || 0);
            const side = (this.positionState[symbol] || 0) === 1 ? '多🟢' : '空🔴';
            totalProfit += profit;
            report += `<b>🔹 ${symbol}</b> | ${side} | 盈亏: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}\n`;
        }

        if (!hasPosition) {
            report += '当前无持仓\n';
        } else {
            report += `\n<b>💰 总盈亏: ${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} USDT</b>\n`;
        }
        return report;
    }

    // 处理单个交易对的逻辑
    async processSymbol(symbol) {
        try {
            // 1. 获取共享的市场数据
            const marketData = await marketService.getMarketAnalysis(symbol);
            const { 
                currentClose, previousClose, historicalEMA120, historicalATR60, priceDistance, swapSymbol 
            } = marketData;

            if (!this.settings.tradingEnabled[symbol]) {
                return this._buildResult(symbol, marketData, '交易已禁用');
            }

            if (previousClose > historicalEMA120 && this.settings.shortSignalState[symbol] === 'ignored_temporarily') {
                this.settings.shortSignalState[symbol] = 'normal';
                console.log(`[${this.name}] ${symbol} 价格回EMA上方，空头信号恢复为正常`);
            }

            let tradeAction = '无';
            const posState = this.positionState[symbol] || 0;

            // 4. 策略状态机
            if (posState === 0) {
                tradeAction = await this._attemptOpenPosition(marketData, 'both');
            } 
            else if (posState === 1) {
                if (previousClose < historicalEMA120) {
                    tradeAction = await this._executeClosePosition(symbol, previousClose, '价格跌破EMA');
                    const reAction = await this._reevaluateAfterClose(symbol, 'checkShort', '平多后');
                    if (reAction) tradeAction = reAction;
                } else {
                    tradeAction = await this._checkAddPosition(marketData);
                }
            } 
            else if (posState === -1) {
                tradeAction = await this._checkCloseShort(marketData);
            }

            return this._buildResult(symbol, marketData, tradeAction);

        } catch (error) {
            console.error(`[${this.name}] 处理${symbol}出错: ${error.message}`);
            return this._buildResult(symbol, {}, `出错: ${error.message}`);
        }
    }

    _buildResult(symbol, marketData, action) {
        return {
            symbol,
            user: this.name,
            currentClose: marketData.currentClose,
            priceDistance: marketData.priceDistance,
            positionState: this.positionState[symbol] || 0,
            tradingEnabled: this.settings.tradingEnabled[symbol],
            tradeMode: this.settings.tradeMode[symbol],
            shortSignalState: this.settings.shortSignalState[symbol],
            pairMultiplier: this.settings.pairMultipliers[symbol] || 1,
            positionDetail: this.positionDetails[symbol] || null,
            tradeAction: action
        };
    }

    async _attemptOpenPosition(marketData, checkType, useCurrentPrice = false) {
        const { symbol, swapSymbol, currentClose, previousClose, historicalEMA120, historicalATR60 } = marketData;
        const priceToCheck = useCurrentPrice ? currentClose : previousClose;
        const distance = (priceToCheck - historicalEMA120) / historicalATR60;
        
        const baseAmount = this.baseAmounts[swapSymbol] || 1000;
        const amount = baseAmount * (this.settings.pairMultipliers[symbol] || 1);

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
        
        if ((checkType === 'both' || checkType === 'checkShort') && 
            this.settings.tradeMode[symbol] === 'both' &&
            this.settings.shortSignalState[symbol] === 'normal' &&
            priceToCheck < historicalEMA120 && distance < -ATR_MULTIPLIER) {
            
            await this.client.placeOrder(swapSymbol, priceToCheck, 'short', amount);
            this.positionState[symbol] = -1;
            
            const msg = `开空🔴 价格在EMA之下，距离${distance.toFixed(2)}个ATR`;
            logTrade(symbol, `[${this.name}] 开空`, priceToCheck, msg);
            return msg;
        }
        
        return null;
    }

    async _executeClosePosition(symbol, exitPrice, reason) {
        const swapSymbol = `${symbol}-SWAP`;
        
        let prePositions = [];
        try { prePositions = await this.client.getPositions([swapSymbol]); } catch(e){}

        await this.client.closePosition(swapSymbol);
        
        const prevState = this.positionState[symbol];
        this.positionState[symbol] = 0;
        this.longEntryPrice[symbol] = null;
        this.longAddedHalfOnce[symbol] = false;
        
        const actionType = prevState === 1 ? '平多🔵' : '平空🔵';
        logTrade(symbol, `[${this.name}] ${actionType}`, exitPrice, reason);

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

    async _checkAddPosition(marketData) {
        const { symbol, swapSymbol, currentClose, historicalATR60 } = marketData;
        
        if (!this.longAddedHalfOnce[symbol] && 
            this.longEntryPrice[symbol] && 
            currentClose > (this.longEntryPrice[symbol] + 5 * historicalATR60)) {
            
            const baseAmount = this.baseAmounts[swapSymbol] || 1000;
            const amount = baseAmount * (this.settings.pairMultipliers[symbol] || 1);
            
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

    async _checkCloseShort(marketData) {
        const { symbol, previousClose, historicalEMA120, priceDistance } = marketData;
        let shouldClose = false;
        let reason = '';
        let nextCheck = 'checkLong';

        if (this.settings.tradeMode[symbol] !== 'both') {
            shouldClose = true;
            reason = '当前模式不允许做空，关闭空仓';
        } else if (priceDistance < -SHORT_TAKE_PROFIT_ATR_MULTIPLIER) {
            shouldClose = true;
            reason = `做空止盈触发，偏离${priceDistance.toFixed(2)}ATR`;
            this.settings.shortSignalState[symbol] = 'ignored_temporarily';
        } else if (previousClose > historicalEMA120) {
            shouldClose = true;
            reason = '价格突破EMA';
        }

        if (shouldClose) {
            let action = await this._executeClosePosition(symbol, previousClose, reason);
            const reAction = await this._reevaluateAfterClose(symbol, nextCheck);
            if (reAction) action += ` -> ${reAction}`;
            return action;
        }
        return '无';
    }

    async _reevaluateAfterClose(symbol, nextCheckType) {
        try {
            const marketData = await marketService.getMarketAnalysis(symbol);
            return await this._attemptOpenPosition(marketData, nextCheckType, true);
        } catch (e) {
            console.error(`[${this.name}] 反手评估失败: ${e.message}`);
            return null;
        }
    }
}

module.exports = StrategyBot;
