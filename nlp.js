// nlp.js
import Groq from "groq-sdk";
import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function parseIntent(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are an intent classifier for a crypto Telegram bot. Extract the intent of the user in a single word. Return only one of:
- "connect_wallet"
- "about_wallet"
- "get_price"
- "get_route"
- "trigger_swap"
- "get_balance"
- "receive_payment"
- "pay_to"
- "get_tokens"
- "get_notification"
- "unknown"

Only return one of the options.`
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  return completion.choices[0]?.message?.content?.trim();
}

export async function parsePriceIntent(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Extract the token name or symbol the user is asking the price for. Only return the symbol or name as plain text like "SOL", "USDC", "JUP", "bonk", etc. Do not return sentences.`
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  return completion.choices[0]?.message?.content?.trim().toUpperCase();
}

export async function parseRouteIntent(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Extract route parameters from the user's message. Return a JSON object with:
{
  "inputMint": "token symbol or name",
  "outputMint": "token symbol or name", 
  "amount": "amount as number"
}

Example: "get me route for 1 SOL to USDC" should return:
{"inputMint": "SOL", "outputMint": "USDC", "amount": 1}

Only return the JSON object, nothing else.`
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  try {
    const result = completion.choices[0]?.message?.content?.trim();
    return JSON.parse(result);
  } catch (error) {
    console.error("Error parsing route intent:", error);
    return null;
  }
}

export async function parseTriggerIntent(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Extract trigger parameters from the user's message. Return a JSON object with:
{
  "inputMint": "token symbol or name",
  "outputMint": "token symbol or name",
  "amount": "amount as number",
  "targetPrice": "target price as number"
}

Example: "trigger 1 SOL to USDC at $50" should return:
{"inputMint": "SOL", "outputMint": "USDC", "amount": 1, "targetPrice": 50}

Only return the JSON object, nothing else.`
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  try {
    const result = completion.choices[0]?.message?.content?.trim();
    return JSON.parse(result);
  } catch (error) {
    console.error("Error parsing trigger intent:", error);
    return null;
  }
}

export async function parsePaymentIntent(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Extract payment parameters from the user's message. Return a JSON object with:
{
  "amount": "amount as number",
  "wallet": "wallet address if mentioned"
}

Example: "receive payment of 10 USDC" should return:
{"amount": 10}

Example: "pay 5 USDC to ABC123..." should return:
{"amount": 5, "wallet": "ABC123..."}

Only return the JSON object, nothing else.`
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  try {
    const result = completion.choices[0]?.message?.content?.trim();
    return JSON.parse(result);
  } catch (error) {
    console.error("Error parsing payment intent:", error);
    return null;
  }
}

export async function parseNotificationIntent(text) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Extract notification parameters from the user's message. Return a JSON object with:
{
  "token": "token symbol or name",
  "condition": "above or below",
  "price": "target price as number"
}

Example: "notify me when SOL goes above $100" should return:
{"token": "SOL", "condition": "above", "price": 100}

Only return the JSON object, nothing else.`
      },
      {
        role: "user",
        content: text
      }
    ]
  });

  try {
    const result = completion.choices[0]?.message?.content?.trim();
    return JSON.parse(result);
  } catch (error) {
    console.error("Error parsing notification intent:", error);
    return null;
  }
}
