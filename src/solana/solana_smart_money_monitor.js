require("dotenv").config();
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const TelegramNotifier = require("../utils/telegram_notifier");
const {
  updateSmartMoneyWatchlist,
  analyzeWalletPnL,
  fetchTokenHolderAnalytics,
  getBigSwaps,
  isBirdeyePaused,
  huntSmartMoney
} = require("./birdeyeAdapter");
const dbManager = require("../database/dbManager");
const TelegramBot = require("../utils/telegram_bot");
const tokenValidator = require("./tokenValidator");
const { analyzeWallet } = require("./walletAnalyzer");
const { runSolanaPaperTradingCycle } = require("./solanaPaperTrading");
const alphaScraper = require("../adapters/alphaScraper");
const heliusProfiler = require("../adapters/heliusProfiler");
const rugcheckAdapter = require("../adapters/rugcheckAdapter");
const gmgnAdapter = require("../adapters/gmgnAdapter");
const solanaTracker = require("../adapters/solanaTracker"); // Whale Detector
const bitqueryAdapter = require("../advanced_trackers/bitqueryAdapter");
const smartMoneyBuilder = require("../advanced_trackers/smartMoneyBuilder");

const {
  ensureTokenWorthAnalyzing,
  selectBestPair,
  fetchTokenPairs,
  fetchLatestTokenProfiles,
  fetchLatestBoosts,
  fetchTopBoosts,
  extractPairMetrics
} = require("./dexscreenerAdapter");

