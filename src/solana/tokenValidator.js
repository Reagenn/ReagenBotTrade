require("dotenv").config();

const { fetchTokenPairs, selectBestPair } = require("./dexscreenerAdapter");
const { PublicKey } = require("@solana/web3.js");

const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Validasi alamat Solana secara teknis (Base58 & checksum).
 * @param {string} address 
 * @returns {boolean}
 */
function isValidSolanaAddress(address) {
  if (!address || typeof address !== "string") return false;
  try {
    new PublicKey(address);
    return true;
  } catch (e) {
    return false;
  }
}

const config = {
  minScore: Number(process.env.TOKEN_VALIDATOR_MIN_SCORE || 75),
  minLiquiditySol: Number(process.env.TOKEN_VALIDATOR_MIN_LIQUIDITY_SOL || 50),
  maxMomentum5mPct: Number(process.env.TOKEN_VALIDATOR_MAX_MOMENTUM_5M_PCT || 300),
  rpcUrl: resolveRpcUrl(),
  rpcDelayMs: Number(process.env.SOLANA_RPC_DELAY_MS || 450),
  rpcMaxRetries: Number(process.env.SOLANA_RPC_MAX_RETRIES || 4),
  rpcRetryBaseMs: Number(process.env.SOLANA_RPC_RETRY_BASE_MS || 1500),
  cacheTtlMs: Number(process.env.TOKEN_VALIDATOR_CACHE_MS || 90000),
  chainId: process.env.SOLANA_CHAIN_ID || "solana",
};

const validationCache = new Map();
let lastRpcAt = 0;
let cachedSolUsd = 0;
let cachedSolUsdAt = 0;

