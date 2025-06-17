import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import express from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';

const app = express();
const dappKeyPair = nacl.box.keyPair();
const dappPublicKey = bs58.encode(dappKeyPair.publicKey); // used in connect URL
dotenv.config();
const port = process.env.PORT ;
const token = process.env.TELEGRAM_BOT_TOKEN;
const userWalletMap = new Map(); // chat_id → walletAddress

// Create bot (polling means it will keep checking for new messages)
const bot = new TelegramBot(token, { polling: true });

app.use(express.json());
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
bot.onText(/\/connect/, (msg) => {
  const chatId = msg.chat.id;
  const redirectLink = `https://5966-2405-201-301c-4114-e84a-e2bf-875a-55fe.ngrok-free.app/phantom/callback?chat_id=${chatId}`;
  const params = new URLSearchParams({
    dapp_encryption_public_key: dappPublicKey,
    app_url: 'https://phantom.app', // or your own landing page
    redirect_link: redirectLink,
    cluster: 'devnet',
  });

  const phantomLink = `https://phantom.app/ul/v1/connect?${params.toString()}`;
  bot.sendMessage(chatId, `Click to connect your wallet: [Connect Wallet](${phantomLink})`, {
    parse_mode: 'Markdown'
  });
});

bot.onText(/\/about/, async (msg) => {
  const chatId = String(msg.chat.id);

  const wallet = userWalletMap.get(chatId);
  if (!wallet) {
    return bot.sendMessage(chatId, "❌ You haven't connected your wallet yet. Use /connect first.");
  }

  try {
    const response = await axios.get(`https://lite-api.jup.ag/ultra/v1/balances/${wallet}`);
    const data = response.data;

    if (data.error) {
      return bot.sendMessage(chatId, `❌ Error: ${data.error}`);
    }

    const sol = data.SOL?.uiAmount ?? 0;
    const isFrozen = data.SOL?.isFrozen ? "Yes" : "No";

    bot.sendMessage(chatId, `💰 Your SOL Balance:\n\nBalance: ${sol} SOL\nFrozen: ${isFrozen}`);
  } catch (error) {
    console.error("Error fetching balance:", error);
    bot.sendMessage(chatId, "⚠️ Failed to fetch balance. Please try again later.");
  }
});

bot.onText(/\/price (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  console.log(match)
  const mintAddress = match[1].trim();
console.log("Mint Address:", mintAddress);
  try {
    const tokenRes = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mintAddress}`);
    const tokenInfo = await tokenRes.json();
console.log("Token Info:", tokenInfo);
    const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${mintAddress}`);
    const priceJson = await priceRes.json();
    console.log("Price Data:", priceJson);
const priceData = priceJson.data[mintAddress]; // ✅ use bracket notation

   const price = parseFloat(priceData?.price ?? "0");
// const change = parseFloat(priceData?.priceChange?.percent24h ?? "0");

console.log("Change:", price);
    if (!price ) {
      return bot.sendMessage(chatId, "❌ Could not retrieve a valid price.");
    }

    const msgText = `💰 *${tokenInfo.name}* (${tokenInfo.symbol})\n\n📈 Price: $${price.toFixed(6)}`;

    await bot.sendPhoto(chatId, tokenInfo.logoURI, {
      caption: msgText,
      parse_mode: "Markdown"
    });

  } catch (err) {
    console.error("Error fetching price/token info:", err.message);
    bot.sendMessage(chatId, "⚠️ Failed to fetch data. Double-check the mint address.");
  }
});


bot.onText(/\/tokens/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const response = await axios.get('https://lite-api.jup.ag/tokens/v1/mints/tradable');
    const tokenMints = response.data.slice(0, 5); // limit to first 5 for now

    const inlineKeyboard = tokenMints.map((mint) => [{
      text: mint.slice(0, 6) + '...', // first 6 chars
      callback_data: `token_${mint}`
    }]);

    bot.sendMessage(chatId, 'Select a token to view details:', {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, '❌ Failed to fetch token list.');
  }
});

// Handle button clicks
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const mint = query.data.replace('token_', '');

  try {
    const [tokenResponse, priceResponse] = await Promise.all([
      axios.get(`https://lite-api.jup.ag/tokens/v1/token/${mint}`),
      axios.get(`https://lite-api.jup.ag/price/v2?ids=${mint}`)
    ]);

    const token = tokenResponse.data;
    const price = priceResponse.data[mint]?.price ?? 0;

    const caption = `💠 *${token.name} (${token.symbol})*\n\n💵 *Price*: $${price.toFixed(4)}\n📦 Volume (24h): $${Math.floor(token.daily_volume).toLocaleString()}`;
    bot.sendPhoto(chatId, token.logoURI, {
      caption,
      parse_mode: 'Markdown'
    });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Failed to fetch token details.');
  }
});

// Echo any text message
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Avoid echoing commands like /start
  if (!text.startsWith('/')) {
    bot.sendMessage(chatId, `You said: ${text} , ${chatId}`);
  }
});
app.get('/', (req, res) => {
  res.send('Telegram Bot is running!');
});


app.get('/phantom/callback', async (req, res) => {
  const { phantom_encryption_public_key, nonce, data, chat_id } = req.query;

  if (!phantom_encryption_public_key || !nonce || !data || !chat_id) {
    return res.status(400).send("Missing required parameters.");
  }

  try {
    const sharedSecret = nacl.box.before(
      bs58.decode(phantom_encryption_public_key),
      dappKeyPair.secretKey
    );

    const decryptedData = nacl.box.open.after(
      bs58.decode(data),
      bs58.decode(nonce),
      sharedSecret
    );

    const json = JSON.parse(Buffer.from(decryptedData).toString());
    const wallet = json.public_key;
userWalletMap.set(String(chat_id), wallet); // Save wallet for this Telegram user

    bot.sendMessage(chat_id, `✅ Wallet connected: \n${wallet}`);

    res.send(`
      <html>
        <body>
          <h2>✅ Wallet Connected</h2>
          <p>You can go back to Telegram.</p>
          <a href="tg://resolve?domain=jupidaddy_bot">
  👉 Return to Telegram
</a>

        </body>
      </html>
    `);
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to decrypt Phantom data.");
  }
});
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});