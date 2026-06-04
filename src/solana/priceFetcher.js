require("dotenv").config();

const axios = require("axios");
const { isValidSolanaAddress } = require("./tokenValidator");
const dbManager = require("../database/dbManager");

const BIRDEYE_BASE = String(process.env.BIRDEYE_API_BASE || "https://public-api.birdeye.so").replace(/\/$/, "");
const JUPITER_PRICE_BASE = String(process.env.JUPITER_PRICE_BASE || "https://price.jup.ag").replace(/\/$/, "");
const DEXSCREENER_BASE = "https://api.dexscreener.com";

const config = {
  requestTimeoutMs: Number(process.env.PRICE_FETCH_TIMEOUT_MS || 4500),
  birdeyeApiKey: process.env.BIRDEYE_API_KEY || "",
  chainId: process.env.SOLANA_CHAIN_ID || "solana",
  jupiterPricePath: String(process.env.JUPITER_PRICE_PATH || "/v4/price"),
};

let currentBirdeyeIndex = 0;
function getBirdeyeKeys() {
  const raw = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEYS || "";
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

function getNextBirdeyeKey() {
  const keys = getBirdeyeKeys();
  if (keys.length === 0) return "";
  const key = keys[currentBirdeyeIndex];
  currentBirdeyeIndex = (currentBirdeyeIndex + 1) % keys.length;
  return key;
}

function buildBirdeyeHeaders() {
  return {
    accept: "application/json",
    "x-chain": config.chainId,
    "X-API-KEY": getNextBirdeyeKey(),
  };
}

function isRateLimitError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  if (status === 429) {
    return true;
  }

  const message = String(
    error?.response?.data?.message || error?.response?.data?.error || error?.message || "",
  ).toLowerCase();

  return (
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("compute units") ||
    message.includes("usage limit")
  );
}

async function requestWithTimeout(requestConfig) {
  try {
    const response = await axios.request({
      timeout: config.requestTimeoutMs,
      validateStatus: (status) => status >= 200 && status < 300,
      ...requestConfig,
    });
    return response;
  } catch (error) {
    if (error.code === "ECONNABORTED") {
      const timeoutError = new Error(`Request timeout (${config.requestTimeoutMs}ms)`);
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  }
}

function normalizePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  return price;
}

function parseBirdeyePrice(payload, tokenAddress) {
  const root = payload?.data ?? payload;
  if (!root || typeof root !== "object") {
    return null;
  }

  const direct =
    root.value ??
    root.price ??
    root.priceUsd ??
    root.usdPrice ??
    root.data?.value ??
    root.data?.price;

  if (direct != null) {
    return normalizePrice(direct);
  }

  const keyed = root[tokenAddress] || root.data?.[tokenAddress];
  if (keyed) {
    return normalizePrice(keyed.value ?? keyed.price ?? keyed.usdPrice ?? keyed.priceUsd);
  }

  return null;
}

function parseJupiterPrice(payload, tokenAddress) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const mint = String(tokenAddress || "").trim();

  const v2Entry = payload?.data?.[mint] ?? payload?.data?.[mint]?.price;
  if (v2Entry && typeof v2Entry === "object") {
    const fromObject = normalizePrice(v2Entry.price ?? v2Entry.usdPrice ?? v2Entry.value);
    if (fromObject) {
      return fromObject;
    }
  }

  if (payload?.data && typeof payload.data === "object" && payload.data.price != null) {
    const nested = normalizePrice(payload.data.price);
    if (nested) {
      return nested;
    }
  }

  const rootEntry = payload[mint];
  if (rootEntry && typeof rootEntry === "object") {
    return normalizePrice(rootEntry.usdPrice ?? rootEntry.price ?? rootEntry.value);
  }

  if (typeof payload.price === "number" || typeof payload.price === "string") {
    return normalizePrice(payload.price);
  }

  return null;
}

