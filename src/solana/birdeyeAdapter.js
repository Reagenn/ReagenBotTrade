const fs = require("fs");
const path = require("path");
const axios = require("axios");
const solanaTracker = require("../adapters/solanaTracker");
const dbManager = require("../database/dbManager");
const TelegramNotifier = require("../utils/telegram_notifier");
const { isValidSolanaAddress } = require("./tokenValidator");

// Instantiate notifier for background hunter
const tg = new TelegramNotifier({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BIRDEYE_BASE = "https://public-api.birdeye.so";
const MAX_API_ATTEMPTS = 4;
const RETRY_DELAY_MS = Number(process.env.BIRDEYE_RETRY_DELAY_MS || 3500);
const QUEUE_DELAY_MS = Number(process.env.BIRDEYE_QUEUE_DELAY_MS || 2800);
const MIN_GAP_MS = Number(process.env.BIRDEYE_MIN_GAP_MS || 2800);
const CU_PAUSE_MS = Number(process.env.BIRDEYE_CU_PAUSE_MS || 300000);
const TOP_TRADERS_PER_TOKEN = Number(process.env.BIRDEYE_TOP_TRADERS_PER_TOKEN || 2);
const SMART_MONEY_TRADER_LOOKUP_TOKENS = Number(
  process.env.BIRDEYE_SMART_MONEY_TRADER_LOOKUP_TOKENS || 5
);
const ENRICH_WALLET_PNL_LIMIT = Number(process.env.BIRDEYE_ENRICH_WALLET_PNL || 2);

let smartMoneyAccessDenied = false;
let birdeyePausedUntil = 0;
let lastBirdeyeRequestAt = 0;
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

function getApiKey() {
  return getNextBirdeyeKey();
}

function buildHeaders() {
  return {
    "x-chain": "solana",
    "X-API-KEY": getApiKey(),
    accept: "application/json",
  };
}

function getBirdeyeErrorMessage(error) {
  const data = error?.response?.data;
  if (typeof data === "string") {
    return data;
  }
  return data?.message || data?.error || null;
}

function logQueueDelay(context) {
  console.log(`[birdeyeAdapter] Delay ${QUEUE_DELAY_MS / 1000}s untuk mencegah rate limit${context ? ` (${context})` : ""}...`);
}

function isComputeUnitLimitError(error) {
  const apiMessage = String(getBirdeyeErrorMessage(error) || "").toLowerCase();
  return (
    apiMessage.includes("compute units") ||
    apiMessage.includes("usage limit") ||
    apiMessage.includes("cu limit")
  );
}

function isRateLimitError(error) {
  const status = error?.response?.status;
  return status === 429 || isComputeUnitLimitError(error);
}

function pauseBirdeye(reason) {
  birdeyePausedUntil = Date.now() + CU_PAUSE_MS;
  console.warn(
    `[birdeyeAdapter] ${reason} — jeda Birdeye ${Math.round(CU_PAUSE_MS / 60000)} menit (hingga ${new Date(birdeyePausedUntil).toLocaleTimeString("id-ID")}).`
  );
}

function isBirdeyePaused() {
  return Date.now() < birdeyePausedUntil;
}

async function throttleBirdeyeGap() {
  const elapsed = Date.now() - lastBirdeyeRequestAt;
  if (elapsed < MIN_GAP_MS) {
    await sleep(MIN_GAP_MS - elapsed);
  }
  lastBirdeyeRequestAt = Date.now();
}

async function delayBetweenRequests(context) {
  logQueueDelay(context);
  await sleep(QUEUE_DELAY_MS);
}

/**
 * Request Axios ke Birdeye dengan throttle global + retry 429 / compute units.
 */
async function birdeyeRequest(config, context = "birdeyeRequest") {
  if (isBirdeyePaused()) {
    throw new Error(`Birdeye paused (CU/rate limit) until ${new Date(birdeyePausedUntil).toISOString()}`);
  }

  // Daily Quota Check (NEW)
  const quotaSafe = await dbManager.checkApiQuota('birdeye');
  if (!quotaSafe) {
    console.warn("[QUOTA] Kuota Birdeye harian (950) habis. Beralih ke fallback (Jupiter/DexScreener)...");
    throw new Error("Birdeye daily quota exceeded");
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt += 1) {
    await throttleBirdeyeGap();

    try {
      const response = await axios.request({
        timeout: 30000,
        ...config,
      });

      // Increment Usage on success
      await dbManager.incrementApiUsage('birdeye');
      
      return response;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const retryable = isRateLimitError(error);

      if (retryable && attempt < MAX_API_ATTEMPTS) {
        const waitMs = RETRY_DELAY_MS * attempt;
        const label = isComputeUnitLimitError(error) ? "Compute units" : "Rate limit 429";
        console.warn(
          `[birdeyeAdapter] ${context}: ${label}, percobaan ${attempt}/${MAX_API_ATTEMPTS}. Menunggu ${Math.round(waitMs / 1000)}s...`
        );
        await sleep(waitMs);
        continue;
      }

      if (isComputeUnitLimitError(error)) {
        pauseBirdeye("Compute units usage limit exceeded");
      }

      throw error;
    }
  }

  throw lastError;
}

function logAxiosError(context, error) {
  const status = error?.response?.status;
  const statusText = error?.response?.statusText;
  const apiMessage = getBirdeyeErrorMessage(error);
  const message = error?.message || String(error);

  if (status === 429 || isComputeUnitLimitError(error)) {
    console.error(
      `[birdeyeAdapter] ${context}: ${isComputeUnitLimitError(error) ? "Compute units limit" : "Rate limit 429"} — semua percobaan gagal.`
    );
    return;
  }

  if (status === 401 && apiMessage?.toLowerCase().includes("permission")) {
    console.error(
      `[birdeyeAdapter] ${context}: API key valid, tetapi plan Anda tidak mencakup endpoint ini (butuh Starter+). Detail: ${apiMessage}`
    );
    return;
  }

  if (status === 401) {
    console.error(
      `[birdeyeAdapter] ${context}: API key tidak valid atau kedaluwarsa. Periksa BIRDEYE_API_KEY di .env (dashboard: https://bds.birdeye.so).`
    );
    if (apiMessage) {
      console.error(`[birdeyeAdapter] ${context}: ${apiMessage}`);
    }
    return;
  }

  if (status) {
    console.error(
      `[birdeyeAdapter] ${context}: HTTP ${status} ${statusText || ""}${apiMessage ? ` — ${apiMessage}` : ` — ${message}`}`
    );
    return;
  }

  console.error(`[birdeyeAdapter] ${context}: ${message}`);
}

function extractListItems(payload) {
  const data = payload?.data ?? payload?.result ?? payload;
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.items)) {
    return data.items;
  }
  if (Array.isArray(data?.tokens)) {
    return data.tokens;
  }
  if (Array.isArray(data?.list)) {
    return data.list;
  }
  return [];
}

