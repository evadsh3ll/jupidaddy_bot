import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import express from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';
import crypto from 'crypto';
import { parseIntent } from './nlp.js';

let e_key;
const app = express();
const dappKeyPair = nacl.box.keyPair();
const dappPublicKey = bs58.encode(dappKeyPair.publicKey); // used in connect URL
dotenv.config();
const port = process.env.PORT;
const token = process.env.TELEGRAM_BOT_TOKEN;
const userWalletMap = new Map(); // chat_id → walletAddress
const userSessionMap = new Map(); // chat_id → sessionId
const bot = new TelegramBot(token, { polling: true });
app.use(express.json());
const userPhantomPubkeyMap = new Map(); // chat_id → Phantom's public key
const notifyWatchers = {}; // To track active notify sessions per chat

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Hey ${msg.from.first_name}! 👋 I'm your bot.`);
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Available commands:\n/start - Start the bot\n/help - Show help');
});

bot.onText(/\/connect/, (msg) => {
    const chatId = msg.chat.id;
    const redirectLink = `https://5966-2405-201-301c-4114-e84a-e2bf-875a-55fe.ngrok-free.app/phantom/callback?chat_id=${chatId}`;
    const params = new URLSearchParams({
        dapp_encryption_public_key: dappPublicKey,
        app_url: 'https://phantom.app',
        redirect_link: redirectLink,
        cluster: 'mainnet-beta',
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
    const mintAddress = match[1].trim();
    try {
        const tokenRes = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mintAddress}`);
        const tokenInfo = await tokenRes.json();
        const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${mintAddress}`);
        const priceJson = await priceRes.json();

        const priceData = priceJson.data[mintAddress];
        const price = parseFloat(priceData?.price ?? "0");

        if (!price) {
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
        const tokenMints = response.data.slice(0, 5);

        const inlineKeyboard = tokenMints.map((mint) => [{
            text: mint.slice(0, 6) + '...',
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

bot.onText(/\/trigger (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const wallet = userWalletMap.get(chatId);
    const session = userSessionMap.get(chatId);

    if (!wallet || !session) {
        return bot.sendMessage(chatId, "❌ You haven't connected your wallet yet. Use /connect first.");
    }

    const args = match[1].trim().split(" ");
    if (args.length !== 4) {
        return bot.sendMessage(chatId, `⚠️ Usage:\n/trigger <inputMint> <outputMint> <amount> <targetPrice>\n\nExample:\n/trigger So111... EPjF... 1 0.2`);
    }

    const [inputMint, outputMint, amountStr, targetPriceStr] = args;
    const amount = parseFloat(amountStr);
    const targetPrice = parseFloat(targetPriceStr);

    if (isNaN(amount) || isNaN(targetPrice)) {
        return bot.sendMessage(chatId, "❌ Invalid amount or price.");
    }

    try {
        // 1. Create the order
        const createPayload = {
            inputMint,
            outputMint,
            maker: wallet,
            payer: wallet,
            params: {
                makingAmount: amountStr,
                takingAmount: (amount * targetPrice).toString()
            },
            computeUnitPrice: "auto"
        };

        const createRes = await axios.post(
            "https://api.jup.ag/trigger/v1/createOrder",
            createPayload,
            { headers: { 'Content-Type': 'application/json' } }
        );

        const orderId = createRes.data?.requestId;
        const txBase58 = createRes.data?.transaction;
        // Phantom's public key (you get this in the connect step earlier)
        const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId); // <-- you MUST save this in /phantom/callback

        if (!phantomEncryptionPubKey) {
            return bot.sendMessage(chatId, "❌ Missing Phantom encryption public key. Try /connect again.");
        }

        // 1. Generate a fresh nonce
        const nonce = nacl.randomBytes(24);
        const nonceB58 = bs58.encode(nonce);

        // 2. Create shared secret using Phantom's pubkey + your private key
        const sharedSecret = nacl.box.before(
            bs58.decode(phantomEncryptionPubKey),
            dappKeyPair.secretKey
        );

        // 3. Encrypt payload
        const payloadJson = JSON.stringify({
            transaction: txBase58,
            session: session
        });
        const encryptedPayload = nacl.box.after(
            Buffer.from(payloadJson),
            nonce,
            sharedSecret
        );
        const encryptedPayloadB58 = bs58.encode(encryptedPayload);

        if (!orderId || !txBase58) {
            return bot.sendMessage(chatId, "⚠️ Failed to create order.");
        }

        // 2. Generate Phantom signing link
        const redirectLink = `https://5966-2405-201-301c-4114-e84a-e2bf-875a-55fe.ngrok-free.app/phantom/execute?chat_id=${chatId}&order_id=${orderId}`;
        const phantomParams = new URLSearchParams({
            dapp_encryption_public_key: dappPublicKey,
            nonce: nonceB58,
    redirect_link: encodeURIComponent(redirectLink), // ✅ encode this!
              payload: encryptedPayloadB58

        });

        const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;

        // 3. Ask user to sign
        await bot.sendMessage(chatId, `✅ Limit order created!\n🆔 Order ID: \`${orderId}\`\n\nPlease sign the transaction using Phantom: [Sign Transaction](${phantomLink})`, {
            parse_mode: "Markdown"
        });

    } catch (err) {
        console.error("Trigger error:", err?.response?.data || err.message);
        bot.sendMessage(chatId, "❌ Failed to create trigger.");
    }
});

bot.onText(/\/route (.+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const wallet = userWalletMap.get(chatId);
  const input = match[1]?.trim()?.split(" ");

  if (!wallet) {
    bot.sendMessage(chatId, "❌ Wallet not connected. Use /connect first.");
    return;
  }

  if (!input || input.length !== 3) {
    bot.sendMessage(chatId, "❌ Usage:\n/route <inputMint> <outputMint> <amountInLamports>");
    return;
  }
console.log("Route input:", wallet);
  const [inputMint, outputMint, amount] = input;

  try {
    const url = `https://lite-api.jup.ag/ultra/v1/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${wallet}`;
    const response = await fetch(url);
    const data = await response.json();
console.log("Route response:", data.routePlan);
console.log("Route response:", data);
    if (data.error) {
      bot.sendMessage(chatId, `❌ API Error: ${data.error}`);
      return;
    }

    const {
      swapType,
      requestId,
      inAmount,
      outAmount,
      slippageBps,
      priceImpactPct,
      routePlan,
      gasless,
    } = data;

    const route = routePlan[0]?.swapInfo;
    const routeLabel = route?.label || "Unknown";
    const percent = routePlan[0]?.percent || 100;

    const formattedMsg = `
🔀 *Route Preview*
Swap Type: *${swapType.toUpperCase()}*
DEX: *${routeLabel}* (${percent}%)
Gasless: *${gasless ? "Yes" : "No"}*

📥 In: ${Number(inAmount) / 1e9} ${route.inputMint.slice(0, 4)}...
📤 Out: ${Number(outAmount) / 1e6} ${route.outputMint.slice(0, 4)}...

💸 Slippage: ${slippageBps / 100}%  
📉 Price Impact: ${priceImpactPct}%
🆔 Request ID: \`${requestId?.slice(0, 8)}...\`
`;

    bot.sendMessage(chatId, formattedMsg, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Failed to fetch route. Check inputs or try again.");
  }
});



bot.onText(/\/notify (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim().split(" ");

    if (input.length !== 3) {
        return bot.sendMessage(chatId, "❌ Usage: /notify <mint_address> <above|below> <target_price>");
    }

    const [mintAddress, condition, targetStr] = input;
    const targetPrice = parseFloat(targetStr);

    if (isNaN(targetPrice) || !(condition === "above" || condition === "below")) {
        return bot.sendMessage(chatId, "⚠️ Invalid input. Use:\n/notify <mint_address> <above|below> <price>");
    }

    try {
        const tokenRes = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mintAddress}`);
        const tokenInfo = await tokenRes.json();

        bot.sendMessage(chatId, `🔔 Monitoring *${tokenInfo.symbol}* — will notify when price goes *${condition}* $${targetPrice}`, {
            parse_mode: "Markdown"
        });

        if (!notifyWatchers[chatId]) notifyWatchers[chatId] = [];

        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`https://lite-api.jup.ag/price/v2?ids=${mintAddress}`);
                const json = await res.json();
                const priceNow = parseFloat(json.data[mintAddress]?.price ?? "0");
console.log(`Current price for ${tokenInfo.symbol}: $${priceNow}`);
                const shouldNotify =
                    (condition === "above" && priceNow >= targetPrice) ||
                    (condition === "below" && priceNow <= targetPrice);

                if (shouldNotify) {
                    bot.sendMessage(chatId, `🎯 *${tokenInfo.symbol}* is now at $${priceNow.toFixed(4)}!\n\n💬 Do you want to *buy it*, *trigger it*, or just *get notified*?`, {
                        parse_mode: "Markdown"
                    });

                    clearInterval(intervalId);
                }
            } catch (err) {
                console.error(`Polling error: ${err.message}`);
            }
        }, 10000);

        notifyWatchers[chatId].push(intervalId);
    } catch (err) {
        console.error("Notify command error:", err.message);
        bot.sendMessage(chatId, "⚠️ Failed to fetch token info. Please check the mint address.");
    }
});
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


bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text?.toLowerCase().trim();

    // Ignore regular commands like /start
    if (text.startsWith('/')) return;

    const wallet = userWalletMap.get(chatId);

    try {
        const intent = await parseIntent(text);

        switch (intent) {
            case 'connect_wallet':
                const redirectLink = `https://5966-2405-201-301c-4114-e84a-e2bf-875a-55fe.ngrok-free.app/phantom/callback?chat_id=${chatId}`;
                const params = new URLSearchParams({
                    dapp_encryption_public_key: dappPublicKey,
                    app_url: 'https://phantom.app',
                    redirect_link: redirectLink,
                    cluster: 'mainnet-beta',
                });
                const phantomLink = `https://phantom.app/ul/v1/connect?${params.toString()}`;
                return bot.sendMessage(chatId, `Click to connect your wallet: [Connect Wallet](${phantomLink})`, {
                    parse_mode: 'Markdown'
                });

            case 'about_wallet':
                if (!wallet) return bot.sendMessage(chatId, "❌ You haven't connected your wallet yet. Use /connect first.");
                const res = await axios.get(`https://lite-api.jup.ag/ultra/v1/balances/${wallet}`);
                const sol = res.data?.SOL?.uiAmount ?? 0;
                const frozen = res.data?.SOL?.isFrozen ? 'Yes' : 'No';
                return bot.sendMessage(chatId, `💰 Your SOL Balance:\nBalance: ${sol} SOL\nFrozen: ${frozen}`);

            default:
                return bot.sendMessage(chatId, `🤔 Sorry, I didn’t understand that.\nTry saying “connect my wallet” or “what’s in my wallet?”`);
        }
    } catch (err) {
        console.error('NLP parse failed:', err);
        bot.sendMessage(chatId, "⚠️ NLP parsing failed. Try again.");
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
    e_key = phantom_encryption_public_key;

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
        console.log("Decrypted Phantom data:", json);
        const wallet = json.public_key;
        const sessionId = json.session;
        userWalletMap.set(String(chat_id), wallet);
        userSessionMap.set(String(chat_id), sessionId);
userPhantomPubkeyMap.set(String(chat_id), phantom_encryption_public_key);

        bot.sendMessage(chat_id, `✅ Wallet connected: \n${wallet}`);

        res.send(`
      <html>
        <body>
          <h2>✅ Wallet Connected</h2>
          <p>You can go back to Telegram.</p>
          <a href="tg://resolve?domain=jupidaddy_bot">👉 Return to Telegram</a>
        </body>
      </html>
    `);
    } catch (e) {
        console.error(e);
        res.status(500).send("Failed to decrypt Phantom data.");
    }
});
app.get("/phantom/execute", async (req, res) => {
    const {  nonce, data, chat_id, order_id } = req.query;
    console.log("Execute params:", req.query);
    if (!nonce || !data || !chat_id || !order_id) {
        return res.status(400).send("❌ Missing parameters.");
    }
if (!e_key) return res.status(400).send("Missing encryption key.");
console.log("Using encryption key:", e_key);
    try {
       
   const sharedSecret = nacl.box.before(
            bs58.decode(e_key),
            dappKeyPair.secretKey
        );

        const decryptedData = nacl.box.open.after(
            bs58.decode(data),
            bs58.decode(nonce),
            sharedSecret
        );

        const json = JSON.parse(Buffer.from(decryptedData).toString());
        // const signedTx = json.transaction;
        const signedTxBase58 = json.transaction;
const signedTxBuffer = bs58.decode(signedTxBase58);
const signedTxBase64 = signedTxBuffer.toString("base64");


        // ✅ Execute the signed tx with Jupiter
        const execRes = await axios.post("https://lite-api.jup.ag/trigger/v1/execute", {
            signedTransaction: signedTxBase64,
            requestId: order_id
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const { signature, status } = execRes.data;

        // Notify user in Telegram
        bot.sendMessage(chat_id, `✅ Order executed!\n\n🆔 Signature: \`${signature}\`\n📦 Status: ${status}`, {
            parse_mode: "Markdown"
        });

        res.send(`
        <html>
          <body>
            <h2>✅ Order Executed</h2>
            <p>Signature: ${signature}</p>
            <a href="tg://resolve?domain=jupidaddy_bot">👉 Return to Telegram</a>
          </body>
        </html>
        `);
    } catch (err) {
        console.error("Execution error:", err?.response || err.message);
        res.status(500).send("❌ Failed to execute order.");
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
