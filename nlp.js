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
- "trigger_swap"
- "get_price"
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
