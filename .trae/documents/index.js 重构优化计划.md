# 重构计划：优化 index.js 代码结构

## 目标

消除 `index.js` 中的重复代码，提高可维护性，保持原有业务逻辑和功能完全不变。

## 核心优化点

### 1. 提取“平仓并记录”通用函数

目前在“平多”、“平空”、“止盈”、“只做多平空”等场景下，有一大段重复代码用于：

* 获取当前持仓详情

* 执行平仓操作

* 更新本地持仓状态

* 遍历持仓并记录 `logCloseSummary`

**优化方案**：创建一个 `executeClosePosition(symbol, exitPrice, reason)` 函数来统一处理这些步骤。

### 2. 提取“重新评估并开仓”通用函数

在平仓后（如平多反手开空、平空反手开多、止盈后重新开多），代码重复进行了：

* 重新获取 K 线数据 (`fetchKlines`)

* 重新计算 EMA/ATR

* 判断开仓条件

* 下单并更新状态

**优化方案**：创建一个 `checkAndExecuteEntry(symbol, isRecheck)` 函数，将开仓判断和执行逻辑集中管理。不仅用于平仓后的反手，也可以用于主循环的开仓判断。

## 实施步骤

1. **定义 Helper 函数**：

   * `handlePositionClose(symbol, exitPrice, reason)`: 负责平仓、日志记录、状态重置。

   * `calculateIndicators(symbol)`: 负责获取 K 线、计算 EMA/ATR。

   * `attemptToOpen(symbol, marketData)`: 负责判断条件并执行开仓。

2. **重构** **`processSymbol`**：

   * 使用 `calculateIndicators` 获取当前数据。

   * 使用 `handlePositionClose` 替换所有平仓代码块。

   * 如果发生了平仓，再次调用 `calculateIndicators` 和 `attemptToOpen` 进行反手或重新开仓判断。

   * 如果没发生平仓，直接调用 `attemptToOpen`。

3. **重构** **`processTelegramCommand`**：

   * 复用上述 Helper 函数，特别是 `/只做多` 命令中的平仓和反手逻辑。

## 预期结果

* 代码行数显著减少，阅读更顺畅。

* 逻辑更清晰，修改开平仓逻辑时只需修改一处。

* 功能与原版完全一致。