function parseTokenEntry(item) {
  const mint =
    item?.token ||
    item?.address ||
    item?.mint ||
    item?.token_address ||
    item?.tokenAddress ||
    item?.base_address ||
    null;

  if (!mint) {
    return null;
  }

  return {
    symbol: item?.symbol || item?.name || item?.token_symbol || "UNKNOWN",
    mint: String(mint),
    smartTradersNo: Number(item?.smart_traders_no ?? item?.smartTradersNo ?? 0),
    netFlowUsd: Number(item?.net_flow ?? item?.netFlow ?? 0),
    traderStyle: item?.trader_style || item?.traderStyle || null,
    priceUsd: Number(item?.price ?? item?.priceUsd ?? 0),
    marketCapUsd: Number(item?.market_cap ?? item?.marketCap ?? 0),
    notes: "Birdeye smart-money token list (Starter+)",
    source: "birdeye_smart_money",
    updatedAt: new Date().toISOString(),
  };
}

function computeSmartScoreFromTrader(trader) {
  const realizedPnl = Number(trader?.realizedPnl ?? trader?.realized_pnl ?? 0);
  const volumeUsd = Number(trader?.volumeUsd ?? trader?.volume_usd ?? trader?.volume ?? 0);
  let smartScore = 52;

  if (realizedPnl > 10000) smartScore += 28;
  else if (realizedPnl > 5000) smartScore += 22;
  else if (realizedPnl > 1000) smartScore += 14;
  else if (realizedPnl > 0) smartScore += 8;
  else if (realizedPnl < 0) smartScore -= 12;

  if (volumeUsd > 250000) smartScore += 12;
  else if (volumeUsd > 50000) smartScore += 7;

  return Math.max(35, Math.min(99, Math.round(smartScore)));
}

