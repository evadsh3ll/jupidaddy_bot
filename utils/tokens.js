// utils/tokens.js
const tokens = {
    solana: "So11111111111111111111111111111111111111112",
    SOL: "So11111111111111111111111111111111111111112",
    sol: "So11111111111111111111111111111111111111112",

    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",

    wbtc: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
    WBTC: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",

    weth: "2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6WxK",
    WETH: "2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6WxK",

    jup: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    jupiter: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",

    srm: "9LhH5Ffhmb7fKaMR7dUe4Coz8KWLPiVyqJcs69Mvth1B",
    serum: "9LhH5Ffhmb7fKaMR7dUe4Coz8KWLPiVyqJcs69Mvth1B",

    ray: "4k3Dyjzvzp8eZ6N5m7JxR3S6nLtWPhhqW37bZV8fDm7z",
    raydium: "4k3Dyjzvzp8eZ6N5m7JxR3S6nLtWPhhqW37bZV8fDm7z",

    fida: "E2Q3gxdrbFG6URZxdUizpfzRG7qAQFGxsRrMpZ9ncmyC",
    bonfida: "E2Q3gxdrbFG6URZxdUizpfzRG7qAQFGxsRrMpZ9ncmyC",

    mango: "4Z1ZVDK1r1JJb6VnGMGfMuGJeRQoY6Wj7C67cuDXS2xG",
    mango_markets: "4Z1ZVDK1r1JJb6VnGMGfMuGJeRQoY6Wj7C67cuDXS2xG",
    mngo: "4Z1ZVDK1r1JJb6VnGMGfMuGJeRQoY6Wj7C67cuDXS2xG",

    step: "E3BTSJbQZFtvGp3vJy5sx3RZsX7d6z9Uohgn2nXz5ChF",
    step_finance: "E3BTSJbQZFtvGp3vJy5sx3RZsX7d6z9Uohgn2nXz5ChF",

    slnd: "7dHbWXmYkH7Hg6k5N9VG2J6pcV8pRixYZqj8ZwLVHZvG",
    solend: "7dHbWXmYkH7Hg6k5N9VG2J6pcV8pRixYZqj8ZwLVHZvG",

    oxy: "BPFLoader1111111111111111111111111111111111", // placeholder — update if needed
    oxygen: "BPFLoader1111111111111111111111111111111111",

    kin: "KinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq5",
    civic: "7dHbWXmYkH7Hg6k5N9VG2J6pcV8pRixYZqj8ZwLVHZvG",

    stsol: "7dHbWXmYkH7Hg6k5N9VG2J6pcV8pRixYZqj8ZwLVHZvG",
    lido_staked_sol: "7dHbWXmYkH7Hg6k5N9VG2J6pcV8pRixYZqj8ZwLVHZvG",

    usdt: "Es9vMFrzaCERZGKhXoiXZHhJxjXFFqdxMTy7ZR1uPvtX",

    bonk: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",

    pyusd: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",

    sabre: "4k3Dyjzvzp8eZ6N5m7JxR3S6nLtWPhhqW37bZV8fDm7z",
    saber: "4k3Dyjzvzp8eZ6N5m7JxR3S6nLtWPhhqW37bZV8fDm7z",
};

export function resolveTokenMint(input) {
    if (!input) return null;

    // Normalize: lowercase and remove spaces/underscores/dashes
    const normalized = input.toLowerCase().replace(/[\s_-]/g, "");

    // Try exact match (case-insensitive keys like 'solana' or 'usdc')
    if (tokens[normalized]) return tokens[normalized];

    // Try uppercase symbol lookup (like 'SOL', 'USDC')
    if (tokens[input.toUpperCase()]) return tokens[input.toUpperCase()];

    return null; // Not found
} 