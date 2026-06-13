require("dotenv").config();

const ccxt = require("ccxt");

const SUPPORTED_EXCHANGES = {
  bybit: ccxt.bybit,
  bitget: ccxt.bitget,
  binance: ccxt.binance,
  kraken: ccxt.kraken,
};

/**
 * Buat instance ccxt — hanya public market data (tanpa API key).
 * @param {string} [exchangeId]
 */
function createPublicExchange(exchangeId = process.env.CEX_EXCHANGE || "kraken") {
  const key = String(exchangeId || "kraken").toLowerCase();
  const ExchangeClass = SUPPORTED_EXCHANGES[key];

  if (!ExchangeClass) {
    throw new Error(`Exchange tidak didukung: ${key}. Gunakan: ${Object.keys(SUPPORTED_EXCHANGES).join(", ")}`);
  }

  const exchangeConfig = {
    enableRateLimit: true,
    timeout: 30000, // Increase timeout to 30s
    options: {
      defaultType: "spot",
    },
  };

  if (key === "bybit") {
    exchangeConfig.hostname = "bytick.com";
  }

  if (key === "binance") {
    exchangeConfig.urls = {
      api: {
        public: "https://api.binance.info/api/v3",
        private: "https://api.binance.info/api/v3",
        sapi: "https://api.binance.info/sapi/v1",
        fapiPublic: "https://fapi.binance.com/fapi/v1",
        fapiPrivate: "https://fapi.binance.com/fapi/v1",
      }
    };
  }

  return new ExchangeClass(exchangeConfig);
}

/**
 * Jalankan fungsi ccxt dengan timeout tambahan (anti-hang).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [timeoutMs]
 * @param {string} [label]
 * @returns {Promise<T>}
 */
async function withTimeout(fn, timeoutMs = Number(process.env.CEX_API_TIMEOUT_MS || 12000), label = "ccxt") {
  let timer;

  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Retry sekali jika network / timeout.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} [label]
 */
async function withRetry(fn, label = "request") {
  try {
    return await fn();
  } catch (error) {
    const retryable =
      error?.message?.includes("timeout") ||
      error?.code === "ECONNABORTED" ||
      error?.code === "ETIMEDOUT" ||
      error?.name === "NetworkError";

    if (!retryable) {
      throw error;
    }

    console.warn(`[cexExchange] ${label} gagal (${error.message}), retry 1x...`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    return fn();
  }
}

module.exports = {
  SUPPORTED_EXCHANGES,
  createPublicExchange,
  withTimeout,
  withRetry,
};
