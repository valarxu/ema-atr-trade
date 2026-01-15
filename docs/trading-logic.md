# 交易逻辑说明

本文档详细说明当前系统的开仓、平仓与加仓规则，以及相关指标与特殊模式。所有规则均以 4H 周期数据为基础，核心指标为 EMA120 与 ATR60。

## 指标与基础计算
- EMA120：以历史收盘价计算的 120 周期指数移动平均
- ATR60：以历史高低收盘价计算的 60 周期平均真实波幅
- 价格偏离度 priceDistance：以 ATR 为单位表示价格与 EMA 的距离  
  计算公式：priceDistance = (previousClose - EMA120) / ATR60  
  位置参考：[index.js:117-121](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L117-L121)
- 关键参数：
  - atrMultiplier = 1.5（触发开仓的最小偏离倍数）
  - shortTakeProfitAtrMultiplier = 5.0（做空的止盈偏离倍数）

## 开仓规则
- 开多
  - 条件：previousClose > EMA120 且 priceDistance > atrMultiplier  
    位置参考：[index.js:151-157](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L151-L157)
  - 动作：以设定金额下多仓；记录开仓价并重置加仓标记
- 开空
  - 条件：previousClose < EMA120 且 priceDistance < -atrMultiplier  
  - 额外限制：未开启“只做多”模式，且不处于“忽略做空信号”状态  
    位置参考：[index.js:158-164](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L158-L164)
  - 动作：以设定金额下空仓

## 加仓规则（仅多头）
- 触发条件：持有多仓，最新价 currentClose > longEntryPrice + 5 × ATR60，且尚未加过仓  
  位置参考：[index.js:166-174](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L166-L174)
- 加仓规模：该品种设定仓位金额的一半
- 状态维护：首次加仓后标记 longAddedHalfOnce 为已加，平仓后重置

## 平仓规则
- 平多（趋势反转）
  - 条件：previousClose < EMA120  
  - 动作：市价平多；写入统一摘要日志（包含开仓价、平仓价、数量、盈亏、原因）  
    位置参考：[index.js:166-174](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L166-L174)
- 平空（原始趋势反转）
  - 条件：previousClose > EMA120  
  - 动作：市价平空；写入统一摘要日志  
    位置参考：[index.js:242-260](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L242-L260)
- 平空（做空止盈）
  - 条件：priceDistance < -shortTakeProfitAtrMultiplier  
  - 动作：市价平空；写入统一摘要日志  
    位置参考：[index.js:214-232](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L214-L232)

## 平仓后的复评估
- 在平仓后，会立即重新抓取最新 K 线，再次评估是否满足开仓条件并执行（例如平空后价格上穿 EMA 满足开多）  
  位置参考：  
  - 平多后评估开空：[index.js:174-189](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L174-L189)  
  - 平空后评估开多（两种场景）：[index.js:252-261](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L252-L261), [index.js:306-311](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L306-L311)

## 特殊模式与信号
- 只做多模式（longOnly）
  - 作用：阻断所有新的开空路径；若当前持有空仓，将立即平空并复评估是否开多  
    位置参考：[index.js:239-261](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L239-L261)
- 忽略做空信号（ignoreShortSignals）
  - 作用：临时忽略做空的触发；当价格重新回到 EMA 上方时自动重置  
    位置参考：[index.js:144-148](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L144-L148)

## 日志与报告
- 逐币种交易日志：logs/trades_<symbol>_YYYY_MM.txt（每次开平/加仓都会记录）  
  开多/开空/平多/平空位置参考：  
  - 开多：[index.js:174](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L174)  
  - 开空：[index.js:180](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L180)  
  - 平多：[index.js:188](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L188)  
  - 平空（多场景）：[index.js:239](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L239), [index.js:277](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L277), [index.js:319](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L319)
- 统一摘要日志：logs/trades_summary_YYYY_MM.txt（平仓时写入统一格式摘要，含开仓价、平仓价、数量、盈亏、原因）  
  摘要写入位置参考：  
  - 平多摘要：[index.js:166-174](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L166-L174)  
  - 平空摘要（只做多强制平空/做空止盈/EMA反转）：[index.js:195-209](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L195-L209), [index.js:214-232](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L214-L232), [index.js:242-260](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L242-L260)

## 备注
- 所有下单均使用逐仓模式、市场价执行，张数按设定的 USDT 金额与合约面值自动计算
- 报告中使用 priceDistance 与当前持仓状态，辅助监控与操作确认  
  报告构建位置参考：[index.js:300-303](file:///d:/my_programs/Trade/ema-atr-trade/index.js#L300-L303)