function buildWalletFromTopTrader(trader, tokenMeta) {
  const address = trader?.owner || trader?.address || trader?.wallet;
  if (!address) {
    return null;
  }

  return {
    label: `${tokenMeta.symbol} · top trader`,
    address: String(address),
    smartScore: computeSmartScoreFromTrader(trader),
    source: "birdeye_top_traders",
    linkedMint: tokenMeta.mint,
    realizedPnl24h: Number(trader?.realizedPnl ?? trader?.realized_pnl ?? 0),
    volumeUsd24h: Number(trader?.volumeUsd ?? trader?.volume_usd ?? trader?.volume ?? 0),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchTopTradersForToken(mint, symbol) {
  const response = await birdeyeRequest(
    {
      method: "GET",
      url: `${BIRDEYE_BASE}/defi/v2/tokens/top_traders`,
      params: {
        address: mint,
        time_frame: "24h",
        sort_by: "realized_pnl",
        sort_type: "desc",
        offset: 0,
        limit: TOP_TRADERS_PER_TOKEN,
      },
      headers: buildHeaders(),
    },
    `top_traders(${symbol || mint.slice(0, 6)})`
  );

  return response.data?.data?.items || [];
}

/**
 * Isi smartWallets dari top traders per token (tersedia di plan Lite+).
 */
async function hydrateSmartWalletsFromTopTraders(parsedTokens) {
  const ranked = [...parsedTokens]
    .sort((a, b) => (b.smartTradersNo || 0) - (a.smartTradersNo || 0))
    .slice(0, SMART_MONEY_TRADER_LOOKUP_TOKENS);

  const walletByAddress = new Map();

  for (let index = 0; index < ranked.length; index += 1) {
    const token = ranked[index];

    try {
      const traders = await fetchTopTradersForToken(token.mint, token.symbol);
      for (const trader of traders) {
        const wallet = buildWalletFromTopTrader(trader, token);
        if (!wallet) {
          continue;
        }

        const existing = walletByAddress.get(wallet.address);
        if (!existing || wallet.smartScore > existing.smartScore) {
          walletByAddress.set(wallet.address, {
            ...existing,
            ...wallet,
            smartScore: Math.max(existing?.smartScore || 0, wallet.smartScore),
          });
        }
      }
    } catch (error) {
      logAxiosError(`hydrateSmartWallets(${token.symbol})`, error);
    }

    if (index < ranked.length - 1) {
      await delayBetweenRequests(`top traders ${index + 1}/${ranked.length}`);
    }
  }

  const wallets = [...walletByAddress.values()];
  console.log(
    `[birdeyeAdapter] Smart wallet dari top_traders: ${wallets.length} alamat (dari ${ranked.length} token).`
  );
  return wallets;
}

async function enrichTopWalletsWithPnL(wallets) {
  if (ENRICH_WALLET_PNL_LIMIT <= 0 || !wallets.length) {
    return wallets;
  }

  const ranked = [...wallets].sort((a, b) => (b.smartScore || 0) - (a.smartScore || 0));
  const targets = ranked.slice(0, ENRICH_WALLET_PNL_LIMIT);

  for (let index = 0; index < targets.length; index += 1) {
    const wallet = targets[index];
    const pnl = await analyzeWalletPnL(wallet.address, {
      skipQueueDelay: index === targets.length - 1,
    });

    if (pnl) {
      wallet.winRate = pnl.winRate;
      wallet.totalPnL = pnl.totalPnL;
      wallet.smartScore = Math.min(
        99,
        Math.round((wallet.smartScore || 50) * 0.55 + (pnl.winRate || 0) * 0.45)
      );
      wallet.pnlSource = "birdeye_wallet_pnl";
    }
  }

  return wallets;
}

async function probeSmartMoneyAccess() {
  if (!getApiKey()) {
    return false;
  }

  try {
    await birdeyeRequest(
      {
        method: "GET",
        url: `${BIRDEYE_BASE}/smart-money/v1/token/list`,
        params: {
          interval: "1d",
          trader_style: "all",
          sort_by: "smart_traders_no",
          sort_type: "desc",
          offset: 0,
          limit: 1,
        },
        headers: buildHeaders(),
      },
      "probeSmartMoneyAccess"
    );
    smartMoneyAccessDenied = false;
    console.log("[birdeyeAdapter] Smart Money API aktif (plan Starter+ terdeteksi).");
    return true;
  } catch (error) {
    const apiMessage = getBirdeyeErrorMessage(error);
    if (
      error?.response?.status === 401 &&
      apiMessage?.toLowerCase().includes("permission")
    ) {
      return false;
    }
    logAxiosError("probeSmartMoneyAccess", error);
    return false;
  }
}

function parseWalletAddresses(item) {
  const candidates = [
    item?.top_traders,
    item?.smart_traders,
    item?.traders,
    item?.wallets,
    item?.smart_wallets,
  ];

  const wallets = [];
  for (const group of candidates) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const entry of group) {
      const address =
        typeof entry === "string"
          ? entry
          : entry?.address || entry?.wallet || entry?.owner || entry?.wallet_address;
      if (address) {
        wallets.push(String(address));
      }
    }
  }
  return wallets;
}