let currentHeliusIndex = 0;
function getHeliusKeys() {
  const raw = process.env.HELIUS_API_KEY || process.env.HELIUS_API_KEYS || "";
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

function getNextHeliusKey() {
  const keys = getHeliusKeys();
  if (keys.length === 0) return "";
  const key = keys[currentHeliusIndex];
  currentHeliusIndex = (currentHeliusIndex + 1) % keys.length;
  return key;
}

function resolveSolanaRpcUrl() {
  const configured = String(process.env.SOLANA_RPC_URL || "").trim();
  const heliusKey = getNextHeliusKey();
  
  const isHeliusUrl = configured.includes("helius");
  const useHelius = process.env.SOLANA_USE_HELIUS_RPC !== "false" && heliusKey && (!configured || isHeliusUrl || configured.includes("api.mainnet-beta.solana.com"));

  if (useHelius) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

  return configured || "https://api.mainnet-beta.solana.com";
}

const config = {
  chainId: "solana",
  rpcUrl: resolveSolanaRpcUrl(),
  rpcDelayMs: Number(process.env.SOLANA_RPC_DELAY_MS || 450),
  rpcMaxRetries: Number(process.env.SOLANA_RPC_MAX_RETRIES || 6),
  rpcRetryBaseMs: Number(process.env.SOLANA_RPC_RETRY_BASE_MS || 2000),
  watchlistPath: path.resolve(process.env.SOLANA_WATCHLIST_PATH || path.join(__dirname, "../../data/solana_watchlist.json")),
  pollIntervalMs: Number(process.env.SOLANA_MONITOR_POLL_MS || 300000), 
  minLiquidityUsd: Number(process.env.SOLANA_MIN_LIQUIDITY_USD || 25000),
  minVolume24hUsd: Number(process.env.SOLANA_MIN_VOLUME_24H_USD || 50000),
  discoveryLimit: Number(process.env.SOLANA_DISCOVERY_LIMIT || 8),
  strongBuyScore: Number(process.env.SOLANA_STRONG_BUY_SCORE || 75),
  buyScore: Number(process.env.SOLANA_BUY_SCORE || 60),
  watchlistEveryNCycles: Number(process.env.SOLANA_WATCHLIST_EVERY_N_CYCLES || 5),
  heliusEnabled: !!(process.env.HELIUS_API_KEY || process.env.HELIUS_API_KEYS),
  bitqueryEnabled: !!process.env.BITQUERY_API_KEY,
  telegramAlertAppearances: process.env.SOLANA_TELEGRAM_ALERT_APPEARANCES !== "false",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
};

let monitorCycleRunning = false;
let cycleCount = 0;

const notifier = new TelegramNotifier({
  botToken: config.telegramBotToken,
  chatId: config.telegramChatId
});

/**
 * Persist discovery signals to SQLite with Smart Notification logic
 */
async function persistDiscoveryCandidates(candidates) {
  for (const c of candidates) {
    try {
      const now = new Date();
      const accumInfo = `Akumulasi ${now.toLocaleDateString('id-ID')} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      const dbResult = await dbManager.addToMonitor({
        token_address: c.token.mint,
        symbol: c.token.symbol,
        status: 'DISCOVERY',
        discovery_tier: c.labels?.tier || 'NEW',
        score: c.score || 0,
        strategy_status: c.status || 'WATCHING',
        timeframe: accumInfo,
        pair_data: c.pair,
        holders_data: c.holderAnalytics,
        smart_money_data: c.smartWalletSignal,
        whale_data: c.whaleSignal,
        rug_status: c.rug_status,
        liq_status: c.liq_status,
        smart_money_count: c.smartWalletSignal?.walletBuyCount || 0,
        whale_count: c.whaleSignal?.whaleWalletCount || 0
      });

      // --- SMART NOTIFICATION LOGIC ---
      const isNewDiscovery = dbResult.isNew;
      const currentTier = c.labels?.tier || 'WATCH';
      const oldTier = dbResult.oldData?.discovery_tier || 'WATCH';
      
      // Tier Priority: FIRE (2) > ALPHA (1) > WATCH/NEW (0)
      const getTierWeight = (t) => t === 'FIRE' ? 2 : (t === 'ALPHA' ? 1 : 0);
      const isUpgrade = getTierWeight(currentTier) > getTierWeight(oldTier);

      const alertPayload = {
        name: c.token.name,
        symbol: c.token.symbol,
        mint: c.token.mint,
        marketCap: c.pair?.marketCap || 0,
        liquidity: c.pair?.liquidityUsd || 0,
        whaleCount: c.whaleSignal?.whaleWalletCount || 0,
        insiderCount: c.smartWalletSignal?.walletBuyCount || 0,
        rugcheckStatus: c.rug_status,
        source: "Scanner Analysis"
      };

      if (isNewDiscovery) {
        // Hanya kirim [NEW MONITOR] untuk koin yang benar-benar baru
        if (currentTier === 'FIRE' || currentTier === 'ALPHA') {
           await notifier.sendMonitorAlert(alertPayload);
        }
      } else if (isUpgrade) {
        // Kirim [🔥 TIER UPGRADE] jika koin naik kelas
        const upgradeMsg = `<b>[🔥 TIER UPGRADE] ${alertPayload.symbol} NAIK LEVEL!</b>\n\n` +
                           `Koin ${alertPayload.symbol} sekarang masuk tier <b>${currentTier}</b> (sebelumnya ${oldTier}).\n` +
                           `Skor saat ini: <code>${c.score}</code>\n\n` +
                           `📄 CA: <code>${alertPayload.mint}</code>`;
        await notifier.sendMessage(upgradeMsg);
      }
      
    } catch (err) {
      console.error("[SCANNER] Notification error:", err.message);
    }
  }
}

/**
 * Main logic for a single monitoring cycle
 */
async function runMonitorCycle() {
  if (monitorCycleRunning) {
    console.warn("[SCANNER] Siklus sebelumnya masih berjalan, skipping...");
    return;
  }

  monitorCycleRunning = true;
  cycleCount++;
  console.log(`\n[SCANNER HEARTBEAT] 🔍 Memulai siklus #${cycleCount} pada ${new Date().toLocaleTimeString()}`);

  try {
    // 0. Quota & Cache Check
    const birdeyeQuota = await dbManager.checkApiQuota('birdeye');
    const heliusQuota = await dbManager.checkApiQuota('helius');
    console.log(`[QUOTA] Birdeye: ${birdeyeQuota ? 'OK' : 'LIMIT'}, Helius: ${heliusQuota ? 'OK' : 'LIMIT'}`);

    // --- NEW: DB CACHE FOR OPTIMIZATION ---
    const [existingMints, blacklistedMints] = await Promise.all([
      dbManager.getMonitoredMints(),
      dbManager.getBlacklistedMints()
    ]);
    const existingSet = new Set(existingMints);
    const blacklistSet = new Set(blacklistedMints);
    console.log(`[FILTER DB] Cache loaded: ${existingMints.length} dipantau | ${blacklistedMints.length} blacklist.`);

    // 1. Fetch Candidates from GMGN Smart Money Radar
    console.log("[🎯 RADAR] Memindai sinyal beli beruntun dari Smart Money via GMGN...");
    const gmgnBuySignals = await gmgnAdapter.getSmartMoneyBuySignals();
    
    // Task: Cache Smart Money Wallets for Holder Profiler sync
    const cachedSmartMoneyWallets = gmgnBuySignals.map(s => s.address || s.wallet_address).filter(Boolean);

    const gmgnCandidates = gmgnBuySignals.map(s => ({
      tokenAddress: s.token_address || s.mint || s.address,
      symbol: s.symbol || s.base_token_symbol || '?',
      name: s.name || s.base_token_name || '?',
      description: "🎯 Captured via GMGN Smart Money Buy Signal",
      isGmgVip: true
    })).filter(c => c.tokenAddress);

    // 2. Fetch Candidates from DexScreener
    console.log("[SCANNER API] Mengambil koin terbaru dan boosted dari DexScreener...");
    const [boosts, profiles] = await Promise.all([
      fetchLatestBoosts().catch(e => []),
      fetchLatestTokenProfiles().catch(e => [])
    ]);

    // Map and Filter
    const rawCandidates = [...gmgnCandidates, ...boosts, ...profiles];
    const uniqueMints = new Set();
    const newTokensToScan = [];
    const existingTokensToUpdate = [];

    for (const item of rawCandidates) {
      const mint = item.tokenAddress;
      if (!mint || uniqueMints.has(mint) || blacklistSet.has(mint)) continue;
      if (!mint.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) continue;
      
      uniqueMints.add(mint);

      const candidateObj = {
        token: { mint, symbol: item.symbol || '?', name: item.name || '?', description: item.description || 'DexScreener discovery' },
        pair: { url: item.url, chainId: item.chainId, boostsActive: item.amount || 0 },
        score: item.amount ? 40 : 20,
        status: 'WATCH',
        isBirdeyeVip: !!item.isBirdeyeVip
      };

      if (existingSet.has(mint)) {
        existingTokensToUpdate.push(candidateObj);
      } else {
        newTokensToScan.push(candidateObj);
      }
    }

    console.log(`[FILTER DB] Lolos koin baru: ${newTokensToScan.length} | Koin lama di-update: ${existingTokensToUpdate.length}`);

    // --- PIPELINE 1: LIGHT UPDATE (Existing Tokens - Silent) ---
    for (const existing of existingTokensToUpdate) {
      try {
        const pairs = await fetchTokenPairs(existing.token.mint, config.chainId);
        const bestPairRaw = selectBestPair(pairs, config.chainId);
        if (!bestPairRaw) continue;
        const metrics = extractPairMetrics(bestPairRaw);
        
        await dbManager.run(`UPDATE monitor_list SET price = ?, market_cap = ?, liq_status = ? WHERE token_address = ?`, 
          [metrics.priceUsd, metrics.marketCap, metrics.liquidityUsd >= 50000 ? 'SAFE' : 'MEDIUM', existing.token.mint]);
      } catch (e) {}
    }

    // --- PIPELINE 2: HEAVY SCAN (New Tokens Only) ---
    const enrichedCandidates = [];
    const funnelStats = { total: newTokensToScan.length, noPair: 0, lowQuality: 0, rugRisk: 0, error: 0, lolos: 0 };

    for (const candidate of newTokensToScan.slice(0, config.discoveryLimit * 3)) {
      try {
        const mint = candidate.token.mint;
        
        // a. Fetch Pair Metrics
        const pairs = await fetchTokenPairs(mint, config.chainId);
        const bestPairRaw = selectBestPair(pairs, config.chainId);
        
        if (!bestPairRaw) {
          funnelStats.noPair++;
          continue;
        }

        // Task: Use robust extraction logic for correct data mapping
        const metrics = extractPairMetrics(bestPairRaw);
        
        // Task: Re-evaluate Gatekeeper (Liquidity/Volume) BEFORE processing further
        // Task: Apply "Whale Bypass" for Birdeye VIP tokens (Lower threshold)
        const isVip = !!candidate.isBirdeyeVip;
        const minLiquidity = isVip ? 2000 : 10000;
        
        if (metrics.liquidityUsd < minLiquidity) {
          funnelStats.lowQuality++;
          continue;
        }

        // Flatten metrics into bestPair and attach to candidate
        const bestPair = { ...bestPairRaw, ...metrics };
        candidate.pair = { ...candidate.pair, ...bestPair };
        candidate.token.symbol = bestPair.baseToken?.symbol || candidate.token.symbol;
        candidate.token.name = bestPair.baseToken?.name || candidate.token.name;

        // Task: Fix missing description ("-") or generic placeholders
        if (isVip) {
          candidate.token.description = "🔥 Captured via Birdeye Smart Money";
        } else if (!candidate.token.description || candidate.token.description === 'DexScreener discovery' || candidate.token.description === '-') {
          candidate.token.description = `${candidate.token.name} (${candidate.token.symbol}) - Token Solana Baru`;
        }

        // b. Security Audit (Rugcheck + GoPlus Fallback)
        const audit = await rugcheckAdapter.analyzeToken(mint);
        if (audit.status === 'DANGER') {
          funnelStats.rugRisk++;
          console.log(`[SCANNER] REJECT ${candidate.token.symbol} (Audit DANGER): ${audit.risks.slice(0, 2).join(', ')}`);
          continue;
        }

        // --- NEW: Token Security & Dev Info Investigation via GMGN ---
        console.log(`[🛡️ SECURITY CHECK] Memindai kontrak pintar token ${candidate.token.symbol}...`);
        const security = await gmgnAdapter.getTokenSecurity(mint);
        
        if (!security) {
           funnelStats.rugRisk++;
           console.log(`[🚨 ANTI-RUG] Membatalkan pembelian ${candidate.token.symbol}. Gagal mendapatkan data Security (Safety First).`);
           continue; 
        }

        const secData = security.data || security; 

        if (secData.is_honeypot === true) {
           funnelStats.rugRisk++;
           console.log(`[🚨 ANTI-RUG] Membatalkan pembelian ${candidate.token.symbol}. Terdeteksi HONEYPOT!`);
           await dbManager.blacklistToken(mint, candidate.token.symbol, `Anti-Rug: Honeypot`);
           continue;
        }

        const buyTax = Number(secData.buy_tax || 0);
        const sellTax = Number(secData.sell_tax || 0);
        if (buyTax > 0.1 || sellTax > 0.1 || buyTax > 10 || sellTax > 10) { 
           funnelStats.rugRisk++;
           console.log(`[🚨 ANTI-RUG] Membatalkan pembelian ${candidate.token.symbol}. Tax terlalu tinggi (Buy: ${buyTax}, Sell: ${sellTax}).`);
           await dbManager.blacklistToken(mint, candidate.token.symbol, `Anti-Rug: High Tax`);
           continue;
        }

        const top10 = Number(secData.top_10_holder_rate || secData.top_10_holders || 0);
        if (top10 > 0.4 || top10 > 40) {
           funnelStats.rugRisk++;
           console.log(`[🚨 ANTI-RUG] Membatalkan pembelian ${candidate.token.symbol}. Top 10 Holders menguasai > 40% suplai.`);
           await dbManager.blacklistToken(mint, candidate.token.symbol, `Anti-Rug: Top 10 > 40%`);
           continue;
        }

        console.log(`[🧐 DEV ANALYSIS] Memata-matai dompet developer ${candidate.token.symbol}...`);
        const devInfo = await gmgnAdapter.getDevInfo(mint);
        
        if (!devInfo) {
           funnelStats.rugRisk++;
           console.log(`[🚨 ANTI-RUG] Membatalkan pembelian ${candidate.token.symbol}. Gagal mendapatkan data Dev Info (Safety First).`);
           continue;
        }

        const devData = devInfo.data || devInfo;
        const devHolding = Number(devData.creator_token_status || devData.dev_holding_rate || devData.holding_rate || devData.creator_percentage || 0);
        
        if (devHolding > 0.1 || devHolding > 10) {
           funnelStats.rugRisk++;
           console.log(`[🚨 RUG ALERT] Developer memegang terlalu banyak token! (${devHolding}) Membatalkan ${candidate.token.symbol}.`);
           await dbManager.blacklistToken(mint, candidate.token.symbol, `Anti-Rug: Dev Holding > 10%`);
           continue;
        }

        // c. Holder Analytics (Helius/SolanaTracker)
        // Task: Sync Smart Money cache to Profiler
        const holderAnalytics = await solanaTracker.getTokenWhales(mint, bestPair.priceUsd, cachedSmartMoneyWallets);
        candidate.holderAnalytics = holderAnalytics;

        // d. Large Swaps via Birdeye
        if (birdeyeQuota) {
          const bigSwaps = await getBigSwaps(mint, 5000);
          candidate.whaleSignal = {
            whaleWalletCount: holderAnalytics.whaleCount || 0,
            whaleFlow24hUsd: bigSwaps.reduce((sum, s) => sum + s.amountUsd, 0),
            swaps: bigSwaps.slice(0, 5)
          };
        }

        // e. Automated Smart Money scouting (top holders)
        if (cycleCount % 2 === 0) {
           // Task: Use GMGN for deep top trader profiling
           const topTraders = await gmgnAdapter.getSmartMoneyHolders(mint);
           if (topTraders.length > 0) {
             const smartWallets = topTraders.filter(p => p.winrate >= 70 && p.total_pnl > 1000 && p.trade_count > 10);
             candidate.smartWalletSignal = {
               walletBuyCount: smartWallets.length,
               wallets: smartWallets
             };
             
             // Save new smart money wallets to global database
             for (const sw of smartWallets) {
               await dbManager.addOrUpdateSmartWallet(sw);
               
               // Tambahkan juga ke tracked_wallets agar tampil di Dashboard/Terminal
               await dbManager.addTrackedWallet({
                 walletId: sw.address,
                 type: "DEX",
                 network: "solana",
                 alias: `Top Trader ${candidate.token.symbol}`,
                 tags: ["Smart Money", "Top Trader", "GMGN"],
                 profit_7d: sw.total_pnl || 0,
                 win_rate: sw.winrate || 0,
                 activity: `Found via ${candidate.token.symbol}`
               });
               console.log(`[TRACKER] ✅ Sukses menambahkan wallet ${sw.address.slice(0, 8)}... ke tracked wallets (Top Trader ${candidate.token.symbol})`);
             }
           }
        }

        // f. Insider Check via Helius
        if (config.heliusEnabled && heliusQuota && candidate.smartWalletSignal?.wallets?.length > 0) {
           let insiderFound = false;
           for (const w of candidate.smartWalletSignal.wallets) {
             const isInsider = await heliusProfiler.isInsiderWallet(w.address);
             if (isInsider) {
               insiderFound = true;
               w.isInsider = true;
             }
           }
           candidate.isInsiderFound = insiderFound;
        }

        // g. Dynamic Scoring
        let score = candidate.score;
        const liquidityUsd = candidate.pair.liquidityUsd || 0;
        const volume24hUsd = candidate.pair.volume24hUsd || 0;

        if (liquidityUsd > 50000) score += 15;
        if (volume24hUsd > 100000) score += 10;
        if (candidate.holderAnalytics?.whaleCount >= 1) score += 10;
        if (candidate.smartWalletSignal?.walletBuyCount >= 1) score += 20;
        if (candidate.isInsiderFound) score += 15;
        if (candidate.pair.boostsActive > 10) score += 10;
        
        // Audit Penalties
        if (audit.status === 'WARNING') score -= 15;
        
        // --- NEW: Aggressive Signal Detection (Smart Money & Volume Breakout) ---
        console.log(`[🚀 SCAN] Memeriksa sinyal agresif untuk ${candidate.token.symbol}...`);
        const [isSmartMoneyBuying, breakout] = await Promise.all([
          cekSinyalSmartMoney(mint).catch(() => false),
          Promise.resolve(cekSinyalVolumeBreakout(bestPairRaw))
        ]);

        if (isSmartMoneyBuying) {
          score += 40; // Bonus besar untuk akumulasi Smart Money
          console.log(`[🎯 SIGNAL] ${candidate.token.symbol} mendapat bonus +40 dari deteksi Smart Money.`);
        }

        if (breakout.valid) {
          score += 30; // Bonus untuk lonjakan volume breakout
          console.log(`[🎯 SIGNAL] ${candidate.token.symbol} mendapat bonus +30 dari deteksi Volume Breakout.`);
        }
        
        candidate.score = score;
        candidate.labels = { tier: score >= config.strongBuyScore ? 'FIRE' : score >= config.buyScore ? 'ALPHA' : 'WATCH' };
        candidate.status = candidate.labels.tier === 'FIRE' ? 'STRONG_BUY' : candidate.labels.tier === 'ALPHA' ? 'BUY_ZONE' : 'WATCH';

        // Task: Hunt Smart Money for high quality tokens (Background)
        if (candidate.labels.tier === 'FIRE' || candidate.labels.tier === 'ALPHA') {
          const huntMint = mint;
          setTimeout(async () => {
             try {
               // Update to use gmgnAdapter since birdeye is no longer used for hunting
               await gmgnAdapter.getSmartMoneyHolders(huntMint);
             } catch (huntErr) {
               console.error(`[SMART-HUNTER ERROR] Gagal hunting untuk ${huntMint}:`, huntErr.message);
             }
          }, 5000 + (enrichedCandidates.length * 2000));
          
          // --- NEW: COMBAT EXECUTION (LIVE vs PAPER) ---
          // JANGAN LUPA: Tambahkan variabel TRADE_MODE=PAPER dan SOLANA_BUY_AMOUNT_SOL=0.01 di file .env Anda.
          const tradeMode = (process.env.TRADE_MODE || 'PAPER').toUpperCase();
          const buyAmount = Number(process.env.SOLANA_BUY_AMOUNT_SOL || 0.05);

          if (tradeMode === 'LIVE') {
            console.log(`[⚡ LIVE TRADE EXECUTION] Menyiapkan senjata Anti-MEV untuk membeli ${candidate.token.symbol}...`);
            const txHash = await gmgnAdapter.executeMarketBuyAntiMEV(mint, buyAmount);
            if (txHash) {
              // Successfully executed live trade
              candidate.liveTradeTx = txHash;
            }
          } else {
            console.log(`[📝 PAPER TRADE] Mode simulasi aktif. Koin ${candidate.token.symbol} akan diteruskan ke mesin Paper Trading...`);
          }
        }

        // Task: Standardize Rug and Liq status for persistence
        candidate.rug_status = audit.status;
        candidate.liq_status = liquidityUsd >= 50000 ? 'SAFE' : liquidityUsd >= 15000 ? 'MEDIUM' : 'WEAK';
        candidate.audit_report = audit;

        // Task: Reject WEAK liquidity coins immediately
        if (candidate.liq_status === 'WEAK') {
          funnelStats.lowQuality++;
          console.log(`[SCANNER] REJECT ${candidate.token.symbol} (Liquidity WEAK): $${liquidityUsd.toFixed(0)}`);
          continue;
        }

        // Log Konfirmasi
        console.log(`[SCANNER] ✅ Lolos Filter: ${candidate.token.symbol} | Rug: ${candidate.rug_status} | Liq: ${candidate.liq_status} | Score: ${candidate.score}`);

        // Task: Save Snapshot for History Chart
        try {
          await dbManager.saveTokenSnapshot({
            token_address: mint,
            token_name: candidate.token.name,
            holders_count: candidate.holderAnalytics?.totalHolders || 0,
            price_usd: metrics.priceUsd,
            market_cap: metrics.marketCap
          });
        } catch (snapErr) {
          console.warn(`[SCANNER] Gagal simpan snapshot untuk ${candidate.token.symbol}:`, snapErr.message);
        }

        // Task: Persist to DB IMMEDIATELY with Smart Notification logic
        const dbResult = await dbManager.addToMonitor({
          token_address: mint,
          symbol: candidate.token.symbol,
          status: isVip ? 'BIRDEYE_VIP' : 'DISCOVERY',
          discovery_tier: candidate.labels?.tier || 'NEW',
          score: candidate.score || 0,
          strategy_status: candidate.status || 'WATCHING',
          pair_data: candidate.pair,
          holders_data: candidate.holderAnalytics,
          smart_money_data: candidate.smartWalletSignal,
          whale_data: candidate.whaleSignal,
          rug_status: candidate.rug_status,
          liq_status: candidate.liq_status,
          smart_money_count: candidate.holderAnalytics?.smartMoneyCount || 0,
          whale_count: candidate.holderAnalytics?.whaleCount || 0,
          insider_count: candidate.holderAnalytics?.insiderCount || 0
        });

        // --- SMART NOTIFICATION LOGIC ---
        const isNewDiscovery = dbResult.isNew;
        const currentTier = candidate.labels?.tier || 'WATCH';
        const oldTier = dbResult.oldData?.discovery_tier || 'WATCH';
        
        const getTierWeight = (t) => t === 'FIRE' ? 2 : (t === 'ALPHA' ? 1 : 0);
        const isUpgrade = getTierWeight(currentTier) > getTierWeight(oldTier);

        if (isNewDiscovery) {
          if (currentTier === 'FIRE' || currentTier === 'ALPHA') {
            try {
              await notifier.sendMonitorAlert({
                name: candidate.token.name,
                symbol: candidate.token.symbol,
                mint: mint,
                marketCap: metrics.marketCap,
                liquidity: metrics.liquidityUsd,
                whaleCount: candidate.whaleSignal?.whaleWalletCount || 0,
                insiderCount: candidate.smartWalletSignal?.walletBuyCount || 0,
                rugcheckStatus: candidate.rug_status,
                source: isVip ? "Birdeye Smart Money" : "DexScreener Discovery"
              });
            } catch (tgErr) {
              console.warn("[TELEGRAM ERROR] Gagal mengirim alert monitor:", tgErr.message);
            }
          }
        } else if (isUpgrade) {
          try {
            const upgradeMsg = `<b>[🔥 TIER UPGRADE] ${candidate.token.symbol} NAIK LEVEL!</b>\n\n` +
                               `Koin ${candidate.token.symbol} sekarang masuk tier <b>${currentTier}</b> (sebelumnya ${oldTier}).\n` +
                               `Skor saat ini: <code>${candidate.score}</code>\n\n` +
                               `📄 CA: <code>${mint}</code>`;
            await notifier.sendMessage(upgradeMsg);
          } catch (tgErr) {
            console.warn("[TELEGRAM ERROR] Gagal mengirim alert upgrade:", tgErr.message);
          }
        }

        enrichedCandidates.push(candidate);
        funnelStats.lolos++;

      } catch (err) {
        funnelStats.error++;
        console.error(`[SCANNER] Gagal memproses kandidat ${candidate.token.mint}:`, err.message);
      }
    }

    console.log(`[SCANNER REPORT] Siklus selesai. Lolos: ${funnelStats.lolos} koin | Ditolak: ${funnelStats.total - funnelStats.lolos - funnelStats.error} koin sampah/rug | Error: ${funnelStats.error}`);

    // Task: Sync full output to generic app_state for dashboard metadata
    const dashboardOutput = {
      generatedAt: new Date().toISOString(),
      chainId: config.chainId,
      candidates: enrichedCandidates,
      watchlistStats: { 
        total: (await dbManager.getMonitorList(1)).length, // Approximate
        smartWallets: 0 // Placeholder
      },
      differenceGuide: {
        whaleBuying: "Whale buying menyorot wallet dengan arus modal besar dalam 24 jam.",
        smartMoney: "Smart money menyorot wallet berkualitas yang aktif akumulasi dalam 24 jam.",
        ruleOfThumb: "Saat dua sinyal aktif pada token yang sama, konviksi setup biasanya lebih tinggi."
      }
    };
    await dbManager.saveState("solana_smart_money_output", dashboardOutput);
    console.log("[SYSTEM] State solana_smart_money_output berhasil diperbarui.");

    // 4. Run Paper Trading Cycle
    console.log("[SCANNER] Menjalankan mesin paper trading...");
    try {
      const botConfig = await dbManager.getBotConfig();
      const result = await runSolanaPaperTradingCycle(enrichedCandidates, { cycleCount, botConfig });
      
      if (result && result.stats) {
        const openPositions = (await dbManager.getActivePositions('solana')) || [];
        console.log(`[SCANNER] Paper Trading: ${openPositions.length} posisi terbuka. Net PnL: ${result.stats.netPnlSol?.toFixed(4)} SOL`);
      }
    } catch (paperErr) {
      console.error("[SCANNER] Error pada mesin paper trading (Non-Fatal):", paperErr.message);
    }

  } catch (error) {
    console.error(`[SCANNER] Error pada siklus #${cycleCount}:`, error.message);
  } finally {
    // 5. Database Cleanup (Garbage Collector) - DISABELD
    // await dbManager.removeDeadCoins().catch(() => {});
    
    monitorCycleRunning = false;
    console.log(`[SCANNER] Siklus #${cycleCount} selesai. Standby hingga interval berikutnya.`);
  }
}

/**
 * Whale Auto-Discovery: Memata-matai portofolio paus dan injeksi koin baru.
 */
async function runWhaleDiscoverySpy() {
  console.log("[SPY] Memulai Whale Auto-Discovery Spy...");
  try {
    const smartWallets = await dbManager.query("SELECT wallet_address FROM smart_wallets ORDER BY last_updated DESC LIMIT 10");
    if (!smartWallets.length) return;

    for (const sw of smartWallets) {
      const address = sw.wallet_address;
      console.log(`[SPY] Memeriksa portofolio paus: ${address.slice(0, 10)}...`);
      
      const portfolioMints = await heliusProfiler.getPortfolioAssets(address);
      if (!portfolioMints.length) continue;

      for (const mint of portfolioMints) {
        // Step 2: Cek apakah koin sudah ada di monitor list
        const exists = await dbManager.isCoinInMonitorList(mint);
        if (exists) continue;

        // Step 3 & 4: Injeksi koin baru dengan Gatekeeper
        try {
          const pairs = await fetchTokenPairs(mint, config.chainId);
          const bestPairRaw = selectBestPair(pairs, config.chainId);
          if (!bestPairRaw) continue;

          const metrics = extractPairMetrics(bestPairRaw);
          
          // Gatekeeper Khusus Paus (Min Liq $5000)
          if (metrics.liquidityUsd < 5000) continue;

          // Security Audit
          const audit = await rugcheckAdapter.analyzeToken(mint);
          if (audit.status === 'DANGER') continue;

          // Standardize data for insert
          const tokenData = {
            token: {
              mint,
              symbol: bestPairRaw.baseToken?.symbol || '?',
              name: bestPairRaw.baseToken?.name || '?',
              description: `Captured via Whale Wallet: ${address.slice(0, 8)}...`
            },
            pair: { ...bestPairRaw, ...metrics },
            score: 50, // Base score for whale discovery
            status: 'BUY_ZONE',
            rug_status: audit.status,
            liq_status: metrics.liquidityUsd >= 50000 ? 'SAFE' : 'MEDIUM'
          };

          console.log(`[SPY] AUTO-DISCOVERY! Injeksi koin dari paus: ${tokenData.token.symbol} (${mint.slice(0, 6)})`);
          
          const now = new Date();
          const accumInfo = `Akumulasi ${now.toLocaleDateString('id-ID')} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

          const dbResult = await dbManager.addToMonitor({
            token_address: mint,
            symbol: tokenData.token.symbol,
            status: 'WHALE_SPY',
            discovery_tier: 'ALPHA',
            score: tokenData.score,
            strategy_status: tokenData.status,
            timeframe: accumInfo,
            pair_data: tokenData.pair,
            rug_status: tokenData.rug_status,
            liq_status: tokenData.liq_status,
            smart_money_count: 1,
            whale_count: 1
          });

          // Whale Spy Notification: Only if genuinely NEW to the monitor list
          if (dbResult.isNew) {
            try {
              await notifier.sendMonitorAlert({
                name: tokenData.token.name,
                symbol: tokenData.token.symbol,
                mint: mint,
                marketCap: metrics.marketCap,
                liquidity: metrics.liquidityUsd,
                whaleCount: 1,
                insiderCount: 0,
                rugcheckStatus: audit.status,
                source: "Whale Auto-Discovery"
              });
            } catch (tgErr) {
               console.warn("[TELEGRAM ERROR] Gagal mengirim alert Whale Spy:", tgErr.message);
            }
          }

        } catch (err) {
          // ignore individual token errors
        }
        
        // Anti-Rate Limit
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (err) {
    console.error("[SPY] Whale Discovery Error:", err.message);
  }
}

/**
 * Entry point
 */
async function startBot() {
  console.log("==================================================");
  console.log("🚀 SOLANA SMART MONEY MONITOR STARTING (ADVANCED)");
  console.log(`📅 Date: ${new Date().toLocaleString()}`);
  console.log(`🔗 RPC: ${config.rpcUrl.split('?')[0]}...`);
  console.log("==================================================");

  try {
    // Initialize Database
    console.log("[SYSTEM] Menginisialisasi koneksi SQLite...");
    await dbManager.initDb();
    console.log("[SYSTEM] Database siap.");

    // Start Alpha Scraper (Telegram Listener) if configured
    if (process.env.TELEGRAM_CHANNELS) {
      const channels = process.env.TELEGRAM_CHANNELS.split(',').map(c => c.trim());
      console.log(`[SYSTEM] Mengaktifkan Alpha Scraper untuk ${channels.length} channel...`);
      alphaScraper.listenToChannels(channels);
    }

    // Start Telegram Command Listener
    const bot = new TelegramBot({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId
    });
    bot.start();

    // Initial run
    await runMonitorCycle();

    // Set Loop
    setInterval(runMonitorCycle, config.pollIntervalMs);

    // Run Whale Discovery Spy every 4 cycles (approx every 20 mins if poll is 5 mins)
    setInterval(runWhaleDiscoverySpy, config.pollIntervalMs * 4);

    // Task: Periodic Garbage Collector (Disabled)
    /*
    setInterval(async () => {
      await dbManager.removeDeadCoins().catch(() => {});
    }, 15 * 60 * 1000);
    */

    // Task: Fast Price Update Loop (Background worker)
    // Refreshes token prices in SQLite every 45 seconds so dashboard feels live.
    setInterval(async () => {
      try {
        const monitored = await dbManager.getMonitorList(40);
        if (!monitored.length) return;

        const mints = monitored.map(m => m.token_address);
        const { getUIPriceBatch } = require("./priceFetcher");
        
        console.log(`[SYSTEM] Background price refresh for ${mints.length} tokens...`);
        const freshPrices = await getUIPriceBatch(mints);

        for (const m of monitored) {
          const priceData = freshPrices[m.token_address];
          if (priceData && priceData.usd) {
            try {
              const newPrice = priceData.usd;
              const change24h = priceData.change24h || 0;

              // Ensure initial_price is set if missing (backfill)
              if (!m.initial_price || m.initial_price === 0) {
                await dbManager.run(`UPDATE monitor_list SET initial_price = ?, ath_price = ? WHERE token_address = ?`, [newPrice, newPrice, m.token_address]);
                m.initial_price = newPrice;
                m.ath_price = newPrice;
              }

              // Check for >50% drop (Drawdown Protection)
              const refPrice = m.ath_price || m.initial_price || 0;
              let shouldBlacklist = false;
              let reason = "";

              if (refPrice > 0) {
                const dropPct = ((refPrice - newPrice) / refPrice) * 100;
                if (dropPct > 50) {
                  shouldBlacklist = true;
                  reason = `Drawdown > 50% from peak ($${refPrice} -> $${newPrice})`;
                }
              }

              // NEW: Check for 24H drop > 50% (Explicit User Request)
              if (!shouldBlacklist && change24h <= -50) {
                shouldBlacklist = true;
                reason = `Price 24h drop > 50% (${change24h.toFixed(1)}%)`;
              }

              if (shouldBlacklist) {
                console.log(`[SYSTEM] Token ${m.symbol} (${m.token_address}) diblokir: ${reason}`);
                await dbManager.blacklistToken(m.token_address, m.symbol, reason);
                continue; // Skip further updates for this token
              }

              const pair = m.pair_data ? JSON.parse(m.pair_data) : {};
              pair.priceUsd = newPrice;
              pair.priceChange24h = change24h; // Sync 24h change
              
              // Update price and pair_data in DB
              await dbManager.run(`UPDATE monitor_list SET price = ?, pair_data = ? WHERE token_address = ?`, [newPrice, JSON.stringify(pair), m.token_address]);
              // Update ATH price if needed
              await dbManager.updateAthPrice(m.token_address, newPrice);
            } catch(e) {}
          }
        }
      } catch (err) {
        // silent fail
      }
    }, 45000);

    console.log(`[SYSTEM] Bot berjalan penuh. Menunggu siklus berikutnya tiap ${config.pollIntervalMs / 1000} detik.`);
  } catch (err) {
    console.error("[SYSTEM] FATAL: Gagal memulai bot:", err.message);
    process.exit(1);
  }
}

// Handle termination
process.on("SIGINT", () => {
  console.log("\n[SYSTEM] Menerima SIGINT. Mematikan bot...");
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("[SYSTEM] Unhandled Rejection:", reason);
});

// Run
if (require.main === module) {
  startBot();
}

module.exports = { config, startBot, runMonitorCycle };
