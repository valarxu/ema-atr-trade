# 交易策略与逻辑说明

本文档详细说明当前多用户版系统的开仓、平仓与加仓规则，以及相关指标与特殊模式。所有规则均以 4H 周期数据为基础，核心指标为 EMA120 与 ATR60。

## 指标与基础计算
- **数据源**：OKX 4小时（4H）K线数据。通过 `MarketService.js` 统一抓取，避免多用户重复请求。
- **EMA120**：以历史收盘价计算的 120 周期指数移动平均（Exponential Moving Average）。
- **ATR60**：以历史高低收盘价计算的 60 周期平均真实波幅（Average True Range）。
- **价格偏离度 (priceDistance)**：以 ATR 为单位表示价格与 EMA 的距离。
  - 计算公式：`priceDistance = (previousClose - EMA120) / ATR60`
- **核心参数**（定义于 `services/StrategyBot.js`）：
  - `ATR_MULTIPLIER = 1.5`：触发开仓的最小偏离倍数。
  - `SHORT_TAKE_PROFIT_ATR_MULTIPLIER = 5.0`：做空的止盈偏离倍数。

## 开仓规则
- **开多 (Long)**
  - 条件：`previousClose > historicalEMA120` 且 `priceDistance > 1.5`
  - 动作：以设定金额（基础金额 × 乘数）下多仓；记录开仓价，并重置加仓标记（`longAddedHalfOnce = false`）。
- **开空 (Short)**
  - 条件：`previousClose < historicalEMA120` 且 `priceDistance < -1.5`
  - 额外限制：当前交易对的交易模式为 `both`（双向），且空头信号状态为 `normal`（正常）。
  - 动作：以设定金额下空仓。

## 加仓规则（仅多头）
- **触发条件**：当前持有多仓，最新价 `currentClose > longEntryPrice + 5 × ATR60`，且尚未进行过加仓（`longAddedHalfOnce === false`）。
- **加仓规模**：按该品种设定的初始开仓金额追加一次（相当于仓位翻倍）。
- **状态维护**：首次加仓后标记 `longAddedHalfOnce = true`，平仓后该标记会自动重置。

## 平仓规则
- **平多（趋势反转）**
  - 条件：`previousClose < historicalEMA120`
  - 动作：市价平掉所有多头仓位；写入统一摘要日志。
- **平空（原始趋势反转）**
  - 条件：`previousClose > historicalEMA120`
  - 动作：市价平掉所有空头仓位；写入统一摘要日志。
- **平空（做空止盈）**
  - 条件：`priceDistance < -5.0`（价格跌破EMA下方超过5个ATR）
  - 动作：市价平空，并将该交易对的空头信号状态临时设置为 `ignored_temporarily`，防止在低位反复频繁开空。
- **平空（模式切换强制平空）**
  - 条件：持有空仓但交易模式被切换为 `long_only`（只做多）。
  - 动作：关闭当前空仓。

## 平仓后的反手评估
在执行平仓动作后，系统会调用 `_reevaluateAfterClose` 方法，立即重新评估是否满足反方向的开仓条件。
例如：平多后，如果当时的价格已经满足开空条件，系统会紧接着自动开空。

## 特殊模式与信号
- **交易模式（tradeMode）**
  - `both`（双向）：允许开多和开空。
  - `long_only`（只做多）：只允许开多；若当前持有空仓，将在下一轮策略执行中触发平空。
- **空头信号状态（shortSignalState）**
  - `normal`（正常）：允许按策略触发开空。
  - `ignored_temporarily`（临时忽略）：临时忽略开空信号（通常在做空止盈后触发）。当价格重新回升到 EMA120 上方（`previousClose > historicalEMA120`）时，系统会自动将其恢复为 `normal`。

## 资金与仓位管理
- **基础开仓金额**：定义在 `utils/constants.js` 的 `POSITION_USDT` 中（例如 BTC 为 1500U，ETH 为 2000U 等）。
- **用户乘数 (pairMultiplier)**：针对多用户架构，每个用户可以配置不同的乘数（默认为 1.0）。
- **实际开仓金额**：`实际金额 = 基础开仓金额 × 乘数`。系统会根据实际金额和当前市价自动计算合约张数。

## 日志与报告
- **逐币种交易日志**：`logs/trades_<symbol>_YYYY_MM.txt`（每次开仓、平仓、加仓动作都会详细记录）。
- **统一摘要日志**：`logs/trades_summary_YYYY_MM.txt`（仅在平仓时写入统一格式的摘要，包含开仓价、平仓价、数量、盈亏、平仓原因）。
- **结构化历史数据**：`data/trades_history.json`（保存交易历史用于 Web 端的展示与统计）。
- **定时监控**：系统通过 `index.js` 中的定时任务每4小时执行一次策略，并在 Telegram 发送包含持仓状态和当前偏离度的监控报告。