function mergeTokens(existing, incoming) {
  const byMint = new Map(existing.map((token) => [token.mint, token]));
  for (const token of incoming) {
    byMint.set(token.mint, { ...byMint.get(token.mint), ...token });
  }
  return [...byMint.values()];
}

function mergeSmartWallets(existing, incoming) {
  const byAddress = new Map(existing.map((wallet) => [wallet.address, wallet]));
  for (const wallet of incoming) {
    byAddress.set(wallet.address, { ...byAddress.get(wallet.address), ...wallet });
  }
  return [...byAddress.values()];
}

function parseTrendingTokenEntry(item) {
  const mint = item?.address || item?.token || item?.mint;
  if (!mint) {
    return null;
  }

  return {
    symbol: item?.symbol || item?.name || "UNKNOWN",
    mint: String(mint),
    rank: Number(item?.rank ?? 0),
    volume24hUsd: Number(item?.volume24hUSD ?? item?.volume24hUsd ?? 0),
    notes: "Birdeye token_trending (fallback, plan tanpa Smart Money)",
    source: "birdeye_trending",
    updatedAt: new Date().toISOString(),
  };
}

async function persistWatchlistTokens(parsedTokens, parsedWallets, source) {
  const watchlist = await dbManager.getWatchlist();
  const updated = {
    ...watchlist,
    smartWallets: mergeSmartWallets(watchlist.smartWallets, parsedWallets),
    tokens: mergeTokens(watchlist.tokens, parsedTokens),
    birdeyeUpdatedAt: new Date().toISOString(),
    birdeyeWatchlistSource: source,
  };

  await dbManager.saveWatchlist(updated);
  console.log(
    `[birdeyeAdapter] Watchlist diperbarui (${source}): ${updated.tokens.length} token, ${updated.smartWallets.length} smart wallet.`
  );
  return updated;
}

