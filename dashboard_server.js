require("dotenv").config();

const http = require("http");
const fs = require("fs");
const https = require("https");
const path = require("path");
const url = require("url");
const PaperAccount = require("./src/core/paper_account");
const { formatPct, formatPrice, formatQty } = require("./src/utils/log_helpers");
const { closeSolanaPaperPosition } = require("./src/solana/solanaPaperTrading");
const { closeCexTradeManually } = require("./src/cex/cexBot");
const { createPublicExchange, withTimeout, withRetry } = require("./src/cex/cexExchange");
const dbManager = require("./src/database/dbManager");
const { getUIPriceBatch, getExecutionPrice } = require("./src/solana/priceFetcher");
const { fetchTokenHolderAnalytics } = require("./src/solana/birdeyeAdapter");
const { handleHeliusWebhook } = require("./src/routes/webhookRoutes");

const PORT = Number(process.env.DASHBOARD_PORT || 3088);
const ROOT = __dirname;
const DASHBOARD_DIR = path.join(ROOT, "dashboard");

const LEDGER_FILES = {
  log: path.join(ROOT, "data", "trading-agent.log"),
};

/**
 * Polling Background untuk Update SQLite (Holder History)
 */
async function runBackgroundPolling() {
  setInterval(async () => {
    try {
      const output = await dbManager.getState("solana_smart_money_output") || {};
      const tokensToFetch = new Set();
      if (output?.sections) {
        Object.values(output.sections).forEach(section => {
          if (Array.isArray(section.items)) {
            section.items.forEach(item => {
              if (item.token?.mint) tokensToFetch.add(item.token.mint);
            });
          }
        });
      }

      if (tokensToFetch.size === 0) {
        const monitoredCoins = await dbManager.getMonitorList(20);
        monitoredCoins.forEach(c => tokensToFetch.add(c.token_address));
      }

      if (tokensToFetch.size > 0) {
        for (const mint of tokensToFetch) {
          try {
            const analytics = await fetchTokenHolderAnalytics(mint);
            if (analytics) {
              await dbManager.saveTokenSnapshot({
                token_address: mint,
                token_name: analytics.symbol || '?',
                holders_count: analytics.totalHolders,
                price_usd: analytics.priceUsd || 0,
                market_cap: analytics.marketCap || 0
              });
            }
          } catch (e) {
            // silent fail for individual tokens
          }
        }
      }
    } catch (err) {
      console.error("[polling] Global error:", err.message);
    }
  }, 300000); // 5 menit
}

/**
 * Helpers
 */
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("File not found");
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    }
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function readRecentLogs(filePath, limit = 50) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    return lines.slice(-limit).reverse().map(l => {
       try { return JSON.parse(l); } catch(e) { return { msg: l }; }
    });
  } catch (e) {
    return [];
  }
}

/**
 * Build Full Dashboard Payload
 */
