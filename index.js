import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import express from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';
import crypto from 'crypto';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { parseIntent } from './nlp.js';
import { handleNLPCommand } from './handlers/commandHandler.js';
import { resolveTokenMint } from './utils/tokens.js';
import { 
    connectToDatabase, 
    saveWalletConnection, 
    saveRouteHistory, 
    saveTriggerHistory, 
    savePaymentHistory, 
    savePriceCheckHistory, 
    saveNotificationHistory, 
    getHistory, 
    updateLastActivity,
    closeDatabase 
} from './utils/database.js';
// const qr = require('qr-image');
import qr from "qr-image"

let e_key;
const app = express();
const dappKeyPair = nacl.box.keyPair();
const dappPublicKey = bs58.encode(dappKeyPair.publicKey); // used in connect URL
dotenv.config();
const port = process.env.PORT;
const token = process.env.TELEGRAM_BOT_TOKEN;
const server_url = process.env.SERVER_URL;
const userWalletMap = new Map(); // chat_id → walletAddress
const userSessionMap = new Map(); // chat_id → sessionId
const bot = new TelegramBot(token, { polling: true });
app.use(express.json());
const userPhantomPubkeyMap = new Map(); // chat_id → Phantom's public key
const notifyWatchers = {}; // To track active notify sessions per chat
const LAMPORTS_PER_SOL = 1_000_000_000;
bot.on('polling_error', console.error);

// Connect to database on startup
connectToDatabase().catch(console.error);

async function toLamports({ sol = null, usd = null } = {}) {
    if (sol !== null) {
        return Math.round(sol * LAMPORTS_PER_SOL);
    }

    if (usd !== null) {
        try {
            const res = await axios.get('https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112');
            console.log(res.data)
            const solPrice = res.data.data["So11111111111111111111111111111111111111112"].price;
            return Math.round((usd / solPrice) * LAMPORTS_PER_SOL);
        } catch (e) {
            console.error("Error fetching SOL price:", e.message);
            throw new Error("❌ Failed to convert USD to lamports.");
        }
    }

    throw new Error("❌ Must provide either SOL or USD for conversion.");
}
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Hey ${msg.from.first_name}! 👋 I'm your bot.`);
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `🤖 *Jupiter Daddy Bot Help*

*Traditional Commands:*
/start - Start the bot
/connect - Connect your wallet
/about - Check your balance
/price <token> - Get token price
/tokens - List available tokens
/route <input> <output> <amount> - Get swap route
/trigger <input> <output> <amount> <price> - Create limit order
/receivepayment <amount> - Generate payment request
/payto <wallet> <amount> - Pay to specific wallet
/notify <token> <above/below> <price> - Set price alerts
/history [type] - Show your activity history

*Natural Language Commands (Auto-Execute):*
• "connect my wallet" → Executes /connect
• "what's my balance?" → Executes /about
• "get price of SOL" → Executes /price SOL
• "get route for 1 SOL to USDC" → Executes /route SOL USDC 1
• "trigger 1 SOL to USDC at $50" → Executes /trigger SOL USDC 1 50
• "receive payment of 10 USDC" → Executes /receivepayment 10000000
• "pay 5 USDC to [wallet]" → Executes /payto [wallet] 5000000
• "notify me when SOL goes above $100" → Executes /notify SOL above 100

*Examples (All Auto-Execute):*
• "I want to connect my wallet"
• "Show me the price of Bitcoin"
• "Get me a route for 2 SOL to USDC"
• "Create a trigger order for 1 SOL to USDC at $45"
• "I need to receive 20 USDC"
• "Alert me when JUP goes below $0.5"

*Token Names Supported:*
• SOL, USDC, USDT, WBTC, WETH
• JUP (Jupiter), BONK, SRM (Serum)
• And many more! Just type the token name

*History Types:*
• /history - All activities
• /history route - Route queries
• /history trigger - Trigger orders
• /history payment - Payment history
• /history price - Price checks
• /history notification - Notifications

🚀 *Just type what you want - the bot will automatically execute the commands!*`;
    
    bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});
