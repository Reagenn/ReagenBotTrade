require("dotenv").config();

const axios = require("axios");

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Mint stablecoin yang diperlakukan sebagai quote currency (modal / hasil). */
const QUOTE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT (sering dipakai sebagai quote di DEX)
]);

const config = {
  heliusApiKey: String(process.env.HELIUS_API_KEY || "").trim(),
  heliusBaseUrl: String(process.env.HELIUS_API_BASE_URL || "https://api.helius.xyz").replace(/\/$/, ""),
  swapLimit: Number(process.env.WALLET_ANALYZER_SWAP_LIMIT || 50),
  smartMoneyThreshold: Number(process.env.WALLET_ANALYZER_SMART_MONEY_THRESHOLD || 70),
};

function isQuoteMint(mint) {
  return mint && QUOTE_MINTS.has(String(mint));
}

function normalizeTokenAmount(transfer) {
  if (!transfer || typeof transfer !== "object") {
    return 0;
  }

  if (Number.isFinite(transfer.tokenAmount)) {
    return Math.abs(Number(transfer.tokenAmount));
  }

  const rawAmount = Number(transfer?.rawTokenAmount?.tokenAmount || 0);
  const decimals = Number(transfer?.rawTokenAmount?.decimals ?? 0);
  if (!Number.isFinite(rawAmount) || rawAmount === 0) {
    return 0;
  }

  return Math.abs(rawAmount / 10 ** decimals);
}

function lamportsToSol(lamports) {
  return Math.abs(Number(lamports || 0)) / LAMPORTS_PER_SOL;
}

/**
 * Mengambil riwayat transaksi enhanced dari Helius untuk satu wallet.
 * @param {string} walletAddress
 * @param {{ limit?: number, apiKey?: string }} [options]
 * @returns {Promise<object[]>}
 */