function selectBestDexScreenerPair(pairs) {
  const solanaPairs = (pairs || []).filter((pair) => pair?.chainId === config.chainId);
  if (!solanaPairs.length) {
    return null;
  }

  return [...solanaPairs].sort((a, b) => {
    const liquidityA = Number(a?.liquidity?.usd || 0);
    const liquidityB = Number(b?.liquidity?.usd || 0);
    const volumeA = Number(a?.volume?.h24 || 0);
    const volumeB = Number(b?.volume?.h24 || 0);
    return liquidityB + volumeB - (liquidityA + volumeA);
  })[0];
}

function parseDexScreenerPrice(payload) {
  const pairs = Array.isArray(payload?.pairs) ? payload.pairs : [];
  const bestPair = selectBestDexScreenerPair(pairs);
  if (!bestPair) {
    return null;
  }

  return normalizePrice(bestPair.priceUsd ?? bestPair.priceNative);
}

async function fetchBirdeyePrice(tokenAddress) {
  if (!config.birdeyeApiKey && !process.env.BIRDEYE_API_KEYS) {
    throw new Error("BIRDEYE_API_KEY atau BIRDEYE_API_KEYS tidak dikonfigurasi.");
  }

  const quotaSafe = await dbManager.checkApiQuota('birdeye');
  if (!quotaSafe) {
    console.warn("[QUOTA] Kuota Birdeye harian habis. Beralih ke fallback (Jupiter/DexScreener)...");
    throw new Error("Birdeye daily quota exceeded");
  }

  const mint = String(tokenAddress || "").trim();
  const response = await requestWithTimeout({
    method: "GET",
    url: `${BIRDEYE_BASE}/defi/price`,
    params: {
      address: mint,
      token_address: mint,
    },
    headers: buildBirdeyeHeaders(),
  });

  await dbManager.incrementApiUsage('birdeye');

  const priceUsd = parseBirdeyePrice(response.data, mint);
  if (!priceUsd) {
    throw new Error("Birdeye response tidak berisi harga valid.");
  }

  return {
    tokenAddress: mint,
    priceUsd,
    source: "birdeye",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchJupiterPriceFromPath(tokenAddress, pricePath) {
  const mint = String(tokenAddress || "").trim();
  const response = await requestWithTimeout({
    method: "GET",
    url: `${JUPITER_PRICE_BASE}${pricePath}`,
    params: { ids: mint },
    headers: { accept: "application/json" },
  });

  const priceUsd = parseJupiterPrice(response.data, mint);
  if (!priceUsd) {
    throw new Error(`Jupiter ${pricePath} tidak berisi harga valid.`);
  }

  return priceUsd;
}

async function fetchJupiterPrice(tokenAddress) {
  const mint = String(tokenAddress || "").trim();
  const paths = [config.jupiterPricePath, "/price/v3"].filter(
    (path, index, list) => list.indexOf(path) === index,
  );

  let lastError = null;

  for (const pricePath of paths) {
    try {
      const priceUsd = await fetchJupiterPriceFromPath(mint, pricePath);
      return {
        tokenAddress: mint,
        priceUsd,
        source: pricePath.includes("v3") ? "jupiter-v3" : "jupiter",
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status === 404 && pricePath !== paths[paths.length - 1]) {
        continue;
      }
    }
  }

  throw lastError || new Error("Jupiter price API gagal.");
}

async function fetchDexScreenerPrice(tokenAddress) {
  const mint = encodeURIComponent(String(tokenAddress || "").trim());
  const response = await requestWithTimeout({
    method: "GET",
    url: `${DEXSCREENER_BASE}/latest/dex/tokens/${mint}`,
    headers: { accept: "application/json" },
  });

  const priceUsd = parseDexScreenerPrice(response.data);
  if (!priceUsd) {
    throw new Error("DexScreener response tidak berisi harga valid.");
  }

  return {
    tokenAddress: String(tokenAddress || "").trim(),
    priceUsd,
    source: "dexscreener",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Jalur UI: Ambil harga banyak koin sekaligus via DexScreener (Batch).
 * Lebih hemat rate limit & optimal untuk dashboard.
 * @param {string[]} addresses 
 * @returns {Promise<Record<string, number>>}
 */
async function getUIPriceBatch(addresses) {
  const unique = [...new Set((addresses || []).filter(isValidSolanaAddress))];
  if (unique.length === 0) return {};

  const prices = {};
  // DexScreener limit per batch is ~30
  const CHUNK_SIZE = 30;
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    try {
      const response = await requestWithTimeout({
        method: "GET",
        url: `${DEXSCREENER_BASE}/latest/dex/tokens/${chunk.join(",")}`,
        headers: { accept: "application/json" },
      });
      
      const pairs = Array.isArray(response.data?.pairs) ? response.data.pairs : [];
      chunk.forEach(mint => {
        const bestPair = pairs
          .filter(p => p.baseToken?.address === mint && p.chainId === config.chainId)
          .sort((a, b) => (Number(b.liquidity?.usd || 0) + Number(b.volume?.h24 || 0)) - (Number(a.liquidity?.usd || 0) + Number(a.volume?.h24 || 0)))[0];
        
        if (bestPair) {
          prices[mint] = Number(bestPair.priceUsd);
        }
      });
    } catch (e) {
      console.warn(`[priceFetcher] UI Batch fetch failed for chunk: ${e.message}`);
    }
  }
  return prices;
}

/**
 * Jalur Eksekusi: Ambil harga akurat & real-time via Jupiter v6.
 * Digunakan khusus untuk trigger TP/SL internal bot.
 * @param {string} tokenAddress 
 * @returns {Promise<number>}
 */
async function getExecutionPrice(tokenAddress) {
  const mint = String(tokenAddress || "").trim();
  if (!isValidSolanaAddress(mint)) throw new Error(`Invalid Solana address: ${mint}`);

  try {
    const JUP_API_KEY = process.env.JUPITER_API_KEY || "";
    const response = await axios.get(`${JUPITER_PRICE_BASE}${config.jupiterPricePath}`, {
      params: { ids: mint },
      headers: JUP_API_KEY ? { 'x-api-key': JUP_API_KEY } : {},
      timeout: 3000
    });

    const price = parseJupiterPrice(response.data, mint);
    if (price && Number(price) > 0) {
      return Number(price);
    }
  } catch (e) {
    // Try fallback v2 if v4 fails or vice versa
    try {
      const altPath = config.jupiterPricePath.includes("v4") ? "/price/v2" : "/v4/price";
      const altBase = altPath.includes("v2") ? "https://api.jup.ag" : "https://price.jup.ag";
      const response = await axios.get(`${altBase}${altPath}`, {
        params: { ids: mint },
        timeout: 2000
      });
      const price = parseJupiterPrice(response.data, mint);
      if (price) return price;
    } catch (err) {}
  }

  // Fallback ke Birdeye jika Jupiter gagal
  try {
    const quote = await fetchBirdeyePrice(mint);
    return quote.priceUsd;
  } catch (e) {
    // Last fallback: DexScreener single
    const quote = await fetchDexScreenerPrice(mint);
    return quote.priceUsd;
  }
}

/**
 * Jalur Eksekusi Batch: Ambil harga akurat Jupiter v2 untuk banyak koin.
 * Digunakan oleh SimulationEngine untuk sinkronisasi harga posisi aktif.
 */
async function getExecutionPriceBatch(mints = []) {
  const uniqueMints = [...new Set(mints.filter(isValidSolanaAddress))];
  if (uniqueMints.length === 0) return {};

  const results = {};
  const JUP_API_KEY = process.env.JUPITER_API_KEY || "";

  const tryFetch = async (base, path) => {
    try {
      const response = await axios.get(`${base}${path}`, {
        params: { ids: uniqueMints.join(',') },
        headers: JUP_API_KEY ? { 'x-api-key': JUP_API_KEY } : {},
        timeout: 5000
      });
      const data = response.data?.data || response.data || {};
      uniqueMints.forEach(m => {
        const price = parseJupiterPrice(response.data, m);
        if (price) results[m] = price;
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  // Try primary
  let success = await tryFetch(JUPITER_PRICE_BASE, config.jupiterPricePath);
  
  // Try fallback
  if (!success || Object.keys(results).length < uniqueMints.length) {
    const altPath = config.jupiterPricePath.includes("v4") ? "/price/v2" : "/v4/price";
    const altBase = altPath.includes("v2") ? "https://api.jup.ag" : "https://price.jup.ag";
    await tryFetch(altBase, altPath);
  }

  if (Object.keys(results).length === 0) {
    console.warn(`[priceFetcher] Jupiter batch execution price fail for all attempts.`);
  }

  // Fill missing with UI batch (DexScreener)
  const missing = uniqueMints.filter(m => !results[m]);
  if (missing.length > 0) {
    try {
      const fallback = await getUIPriceBatch(missing);
      Object.assign(results, fallback);
    } catch (e) {}
  }

  return results;
}

const priceProviders = [
  { name: "birdeye", fetch: fetchBirdeyePrice },
  { name: "jupiter", fetch: fetchJupiterPrice },
  { name: "dexscreener", fetch: fetchDexScreenerPrice },
];

function logProviderFallback(provider, error, nextProvider) {
  if (!nextProvider) {
    return;
  }

  if (provider.name === "birdeye" && isRateLimitError(error)) {
    console.warn("[Birdeye Limit] Beralih ke Jupiter...");
    return;
  }

  console.warn(`[priceFetcher] ${provider.name} gagal, beralih ke ${nextProvider.name}...`);
}

/**
 * Ambil harga token USD dengan fallback Birdeye → Jupiter → DexScreener.
 * @param {string} tokenAddress
 * @returns {Promise<{ tokenAddress: string, priceUsd: number, source: string, fetchedAt: string, attempts?: object[] }>}
 */
async function getTokenPrice(tokenAddress) {
  const mint = String(tokenAddress || "").trim();
  if (!mint) {
    throw new Error("tokenAddress wajib diisi.");
  }

  if (!isValidSolanaAddress(mint)) {
    console.log(`[VALIDATION] Mengabaikan token price fetch untuk address tidak valid: ${mint}`);
    throw new Error(`Invalid Solana address: ${mint}`);
  }

  const attempts = [];
  let lastError = null;

  for (let index = 0; index < priceProviders.length; index += 1) {
    const provider = priceProviders[index];

    try {
      const result = await provider.fetch(mint);
      if (index > 0) {
        console.log(`[priceFetcher] Berhasil mendapatkan harga dari ${provider.name} untuk ${mint.slice(0, 6)}: $${result.priceUsd}`);
      }
      return {
        ...result,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        source: provider.name,
        error: error.message || String(error),
        rateLimited: isRateLimitError(error),
      });

      logProviderFallback(provider, error, priceProviders[index + 1]);
    }
  }

  throw new Error(
    lastError?.message || `Gagal mengambil harga untuk ${mint} dari semua sumber (Birdeye, Jupiter, DexScreener).`,
  );
}

/**
 * Batch fetch harga (sequential + delay opsional untuk hemat rate limit).
 * @param {string[]} tokenAddresses
 * @param {{ delayMs?: number }} [options]
 * @returns {Promise<Record<string, number>>}
 */
async function getTokenPrices(tokenAddresses, options = {}) {
  const delayMs = Number(options.delayMs ?? 120);
  const prices = {};
  const meta = {};
  const unique = [...new Set((tokenAddresses || []).map((mint) => String(mint || "").trim()).filter(Boolean))];

  for (let index = 0; index < unique.length; index += 1) {
    const mint = unique[index];

    try {
      const quote = await getTokenPrice(mint);
      prices[mint] = quote.priceUsd;
      meta[mint] = quote;
    } catch (error) {
      console.warn(`[priceFetcher] Skip ${mint.slice(0, 6)}: ${error.message}`);
    }

    if (index < unique.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { prices, meta };
}

module.exports = {
  config,
  getTokenPrice,
  getTokenPrices,
  getUIPriceBatch,
  getExecutionPrice,
  getExecutionPriceBatch,
  fetchBirdeyePrice,
  fetchJupiterPrice,
  fetchDexScreenerPrice,
  isRateLimitError,
};
