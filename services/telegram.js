const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const globalToken = process.env.TELEGRAM_BOT_TOKEN;
const globalChatId = process.env.TELEGRAM_CHAT_ID;

const activeBots = new Map(); // token -> { bot, chatHandlers }

// 初始化Telegram机器人
function setupTelegramBot(token, chatId, cmdHandler) {
    const finalToken = token || globalToken;
    const finalChatId = chatId || globalChatId;

    if (!finalToken || !finalChatId) {
        console.error('Telegram配置缺失，无法初始化机器人');
        return;
    }

    try {
        let botInfo = activeBots.get(finalToken);

        if (!botInfo) {
            const bot = new TelegramBot(finalToken, { polling: true });
            botInfo = { bot, chatHandlers: new Map() };
            activeBots.set(finalToken, botInfo);

            // 监听消息
            bot.on('message', (msg) => {
                if (msg.from.is_bot) return;

                const senderChatId = msg.chat.id.toString();
                const handler = botInfo.chatHandlers.get(senderChatId);

                if (handler) {
                    const text = (msg.text || '').trim();
                    if (!text.startsWith('/')) {
                        return;
                    }
                    const response = handler(text);
                    if (response) {
                        botInfo.bot.sendMessage(senderChatId, response, { parse_mode: 'HTML' }).catch(err => {
                            console.error(`向 ${senderChatId} 回复消息失败:`, err.message);
                        });
                    }
                }
            });

            bot.on('polling_error', (error) => {
                console.error(`Telegram轮询错误 (Token: ***${finalToken.slice(-4)}):`, error.message);
            });

            console.log(`Telegram机器人初始化成功 (Token: ***${finalToken.slice(-4)})，正在监听命令`);
        }

        // 注册特定 chatId 的命令处理器
        botInfo.chatHandlers.set(finalChatId.toString(), cmdHandler);

        // 发送欢迎消息
        botInfo.bot.sendMessage(finalChatId, '🤖 交易机器人已启动，可接收交易控制命令\n\n发送 /帮助 查看所有可用命令', { parse_mode: 'HTML' }).catch(err => {
            console.error(`向 ${finalChatId} 发送欢迎消息失败:`, err.message);
        });
    } catch (error) {
        console.error('Telegram机器人初始化失败:', error);
    }
}

// 发送消息到Telegram
async function sendToTelegram(message, targetToken = null, targetChatId = null) {
    const finalToken = targetToken || globalToken;
    const finalChatId = targetChatId || globalChatId;

    if (!finalToken || !finalChatId) {
        console.error('Telegram配置缺失，无法发送消息');
        return false;
    }

    try {
        let botInfo = activeBots.get(finalToken);
        let bot;

        if (!botInfo) {
            bot = new TelegramBot(finalToken, { polling: false });
            activeBots.set(finalToken, { bot, chatHandlers: new Map() });
        } else {
            bot = botInfo.bot;
        }

        await bot.sendMessage(finalChatId, message, { parse_mode: 'HTML' });
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
