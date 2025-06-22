// commands/balance.js
import axios from 'axios';

export async function getWalletBalance(wallet) {
    try {
        const response = await axios.get(`https://lite-api.jup.ag/ultra/v1/balances/${wallet}`);
        const data = response.data;

        if (data.error) {
            throw new Error(data.error);
        }

        const sol = data.SOL?.uiAmount ?? 0;
        const isFrozen = data.SOL?.isFrozen ? "Yes" : "No";

        return {
            success: true,
            balance: sol,
            frozen: isFrozen
        };
    } catch (error) {
        console.error("Error fetching balance:", error);
        return {
            success: false,
            error: "Failed to fetch balance. Please try again later."
        };
    }
} 