//Phantom Deeplink
bot.onText(/\/connect/, async (msg) => {
    const chatId = msg.chat.id;
    const { generateConnectLink } = await import('./commands/connect.js');
    const phantomLink = generateConnectLink(chatId, server_url, dappPublicKey);
    bot.sendMessage(chatId, `Click to connect your wallet: [Connect Wallet](${phantomLink})`, {
        parse_mode: 'Markdown'
    });
});
bot.onText(/\/receivepayment (\d+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const username = msg.from.username || null;
  const merchantWallet = userWalletMap.get(chatId);
  const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);
  const amount = Number(match[1]); // in micro USDC (e.g. 1 USDC = 1_000_000)

  if (!merchantWallet || !phantomEncryptionPubKey) {
    return bot.sendMessage(chatId, "❌ Please connect wallet first using /connect.");
  }

  try {
    const merchantPublicKey = new PublicKey(merchantWallet);
    const merchantUSDCATA = await getAssociatedTokenAddress(
      USDC_MINT,
      merchantPublicKey,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=50&swapMode=ExactOut`;
    const quote = await (await fetch(quoteUrl)).json();

   const swapRes = await (await fetch(`https://lite-api.jup.ag/swap/v1/swap`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: merchantWallet,
    destinationTokenAccount: merchantUSDCATA.toBase58()
  })
})).json();

console.log(swapRes); // 👈 Do this to inspect structure!

    const payload = {
      transaction: swapRes.swapTransaction,
      session: "payment" // optional
    };

    const { encryptPayload } = await import('./commands/connect.js');
    const { nonce, payload: encryptedPayload } = encryptPayload(payload, phantomEncryptionPubKey, dappKeyPair);

    const redirect = `${server_url}/phantom/ultra-execute?chat_id=${chatId}&order_id=${swapRes.requestId}`;
    const phantomParams = new URLSearchParams({
      dapp_encryption_public_key: dappPublicKey,
      nonce,
      redirect_link: encodeURIComponent(redirect),
      payload: encryptedPayload
    });

    const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;
    console.log(phantomLink)
    const qrData = qr.imageSync(phantomLink, { type: 'png' });

    // Save payment history
    await savePaymentHistory(chatId, amount, 'receive', null, username);

    await bot.sendPhoto(chatId, qrData, {
      caption: `🧾 Payment request: Pay ${amount / 1e6} USDC\n[Click here to pay with SOL](${phantomLink})`,
      parse_mode: "Markdown"
    });

  } catch (err) {
    console.error("/receivepayment error:", err);
    bot.sendMessage(chatId, "❌ Failed to generate payment link.");
  }
});