async function buildDashboardPayload() {
  const solanaSmartMoney = await dbManager.getState("solana_smart_money_output") || { sections: {} };
  const solanaPaper = await dbManager.getState("solana_paper_trading_state") || { stats: {} };
  const cexPaper = await dbManager.getState("cex_bot_state") || { stats: {} };
  const solanaPaperBalance = await dbManager.getPaperBalance();
  
  const spotState = await dbManager.getState("paper_ledger_spot") || { balances: { cash: 0, asset: 0 }, trades: [] };
  const futuresState = await dbManager.getState("paper_ledger_futures") || { balances: { cash: 0, asset: 0 }, trades: [] };
  
  let sqliteTrades = [];
  try {
    sqliteTrades = await dbManager.getTradeHistory(40);
  } catch(e) {}

  // Enrichment from SQLite
  try {
    const monitored = await dbManager.getMonitorList(150);
    solanaSmartMoney.discovery = solanaSmartMoney.discovery || { fire: [], alpha: [] };
    
    // Map all SQLite entries to candidates for frontend widgets
    const parsedCandidates = monitored.map(m => {
      let holders = { totalHolders: 0, sampledHolders: 0, tiers: { under10: 0, over100: 0, over1k: 0, over10k: 0 }, smartMoney: { count: 0 }, whale: { count: 0 } };
      let smart = { walletBuyCount: 0, netAccumulatedUsd: 0, wallets: [] };
      let whale = { whaleWalletCount: 0, whaleFlow24hUsd: 0, wallets: [] };
      let pair = { priceUsd: 0, liquidity: { usd: 0 }, volume: { h24: 0 } };

      try { if (m.holders_data) holders = JSON.parse(m.holders_data); } catch(e) {}
      try { if (m.smart_money_data) smart = JSON.parse(m.smart_money_data); } catch(e) {}
      try { if (m.whale_data) whale = JSON.parse(m.whale_data); } catch(e) {}
      try { if (m.pair_data) pair = JSON.parse(m.pair_data); } catch(e) {}

      // Task: Remove inaccurate fallbacks. Use null if not in DB.
      const rugRisk = m.rug_status || null;
      const liqSafety = m.liq_status || null;
      const smartCount = m.smart_money_count ?? (smart.walletBuyCount > 0 ? smart.walletBuyCount : null);
      const whaleCount = m.whale_count ?? (whale.whaleWalletCount > 0 ? whale.whaleWalletCount : null);

      return {
        token: { mint: m.token_address, symbol: m.symbol },
        score: m.score || 0,
        status: m.status || 'WATCH',
        timeframe: m.timeframe || 'DISCOVERY',
        added_at: m.added_at,
        pair: pair,
        // Standardized fields for Morning Briefing and Signal cards
        rug_status: rugRisk,
        liq_status: liqSafety,
        smart_money_count: smartCount,
        whale_count: whaleCount,
        holders_data: holders,
        holderAnalytics: holders,
        smartWalletSignal: smart,
        whaleSignal: whale,
        signals: {
          accumulationHourWIB: m.added_at ? new Date(m.added_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'belum ada'
        },
        labels: { accumulation: m.discovery_tier || 'NEW' },
        timing: 'Captured via SQLite Discovery'
      };
    });

    if (parsedCandidates.length > 0) {
      console.log("[BADGE DEBUG] Data parsed di backend (sample):", 
        parsedCandidates[0].token.symbol, 
        "Rug:", parsedCandidates[0].rug_status || "N/A", 
        "Liq:", parsedCandidates[0].liq_status || "N/A"
      );
      solanaSmartMoney.candidates = parsedCandidates;
    }

    // Enriching specific signals arrays
    const smartMoneySignals = parsedCandidates.filter(c => c.smartWalletSignal && c.smartWalletSignal.walletBuyCount > 0);
    if (smartMoneySignals.length > 0) solanaSmartMoney.smartMoneyBuying24h = smartMoneySignals.slice(0, 30);

    const whaleSignals = parsedCandidates.filter(c => c.whaleSignal && (c.whaleSignal.whaleWalletCount > 0 || c.whaleSignal.whaleFlow24hUsd > 0));
    if (whaleSignals.length > 0) solanaSmartMoney.whaleBuying24h = whaleSignals.slice(0, 30);

    const mustBuySignals = parsedCandidates.filter(c => c.status === "STRONG_BUY" && c.score >= 85);
    if (mustBuySignals.length > 0) solanaSmartMoney.mustBuyNow = mustBuySignals.slice(0, 30);

    console.log(`[ANALYTICS] Payload enriched: ${parsedCandidates.length} total, ${smartMoneySignals.length} smart, ${whaleSignals.length} whale, ${mustBuySignals.length} must_buy.`);

    // Build timeframeSections from SQLite monitored coins
    const timeframeSections = {
      generatedAt: new Date().toISOString(),
      sections: {
        "1hour": { items: [] },
        "4hour": { items: [] },
        "1day": { items: [] }
      },
      summary: {
        "1hour": { count: 0, avgWinRate: 0 },
        "4hour": { count: 0, avgWinRate: 0 },
        "1day": { count: 0, avgWinRate: 0 }
      }
    };

    monitored.forEach(m => {
      const smart = m.smart_money_data ? JSON.parse(m.smart_money_data) : { walletBuyCount: 0 };
      const whale = m.whale_data ? JSON.parse(m.whale_data) : { whaleWalletCount: 0 };
      
      const candidate = {
        token: { mint: m.token_address, symbol: m.symbol },
        score: m.score,
        status: m.status,
        timeframe: m.timeframe,
        added_at: m.added_at,
        smartWalletSignal: smart,
        whaleSignal: whale,
        timeframeMetrics: {
          accumulationHourWIB: new Date(m.added_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
          winRate: smart.avgSmartScore || 0,
          persisted: false
        }
      };

      const tf = String(m.timeframe || "").toUpperCase();
      if (tf === '1H' || tf === 'DISCOVERY' || tf === '1M' || tf === '5M' || tf === 'NEW') {
        timeframeSections.sections["1hour"].items.push(candidate);
      } else if (tf === '4H') {
        timeframeSections.sections["4hour"].items.push(candidate);
      } else if (tf === '1D') {
        timeframeSections.sections["1day"].items.push(candidate);
      }
    });

    // Sort items by added_at desc, but prioritize DISCOVERY in 1H
    timeframeSections.sections["1hour"].items.sort((a, b) => {
      if (a.timeframe === 'DISCOVERY' && b.timeframe !== 'DISCOVERY') return -1;
      if (a.timeframe !== 'DISCOVERY' && b.timeframe === 'DISCOVERY') return 1;
      return new Date(b.added_at) - new Date(a.added_at);
    });
    timeframeSections.sections["4hour"].items.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
    timeframeSections.sections["1day"].items.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

    // Update counts and average win rates
    ["1hour", "4hour", "1day"].forEach(key => {
      const items = timeframeSections.sections[key].items;
      timeframeSections.summary[key].count = items.length;
      if (items.length > 0) {
        const sum = items.reduce((s, it) => s + (it.timeframeMetrics.winRate || 0), 0);
        timeframeSections.summary[key].avgWinRate = sum / items.length;
      }
    });

    solanaSmartMoney.timeframeSections = timeframeSections;

    // Task: Attach Token Holder History for Dashboard Details
    const holderHistoryMap = {};
    const monitoredMints = monitored.map(m => m.token_address);
    if (monitoredMints.length > 0) {
      for (const mint of monitoredMints) {
        const history = await dbManager.getTokenHistory(mint, 24);
        if (history && history.length > 0) {
          const latestM = monitored.find(m => m.token_address === mint);
          
          holderHistoryMap[mint] = history.map(h => ({
            timestamp: new Date(h.timestamp).getTime(),
            totalHolders: h.holders_count,
            price: h.price_usd,
            marketCap: h.market_cap,
            smartMoney: 0,
            whale: 0,
            over10k: 0
          }));

          // Try to enrich latest point with tier data from monitor_list JSON
          if (latestM && latestM.holders_data) {
            try {
              const hData = JSON.parse(latestM.holders_data);
              const lastPoint = holderHistoryMap[mint][0]; // History is DESC (timestamp)
              lastPoint.smartMoney = hData.smartMoney?.count || 0;
              lastPoint.whale = hData.whale?.count || 0;
              lastPoint.over10k = hData.tiers?.over10k || 0;
            } catch(e) {}
          }
        }
      }
    }
    solanaSmartMoney.tokenHolderDetails = {
      history: holderHistoryMap,
      byMint: {}
    };

    // Task: Build Provider Health Status
    const hasHelius = !!(process.env.HELIUS_API_KEYS || process.env.HELIUS_API_KEY);
    const hasBirdeye = !!(process.env.BIRDEYE_API_KEYS || process.env.BIRDEYE_API_KEY);
    const hasGoPlus = !!(process.env.GOPLUS_ACCESS_TOKEN || process.env.GOPLUS_API_KEY);
    
    // Sinkronisasi Discovery Count: Ambil jumlah asli dari SQLite secara dinamis
    const dbStats = await dbManager.query("SELECT COUNT(*) as count FROM monitor_list");
    const totalDiscoveryCount = dbStats[0]?.count || 0;

    solanaSmartMoney.providerStatus = {
      dexscreener: totalDiscoveryCount > 0,
      latestProfilesTracked: totalDiscoveryCount,
      discoveryCandidates: totalDiscoveryCount,
      goplus: hasGoPlus,
      helius: hasHelius,
      birdeye: hasBirdeye
    };

    // Task: Build Phoenix Scanner Data
    const phoenixCards = parsedCandidates.map(c => {
      const score = Number(c.score || 0);
      const rugLabel = (c.pair?.rugRisk?.label || 'HIGH').toUpperCase();
      
      let phoenixTier = "WATCH";
      if (score >= 90 || c.status === "STRONG_BUY") phoenixTier = "FIRE";
      else if (score >= 75) phoenixTier = "CANDIDATE";
      else if (score >= 55) phoenixTier = "PRE_IGN";
      else if (score < 40 || rugLabel === "HIGH") phoenixTier = "CAPITUL";

      return {
        ca: c.token.mint,
        symbol: c.token.symbol,
        phoenixScore: score,
        phoenixTier,
        pair: c.pair,
        dexUrl: c.pair?.url,
        metrics: {
          smartMoney: c.smartWalletSignal?.walletBuyCount || 0,
          whale: c.whaleSignal?.whaleWalletCount || 0,
          vol24hUsd: c.pair?.volume?.h24 || 0,
          winRate: c.smartWalletSignal?.avgSmartScore || 0,
          whalesH10k: { label: `${c.holders_data?.whale?.count || 0} whale`, tone: (c.holders_data?.whale?.count > 0 ? 'good' : 'neutral') },
          volExhaustion: { label: "active", tone: "good" } // Placeholder
        },
        sparkline: [], // Placeholder
        persisted: false
      };
    });

    const phoenixCounts = { FIRE: 0, CANDIDATE: 0, PRE_IGN: 0, CAPITUL: 0, WATCH: 0 };
    phoenixCards.forEach(c => { phoenixCounts[c.phoenixTier]++; });

    solanaSmartMoney.phoenixScanner = {
      subtitle: `Analyzing ${parsedCandidates.length} potential runners · SQLite Data Pipeline`,
      summary: {
        fire: phoenixCounts.FIRE,
        candidate: phoenixCounts.CANDIDATE,
        preIgn: phoenixCounts.PRE_IGN,
        capitul: phoenixCounts.CAPITUL,
        watch: phoenixCounts.WATCH,
        total: parsedCandidates.length,
        withConviction: phoenixCounts.FIRE + phoenixCounts.CANDIDATE
      },
      counts: phoenixCounts,
      cards: phoenixCards
    };

    // Sync Active Positions for Solana
    const dbSolanaPositions = await dbManager.getActivePositions('solana');
    const dbSolanaTrades = await dbManager.getPaperTrades(100);
    const livePaperStats = await dbManager.getPaperStats();

    if (livePaperStats) {
      solanaPaper.stats = {
        totalTrades: livePaperStats.totalTrades,
        profitTrades: livePaperStats.profitTrades,
        lossTrades: livePaperStats.lossTrades,
        winRate: livePaperStats.winRate,
        netPnlSol: livePaperStats.netPnlSol,
        totalFeesSol: livePaperStats.totalFeesSol || 0,
        totalInvestedSol: livePaperStats.totalInvestedSol,
        avgPnlSol: livePaperStats.totalTrades > 0 ? livePaperStats.netPnlSol / livePaperStats.totalTrades : 0
      };
    }

    solanaPaper.activePositions = dbSolanaPositions.map(p => ({
      id: p.id,
      tokenAddress: p.token_address,
      symbol: p.symbol,
      entryPrice: p.entry_price,
      currentPrice: p.current_price,
      amountSol: p.amount_sol,
      targetTP: p.target_tp,
      targetSL: p.target_sl,
      openedAt: p.opened_at,
      metadata: p.metadata ? JSON.parse(p.metadata) : null,
      virtualTokensBought: p.amount_sol / (p.entry_price || 0.000001),
      unrealizedPnlSol: (p.amount_sol * (((p.current_price || p.entry_price) - p.entry_price) / p.entry_price)),
      unrealizedPnlPct: p.entry_price > 0 ? (((p.current_price || p.entry_price) - p.entry_price) / p.entry_price) * 100 : 0
    }));

    solanaPaper.tradeHistory = dbSolanaTrades.map(t => ({
      id: t.id,
      tokenAddress: t.token_address,
      symbol: t.symbol,
      entryPrice: t.entry_price,
      exitPrice: t.exit_price,
      amountSol: t.amount_sol,
      pnlSol: t.pnl_sol,
      pnlPct: t.pnl_pct,
      trigger: t.trigger_type,
      openedAt: t.opened_at,
      closedAt: t.closed_at,
      result: t.result
    }));

    // CEX Data
    const dbCexPositions = await dbManager.getActivePositions('cex');
    const dbCexTrades = await dbManager.getCexTrades(100);
    const dbCexStats = await dbManager.getCexStats();
    
    if (dbCexStats) {
      cexPaper.stats = {
        totalTrades: dbCexStats.totalTrades,
        profitTrades: dbCexStats.profitTrades,
        lossTrades: dbCexStats.lossTrades,
        winRate: dbCexStats.winRate,
        netPnlUsdt: dbCexStats.netPnlUsdt,
        balanceUsdt: await dbManager.getCexBalance()
      };
    }

    cexPaper.activeTrades = dbCexPositions.map(p => {
      const entryPrice = p.entry_price;
      const currentPrice = p.current_price || entryPrice;
      const amountUsdt = p.amount_usdt;
      // Approx fee (0.1% entry + 0.1% exit estimate)
      const entryFee = amountUsdt * 0.001; 
      
      return {
        id: p.id,
        symbol: p.symbol,
        entryPrice: entryPrice,
        currentPrice: currentPrice,
        amountUsdt: amountUsdt,
        targetTP: p.target_tp,
        targetSL: p.target_sl,
        openedAt: p.opened_at,
        fee: entryFee,
        pnlUsdt: amountUsdt * ((currentPrice - entryPrice) / entryPrice),
        pnlPct: entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0
      };
    });
    cexPaper.tradeHistory = dbCexTrades.map(t => ({
      id: t.id,
      symbol: t.symbol,
      entryPrice: t.entry_price,
      exitPrice: t.exit_price,
      amountUsdt: t.amount_usdt,
      pnlUsdt: t.pnl_usd,
      pnlPct: t.pnl_percent,
      trigger: t.trigger_type,
      openedAt: t.opened_at,
      closedAt: t.closed_at,
      type: "BUY",
      result: t.result
    }));
  } catch (e) {
    console.error("[dashboard] Enrichment error:", e.message);
  }

  return {
    generatedAt: new Date().toISOString(),
    spot: spotState,
    futures: futuresState,
    solanaSmartMoney,
    solanaPaperTrading: solanaPaper,
    solanaPaperBalance: solanaPaperBalance,
    cexPaper,
    recentLogs: readRecentLogs(LEDGER_FILES.log),
    sqliteTrades: sqliteTrades
  };
}

async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.replace(/\/$/, "") || "/";
  const method = req.method;

  console.log(`[HTTP DEBUG] ${method} ${pathname}`);

  // PRIORITY ROUTES
  if (pathname === "/api/cex/live-prices") {
    console.log("[SERVER] Route /api/cex/live-prices telah didaftarkan.");
    try {
      const positions = await dbManager.getActivePositions('cex');
      if (!positions || positions.length === 0) {
        return sendJson(res, 200, []);
      }

      const symbols = [...new Set(positions.map(p => p.symbol))];
      const exchangeId = process.env.CEX_EXCHANGE || "bybit";
      const exchange = createPublicExchange(exchangeId);
      
      const tickers = await withRetry(
        () => withTimeout(() => exchange.fetchTickers(symbols), 8000, "fetchTickers"),
        "fetchTickers"
      );
      
      const results = positions.map(pos => {
        const ticker = tickers[pos.symbol];
        if (ticker) {
          const currentPrice = Number(ticker.last || ticker.close || 0);
          const entryPrice = Number(pos.entry_price);
          
          let side = "LONG";
          try {
            const meta = pos.metadata ? JSON.parse(pos.metadata) : {};
            side = (meta.side || meta.type || "LONG").toUpperCase();
            if (side !== "SHORT") side = "LONG";
          } catch(e) {}

          let pnlPercentage = 0;
          if (entryPrice > 0 && currentPrice > 0) {
            if (side === "SHORT") {
              pnlPercentage = ((entryPrice - currentPrice) / entryPrice) * 100;
            } else {
              pnlPercentage = ((currentPrice - entryPrice) / entryPrice) * 100;
            }
          }

          return { 
            id: pos.id, 
            symbol: pos.symbol, 
            currentPrice, 
            pnlPercentage,
            side
          };
        }
        return null;
      }).filter(Boolean);

      return sendJson(res, 200, results);
    } catch(e) { 
      console.error("[CEX LIVE] Error:", e.message);
      return sendJson(res, 500, { error: "Gagal mengambil harga live CEX" }); 
    }
  }

  // API ROUTES
  if (pathname === "/api/db-status") {
    try {
      const tables = await dbManager.query("SELECT name FROM sqlite_master WHERE type='table'");
      const status = { connected: true, tables: tables.map(t => t.name), rows: {} };
      for (const t of status.tables) {
        const count = await dbManager.query(`SELECT count(*) as c FROM ${t}`);
        status.rows[t] = count[0].c;
      }
      return sendJson(res, 200, status);
    } catch(e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathname === "/api/dashboard") {
    console.log("[BACKEND TRACER] Endpoint /api/dashboard dipanggil.");
    try {
      const payload = await buildDashboardPayload();
      const candidateCount = payload.solanaSmartMoney?.candidates?.length || 0;
      const tfCount = (payload.solanaSmartMoney?.timeframeSections?.summary["1hour"]?.count || 0) + 
                      (payload.solanaSmartMoney?.timeframeSections?.summary["4hour"]?.count || 0) + 
                      (payload.solanaSmartMoney?.timeframeSections?.summary["1day"]?.count || 0);
      
      console.log(`[BACKEND TRACER] Payload siap dikirim. Total koin (candidates): ${candidateCount}, Total timeframe items: ${tfCount}`);
      return sendJson(res, 200, payload);
    } catch(e) { 
      console.error("[BACKEND ERROR] /api/dashboard gagal:", e.message);
      return sendJson(res, 500, { error: e.message }); 
    }
  }

  if (pathname === "/api/dashboard/live-prices") {
    try {
      const positions = await dbManager.getActivePositions('solana');
      if (!positions || positions.length === 0) return sendJson(res, 200, []);

      const mints = [...new Set(positions.map(p => p.token_address))];
      const prices = await getUIPriceBatch(mints);
      
      const results = positions.map(pos => {
        const currentPrice = prices[pos.token_address];
        if (currentPrice) {
          const entryPrice = Number(pos.entry_price);
          const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
          return { id: pos.id, mint: pos.token_address, currentPrice, pnlPct };
        }
        return null;
      }).filter(Boolean);

      return sendJson(res, 200, results);
    } catch(e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathname === "/api/cex-paper") {
    try {
      const payload = await buildDashboardPayload();
      return sendJson(res, 200, payload.cexPaper);
    } catch(e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathname === "/api/prices") {
    const mints = (parsedUrl.query.mints || "").split(",").filter(Boolean);
    try {
      if (!mints.length) {
        return sendJson(res, 200, { prices: {} });
      }

      // Task: Read latest prices from DB instead of live API to avoid bottleneck
      // We chunk the array to prevent SQLite limit issues just in case
      const chunkSize = 100;
      let allRows = [];
      for (let i = 0; i < mints.length; i += chunkSize) {
        const chunk = mints.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        const rows = await dbManager.query(`SELECT token_address, pair_data FROM monitor_list WHERE token_address IN (${placeholders})`, chunk);
        allRows = allRows.concat(rows);
      }

      const formatted = {};
      mints.forEach(m => { formatted[m] = { usd: 0, change24h: 0 }; }); // Default

      allRows.forEach(row => {
        try {
          const pair = row.pair_data ? JSON.parse(row.pair_data) : {};
          formatted[row.token_address] = { 
            usd: Number(pair.priceUsd || 0), 
            change24h: Number(pair.priceChange24h || pair.priceChange?.h24 || 0) 
          };
        } catch(e) {}
      });

      return sendJson(res, 200, { prices: formatted });
    } catch(e) { 
      console.error("[PRICE API ERROR]", e.message);
      return sendJson(res, 500, { error: "Gagal mengambil harga", useFallback: true }); 
    }
  }

  if (pathname === "/api/webhook/helius" && method === "POST") {
    try {
      const body = await readRequestBody(req);
      // Respond fast to Helius
      sendJson(res, 200, { status: "OK" });
      // Process async
      handleHeliusWebhook(body).catch(e => console.error("[WEBHOOK ERROR]", e.message));
      console.log("[HELIUS ADVANCED] Webhook listener aktif di /api/webhook/helius");
      return;
    } catch(e) { return sendJson(res, 400, { error: "Invalid Webhook Body" }); }
  }

  if (pathname === "/api/paper-trade/manual-buy" && method === "POST") {
    try {
      const body = await readRequestBody(req);
      const mint = body.token_address;
      const buyAmount = Number(body.amount);
      const balance = await dbManager.getPaperBalance();

      if (balance < buyAmount) return sendJson(res, 400, { error: "Saldo tidak cukup" });

      const price = await getExecutionPrice(mint);
      const position = {
        id: `manual-${Date.now()}`,
        tokenAddress: mint,
        symbol: body.symbol,
        entryPrice: price,
        currentPrice: price,
        amountSol: buyAmount,
        targetTP: price * 1.5,
        targetSL: price * 0.8,
        openedAt: new Date().toISOString(),
        status: "OPEN",
        metadata: { source: "dashboard_manual" }
      };

      await dbManager.saveOpenPosition('solana', position);
      await dbManager.updatePaperBalance(balance - buyAmount);
      return sendJson(res, 200, { success: true, entryPrice: price });
    } catch(e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathname === "/api/close-position" && method === "POST") {
    try {
      const body = await readRequestBody(req);
      const mode = body.mode || "solana-paper";
      if (mode === "solana-paper") {
        const result = await closeSolanaPaperPosition(body.mint, body.id);
        return sendJson(res, 200, { ok: true, closed: result.closed });
      }
      if (mode === "cex-paper") {
        const result = await closeCexTradeManually({ tradeId: body.tradeId, symbol: body.symbol });
        return sendJson(res, 200, { ok: true, closed: result.closed });
      }
      return sendJson(res, 400, { error: "Invalid mode" });
    } catch(e) { return sendJson(res, 500, { error: e.message }); }
  }

  // STATIC ASSETS
  if (pathname === "/" || pathname === "/index.html") return sendFile(res, path.join(DASHBOARD_DIR, "index.html"), "text/html");
  if (pathname === "/styles.css") return sendFile(res, path.join(DASHBOARD_DIR, "styles.css"), "text/css");
  if (pathname === "/app.js") return sendFile(res, path.join(DASHBOARD_DIR, "app.js"), "application/javascript");

  return sendJson(res, 404, { error: `Not found: ${pathname}` });
}

const server = http.createServer(handleRequest);

dbManager.initDb().then(() => {
  runBackgroundPolling();
  server.listen(PORT, () => {
    console.log(`[SERVER] Running at http://localhost:${PORT}`);
    console.log("[SERVER] CEX live price logic is active in handleRequest.");
  });
}).catch(err => {
  console.error("[DB] Init fail:", err.message);
  process.exit(1);
});
