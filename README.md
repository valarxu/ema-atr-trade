# EMA-ATR 加密货币自动化交易系统

这是一个基于EMA（指数移动平均线）和ATR（平均真实波幅）指标的加密货币自动化交易系统。该系统通过OKX交易所的API接口，实现了以下功能：

- 自动监控多个交易对（BTC-USDT、ETH-USDT、SOL-USDT）
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
- 支持多交易对同时监控
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
npm start
# 或
yarn start
```

系统启动后将：
- 每4小时自动获取K线数据并计算指标
- 根据策略自动执行开平仓操作
- 通过Telegram发送交易信号和持仓状态通知
- 在 `logs` 目录下记录详细的交易日志

## 配置说明

在 `okx-instrumentInfo_const.js` 中，你可以修改以下参数：
- 交易对配置（BTC/ETH/SOL-USDT）
- 合约面值
- 最小交易单位
- 单次开仓金额（POSITION_USDT）

在 `index.js` 中，你可以修改：
- 监控的交易对列表
- 定时任务执行时间
- 技术指标参数

## 风险提示

本项目仅供学习和研究使用。加密货币交易具有高风险，请在使用本系统时：
- 仔细阅读并理解交易策略
- 使用适量资金进行测试
- 密切关注系统运行状态
- 及时处理异常情况

## 许可证

MIT 