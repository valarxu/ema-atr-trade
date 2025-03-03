const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

let bot = null;
let commandHandler = null;

// 初始化Telegram机器人
function setupTelegramBot(cmdHandler) {
    if (!token || !chatId) {
        console.error('Telegram配置缺失，无法初始化机器人');
        return;
    }

    try {
        bot = new TelegramBot(token, { polling: true });
        commandHandler = cmdHandler;

        // 监听消息
        bot.on('message', (msg) => {
            // 只处理来自指定聊天的消息
            if (msg.chat.id.toString() === chatId && commandHandler) {
                const response = commandHandler(msg.text);
                bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
            }
        });

        console.log('Telegram机器人初始化成功，正在监听命令');
        sendToTelegram('🤖 交易机器人已启动，可接收交易控制命令\n\n可用命令:\n/禁用 BTC-USDT\n/启用 ETH-USDT\n/状态');
    } catch (error) {
        console.error('Telegram机器人初始化失败:', error);
    }
}

// 发送消息到Telegram
async function sendToTelegram(message) {
    if (!token || !chatId) {
        console.error('Telegram配置缺失，无法发送消息');
        return;
    }

    try {
        if (!bot) {
            bot = new TelegramBot(token, { polling: false });
        }
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        return true;
    } catch (error) {
        console.error('发送Telegram消息失败:', error);
        return false;
    }
}

module.exports = {
    sendToTelegram,
    setupTelegramBot
}; 