async function parseTrendingTokensSequentially(tokens) {
  const parsedTokens = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const entry = parseTrendingTokenEntry(token);
    if (entry) {
      parsedTokens.push(entry);
    }

    if (index < tokens.length - 1) {
      await delayBetweenRequests(`trending token ${index + 1}/${tokens.length}`);
    }
  }

  return parsedTokens;
}

async function parseSmartMoneyItemsSequentially(items) {
  const parsedTokens = [];
  const parsedWallets = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const tokenEntry = parseTokenEntry(item);
    if (tokenEntry) {
      parsedTokens.push(tokenEntry);
    }

    const mint = item?.token || item?.address || item?.mint || item?.token_address;
    for (const address of parseWalletAddresses(item)) {
      parsedWallets.push({
        label: `Smart trader (${mint ? String(mint).slice(0, 6) : "token"})`,
        address,
        source: "birdeye",
        updatedAt: new Date().toISOString(),
      });
    }

    if (index < items.length - 1) {
      await delayBetweenRequests(`smart money item ${index + 1}/${items.length}`);
    }
  }

  return { parsedTokens, parsedWallets };
}

/**
 * Fallback untuk plan Lite: isi token dari /defi/token_trending.
 */
async function updateWatchlistFromTrending() {
  try {
    const response = await birdeyeRequest(
      {
        method: "GET",
        url: `${BIRDEYE_BASE}/defi/token_trending`,
        params: {
          sort_by: "rank",
          sort_type: "asc",
          offset: 0,
          limit: 20,
        },
        headers: buildHeaders(),
      },
      "updateWatchlistFromTrending"
    );

    const tokens = response.data?.data?.tokens || [];
    const parsedTokens = await parseTrendingTokensSequentially(tokens);
    let parsedWallets = await hydrateSmartWalletsFromTopTraders(parsedTokens);
    parsedWallets = await enrichTopWalletsWithPnL(parsedWallets);
    return await persistWatchlistTokens(parsedTokens, parsedWallets, "token_trending+top_traders");
  } catch (error) {
    logAxiosError("updateWatchlistFromTrending", error);
    return [];
  }
}

/**
 * Layer 4 — perbarui watchlist dari Birdeye Smart Money Token List.
 * @returns {Promise<object|[]>} Watchlist tersimpan, atau [] jika gagal.
 */
async function updateSmartMoneyWatchlist() {
  if (process.env.SOLANA_SKIP_BIRDEYE_SMART_MONEY === "true") {
    return [];
  }

  if (smartMoneyAccessDenied) {
    const upgraded = await probeSmartMoneyAccess();
    if (!upgraded) {
      return updateWatchlistFromTrending();
    }
  }

  if (!getApiKey()) {
    console.error("[birdeyeAdapter] updateSmartMoneyWatchlist: BIRDEYE_API_KEY atau BIRDEYE_API_KEYS tidak diset.");
    return [];
  }

  try {
    const response = await birdeyeRequest(
      {
        method: "GET",
        url: `${BIRDEYE_BASE}/smart-money/v1/token/list`,
        params: {
          interval: "1d",
          trader_style: "all",
          sort_by: "smart_traders_no",
          sort_type: "desc",
          offset: "0",
          limit: "20",
        },
        headers: buildHeaders(),
      },
      "updateSmartMoneyWatchlist"
    );

    smartMoneyAccessDenied = false;
    const items = extractListItems(response.data);
    const { parsedTokens, parsedWallets: embeddedWallets } = await parseSmartMoneyItemsSequentially(items);
    let parsedWallets = mergeSmartWallets(
      embeddedWallets,
      await hydrateSmartWalletsFromTopTraders(parsedTokens)
    );
    parsedWallets = await enrichTopWalletsWithPnL(parsedWallets);
    return await persistWatchlistTokens(parsedTokens, parsedWallets, "smart_money+top_traders");
  } catch (error) {
    const apiMessage = getBirdeyeErrorMessage(error);
    if (
      error?.response?.status === 401 &&
      apiMessage?.toLowerCase().includes("permission")
    ) {
      smartMoneyAccessDenied = true;
      console.warn(
        "[birdeyeAdapter] Smart Money tidak tersedia di plan ini; memakai token_trending sebagai fallback."
      );
      await delayBetweenRequests("sebelum fallback token_trending");
      return updateWatchlistFromTrending();
    }
    logAxiosError("updateSmartMoneyWatchlist", error);
    return [];
  }
}

