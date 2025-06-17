import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Replace with your real token
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

// Create bot (polling means it will keep checking for new messages)
const bot = new TelegramBot(token, { polling: true });

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `Hey ${msg.from.first_name}! 👋 I’m your bot.`);
});

// Handle /help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/help - Show help');
});

// Echo any text message
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Avoid echoing commands like /start
  if (!text.startsWith('/')) {
    bot.sendMessage(chatId, `You said: ${text}`);
  }
});
