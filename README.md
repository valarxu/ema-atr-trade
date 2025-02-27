# EMA-ATR 加密货币自动化交易系统

这是一个基于EMA（指数移动平均线）和ATR（平均真实波幅）指标的加密货币自动化交易系统。该系统通过OKX交易所的API接口，实现了以下功能：

- 自动监控多个交易对（BTC-USDT、ETH-USDT、SOL-USDT、ADA-USDT）
- 基于EMA和ATR指标自动开平仓
- 实时计算技术指标
- Telegram消息通知
- 交易日志记录

## 交易策略

系统使用以下技术指标和规则进行交易：

- EMA120（120周期指数移动平均线）：用于判断趋势方向
- ATR14（14周期平均真实波幅）：用于判断价格波动幅度
- 开仓条件：
  - 多仓：价格在EMA之上且距离超过1.5倍ATR
  - 空仓：价格在EMA之下且距离超过1.5倍ATR
- 平仓条件：
  - 多仓：价格跌破EMA
  - 空仓：价格突破EMA

## 功能特点

- 实时获取OKX交易所的K线数据（4小时周期）
- 自动计算技术指标（EMA120、ATR14）
- 自动执行开平仓操作
- 支持多交易对同时监控（BTC、ETH、SOL、ADA）
- 支持逐仓/全仓模式
- 支持设置杠杆倍数
- 自动记录交易日志
- Telegram实时通知交易信号和持仓状态

## 安装要求

- Node.js >= 14.0.0
- npm 或 yarn
- OKX API密钥（包含API Key、Secret Key和Passphrase）
- Telegram Bot Token（用于接收通知）

## 安装步骤

1. 克隆仓库：
```bash
git clone https://github.com/[your-username]/ema-atr-trade.git
cd ema-atr-trade
```

2. 安装依赖：
```bash
npm install
# 或
yarn install
```

3. 配置环境变量：
创建 `.env` 文件并填入以下信息：
```
OKX_API_KEY=你的OKX_API_KEY
OKX_SECRET_KEY=你的OKX_SECRET_KEY
OKX_PASSPHRASE=你的OKX_PASSPHRASE
TELEGRAM_BOT_TOKEN=你的TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=你的TELEGRAM_CHAT_ID
```

> **安全提示**：请确保 `.env` 文件已添加到 `.gitignore` 中，避免敏感信息泄露。

## 使用方法

1. 运行初始化设置（首次使用）：
```bash
# 设置持仓模式为双向持仓
node okx-set-position-mode.js
# 设置逐仓模式
node okx-set-isolated-mode.js
# 设置杠杆倍数
node okx-set-leverage.js
```

2. 启动交易系统：
```bash
node index.js
# 或使用PM2等工具保持后台运行
pm2 start index.js --name ema-atr-trade
```

系统启动后将：
- 每4小时自动获取K线数据并计算指标
- 根据策略自动执行开平仓操作
- 通过Telegram发送交易信号和持仓状态通知
- 在 `logs` 目录下记录详细的交易日志

## 配置说明

在 `okx-instrumentInfo_const.js` 中，你可以修改以下参数：
- 交易对配置（BTC/ETH/SOL/ADA-USDT）
- 合约面值
- 最小交易单位
- 单次开仓金额（POSITION_USDT）

在 `index.js` 中，你可以修改：
- 监控的交易对列表
- 定时任务执行时间
- 技术指标参数

## 安全注意事项

1. **API密钥安全**：
   - 仅授予API密钥必要的权限（交易、查询）
   - 定期更换API密钥
   - 使用IP白名单限制API访问

2. **环境变量保护**：
   - 确保 `.env` 文件不被提交到版本控制系统
   - 在生产环境使用环境变量管理工具

3. **错误处理**：
   - 系统已实现基本的错误处理机制
   - 建议添加更多的异常处理和重试机制

4. **资金安全**：
   - 建议在小资金测试后再使用大资金
   - 设置合理的仓位大小和风险控制参数

## 风险提示

本项目仅供学习和研究使用。加密货币交易具有高风险，请在使用本系统时：
- 仔细阅读并理解交易策略
- 使用适量资金进行测试
- 密切关注系统运行状态
- 及时处理异常情况

## 更新日志

### 2024-02-21
- 添加ADA-USDT交易对支持
- 优化持仓状态管理
- 改进错误处理机制

### 2024-01-30
- 初始版本发布
- 支持BTC、ETH、SOL交易对

## 许可证

MIT 