/**
 * Layer 4 — analisis PnL ringkas untuk satu wallet Solana.
 * @param {string} walletAddress
 * @param {{ skipQueueDelay?: boolean }} [options]
 * @returns {Promise<{ winRate: number, totalPnL: number }|null>}
 */
async function analyzeWalletPnL(walletAddress, options = {}) {
  if (!walletAddress) {
    console.error("[birdeyeAdapter] analyzeWalletPnL: walletAddress wajib diisi.");
    return null;
  }

  if (!getApiKey()) {
    console.error("[birdeyeAdapter] analyzeWalletPnL: BIRDEYE_API_KEY atau BIRDEYE_API_KEYS tidak diset.");
    return null;
  }

  try {
    const response = await birdeyeRequest(
      {
        method: "GET",
        url: `${BIRDEYE_BASE}/wallet/v2/pnl/summary`,
        params: {
          wallet: walletAddress,
          duration: "24h",
        },
        headers: buildHeaders(),
      },
      `analyzeWalletPnL(${walletAddress})`
    );

    const data = response.data?.data ?? response.data?.result ?? response.data ?? {};

    const winRate = Number(
      data.win_rate ?? data.winrate ?? data.winRate ?? data.win_rate_percent ?? 0
    );

    const totalPnL = Number(
      data.total_pnl ??
        data.total_pnl_usd ??
        data.total_usd ??
        data.totalPnL ??
        (Number(data.realized_profit_usd ?? data.realized_pnl_usd ?? 0) +
          Number(data.unrealized_usd ?? data.unrealized_pnl_usd ?? 0))
    );

    const tradeCount = Number(data.total_trade ?? data.trade_count ?? data.tradeCount ?? 0);

    return { winRate, totalPnL, tradeCount };
  } catch (error) {
    logAxiosError(`analyzeWalletPnL(${walletAddress})`, error);
    return null;
  } finally {
    if (!options.skipQueueDelay && !isBirdeyePaused()) {
      await delayBetweenRequests(`setelah PnL wallet ${walletAddress.slice(0, 6)}...`);
    }
  }
}

/**
 * Smart Money Hunter: Mencari dompet dewa (high winrate & pnl) dari top traders koin.
 */
