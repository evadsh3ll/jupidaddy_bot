# Jupiter Daddy Bot

A Telegram bot for Solana DeFi operations with natural language processing capabilities.

## Features

### Traditional Commands
- `/connect` - Connect Phantom wallet
- `/about` - Check SOL balance
- `/price <token>` - Get token price
- `/tokens` - List available tokens
- `/route <input> <output> <amount>` - Get swap route
- `/trigger <input> <output> <amount> <price>` - Create limit order
- `/receivepayment <amount>` - Generate payment request
- `/payto <wallet> <amount>` - Pay to specific wallet
- `/notify <token> <above/below> <price>` - Set price alerts

### Natural Language Commands (Auto-Execute)
The bot now supports natural language processing and **automatically executes commands**! You can say things like:

- "connect my wallet" → **Executes** `/connect`
- "what's my balance?" → **Executes** `/about`
- "get price of SOL" → **Executes** `/price SOL`
- "get route for 1 SOL to USDC" → **Executes** `/route SOL USDC 1`
- "trigger 1 SOL to USDC at $50" → **Executes** `/trigger SOL USDC 1 50`
- "receive payment of 10 USDC" → **Executes** `/receivepayment 10000000`
- "pay 5 USDC to [wallet]" → **Executes** `/payto [wallet] 5000000`
- "notify me when SOL goes above $100" → **Executes** `/notify SOL above 100`

## Project Structure

```
├── index.js                 # Main bot file
├── nlp.js                   # NLP processing functions
├── commands/                # Command modules
│   ├── connect.js          # Wallet connection functions
│   ├── balance.js          # Balance checking functions
│   └── price.js            # Price checking functions
├── handlers/                # Command handlers
│   └── commandHandler.js   # NLP command processor
└── utils/                   # Utility functions
    └── tokens.js           # Token resolution utilities
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables in `.env`:
```
TELEGRAM_BOT_TOKEN=your_bot_token
SERVER_URL=your_server_url
GROQ_API_KEY=your_groq_api_key
PORT=3000
```

3. Run the bot:
```bash
node index.js
```

## How It Works

1. **NLP Processing**: When a user sends a message, the bot uses Groq's LLM to determine the intent
2. **Intent Classification**: The bot classifies the intent into one of several categories (connect_wallet, get_price, etc.)
3. **Parameter Extraction**: For complex commands, the bot extracts parameters like token names, amounts, and prices
4. **Automatic Execution**: The bot automatically executes the appropriate command using the extracted parameters

## Supported Tokens

The bot supports many popular Solana tokens including:
- SOL, USDC, USDT
- WBTC, WETH
- JUP (Jupiter), BONK
- And many more!

## Examples

### Natural Language Examples (All Auto-Execute):
- "I want to connect my wallet" → **Executes** `/connect`
- "Show me the price of Bitcoin" → **Executes** `/price WBTC`
- "Get me a route for 2 SOL to USDC" → **Executes** `/route SOL USDC 2`
- "Create a trigger order for 1 SOL to USDC at $45" → **Executes** `/trigger SOL USDC 1 45`
- "I need to receive 20 USDC" → **Executes** `/receivepayment 20000000`
- "Alert me when JUP goes below $0.5" → **Executes** `/notify JUP below 0.5`

### Key Features:
- **No manual command typing**: Just describe what you want
- **Automatic parameter conversion**: "1 SOL" automatically becomes the correct lamport amount
- **Smart token recognition**: "Bitcoin" → WBTC, "Jupiter" → JUP, etc.
- **Price conversion**: "at $50" automatically becomes the target price parameter

The bot makes DeFi operations as easy as having a conversation! 🚀 