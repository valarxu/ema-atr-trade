# EMA-ATR 交易数据分析工具

这是一个基于EMA（指数移动平均线）和ATR（平均真实波幅）指标的加密货币交易数据分析工具。该工具通过OKX交易所的API获取BTC-USDT的K线数据，并计算以下技术指标：

- EMA120（120周期指数移动平均线）
- ATR14（14周期平均真实波幅）

## 功能特点

- 实时获取OKX交易所的K线数据
- 计算EMA120指标
- 计算ATR14指标
- 自动输出关键数据，包括最新收盘价、EMA值和ATR值

## 安装要求

- Node.js >= 14.0.0
- npm 或 yarn

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

## 使用方法

运行程序：
```bash
npm start
# 或
yarn start
```

程序将输出以下信息：
- 最新收盘价
- EMA120 值
- ATR14 值
- ATR14×1.5 值

## 配置说明

在 `index.js` 中，你可以修改以下参数：
- 交易对（默认：BTC-USDT）
- K线周期（默认：4小时）
- 数据点数量（默认：121个）

## 许可证

MIT 