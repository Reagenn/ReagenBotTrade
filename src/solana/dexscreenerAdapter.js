require("dotenv").config();

const DEFAULT_CHAIN_ID = process.env.SOLANA_CHAIN_ID || "solana";

const thresholds = {
  minLiquidityUsd: Number(process.env.DEXSCREENER_MIN_LIQUIDITY_USD || 10000),
  minVolume24hUsd: Number(process.env.DEXSCREENER_MIN_VOLUME_24H_USD || 50000),
  minFdvUsd: Number(process.env.DEXSCREENER_MIN_FDV_USD || 20000),
};

async function fetchJson(url, options = {}, attempt = 0) {
  try {
    const response = await fetch(url, options);
    
    if (response.status === 429 && attempt < 3) {
      const waitMs = Math.pow(2, attempt) * 2000;
      console.warn(`[DexScreener] Rate limited (429), retrying in ${waitMs}ms...`);
      await new Promise(r => setTimeout(r, waitMs));
      return fetchJson(url, options, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DexScreener request failed ${response.status}: ${body}`);
    }
    return response.json();
  } catch (err) {
    if (attempt < 3 && (err.message.includes("429") || err.message.includes("ETIMEDOUT") || err.message.includes("timeout"))) {
      const waitMs = Math.pow(2, attempt) * 2000;
      await new Promise(r => setTimeout(r, waitMs));
      return fetchJson(url, options, attempt + 1);
    }
    throw err;
  }
}

function extractPairMetrics(tokenData) {
  if (!tokenData || typeof tokenData !== "object") {
    return { 
      priceUsd: 0,
      volume24hUsd: 0, 
      liquidityUsd: 0,
      fdv: 0,
      marketCap: 0,
      priceChange24h: 0
    };
  }

  return {
    priceUsd: Number(tokenData.priceUsd || 0),
    volume24hUsd: Number(tokenData.volume?.h24 || 0),
    liquidityUsd: Number(tokenData.liquidity?.usd || 0),
    fdv: Number(tokenData.fdv || 0),
    marketCap: Number(tokenData.marketCap || tokenData.fdv || 0),
    priceChange24h: Number(tokenData.priceChange?.h24 || 0)
  };
}

/**
 * Gate sebelum GoPlus / Helius / Birdeye — hanya pair dengan likuiditas & volume pasar nyata.
 * @param {object} tokenData — raw DexScreener pair atau objek dengan liquidityUsd / volume24hUsd / fdv
 * @param {object} [options] — override ambang (opsional)
 * @returns {boolean}
 */
function isTokenWorthAnalyzing(tokenData, options = {}) {
  const minLiquidityUsd = Number(options.minLiquidityUsd ?? thresholds.minLiquidityUsd);
  const minVolume24hUsd = Number(options.minVolume24hUsd ?? thresholds.minVolume24hUsd);
  const minFdvUsd = Number(options.minFdvUsd ?? thresholds.minFdvUsd);
  const { liquidityUsd, volume24hUsd, fdv } = extractPairMetrics(tokenData);

  return liquidityUsd > minLiquidityUsd && volume24hUsd > minVolume24hUsd && fdv > minFdvUsd;
}

/**
 * Sama seperti isTokenWorthAnalyzing; jika gagal, log dan return false.
 */
function ensureTokenWorthAnalyzing(tokenData, options = {}) {
  if (isTokenWorthAnalyzing(tokenData, options)) {
    return true;
  }

  if (options.log !== false) {
    console.log("[DexScreener] Token diabaikan karena likuiditas/volume terlalu rendah.");
  }

  return false;
}

function selectBestPair(pairs, chainId = DEFAULT_CHAIN_ID) {
  return (
    [...(pairs || [])]
      .filter((pair) => pair.chainId === chainId)
      .sort((a, b) => {
        const liquidityA = Number(a?.liquidity?.usd || 0);
        const liquidityB = Number(b?.liquidity?.usd || 0);
        const volumeA = Number(a?.volume?.h24 || 0);
        const volumeB = Number(b?.volume?.h24 || 0);
        return liquidityB + volumeB - (liquidityA + volumeA);
      })[0] || null
  );
}

async function fetchTokenPairs(mint, chainId = DEFAULT_CHAIN_ID) {
  const url = `https://api.dexscreener.com/token-pairs/v1/${chainId}/${mint}`;
  const payload = await fetchJson(url);
  return Array.isArray(payload) ? payload : [];
}

async function fetchLatestTokenProfiles(chainId = DEFAULT_CHAIN_ID) {
  const url = "https://api.dexscreener.com/token-profiles/latest/v1";
  const payload = await fetchJson(url);
  return Array.isArray(payload) ? payload.filter((item) => item?.chainId === chainId) : [];
}

async function fetchLatestBoosts(chainId = DEFAULT_CHAIN_ID) {
  const url = "https://api.dexscreener.com/token-boosts/latest/v1";
  const payload = await fetchJson(url);
  return Array.isArray(payload) ? payload.filter((item) => item?.chainId === chainId) : [];
}

async function fetchTopBoosts(chainId = DEFAULT_CHAIN_ID) {
  const url = "https://api.dexscreener.com/token-boosts/top/v1";
  const payload = await fetchJson(url);
  return Array.isArray(payload) ? payload.filter((item) => item?.chainId === chainId) : [];
}

module.exports = {
  thresholds,
  extractPairMetrics,
  isTokenWorthAnalyzing,
  ensureTokenWorthAnalyzing,
  selectBestPair,
  fetchTokenPairs,
  fetchLatestTokenProfiles,
  fetchLatestBoosts,
  fetchTopBoosts,
};