async function huntSmartMoney(tokenAddress) {
  if (isBirdeyePaused()) return [];
  
  console.log(`[SMART-HUNTER] Hunting traders for token: ${tokenAddress.slice(0, 12)}...`);
  
  try {
    const traders = await fetchTopTradersForToken(tokenAddress, "HUNTER");
    const smartFound = [];

    for (const trader of traders) {
      const address = trader.owner || trader.address;
      if (!address) continue;

      const stats = await analyzeWalletPnL(address);
      if (!stats) continue;

      // Filter ketat: Winrate > 70%, PnL > $1000, Trades > 10
      if (stats.winRate > 70 && stats.totalPnL > 1000 && stats.tradeCount > 10) {
        console.log(`[SMART-HUNTER] DEWA FOUND! ${address.slice(0, 10)}... WR: ${stats.winRate.toFixed(1)}% | PnL: $${stats.totalPnL.toFixed(0)} | Trades: ${stats.tradeCount}`);
        
        await dbManager.addOrUpdateSmartWallet({
          address: address,
          winrate: stats.winRate,
          pnl: stats.totalPnL,
          trades: stats.tradeCount
        });

        // Task: Rich Telegram Notif for Hunter
        try {
          await tg.sendSmartHunter({
            address: address,
            winrate: stats.winRate,
            pnl: stats.totalPnL,
            trades: stats.tradeCount,
            linkedToken: tokenAddress.slice(0, 8) + "..."
          });
        } catch (tgErr) {
          console.warn("[TELEGRAM ERROR] Gagal kirim notif hunter:", tgErr.message);
        }
        
        smartFound.push(address);
      }
    }
    
    return smartFound;
  } catch (err) {
    console.error(`[SMART-HUNTER] Hunting failed for ${tokenAddress.slice(0, 6)}:`, err.message);
    return [];
  }
}

/**
 * Analisis PnL banyak wallet secara berurutan (tanpa Promise.all).
 * @param {string[]} walletAddresses
 * @returns {Promise<Record<string, { winRate: number, totalPnL: number }|null>>}
 */
async function analyzeWalletsPnLSequential(walletAddresses) {
  const results = {};
  const wallets = Array.isArray(walletAddresses) ? walletAddresses : [];

  for (let index = 0; index < wallets.length; index += 1) {
    const address = wallets[index];
    const isLast = index === wallets.length - 1;
    results[address] = await analyzeWalletPnL(address, { skipQueueDelay: isLast });
  }

  return results;
}

function classifyHoldingUsd(holdingUsd) {
  if (holdingUsd < 10) return "under10";
  if (holdingUsd < 1000) return "over100";
  if (holdingUsd < 10000) return "over1k";
  return "over10k";
}

function appendHolderSnapshot(historyByMint, mint, analytics) {
  if (!analytics) return historyByMint;

  const next = { ...historyByMint };
  const series = Array.isArray(next[mint]) ? [...next[mint]] : [];
  series.push({
    timestamp: Date.now(),
    totalHolders: analytics.totalHolders,
    uniqueWallet24h: analytics.uniqueWallet24h,
    under10: analytics.tiers.under10,
    over100: analytics.tiers.over100,
    over1k: analytics.tiers.over1k,
    over10k: analytics.tiers.over10k,
    smartMoney: analytics.smartMoney.count,
    whale: analytics.whale.count,
  });

  const maxPoints = Number(process.env.SOLANA_HOLDER_HISTORY_MAX || 84);
  next[mint] = series.slice(-maxPoints);
  return next;
}

function buildTierCounts() {
  return {
    under10: 0,
    over100: 0,
    over1k: 0,
    over10k: 0,
  };
}

/**
 * Detail holder token: tier USD, jumlah smart money & whale (Birdeye + watchlist).
 * @param {string} mint
 * @param {{ priceUsd?: number, symbol?: string, smartWalletAddresses?: string[], smartTradersNo?: number }} options
 */
