import { generateConnectLink } from '../commands/connect.js';
import { getWalletBalance } from '../commands/balance.js';
import { getTokenPrice } from '../commands/price.js';
import { resolveTokenMint } from '../utils/tokens.js';
import { 
    parsePriceIntent, 
    parseRouteIntent, 
    parseTriggerIntent, 
    parsePaymentIntent, 
    parseNotificationIntent 
} from '../nlp.js';
import { 
    savePriceCheckHistory, 
    saveRouteHistory, 
    saveTriggerHistory, 
    savePaymentHistory, 
    saveNotificationHistory,
    updateLastActivity 
} from '../utils/database.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';

export async function handleNLPCommand(bot, msg, intent, userWalletMap, userSessionMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair, toLamports, notifyWatchers) {
    const chatId = String(msg.chat.id);
    const text = msg.text;
    const username = msg.from.username || null;

    // Update last activity
    await updateLastActivity(chatId);

    try {
        switch (intent) {
            case 'connect_wallet':
                const connectLink = generateConnectLink(chatId, server_url, dappPublicKey);
                return bot.sendMessage(chatId, `Click to connect your wallet: [Connect Wallet](${connectLink})`, {
                    parse_mode: 'Markdown'
                });

            case 'about_wallet':
            case 'get_balance':
                const wallet = userWalletMap.get(chatId);
                if (!wallet) {
                    return bot.sendMessage(chatId, "❌ You haven't connected your wallet yet. Use /connect first.");
                }
                const balanceResult = await getWalletBalance(wallet);
                if (balanceResult.success) {
                    return bot.sendMessage(chatId, `💰 Your SOL Balance:\nBalance: ${balanceResult.balance} SOL\nFrozen: ${balanceResult.frozen}`);
                } else {
                    return bot.sendMessage(chatId, balanceResult.error);
                }

            case 'get_price':
                const tokenSymbol = await parsePriceIntent(text);
                if (!tokenSymbol) {
                    return bot.sendMessage(chatId, "❌ Could not identify the token. Please specify a token name or symbol.");
                }
                const priceResult = await getTokenPrice(tokenSymbol);
                if (priceResult.success) {
                    const msgText = `💰 *${priceResult.token.name}* (${priceResult.token.symbol})\n\n📈 Price: $${priceResult.price.toFixed(6)}`;
                    
                    // Save price check history
                    await savePriceCheckHistory(chatId, tokenSymbol, priceResult.price, username);
                    
                    return bot.sendPhoto(chatId, priceResult.token.logoURI, {
                        caption: msgText,
                        parse_mode: "Markdown"
                    });
                } else {
                    return bot.sendMessage(chatId, priceResult.error);
                }

            case 'get_route':
                const routeParams = await parseRouteIntent(text);
                if (!routeParams) {
                    return bot.sendMessage(chatId, "❌ Could not parse route parameters. Please specify input token, output token, and amount.");
                }
                
                // Execute the route command
                const inputMint = resolveTokenMint(routeParams.inputMint);
                const outputMint = resolveTokenMint(routeParams.outputMint);
                const amountInLamports = await toLamports({ sol: routeParams.amount });
                
                // Call the route command logic
                const routeResult = await executeRouteCommand(bot, chatId, inputMint, outputMint, amountInLamports.toString(), userWalletMap, userSessionMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair);
                
                // Save route history
                await saveRouteHistory(chatId, inputMint, outputMint, routeParams.amount, "Route query executed", username);
                
                return routeResult;

            case 'trigger_swap':
                const triggerParams = await parseTriggerIntent(text);
                if (!triggerParams) {
                    return bot.sendMessage(chatId, "❌ Could not parse trigger parameters. Please specify input token, output token, amount, and target price.");
                }
                
                // Execute the trigger command
                const triggerInputMint = resolveTokenMint(triggerParams.inputMint);
                const triggerOutputMint = resolveTokenMint(triggerParams.outputMint);
                const triggerAmount = triggerParams.amount;
                const targetPrice = triggerParams.targetPrice;
                
                // Call the trigger command logic
                const triggerResult = await executeTriggerCommand(bot, chatId, triggerInputMint, triggerOutputMint, triggerAmount, targetPrice, userWalletMap, userSessionMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair, toLamports);
                
                // Save trigger history (we'll need to extract orderId from the result)
                if (triggerResult && triggerResult.includes('Order ID:')) {
                    const orderIdMatch = triggerResult.match(/Order ID: `([^`]+)`/);
                    const orderId = orderIdMatch ? orderIdMatch[1] : null;
                    await saveTriggerHistory(chatId, triggerInputMint, triggerOutputMint, triggerAmount, targetPrice, orderId, username);
                }
                
                return triggerResult;

            case 'receive_payment':
                const paymentParams = await parsePaymentIntent(text);
                if (!paymentParams || !paymentParams.amount) {
                    return bot.sendMessage(chatId, "❌ Could not parse payment amount. Please specify an amount.");
                }
                
                // Execute the receivepayment command
                const paymentAmount = paymentParams.amount * 1000000; // Convert to micro USDC
                const receiveResult = await executeReceivePaymentCommand(bot, chatId, paymentAmount, userWalletMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair);
                
                // Save payment history
                await savePaymentHistory(chatId, paymentAmount, 'receive', null, username);
                
                return receiveResult;

            case 'pay_to':
                const payParams = await parsePaymentIntent(text);
                if (!payParams || !payParams.amount || !payParams.wallet) {
                    return bot.sendMessage(chatId, "❌ Could not parse payment parameters. Please specify amount and wallet address.");
                }
                
                // Execute the payto command
                const payAmount = payParams.amount * 1000000; // Convert to micro USDC
                const payResult = await executePayToCommand(bot, chatId, payParams.wallet, payAmount, userWalletMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair);
                
                // Save payment history
                await savePaymentHistory(chatId, payAmount, 'send', payParams.wallet, username);
                
                return payResult;

            case 'get_tokens':
                // Execute the tokens command
                return await executeTokensCommand(bot, chatId);

            case 'get_notification':
                const notificationParams = await parseNotificationIntent(text);
                if (!notificationParams) {
                    return bot.sendMessage(chatId, "❌ Could not parse notification parameters. Please specify token, condition (above/below), and price.");
                }
                
                // Execute the notify command
                const notificationToken = resolveTokenMint(notificationParams.token);
                const notifyResult = await executeNotifyCommand(bot, chatId, notificationToken, notificationParams.condition, notificationParams.price, notifyWatchers);
                
                // Save notification history
                await saveNotificationHistory(chatId, notificationToken, notificationParams.condition, notificationParams.price, username);
                
                return notifyResult;

            default:
                return bot.sendMessage(chatId, `🤔 Sorry, I didn't understand that.\n\nTry saying:\n• "connect my wallet"\n• "what's my balance?"\n• "get price of SOL"\n• "get route for 1 SOL to USDC"\n• "trigger 1 SOL to USDC at $50"`);
        }
    } catch (err) {
        console.error('NLP command handling error:', err);
        return bot.sendMessage(chatId, "⚠️ Something went wrong while processing your request. Please try again.");
    }
}

