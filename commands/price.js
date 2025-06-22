// commands/price.js
import { resolveTokenMint } from '../utils/tokens.js';

export async function getTokenPrice(mintAddress) {
    try {
        const resolvedMint = resolveTokenMint(mintAddress);
        if (!resolvedMint) {
            return {
                success: false,
                error: "❌ Invalid token. Please check the token name or address."
            };
        }

        const [tokenRes, priceRes] = await Promise.all([
            fetch(`https://lite-api.jup.ag/tokens/v1/token/${resolvedMint}`),
            fetch(`https://lite-api.jup.ag/price/v2?ids=${resolvedMint}`)
        ]);

        const tokenInfo = await tokenRes.json();
        const priceJson = await priceRes.json();

        const priceData = priceJson.data[resolvedMint];
        const price = parseFloat(priceData?.price ?? "0");

        if (!price) {
            return {
                success: false,
                error: "❌ Could not retrieve a valid price."
            };
        }

        return {
            success: true,
            token: tokenInfo,
            price: price
        };
    } catch (err) {
        console.error("Error fetching price/token info:", err.message);
        return {
            success: false,
            error: "⚠️ Failed to fetch data. Double-check the mint address."
        };
    }
} 