bot.onText(/\/payto (\w{32,44}) (\d+)/, async (msg, match) => {
  const chatId = String(msg.chat.id);
  const username = msg.from.username || null;
  const payerWallet = userWalletMap.get(chatId);
  const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);
  const merchantWallet = match[1];
  const amount = Number(match[2]); // in micro USDC

  if (!payerWallet || !phantomEncryptionPubKey) {
    return bot.sendMessage(chatId, "❌ Connect your wallet first using /connect.");
  }

  try {
    const merchantPublicKey = new PublicKey(merchantWallet);
    const merchantUSDCATA = await getAssociatedTokenAddress(
      USDC_MINT,
      merchantPublicKey,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const quoteUrl = `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${USDC_MINT}&amount=${amount}&slippageBps=50&swapMode=ExactOut`;
    const quote = await (await fetch(quoteUrl)).json();

    const swapRes = await (await fetch(`https://lite-api.jup.ag/swap/v1/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: payerWallet,
        destinationTokenAccount: merchantUSDCATA.toBase58()
      })
    })).json();

    const payload = {
      transaction: swapRes.swapTransaction,
      session: "payment"
    };

    const { encryptPayload } = await import('./commands/connect.js');
    const { nonce, payload: encryptedPayload } = encryptPayload(payload, phantomEncryptionPubKey, dappKeyPair);
    const redirect = `${server_url}/phantom/ultra-execute?chat_id=${chatId}&order_id=${swapRes.requestId}`;

    const phantomParams = new URLSearchParams({
      dapp_encryption_public_key: dappPublicKey,
      nonce,
      redirect_link: encodeURIComponent(redirect),
      payload: encryptedPayload
    });

    const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;

    // Save payment history
    await savePaymentHistory(chatId, amount, 'send', merchantWallet, username);

    await bot.sendMessage(chatId, `💸 [Click here to pay ${amount / 1e6} USDC to merchant](${phantomLink})`, {
      parse_mode: "Markdown"
    });

  } catch (err) {
    console.error("/payto error:", err);
    bot.sendMessage(chatId, "❌ Failed to generate payment transaction.");
  }
});

//ULTRA API balance
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
//PRICE API
bot.onText(/\/price (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || null;
    const mintAddress = match[1].trim();
    const resolvedMint = resolveTokenMint(mintAddress);
    
    try {
        const tokenRes = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${resolvedMint}`);
        const tokenInfo = await tokenRes.json();
        const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${resolvedMint}`);
        const priceJson = await priceRes.json();

        const priceData = priceJson.data[resolvedMint];
        const price = parseFloat(priceData?.price ?? "0");

        if (!price) {
            return bot.sendMessage(chatId, "❌ Could not retrieve a valid price.");
        }

        const msgText = `💰 *${tokenInfo.name}* (${tokenInfo.symbol})\n\n📈 Price: $${price.toFixed(6)}`;

        // Save price check history
        await savePriceCheckHistory(chatId, mintAddress, price, username);

        await bot.sendPhoto(chatId, tokenInfo.logoURI, {
            caption: msgText,
            parse_mode: "Markdown"
        });

    } catch (err) {
        console.error("Error fetching price/token info:", err.message);
        bot.sendMessage(chatId, "⚠️ Failed to fetch data. Double-check the mint address.");
    }
});
//TOKEN API
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
//TRIGGER API
bot.onText(/\/trigger (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const username = msg.from.username || null;
    const wallet = userWalletMap.get(chatId);
    const session = userSessionMap.get(chatId);

    if (!wallet || !session) {
        return bot.sendMessage(chatId, "❌ You haven't connected your wallet yet. Use /connect first.");
    }

    const args = match[1].trim().split(" ");

    if (args[0] === 'orders') {
        const res = await axios.get(`https://lite-api.jup.ag/trigger/v1/getTriggerOrders?user=${wallet}&orderStatus=active`);
        if (!res.data.length) return bot.sendMessage(chatId, "📭 No active orders.");
        const orders = res.data.map(o => `• 🆔 ${o.order} (${o.params.makingAmount} → ${o.params.takingAmount})`);
        return bot.sendMessage(chatId, `📋 *Active Orders*\n\n${orders.join('\n')}`, { parse_mode: "Markdown" });
    }

    if (args[0] === 'orderhistory') {
        const res = await axios.get(`https://lite-api.jup.ag/trigger/v1/getTriggerOrders?user=${wallet}&orderStatus=history`);
        if (!res.data.length) return bot.sendMessage(chatId, "📭 No order history found.");
        const orders = res.data.map(o => `• 🆔 ${o.order} (${o.params.makingAmount} → ${o.params.takingAmount})`);
        return bot.sendMessage(chatId, `📜 *Order History*\n\n${orders.join('\n')}`, { parse_mode: "Markdown" });
    }

    if (args[0] === 'cancelorder') {
        const res = await axios.get(`https://lite-api.jup.ag/trigger/v1/getTriggerOrders?user=${wallet}&orderStatus=active`);
        const orders = res.data;
        if (!orders.length) return bot.sendMessage(chatId, "📭 No active orders to cancel.");

        const keyboard = orders.map(o => [{
            text: `Cancel ${o.params.makingAmount} → ${o.params.takingAmount}`,
            callback_data: `cancel_${o.order}`
        }]);

        return bot.sendMessage(chatId, `🗑️ *Choose an order to cancel:*`, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    // Default fallback to actual order trigger
    if (args.length !== 4) {
        return bot.sendMessage(chatId, `⚠️ Usage:\n/trigger <inputMint> <outputMint> <amount> <targetPrice>\n/trigger orders\n/trigger orderhistory\n/trigger cancelorder`);
    }

    const [inputMintName, outputMintName, amountStr, targetPriceStr] = args;
    const inputMint = resolveTokenMint(inputMintName);
    const outputMint = resolveTokenMint(outputMintName);
    console.log(inputMint,outputMint)
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
                makingAmount:(await toLamports({ sol: amount })).toString(),
                takingAmount: (await toLamports({ usd: amount * targetPrice })).toString()
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

        // Save trigger history
        await saveTriggerHistory(chatId, inputMint, outputMint, amount, targetPrice, orderId, username);

        // 2. Generate Phantom signing link
        const redirectLink = `${server_url}/phantom/execute?chat_id=${chatId}&order_id=${orderId}`;
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
//ULTRA API 
bot.onText(/\/route (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const username = msg.from.username || null;
    const wallet = userWalletMap.get(chatId);
    const session = userSessionMap.get(chatId);
    const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);

    const input = match[1]?.trim()?.split(" ");
    if (!wallet || !session || !phantomEncryptionPubKey) {
        return bot.sendMessage(chatId, "❌ You must connect your wallet first. Use /connect.");
    }

    if (!input || input.length !== 3) {
        return bot.sendMessage(chatId, "❌ Usage:\n/route <inputMint> <outputMint> <amountInLamports>");
    }

    const [inputMint, outputMint, amount] = input;

    const fetchOrder = async (includeWallet = true) => {
        const base = `https://lite-api.jup.ag/ultra/v1/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}`;
        const url = includeWallet ? `${base}&taker=${wallet}` : base;
        const res = await fetch(url);
        return res.json();
    };

    let data = await fetchOrder(true);
    let retried = false;
    if (data.error || !data.transaction) {
        data = await fetchOrder(false);
        retried = true;
    }

    if (data.error || !data.routePlan) {
        return bot.sendMessage(chatId, `❌ Could not fetch route.\nReason: ${data.error || 'Unknown error'}`);
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
        transaction,
    } = data;

    let routeDetails = `
🔀 *Route ${retried ? "Preview (No Wallet)" : "Details"}*
Swap Type: *${swapType?.toUpperCase() || 'Unknown'}*
Gasless: *${gasless ? "Yes" : "No"}*
💸 Slippage: ${slippageBps / 100}%
📉 Price Impact: ${priceImpactPct}%
🆔 Request ID: \`${requestId?.slice(0, 8)}...\`
${retried ? "⚠️ *Insufficient balance. Preview only.*" : ""}
`;

    routePlan.forEach((route, idx) => {
        const s = route.swapInfo;
        const pct = route.percent || 100;
        const fee = Number(s.feeAmount || 0) / 1e9;
        routeDetails += `
\n🔁 *Route ${idx + 1} (${pct}% via ${s.label})*
• 🧩 AMM: \`${s.ammKey.slice(0, 8)}...\`
• 📥 In: ${Number(s.inAmount) / 1e9} ${s.inputMint.slice(0, 4)}...
• 📤 Out: ${Number(s.outAmount) / 1e6} ${s.outputMint.slice(0, 4)}...
• 💰 Fee: ${fee} ${s.feeMint.slice(0, 4)}...`;
    });

    // Save route history
    await saveRouteHistory(chatId, inputMint, outputMint, amount, routeDetails, username);

    if (retried || !transaction) {
        return bot.sendMessage(chatId, routeDetails, { parse_mode: "Markdown" });
    }

    try {
        // Encrypt transaction with Phantom pubkey
        const nonce = nacl.randomBytes(24);
        const nonceB58 = bs58.encode(nonce);

        const sharedSecret = nacl.box.before(
            bs58.decode(phantomEncryptionPubKey),
            dappKeyPair.secretKey
        );

        const payloadJson = JSON.stringify({
            transaction: transaction, // base64 encoded from Ultra
            session: session
        });

        const encryptedPayload = nacl.box.after(Buffer.from(payloadJson), nonce, sharedSecret);
        const encryptedPayloadB58 = bs58.encode(encryptedPayload);

        const redirectLink = `${server_url}/phantom/ultra-execute?chat_id=${chatId}&order_id=${requestId}`;

        const phantomParams = new URLSearchParams({
            dapp_encryption_public_key: dappPublicKey,
            nonce: nonceB58,
            redirect_link: encodeURIComponent(redirectLink),
            payload: encryptedPayloadB58
        });

        const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;

        routeDetails += `\n\n✅ [Sign and Execute Transaction](${phantomLink})`;

        await bot.sendMessage(chatId, routeDetails, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Encryption/signing error:", err);
        bot.sendMessage(chatId, "❌ Failed to prepare transaction for Phantom.");
    }
});

//custom to send notifications based on price conditions
bot.onText(/\/notify (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || null;
    const input = match[1].trim().split(" ");

    if (input.length !== 3) {
        return bot.sendMessage(chatId, "❌ Usage: /notify <token_name> <above|below> <target_price>");
    }

    const [tokenName, condition, targetStr] = input;
    const targetPrice = parseFloat(targetStr);
    const resolvedMint = resolveTokenMint(tokenName);

    if (!resolvedMint) {
        return bot.sendMessage(chatId, "❌ Invalid token. Please check the token name or symbol.");
    }

    if (isNaN(targetPrice) || !(condition === "above" || condition === "below")) {
        return bot.sendMessage(chatId, "⚠️ Invalid input. Use:\n/notify <token_name> <above|below> <price>");
    }

    try {
        const tokenRes = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${resolvedMint}`);
        const tokenInfo = await tokenRes.json();

        const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${resolvedMint}`);
        const priceJson = await priceRes.json();
        const currentPrice = parseFloat(priceJson.data[resolvedMint]?.price ?? "0");

        if (!currentPrice) {
            return bot.sendMessage(chatId, "❌ Couldn't fetch valid token price.");
        }

        // Save notification history
        await saveNotificationHistory(chatId, resolvedMint, condition, targetPrice, username);

        await bot.sendMessage(chatId,
            `📊 *${tokenInfo.name}* (${tokenInfo.symbol})\n` +
            `💵 Current Price: $${currentPrice.toFixed(6)}\n\n` +
            `🔔 Monitoring for price *${condition}* $${targetPrice}`,
            { parse_mode: "Markdown" }
        );

        if (!notifyWatchers[chatId]) notifyWatchers[chatId] = [];

        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`https://lite-api.jup.ag/price/v2?ids=${resolvedMint}`);
                const json = await res.json();
                const priceNow = parseFloat(json.data[resolvedMint]?.price ?? "0");

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
        bot.sendMessage(chatId, "⚠️ Failed to fetch token info. Please check the token name.");
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        if (data.startsWith('token_')) {
            const mint = data.replace('token_', '');

            const [tokenResponse, priceResponse] = await Promise.all([
                axios.get(`https://lite-api.jup.ag/tokens/v1/token/${mint}`),
                axios.get(`https://lite-api.jup.ag/price/v2?ids=${mint}`)
            ]);

            const token = tokenResponse.data;
            const price = priceResponse.data[mint]?.price ?? 0;

            const caption = `💠 *${token.name} (${token.symbol})*\n\n💵 *Price*: $${price.toFixed(4)}\n📦 Volume (24h): $${Math.floor(token.daily_volume).toLocaleString()}`;

            return bot.sendPhoto(chatId, token.logoURI, {
                caption,
                parse_mode: 'Markdown'
            });
        }

        if (data.startsWith('cancel_')) {
            const orderId = data.replace('cancel_', '');
            const wallet = userWalletMap.get(chatId);
            const session = userSessionMap.get(chatId);
            const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);

            if (!wallet || !session || !phantomEncryptionPubKey) {
                return bot.sendMessage(chatId, "❌ Missing wallet/session. Use /connect again.");
            }

            const cancelPayload = {
                maker: wallet,
                order: orderId,
                computeUnitPrice: "auto"
            };

            const cancelRes = await axios.post("https://lite-api.jup.ag/trigger/v1/cancelOrder", cancelPayload, {
                headers: { 'Content-Type': 'application/json' }
            });

            const txBase58 = cancelRes.data?.transaction;
            if (!txBase58) {
                return bot.sendMessage(chatId, "❌ Failed to get cancellation transaction.");
            }

            const nonce = nacl.randomBytes(24);
            const nonceB58 = bs58.encode(nonce);
            const sharedSecret = nacl.box.before(
                bs58.decode(phantomEncryptionPubKey),
                dappKeyPair.secretKey
            );

            const payloadJson = JSON.stringify({
                transaction: txBase58,
                session: session
            });

            const encryptedPayload = nacl.box.after(Buffer.from(payloadJson), nonce, sharedSecret);
            const encryptedPayloadB58 = bs58.encode(encryptedPayload);

            const redirectLink = `${server_url}/phantom/execute?chat_id=${chatId}&order_id=${orderId}`;
            const phantomParams = new URLSearchParams({
                dapp_encryption_public_key: dappPublicKey,
                nonce: nonceB58,
                redirect_link: encodeURIComponent(redirectLink),
                payload: encryptedPayloadB58
            });

            const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;

            return bot.sendMessage(chatId, `⚠️ *Sign to Cancel Order*\n🆔 Order ID: \`${orderId}\`\n\n[Sign Cancel Transaction](${phantomLink})`, {
                parse_mode: "Markdown"
            });
        }

        return bot.sendMessage(chatId, "⚠️ Unknown action.");
    } catch (err) {
        console.error("Callback Query Error:", err?.response?.data || err.message);
        return bot.sendMessage(chatId, "❌ Something went wrong while processing your request.");
    }
});

//NLP intent parsing and message handling
bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const rawText = msg.text;
    if (!rawText || rawText.startsWith('/')) return;

    const text = rawText.toLowerCase().trim();

    // Ignore regular commands like /start
    if (text.startsWith('/')) return;

    try {
        const intent = await parseIntent(text);
        
        // Use the new command handler for all NLP-based commands
        await handleNLPCommand(bot, msg, intent, userWalletMap, userSessionMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair, toLamports, notifyWatchers);
    } catch (err) {
        console.error('NLP parse failed:', err);
        bot.sendMessage(chatId, "⚠️ NLP parsing failed. Try again.");
    }
});

