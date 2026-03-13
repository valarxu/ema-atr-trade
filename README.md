# EMA-ATR 加密货币自动化交易系统 (多用户版)

这是一个基于EMA（指数移动平均线）和ATR（平均真实波幅）指标的加密货币自动化交易系统。该系统经过重构，支持**单进程多用户**模式，并提供了**可视化网页控制台**。

## 🌟 主要特性

*   **多用户支持**：单个程序实例可同时管理多个OKX账号，策略独立运行。
*   **资源优化**：共享行情数据获取，大幅降低交易所API请求频率。
*   **可视化控制台**：
    *   网页端实时查看各币种持仓、盈亏及信号状态。
    *   支持一键开关交易、切换"只做多"模式、重置信号等。
    *   支持独立设置每个用户的全局杠杆倍数和单币种开仓金额。
*   **自动化策略**：
    *   基于EMA120判断趋势，ATR14判断波动。
    *   自动开平仓、自动止盈、趋势反转自动反手。
    *   支持顺势加仓逻辑。
*   **消息通知**：通过Telegram Bot向对应用户发送实时交易信号和日报。

## 🚀 交易策略逻辑

系统对每个监控的交易对（如 BTC-USDT, ETH-USDT 等）执行以下逻辑：

1.  **数据获取**：每4小时获取一次K线数据，计算 EMA120 和 ATR14。
2.  **开仓条件**：
    *   **做多**：收盘价 > EMA120 且 (收盘价 - EMA120) > 1.5 * ATR14。
    *   **做空**：收盘价 < EMA120 且 (EMA120 - 收盘价) > 1.5 * ATR14 (且未开启"只做多"或"忽略做空")。
3.  **平仓条件**：
    *   **平多**：收盘价跌破 EMA120。
    *   **平空**：收盘价突破 EMA120 或 价格向下偏离超过 5 * ATR14 (止盈)。
4.  **加仓逻辑**：
    *   仅针对多单，当价格较开仓价上涨超过 5 * ATR14 时，追加一次同等金额仓位。
5.  **反手逻辑**：
    *   平仓后会立即使用当前最新价格重新评估是否满足反向开仓条件。

## 📂 项目结构

```
.
├── config/
│   ├── users.json          # 用户配置文件 (账号、API Key、策略开关)
│   └── users.example.json  # 配置示例
├── public/                 # 网页端前端资源
├── scripts/                # 独立的OKX工具脚本 (设置杠杆、查询等)
├── services/
│   ├── MarketService.js    # 共享行情服务 (单例)
│   ├── OkxClient.js        # OKX API 封装
│   ├── StrategyBot.js      # 策略核心逻辑 (每个用户一个实例)
│   ├── web-server.js       # 网页控制台后端
│   └── telegram.js         # TG消息推送
├── utils/
│   ├── constants.js        # 交易对及常量定义
│   └── technical-indicators.js # 指标计算
├── index.js                # 程序入口
└── .env                    # 全局环境变量
```

## 🛠️ 安装与配置

### 1. 环境准备
*   Node.js >= 14.0.0
*   OKX API Key (V5)
*   Telegram Bot Token (用于通知)

### 2. 安装依赖
```bash
git clone <repository-url>
cd ema-atr-trade
npm install
```

### 3. 全局配置 (.env)
复制 `.env` 文件并填写基础信息：
```env
# Telegram 机器人配置 (所有用户共享同一个Bot发送消息)
TELEGRAM_BOT_TOKEN=你的BotToken
TELEGRAM_CHAT_ID=默认管理员ID

# Web控制台全局管理员 (可选)
WEB_USER=admin
WEB_PASS=admin123
```

### 4. 用户配置 (config/users.json)
这是核心配置文件。复制 `config/users.example.json` 为 `config/users.json` 并编辑：

```json
[
  {
    "id": "user1",
    "name": "主账号",
    "username": "admin",      // Web登录用户名
    "password": "password123", // Web登录密码
    "enabled": true,
    "telegram": {
      "chatId": "用户1的TG_Chat_ID"
    },
    "okx": {
      "apiKey": "...",
      "secretKey": "...",
      "passphrase": "..."
    },
    "settings": {
      "multiplier": 1.0,      // 全局金额倍数
      "tradingEnabled": {     // 初始交易开关
        "BTC-USDT": false,
        "ETH-USDT": false
        // ...
      },
      "longOnly": {},         // 只做多模式
      "ignoreShortSignals": {} // 忽略做空信号
    }
  },
  {
    "id": "user2",
    "name": "第二个账号",
    ...
  }
]
```
> ⚠️ **注意**：`config/users.json` 包含敏感信息，请勿提交到 Git 仓库 (已加入 .gitignore)。

## ▶️ 启动与使用

### 启动程序
```bash
node index.js
# 或使用 PM2
pm2 start index.js --name trade-bot
```

### 访问控制台
启动成功后，浏览器访问：`http://服务器IP:3020`

*   输入 `config/users.json` 中配置的 `username` 和 `password` 登录。
*   系统会自动识别用户，只显示该用户的策略状态。
*   **功能**：
    *   **启用/禁用**：控制特定币种是否参与交易。
    *   **只做多**：开启后，该币种只会开多单，现有空单会被平仓。
    *   **忽略做空**：开启后，不执行新的做空信号（通常用于手动止盈后防止立即反手）。
    *   **修改金额**：调整基础开仓金额或全局倍数，实时生效。

## 🔧 辅助脚本
在 `scripts/` 目录下提供了一些独立的工具脚本，可单独运行：
*   `okx-set-position-mode.js`: 设置持仓模式
*   `okx-set-leverage.js`: 批量设置杠杆
*   `okx-get-positions.js`: 查看当前持仓

## ⚠️ 风险提示
本项目仅供学习研究，实盘交易请自行承担风险。建议先使用小资金或模拟盘测试。