// Helper functions to execute the actual commands
async function executeRouteCommand(bot, chatId, inputMint, outputMint, amount, userWalletMap, userSessionMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair) {
    const wallet = userWalletMap.get(chatId);
    const session = userSessionMap.get(chatId);
    const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);

    if (!wallet || !session || !phantomEncryptionPubKey) {
        return bot.sendMessage(chatId, "❌ You must connect your wallet first. Use /connect.");
    }

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

    if (retried || !transaction) {
        return bot.sendMessage(chatId, routeDetails, { parse_mode: "Markdown" });
    }

    try {
        const { encryptPayload } = await import('../commands/connect.js');
        const nonce = nacl.randomBytes(24);
        const nonceB58 = bs58.encode(nonce);

        const sharedSecret = nacl.box.before(
            bs58.decode(phantomEncryptionPubKey),
            dappKeyPair.secretKey
        );

        const payloadJson = JSON.stringify({
            transaction: transaction,
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

        return await bot.sendMessage(chatId, routeDetails, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Encryption/signing error:", err);
        return bot.sendMessage(chatId, "❌ Failed to prepare transaction for Phantom.");
    }
}

async function executeTriggerCommand(bot, chatId, inputMint, outputMint, amount, targetPrice, userWalletMap, userSessionMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair, toLamports) {
    const wallet = userWalletMap.get(chatId);
    const session = userSessionMap.get(chatId);
    const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);

    if (!wallet || !session || !phantomEncryptionPubKey) {
        return bot.sendMessage(chatId, "❌ You haven't connected your wallet yet. Use /connect first.");
    }

    try {
        const createPayload = {
            inputMint,
            outputMint,
            maker: wallet,
            payer: wallet,
            params: {
                makingAmount: (await toLamports({ sol: amount })).toString(),
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

        if (!orderId || !txBase58) {
            return bot.sendMessage(chatId, "⚠️ Failed to create order.");
        }

        const { encryptPayload } = await import('../commands/connect.js');
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
        const encryptedPayload = nacl.box.after(
            Buffer.from(payloadJson),
            nonce,
            sharedSecret
        );
        const encryptedPayloadB58 = bs58.encode(encryptedPayload);

        const redirectLink = `${server_url}/phantom/execute?chat_id=${chatId}&order_id=${orderId}`;
        const phantomParams = new URLSearchParams({
            dapp_encryption_public_key: dappPublicKey,
            nonce: nonceB58,
            redirect_link: encodeURIComponent(redirectLink),
            payload: encryptedPayloadB58
        });

        const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;

        return await bot.sendMessage(chatId, `✅ Limit order created!\n🆔 Order ID: \`${orderId}\`\n\nPlease sign the transaction using Phantom: [Sign Transaction](${phantomLink})`, {
            parse_mode: "Markdown"
        });

    } catch (err) {
        console.error("Trigger error:", err?.response?.data || err.message);
        return bot.sendMessage(chatId, "❌ Failed to create trigger.");
    }
}

async function executeReceivePaymentCommand(bot, chatId, amount, userWalletMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair) {
    const merchantWallet = userWalletMap.get(chatId);
    const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);

    if (!merchantWallet || !phantomEncryptionPubKey) {
        return bot.sendMessage(chatId, "❌ Please connect wallet first using /connect.");
    }

    try {
        const { PublicKey } = await import('@solana/web3.js');
        const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
        const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

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

        const payload = {
            transaction: swapRes.swapTransaction,
            session: "payment"
        };

        const { encryptPayload } = await import('../commands/connect.js');
        const { nonce, payload: encryptedPayload } = encryptPayload(payload, phantomEncryptionPubKey, dappKeyPair);

        const redirect = `${server_url}/phantom/ultra-execute?chat_id=${chatId}&order_id=${swapRes.requestId}`;
        const phantomParams = new URLSearchParams({
            dapp_encryption_public_key: dappPublicKey,
            nonce,
            redirect_link: encodeURIComponent(redirect),
            payload: encryptedPayload
        });

        const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;
        const qr = await import('qr-image');
        const qrData = qr.imageSync(phantomLink, { type: 'png' });

        return await bot.sendPhoto(chatId, qrData, {
            caption: `🧾 Payment request: Pay ${amount / 1e6} USDC\n[Click here to pay with SOL](${phantomLink})`,
            parse_mode: "Markdown"
        });

    } catch (err) {
        console.error("/receivepayment error:", err);
        return bot.sendMessage(chatId, "❌ Failed to generate payment link.");
    }
}

async function executePayToCommand(bot, chatId, merchantWallet, amount, userWalletMap, userPhantomPubkeyMap, server_url, dappPublicKey, dappKeyPair) {
    const payerWallet = userWalletMap.get(chatId);
    const phantomEncryptionPubKey = userPhantomPubkeyMap.get(chatId);

    if (!payerWallet || !phantomEncryptionPubKey) {
        return bot.sendMessage(chatId, "❌ Connect your wallet first using /connect.");
    }

    try {
        const { PublicKey } = await import('@solana/web3.js');
        const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
        const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

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

        const { encryptPayload } = await import('../commands/connect.js');
        const { nonce, payload: encryptedPayload } = encryptPayload(payload, phantomEncryptionPubKey, dappKeyPair);
        const redirect = `${server_url}/phantom/ultra-execute?chat_id=${chatId}&order_id=${swapRes.requestId}`;

        const phantomParams = new URLSearchParams({
            dapp_encryption_public_key: dappPublicKey,
            nonce,
            redirect_link: encodeURIComponent(redirect),
            payload: encryptedPayload
        });

        const phantomLink = `https://phantom.app/ul/v1/signTransaction?${phantomParams.toString()}`;

        return await bot.sendMessage(chatId, `💸 [Click here to pay ${amount / 1e6} USDC to merchant](${phantomLink})`, {
            parse_mode: "Markdown"
        });

    } catch (err) {
        console.error("/payto error:", err);
        return bot.sendMessage(chatId, "❌ Failed to generate payment transaction.");
    }
}

async function executeTokensCommand(bot, chatId) {
    try {
        const response = await axios.get('https://lite-api.jup.ag/tokens/v1/mints/tradable');
        const tokenMints = response.data.slice(0, 5);

        const inlineKeyboard = tokenMints.map((mint) => [{
            text: mint.slice(0, 6) + '...',
            callback_data: `token_${mint}`
        }]);

        return bot.sendMessage(chatId, 'Select a token to view details:', {
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (err) {
        console.error(err);
        return bot.sendMessage(chatId, '❌ Failed to fetch token list.');
    }
}

async function executeNotifyCommand(bot, chatId, tokenMint, condition, price, notifyWatchers) {
    try {
        const tokenRes = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${tokenMint}`);
        const tokenInfo = await tokenRes.json();

        const priceRes = await fetch(`https://lite-api.jup.ag/price/v2?ids=${tokenMint}`);
        const priceJson = await priceRes.json();
        const currentPrice = parseFloat(priceJson.data[tokenMint]?.price ?? "0");

        if (!currentPrice) {
            return bot.sendMessage(chatId, "❌ Couldn't fetch valid token price.");
        }

        await bot.sendMessage(chatId,
            `📊 *${tokenInfo.name}* (${tokenInfo.symbol})\n` +
            `💵 Current Price: $${currentPrice.toFixed(6)}\n\n` +
            `🔔 Monitoring for price *${condition}* $${price}`,
            { parse_mode: "Markdown" }
        );

        // Set up the notification monitoring
        if (!notifyWatchers[chatId]) notifyWatchers[chatId] = [];

        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`https://lite-api.jup.ag/price/v2?ids=${tokenMint}`);
                const json = await res.json();
                const priceNow = parseFloat(json.data[tokenMint]?.price ?? "0");

                console.log(`Current price for ${tokenInfo.symbol}: $${priceNow}`);

                const shouldNotify =
                    (condition === "above" && priceNow >= price) ||
                    (condition === "below" && priceNow <= price);

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

        return bot.sendMessage(chatId, `✅ Notification set up successfully for ${tokenInfo.symbol} ${condition} $${price}`);

    } catch (err) {
        console.error("Notify command error:", err.message);
        return bot.sendMessage(chatId, "⚠️ Failed to fetch token info. Please check the token name.");
    }
}