function resolveRpcUrl() {
  const configured = String(process.env.SOLANA_RPC_URL || "").trim();
  const heliusKey = String(process.env.HELIUS_API_KEY || "").trim();
  const useHelius =
    process.env.SOLANA_USE_HELIUS_RPC !== "false" &&
    heliusKey &&
    (!configured || configured.includes("api.mainnet-beta.solana.com"));

  if (useHelius) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

  return configured || "https://api.mainnet-beta.solana.com";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function rpcThrottle() {
  const elapsed = Date.now() - lastRpcAt;
  if (elapsed < config.rpcDelayMs) {
    await sleep(config.rpcDelayMs - elapsed);
  }
  lastRpcAt = Date.now();
}

const rpcHealth = require("../utils/rpc_health");

/**
 * Satu panggilan JSON-RPC ke Helius / Solana RPC dengan retry ringan.
 */
async function callRpc(method, params, attempt = 0) {
  const wait = await rpcHealth.rpcThrottle(config.rpcDelayMs);
  if (wait > 0) {
    if (rpcHealth.isRpcPaused()) {
      console.log(`[validator] RPC sedang dalam masa jeda (rate limit), menunggu ${Math.round(wait / 1000)}s...`);
    }
    await sleep(wait);
  }

  let response;
  let bodyText = "";

  try {
    response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    bodyText = await response.text();
  } catch (error) {
    if (attempt < config.rpcMaxRetries) {
      await sleep(config.rpcRetryBaseMs * (attempt + 1));
      return callRpc(method, params, attempt + 1);
    }
    throw error;
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error(`RPC response tidak valid: ${bodyText.slice(0, 160)}`);
  }

  const rateLimited =
    response.status === 429 || payload?.error?.code === 429 || payload?.error?.code === -32429;

  if (rateLimited) {
    if (attempt < config.rpcMaxRetries) {
      const waitMs = Math.min(config.rpcRetryBaseMs * (attempt + 1), 15000);
      console.warn(`[validator] Solana RPC 429 (${method}), retry ${attempt + 1}/${config.rpcMaxRetries} dlm ${waitMs}ms`);
      await sleep(waitMs);
      return callRpc(method, params, attempt + 1);
    }
    
    console.error(`[validator] RPC hit hard rate limit. Jeda global selama 60 detik.`);
    rpcHealth.setRpcPause(60000);
    throw new Error(`RPC rate limit: ${bodyText.slice(0, 200)}`);
  }

  if (payload?.error) {
    throw new Error(`RPC ${payload.error.code}: ${payload.error.message || bodyText}`);
  }

  return payload;
}

/**
 * Cek Mint Authority & Freeze Authority via getAccountInfo (jsonParsed).
 * Aman jika keduanya null (dicabut).
 */
async function fetchMintAuthorities(mint) {
  const payload = await callRpc("getAccountInfo", [
    mint,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  const value = payload?.result?.value;
  if (!value) {
    return {
      found: false,
      mintAuthority: "unknown",
      freezeAuthority: "unknown",
      mintAuthorityActive: true,
      freezeAuthorityActive: true,
      decimals: null,
      supply: null,
    };
  }

  const parsed = value?.data?.parsed;
  if (parsed?.type !== "mint" || !parsed?.info) {
    return {
      found: false,
      mintAuthority: "unknown",
      freezeAuthority: "unknown",
      mintAuthorityActive: true,
      freezeAuthorityActive: true,
      decimals: null,
      supply: null,
    };
  }

  const info = parsed.info;
  const mintAuthority = info.mintAuthority ?? null;
  const freezeAuthority = info.freezeAuthority ?? null;

  return {
    found: true,
    mintAuthority,
    freezeAuthority,
    mintAuthorityActive: mintAuthority !== null,
    freezeAuthorityActive: freezeAuthority !== null,
    decimals: Number(info.decimals ?? 0),
    supply: info.supply ?? null,
  };
}

async function getSolUsdPrice() {
  if (cachedSolUsd > 0 && Date.now() - cachedSolUsdAt < 120000) {
    return cachedSolUsd;
  }

  try {
    const { getTokenPrice } = require("./priceFetcher");
    const quote = await getTokenPrice(SOL_MINT);
    cachedSolUsd = Number(quote.priceUsd);
    cachedSolUsdAt = Date.now();
    return cachedSolUsd;
  } catch {
    cachedSolUsd = Number(process.env.TOKEN_VALIDATOR_SOL_USD_FALLBACK || 150);
    cachedSolUsdAt = Date.now();
    return cachedSolUsd;
  }
}

/**
 * Estimasi likuiditas pool dalam SOL (native quote/base atau konversi USD).
 */
async function resolveLiquiditySol(pair, mint) {
  if (!pair) {
    const pairs = await fetchTokenPairs(mint, config.chainId);
    pair = selectBestPair(pairs, config.chainId);
  }

  if (!pair) {
    return { liquiditySol: 0, liquidityUsd: 0, pair: null, source: "none" };
  }

  const liquidityUsd = Number(pair?.liquidity?.usd || 0);
  const quoteSymbol = String(pair?.quoteToken?.symbol || "").toUpperCase();
  const baseSymbol = String(pair?.baseToken?.symbol || "").toUpperCase();
  const quoteMint = String(pair?.quoteToken?.address || pair?.quoteToken?.mint || "");
  const baseMint = String(pair?.baseToken?.address || pair?.baseToken?.mint || "");

  let liquiditySol = 0;
  let source = "usd_estimate";

  if (quoteMint === SOL_MINT || quoteSymbol === "SOL" || quoteSymbol === "WSOL") {
    liquiditySol = Number(pair?.liquidity?.quote || 0);
    source = "quote_native";
  } else if (baseMint === SOL_MINT || baseSymbol === "SOL" || baseSymbol === "WSOL") {
    liquiditySol = Number(pair?.liquidity?.base || 0);
    source = "base_native";
  }

  if (liquiditySol <= 0 && liquidityUsd > 0) {
    const solUsd = await getSolUsdPrice();
    if (solUsd > 0) {
      liquiditySol = liquidityUsd / solUsd;
      source = "usd_to_sol";
    }
  }

  return {
    liquiditySol: round(liquiditySol, 4),
    liquidityUsd: round(liquidityUsd, 2),
    pair,
    source,
  };
}

/**
 * Momentum 5 menit — gunakan priceChange.m5 DexScreener (persentase perubahan harga).
 * Alternatif: bandingkan close vs open candle 5m jika tersedia di metadata pair.
 */
function resolveMomentum5m(pair) {
  if (!pair) {
    return { changePct5m: null, overbought: false, source: "none" };
  }

  const changePct5m = Number(pair?.priceChange?.m5 ?? pair?.priceChange5m ?? NaN);

  if (!Number.isFinite(changePct5m)) {
    return { changePct5m: null, overbought: false, source: "missing" };
  }

  return {
    changePct5m: round(changePct5m, 2),
    overbought: changePct5m > config.maxMomentum5mPct,
    source: "dexscreener_m5",
  };
}

function buildScoreAndReasons(checks) {
  let score = 100;
  const reasons = [];

  if (!checks.mintAccountFound) {
    score -= 50;
    reasons.push("DITOLAK: Akun mint token tidak valid");
  } else if (checks.mintAuthorityActive) {
    score -= 45;
    reasons.push("DITOLAK: Mint Authority masih aktif");
  } else {
    score += 0;
  }

  if (checks.freezeAuthorityActive) {
    score -= 45;
    reasons.push("DITOLAK: Freeze Authority masih aktif");
  }

  if (checks.liquiditySol < config.minLiquiditySol) {
    score -= 35;
    reasons.push(
      `DITOLAK: Likuiditas pool hanya ~${checks.liquiditySol} SOL (min ${config.minLiquiditySol} SOL)`,
    );
  }

  if (checks.momentum5mPct != null && checks.momentum5mPct > config.maxMomentum5mPct) {
    score -= 40;
    reasons.push(
      `DITOLAK: Harga sudah overbought (+${checks.momentum5mPct}% dalam 5 menit, max ${config.maxMomentum5mPct}%)`,
    );
  } else if (checks.momentum5mPct == null) {
    score -= 8;
    reasons.push("PERINGATAN: Data momentum 5m tidak tersedia (-8 skor)");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const hardFail =
    checks.mintAuthorityActive ||
    checks.freezeAuthorityActive ||
    !checks.mintAccountFound ||
    checks.liquiditySol < config.minLiquiditySol ||
    (checks.momentum5mPct != null && checks.momentum5mPct > config.maxMomentum5mPct);

  const approved = !hardFail && score >= config.minScore;

  if (!approved && score >= config.minScore && reasons.length) {
    reasons.push(`DITOLAK: Skor akhir ${score} < ambang ${config.minScore}`);
  } else if (!approved && !reasons.some((r) => r.startsWith("DITOLAK"))) {
    reasons.push(`DITOLAK: Skor ${score} di bawah ambang ${config.minScore}`);
  }

  return { score, reasons, hardFail, approved };
}

/**
 * Security check menggunakan API Rugcheck.xyz (Free Tier).
 * @param {string} tokenAddress 
 * @returns {Promise<{ approved: boolean, score: number, risks: string[], raw: object }>}
 */
async function checkRugcheck(tokenAddress) {
  const mint = String(tokenAddress || "").trim();
  const result = { approved: false, score: 0, risks: [], raw: null };

  try {
    const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (response.status === 429) {
      console.warn(`[Rugcheck] Rate limited (429). Falling back to safe=false.`);
      return result;
    }

    if (!response.ok) {
      console.warn(`[Rugcheck] API error: ${response.status}. Skipping.`);
      return result;
    }

    const data = await response.json();
    result.raw = data;
    result.score = data.score || 0;

    const risks = data.risks || [];
    result.risks = risks.map(r => r.name || r.level);

    // CRITICAL SECURITY RULES
    const isHoneypot = risks.some(r => /honeypot/i.test(r.name || ''));
    const freezeEnabled = risks.some(r => /freeze authority/i.test(r.name || ''));
    const highRiskScore = result.score > 500; // Threshold Rugcheck: > 500 is usually danger
    
    // Top Holders Check (Explicitly look for > 50% concentration)
    const topHolderRisk = risks.some(r => {
      const isHolderRisk = /holders|concentration/i.test(r.name || '');
      const pctMatch = (r.value || '').match(/(\d+(\.\d+)?)\s*%/);
      const pctValue = pctMatch ? parseFloat(pctMatch[1]) : 0;
      return isHolderRisk && (pctValue > 50 || /danger/i.test(r.level || ''));
    });
    
    if (isHoneypot) result.risks.push("CRITICAL: Honeypot detected");
    if (freezeEnabled) result.risks.push("CRITICAL: Freeze Authority enabled");
    if (highRiskScore) result.risks.push(`CRITICAL: High risk score (${result.score})`);

    result.approved = !isHoneypot && !freezeEnabled && !highRiskScore && !topHolderRisk;

    return result;
  } catch (err) {
    console.error(`[Rugcheck] Error checking ${mint.slice(0,6)}: ${err.message}`);
    // Demi keamanan, jika API down/error, anggap TIDAK approved jika user ingin strict.
    // Atau set default ke true jika ingin bot tetap jalan walau Rugcheck mati.
    return result; 
  }
}

/**
 * Security & Momentum filter sebelum eksekusi buy.
 *
 * @param {string} tokenAddress - Mint SPL
 * @param {{ pair?: object, symbol?: string, skipCache?: boolean }} [options]
 * @returns {Promise<{
 *   approved: boolean,
 *   safe: boolean,
 *   score: number,
 *   reasons: string[],
 *   checks: object,
 *   analyzedAt: string,
 * }>}
 */
async function analyzeToken(tokenAddress, options = {}) {
  const mint = String(tokenAddress || "").trim();
  if (!mint) {
    return {
      approved: false,
      safe: false,
      score: 0,
      reasons: ["DITOLAK: tokenAddress kosong"],
      checks: {},
      analyzedAt: new Date().toISOString(),
    };
  }

  const cacheKey = mint;
  if (!options.skipCache) {
    const cached = validationCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < config.cacheTtlMs) {
      return cached.result;
    }
  }

  // 1. Rugcheck Security Scan (NEW)
  const rugcheck = await checkRugcheck(mint);
  
  let pair = options.pair || null;
  if (!pair) {
    try {
      const pairs = await fetchTokenPairs(mint, config.chainId);
      pair = selectBestPair(pairs, config.chainId);
    } catch (error) {
      console.warn(`[tokenValidator] DexScreener gagal untuk ${options.symbol || mint.slice(0, 6)}: ${error.message}`);
    }
  }

  const [authorities, liquidity] = await Promise.all([
    fetchMintAuthorities(mint),
    resolveLiquiditySol(pair, mint),
  ]);

  const momentum = resolveMomentum5m(pair || liquidity.pair);

  const checks = {
    symbol: options.symbol || pair?.baseToken?.symbol || mint.slice(0, 6),
    mint,
    rugcheckScore: rugcheck.score,
    rugcheckApproved: rugcheck.approved,
    rugcheckRisks: rugcheck.risks,
    mintAccountFound: authorities.found,
    mintAuthority: authorities.mintAuthority,
    freezeAuthority: authorities.freezeAuthority,
    mintAuthorityActive: authorities.mintAuthorityActive,
    freezeAuthorityActive: authorities.freezeAuthorityActive,
    liquiditySol: liquidity.liquiditySol,
    liquidityUsd: liquidity.liquidityUsd,
    liquiditySource: liquidity.source,
    minLiquiditySol: config.minLiquiditySol,
    momentum5mPct: momentum.changePct5m,
    momentumOverbought: momentum.overbought,
    momentumSource: momentum.source,
    maxMomentum5mPct: config.maxMomentum5mPct,
  };

  const baseResult = buildScoreAndReasons(checks);
  
  // Combine internal rules with Rugcheck
  if (!rugcheck.approved) {
    baseResult.approved = false;
    baseResult.reasons.push(`DITOLAK RUGCHECK: ${rugcheck.risks.slice(0,3).join(", ")}`);
  }

  const result = {
    approved: baseResult.approved,
    safe: baseResult.approved,
    score: baseResult.score,
    reasons: baseResult.reasons,
    checks,
    analyzedAt: new Date().toISOString(),
  };

  if (!baseResult.approved) {
    console.warn(
      `[tokenValidator] ${checks.symbol} · skor ${baseResult.score}/100 · ${baseResult.reasons.filter((r) => r.startsWith("DITOLAK")).join(" · ") || baseResult.reasons.join(" · ")}`,
    );
  } else {
    console.log(`[tokenValidator] ${checks.symbol} · LOLOS validasi · skor ${baseResult.score}/100 · LP ~${checks.liquiditySol} SOL`);
  }

  validationCache.set(cacheKey, { cachedAt: Date.now(), result });
  return result;
}

/**
 * Helper boolean — true jika aman untuk dibeli.
 */
async function isSafeToBuy(tokenAddress, options = {}) {
  const analysis = await analyzeToken(tokenAddress, options);
  return analysis.approved;
}

function clearValidationCache() {
  validationCache.clear();
}

module.exports = {
  config,
  analyzeToken,
  isSafeToBuy,
  isValidSolanaAddress,
  checkRugcheck,
  fetchMintAuthorities,
  resolveLiquiditySol,
  resolveMomentum5m,
  clearValidationCache,
};