app.get('/', (req, res) => {
    res.send('Telegram Bot is running!');
});
// Phantom callback endpoint to handle wallet connection
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

        // Save wallet connection to database
        await saveWalletConnection(
            chat_id, 
            wallet, 
            null, // username will be set when user sends a message
            sessionId, 
            phantom_encryption_public_key
        );

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

// Phantom execute endpoint to handle signed transaction execution for TRIGGER API
app.get("/phantom/execute", async (req, res) => {
    const { nonce, data, chat_id, order_id } = req.query;
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
// Phantom Ultra execute endpoint to handle signed transaction execution for ULTRA API
app.get("/phantom/ultra-execute", async (req, res) => {
    const { nonce, data, chat_id, order_id } = req.query;
    if (!nonce || !data || !chat_id || !order_id) {
        return res.status(400).send("❌ Missing params.");
    }
    if (!e_key) return res.status(400).send("❌ Missing Phantom key.");

    try {
        const sharedSecret = nacl.box.before(
            bs58.decode(e_key),
            dappKeyPair.secretKey
        );

        const decrypted = nacl.box.open.after(
            bs58.decode(data),
            bs58.decode(nonce),
            sharedSecret
        );

        const json = JSON.parse(Buffer.from(decrypted).toString());
        const signedTxBase58 = json.transaction;
        // const signedTxBase64 = bs58.decode(signedTxBase58).toString("base64");
const signedTxBase64 = Buffer.from(bs58.decode(signedTxBase58)).toString("base64");

        const execRes = await axios.post("https://lite-api.jup.ag/ultra/v1/execute", {
            signedTransaction: signedTxBase64,
            requestId: order_id
        });

        const { signature, status } = execRes.data;

        bot.sendMessage(chat_id, `✅ Swap Executed!\n🔗 [Solscan](https://solscan.io/tx/${signature})\nStatus: *${status}*`, {
            parse_mode: "Markdown"
        });

        res.send(`
        <html>
            <body>
                <h2>✅ Swap Executed</h2>
                <p>Signature: ${signature}</p>
                <a href="tg://resolve?domain=jupidaddy_bot">🔙 Back to Telegram</a>
            </body>
        </html>
        `);
    } catch (err) {
        console.error("Ultra exec error:", err?.response?.data || err.message);
        res.status(500).send("❌ Failed to execute transaction.");
    }
});

// History command
bot.onText(/\/history(.*)/, async (msg, match) => {
    const chatId = String(msg.chat.id);
    const username = msg.from.username || null;
    const type = match[1].trim() || 'all';
    
    try {
        const history = await getHistory(chatId, type, 10);
        
        if (history.length === 0) {
            return bot.sendMessage(chatId, `📭 No ${type === 'all' ? '' : type + ' '}history found.`);
        }

        let historyText = `🔢 *Your ${type === 'all' ? 'Recent Activity' : type + ' History'}*\n\n`;
        
        history.forEach((item, index) => {
            const date = new Date(item.timestamp).toLocaleString();
            const typeIcon = {
                'route': '🔀',
                'trigger': '⚡',
                'payment': '💸',
                'price': '💰',
                'notification': '🔔'
            }[item.type] || '📝';

            switch (item.type) {
                case 'route':
                    historyText += `${typeIcon} *Route Query* (${date})\n`;
                    historyText += `   ${item.inputMint?.slice(0, 4)}... → ${item.outputMint?.slice(0, 4)}...\n`;
                    historyText += `   Amount: ${item.amount}\n\n`;
                    break;
                    
                case 'trigger':
                    historyText += `${typeIcon} *Trigger Order* (${date})\n`;
                    historyText += `   ${item.inputMint?.slice(0, 4)}... → ${item.outputMint?.slice(0, 4)}...\n`;
                    historyText += `   Amount: ${item.amount} | Target: $${item.targetPrice}\n`;
                    historyText += `   Status: ${item.status} | Order: ${item.orderId?.slice(0, 8)}...\n\n`;
                    break;
                    
                case 'payment':
                    historyText += `${typeIcon} *Payment* (${date})\n`;
                    historyText += `   Type: ${item.type === 'receive' ? 'Received' : 'Sent'}\n`;
                    historyText += `   Amount: ${item.amount / 1e6} USDC\n`;
                    if (item.walletAddress) {
                        historyText += `   Wallet: ${item.walletAddress.slice(0, 8)}...\n`;
                    }
                    historyText += '\n';
                    break;
                    
                case 'price':
                    historyText += `${typeIcon} *Price Check* (${date})\n`;
                    historyText += `   Token: ${item.token?.slice(0, 4)}...\n`;
                    historyText += `   Price: $${item.price}\n\n`;
                    break;
                    
                case 'notification':
                    historyText += `${typeIcon} *Notification* (${date})\n`;
                    historyText += `   Token: ${item.token?.slice(0, 4)}...\n`;
                    historyText += `   Condition: ${item.condition} $${item.targetPrice}\n`;
                    historyText += `   Status: ${item.status}\n\n`;
                    break;
                    
                default:
                    historyText += `${typeIcon} *Activity* (${date})\n\n`;
            }
        });

        bot.sendMessage(chatId, historyText, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('History command error:', error);
        bot.sendMessage(chatId, '❌ Failed to fetch history. Please try again.');
    }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await closeDatabase();
    process.exit(0);
});