async function fetchWalletTransactions(walletAddress, options = {}) {
  const apiKey = options.apiKey || config.heliusApiKey;
  if (!apiKey) {
    throw new Error("HELIUS_API_KEY tidak ditemukan di environment.");
  }

  if (!walletAddress || typeof walletAddress !== "string") {
    throw new Error("walletAddress wajib diisi.");
  }

  const limit = Math.min(Math.max(Number(options.limit || config.swapLimit), 1), 100);
  const encodedAddress = encodeURIComponent(walletAddress.trim());
  const url = `${config.heliusBaseUrl}/v0/addresses/${encodedAddress}/transactions`;

  const response = await axios.get(url, {
    params: {
      "api-key": apiKey,
      limit,
      type: "SWAP",
    },
    timeout: Number(options.timeoutMs || 30000),
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const payload = response.data;
  return Array.isArray(payload) ? payload : [];
}

/**
 * Filter client-side: hanya transaksi bertipe SWAP yang valid.
 * @param {object[]} transactions
 * @returns {object[]}
 */
function filterSwapTransactions(transactions) {
  if (!Array.isArray(transactions)) {
    return [];
  }

  return transactions.filter((transaction) => {
    if (!transaction || transaction.transactionError) {
      return false;
    }

    const type = String(transaction.type || "").toUpperCase();
    if (type === "SWAP") {
      return true;
    }

    // Fallback: beberapa parser Helius hanya mengisi events.swap tanpa type eksplisit.
    return Boolean(transaction?.events?.swap);
  });
}

/**
 * Menghitung aliran quote (SOL + stablecoin) masuk/keluar wallet untuk satu transaksi SWAP.
 *
 * @param {object} transaction - Enhanced transaction dari Helius
 * @param {string} walletAddress
 * @returns {{ spentQuote: number, gainedQuote: number, pnlQuote: number, isProfitable: boolean, signature: string|null }}
 */
function calculateSwapPnL(transaction, walletAddress) {
  const wallet = String(walletAddress || "").trim();
  const nativeTransfers = Array.isArray(transaction?.nativeTransfers) ? transaction.nativeTransfers : [];
  const tokenTransfers = Array.isArray(transaction?.tokenTransfers) ? transaction.tokenTransfers : [];

  let spentQuote = 0;
  let gainedQuote = 0;

  /*
   * nativeTransfers — perpindahan SOL (lamports).
   * Struktur tipikal:
   * { fromUserAccount, toUserAccount, amount }
   *
   * Jika fromUserAccount === wallet → SOL keluar (modal).
   * Jika toUserAccount === wallet → SOL masuk (hasil penjualan / refund).
   */
  for (const transfer of nativeTransfers) {
    const amountSol = lamportsToSol(transfer?.amount);
    if (amountSol <= 0) {
      continue;
    }

    if (transfer?.fromUserAccount === wallet) {
      spentQuote += amountSol;
    }

    if (transfer?.toUserAccount === wallet) {
      gainedQuote += amountSol;
    }
  }

  /*
   * tokenTransfers — perpindahan SPL token.
   * Struktur tipikal:
   * { fromUserAccount, toUserAccount, tokenAmount, mint }
   * atau { rawTokenAmount: { tokenAmount, decimals }, mint, ... }
   *
   * Hanya mint quote (USDC/USDT) yang dihitung sebagai modal/hasil dalam satuan USD stable.
   * Token meme/alt lain diabaikan di layer ini (fokus arus kas quote per swap).
   */
  for (const transfer of tokenTransfers) {
    const mint = transfer?.mint;
    if (!isQuoteMint(mint)) {
      continue;
    }

    const amount = normalizeTokenAmount(transfer);
    if (amount <= 0) {
      continue;
    }

    if (transfer?.fromUserAccount === wallet) {
      spentQuote += amount;
    }

    if (transfer?.toUserAccount === wallet) {
      gainedQuote += amount;
    }
  }

  /*
   * events.swap — ringkasan parser Helius (tokenInputs/tokenOutputs).
   * Dipakai sebagai pelengkap jika nativeTransfers/tokenTransfers tidak lengkap.
   */
  const swapEvent = transaction?.events?.swap;
  if (swapEvent) {
    const tokenInputs = Array.isArray(swapEvent.tokenInputs) ? swapEvent.tokenInputs : [];
    const tokenOutputs = Array.isArray(swapEvent.tokenOutputs) ? swapEvent.tokenOutputs : [];
    const nativeInput = Number(swapEvent.nativeInput?.amount || 0);
    const nativeOutput = Number(swapEvent.nativeOutput?.amount || 0);

    if (nativeInput > 0 && swapEvent.nativeInput?.account === wallet) {
      spentQuote += lamportsToSol(nativeInput);
    }
    if (nativeOutput > 0 && swapEvent.nativeOutput?.account === wallet) {
      gainedQuote += lamportsToSol(nativeOutput);
    }

    for (const input of tokenInputs) {
      if (!isQuoteMint(input?.mint) || input?.userAccount !== wallet) {
        continue;
      }
      spentQuote += normalizeTokenAmount(input);
    }

    for (const output of tokenOutputs) {
      if (!isQuoteMint(output?.mint) || output?.userAccount !== wallet) {
        continue;
      }
      gainedQuote += normalizeTokenAmount(output);
    }
  }

  const pnlQuote = gainedQuote - spentQuote;
  const hasQuoteFlow = spentQuote > 0 || gainedQuote > 0;

  return {
    signature: transaction?.signature || null,
    timestamp: transaction?.timestamp || null,
    spentQuote: Number(spentQuote.toFixed(6)),
    gainedQuote: Number(gainedQuote.toFixed(6)),
    pnlQuote: Number(pnlQuote.toFixed(6)),
    isProfitable: hasQuoteFlow && pnlQuote > 0,
    hasQuoteFlow,
  };
}

/**
 * Analisis win rate wallet dari swap Helius (mandiri, tanpa Birdeye).
 *
 * @param {string} walletAddress
 * @param {{ limit?: number, smartMoneyThreshold?: number, includeTrades?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function analyzeWallet(walletAddress, options = {}) {
  const wallet = String(walletAddress || "").trim();
  const threshold = Number(options.smartMoneyThreshold ?? config.smartMoneyThreshold);
  const emptyResult = {
    wallet,
    totalSwaps: 0,
    profitableTrades: 0,
    winRate: 0,
    isSmartMoney: false,
    analyzedAt: new Date().toISOString(),
    source: "helius_enhanced_transactions",
  };

  try {
    const rawTransactions = await fetchWalletTransactions(wallet, options);
    const swapTransactions = filterSwapTransactions(rawTransactions);

    if (!swapTransactions.length) {
      return {
        ...emptyResult,
        message: "Tidak ada transaksi SWAP pada riwayat yang diambil (dompet baru atau belum swap).",
      };
    }

    const tradeDetails = [];
    let scoredSwaps = 0;
    let profitableTrades = 0;

    for (const transaction of swapTransactions) {
      const trade = calculateSwapPnL(transaction, wallet);

      // Lewati swap token-to-token tanpa arus quote agar win rate tidak bias.
      if (!trade.hasQuoteFlow) {
        continue;
      }

      scoredSwaps += 1;
      if (trade.isProfitable) {
        profitableTrades += 1;
      }

      if (options.includeTrades) {
        tradeDetails.push(trade);
      }
    }

    const winRate = scoredSwaps > 0 ? Number(((profitableTrades / scoredSwaps) * 100).toFixed(1)) : 0;

    return {
      wallet,
      totalSwaps: scoredSwaps,
      profitableTrades,
      winRate,
      isSmartMoney: winRate >= threshold,
      rawSwapCount: swapTransactions.length,
      smartMoneyThreshold: threshold,
      analyzedAt: new Date().toISOString(),
      source: "helius_enhanced_transactions",
      ...(options.includeTrades ? { trades: tradeDetails } : {}),
      ...(scoredSwaps === 0 ?
        {
          message: "Ada SWAP tetapi tidak ada arus SOL/USDC yang terdeteksi — coba naikkan limit atau periksa format Helius.",
        }
      : {}),
    };
  } catch (error) {
    return {
      ...emptyResult,
      error: error.message || String(error),
    };
  }
}

/**
 * Analisis batch beberapa wallet sekaligus.
 * @param {string[]} walletAddresses
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
async function analyzeWallets(walletAddresses, options = {}) {
  const wallets = [...new Set((walletAddresses || []).filter(Boolean))];
  const results = [];

  for (const wallet of wallets) {
    results.push(await analyzeWallet(wallet, options));
  }

  return results;
}

module.exports = {
  config,
  QUOTE_MINTS,
  fetchWalletTransactions,
  filterSwapTransactions,
  calculateSwapPnL,
  analyzeWallet,
  analyzeWallets,
};