async function fetchTokenHolderAnalytics(mint, options = {}) {
  const address = String(mint || "").trim();
  if (!address) {
    return null;
  }

  if (!isValidSolanaAddress(address)) {
    console.log(`[VALIDATION] Mengabaikan token analytics untuk address tidak valid: ${address}`);
    return null;
  }

  let priceUsd = Number(options.priceUsd || 0);

  if (priceUsd <= 0) {
    try {
      const priceFetcher = require("./priceFetcher");
      const priceQuote = await priceFetcher.getTokenPrice(mint);
      priceUsd = priceQuote.priceUsd;
    } catch (e) {
      console.warn(`[birdeyeAdapter] Gagal ambil harga live untuk ${mint.slice(0, 6)}, menggunakan fallback $0.00001: ${e.message}`);
      priceUsd = 0.00001; 
    }
  }

  try {
    const resolvedPrice = priceUsd;
    const trackerResult = await solanaTracker.getTokenWhales(mint, resolvedPrice);
    
    const whaleCount = trackerResult.whaleCount || 0;

    const whaleWallets = (trackerResult.whales || []).map((w) => ({
      address: w.address,
      holdingUsd: w.uiAmount * resolvedPrice,
      uiAmount: w.uiAmount,
      percent: w.percent,
    }));

    const tiers = {
      under10: trackerResult.tiers?.under10 || 0,
      over100: trackerResult.tiers?.over100 || 0,
      over1k: trackerResult.tiers?.over1k || 0,
      over10k: trackerResult.tiers?.over10k || whaleCount
    };

    return {
      mint,
      symbol: options.symbol || "UNKNOWN",
      priceUsd: resolvedPrice,
      generatedAt: new Date().toISOString(),
      fetchMode: options.mode || "full",
      totalHolders: trackerResult.totalHolders,
      uniqueWallet24h: 0,
      tiers,
      sampledHolders: trackerResult.sampledHolders || trackerResult.whales?.length || 0,
      smartMoney: {
        holdersOnToken: 0,
        activeTraders24h: 0,
        birdeyeSmartTradersNo: 0,
        count: 0,
        wallets: [],
      },
      whale: {
        holdersOverThreshold: whaleCount,
        activeTraders24h: whaleCount,
        thresholdUsd: 10000,
        count: whaleCount,
        wallets: whaleWallets.slice(0, 12),
      },
      changes: {
        uniqueWallet24h: 0,
        holder: 0,
      },
      topHoldersSupplyPercent: trackerResult.topHoldersSupplyPercent,
      warning: trackerResult.warning,
      source: "helius_native_rpc",
    };
  } catch (error) {
    console.error(`[birdeyeAdapter] Gagal mengambil holder analytics via Helius untuk ${mint}:`, error.message);
    return null;
  }
}

/**
 * Mengambil trade terbaru untuk token dan memfilter swap besar (> minUsd).
 * @param {string} mint
 * @param {number} minUsd
 * @returns {Promise<object[]>}
 */
async function getBigSwaps(mint, minUsd = 5000) {
  if (!getApiKey() || isBirdeyePaused()) return [];

  try {
    const response = await birdeyeRequest({
      method: "GET",
      url: `${BIRDEYE_BASE}/defi/txs/token`,
      params: {
        address: mint,
        offset: 0,
        limit: 50,
      },
      headers: buildHeaders(),
    }, `getBigSwaps(${mint.slice(0, 6)})`);

    const items = response.data?.data?.items || [];
    
    // Filter & Map ke format standar
    return items
      .filter(tx => {
        const val = Number(tx.vUSD || tx.volumeUsd || 0);
        return val >= minUsd;
      })
      .map(tx => ({
        timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString(),
        amountUsd: Number(tx.vUSD || tx.volumeUsd || 0),
        side: tx.side || (tx.from?.symbol === 'SOL' ? 'buy' : 'sell'),
        signature: tx.txHash,
        walletAddress: tx.owner || tx.from?.address || tx.to?.address
      }));
  } catch (error) {
    // Elegant catch agar tidak mematikan bot
    console.warn(`[birdeyeAdapter] Gagal ambil big swaps untuk ${mint.slice(0, 6)}: ${error.message}`);
    return [];
  }
}

module.exports = {
  updateSmartMoneyWatchlist,
  analyzeWalletPnL,
  analyzeWalletsPnLSequential,
  probeSmartMoneyAccess,
  hydrateSmartWalletsFromTopTraders,
  fetchTokenHolderAnalytics,
  appendHolderSnapshot,
  getBigSwaps,
  isBirdeyePaused,
  huntSmartMoney,
};
