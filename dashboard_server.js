require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const PaperAccount = require("./src/core/paper_account");
const { formatPct, formatPrice, formatQty } = require("./src/utils/log_helpers");
const { closeSolanaPaperPosition } = require("./src/solana/solanaPaperTrading");
const { closeCexTradeManually } = require("./src/cex/cexBot");
const { createPublicExchange, withTimeout, withRetry } = require("./src/cex/cexExchange");
const dbManager = require("./src/database/dbManager");
const { getUIPriceBatch, getExecutionPrice } = require("./src/solana/priceFetcher");
const { fetchTokenHolderAnalytics } = require("./src/solana/birdeyeAdapter");
const { handleHeliusWebhook } = require("./src/routes/webhookRoutes");

// Auth & Admin Routes
const authRoutes = require("./src/routes/auth");
const adminRoutes = require("./src/routes/admin");
const { verifyToken, requireRole, requireApproved } = require("./src/middleware/auth");

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT || 3088);
const ROOT = __dirname;
const DASHBOARD_DIR = path.join(ROOT, "dashboard");

const LEDGER_FILES = {
  log: path.join(ROOT, "data", "trading-agent.log"),
};

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Polling Background
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
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error("[polling] Global error:", err.message);
    }
  }, 300000); // 5 menit
}

// Helpers
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

  let trackedWallets = [];
  try {
    const wallets = await dbManager.getTrackedWallets();
    for (const w of wallets) {
      const history = await dbManager.getTrackedWalletHistory(w.wallet_id, 7);
      trackedWallets.push({
        id: w.wallet_id,
        type: w.type,
        network: w.network,
        alias: w.alias,
        tags: JSON.parse(w.tags || "[]"),
        profit7d: w.profit_7d,
        roi7d: w.roi_7d,
        profit30d: w.profit_30d,
        roi30d: w.roi_30d,
        avgInvested: w.avg_invested,
        winRate: w.win_rate,
        activity: w.activity,
        history: history.reverse().map(h => ({ date: h.date, profit: h.profit }))
      });
    }
  } catch(e) {
    console.error("[dashboard] Tracked wallets error:", e.message);
  }

  try {
    const monitored = await dbManager.getMonitorList(150);
    solanaSmartMoney.discovery = solanaSmartMoney.discovery || { fire: [], alpha: [] };
    
    const parsedCandidates = monitored.map(m => {
      let holders = { totalHolders: 0, sampledHolders: 0, tiers: { under10: 0, over100: 0, over1k: 0, over10k: 0 }, smartMoney: { count: 0 }, whale: { count: 0 } };
      let smart = { walletBuyCount: 0, netAccumulatedUsd: 0, wallets: [] };
      let whale = { whaleWalletCount: 0, whaleFlow24hUsd: 0, wallets: [] };
      let pair = { priceUsd: 0, liquidity: { usd: 0 }, volume: { h24: 0 } };

      try { if (m.holders_data) holders = JSON.parse(m.holders_data); } catch(e) {}
      try { if (m.smart_money_data) smart = JSON.parse(m.smart_money_data); } catch(e) {}
      try { if (m.whale_data) whale = JSON.parse(m.whale_data); } catch(e) {}
      try { if (m.pair_data) pair = JSON.parse(m.pair_data); } catch(e) {}

      return {
        token: { mint: m.token_address, symbol: m.symbol },
        score: m.score || 0,
        status: m.strategy_status || 'WATCH',
        discovery_source: m.status || 'DISCOVERY',
        timeframe: m.status || 'DISCOVERY',
        accumulation_info: m.timeframe,
        added_at: m.added_at,
        pair: pair,
        rug_status: m.rug_status || null,
        liq_status: m.liq_status || null,
        smart_money_count: m.smart_money_count ?? (smart.walletBuyCount > 0 ? smart.walletBuyCount : null),
        whale_count: m.whale_count ?? (whale.whaleWalletCount > 0 ? whale.whaleWalletCount : null),
        holders_data: holders,
        holderAnalytics: holders,
        smartWalletSignal: smart,
        whaleSignal: whale,
        signals: {
          accumulationHourWIB: m.timeframe || (m.added_at ? new Date(m.added_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'belum ada')
        },
        labels: { accumulation: m.discovery_tier || 'NEW' },
        timing: 'Captured via SQLite Discovery'
      };
    });

    if (parsedCandidates.length > 0) {
      solanaSmartMoney.candidates = parsedCandidates;
    }

    const smartMoneySignals = parsedCandidates.filter(c => c.smartWalletSignal && c.smartWalletSignal.walletBuyCount > 0);
    if (smartMoneySignals.length > 0) solanaSmartMoney.smartMoneyBuying24h = smartMoneySignals.slice(0, 30);

    const whaleSignals = parsedCandidates.filter(c => c.whaleSignal && (c.whaleSignal.whaleWalletCount > 0 || c.whaleSignal.whaleFlow24hUsd > 0));
    if (whaleSignals.length > 0) solanaSmartMoney.whaleBuying24h = whaleSignals.slice(0, 30);

    const mustBuySignals = parsedCandidates.filter(c => c.status === "STRONG_BUY" && c.score >= 85);
    if (mustBuySignals.length > 0) solanaSmartMoney.mustBuyNow = mustBuySignals.slice(0, 30);

    const timeframeSections = {
      generatedAt: new Date().toISOString(),
      sections: { "1hour": { items: [] }, "4hour": { items: [] }, "1day": { items: [] } },
      summary: { "1hour": { count: 0, avgWinRate: 0 }, "4hour": { count: 0, avgWinRate: 0 }, "1day": { count: 0, avgWinRate: 0 } }
    };

    monitored.forEach(m => {
      let smart = { walletBuyCount: 0, avgSmartScore: 0 };
      let whale = { whaleWalletCount: 0 };
      try { if (m.smart_money_data) smart = JSON.parse(m.smart_money_data); } catch(e) {}
      try { if (m.whale_data) whale = JSON.parse(m.whale_data); } catch(e) {}
      
      const candidate = {
        token: { mint: m.token_address, symbol: m.symbol },
        score: m.score, status: m.strategy_status || 'WATCH', 
        timeframe: m.status || 'DISCOVERY', accumulation_info: m.timeframe, added_at: m.added_at,
        rug_status: m.rug_status, liq_status: m.liq_status,
        smart_money_count: m.smart_money_count, whale_count: m.whale_count, insider_count: m.insider_count || 0,
        smartWalletSignal: smart, whaleSignal: whale,
        timeframeMetrics: {
          accumulationHourWIB: m.timeframe || new Date(m.added_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
          winRate: smart.avgSmartScore || 0
        }
      };

      const ageHours = (Date.now() - new Date(m.added_at).getTime()) / (1000 * 60 * 60);
      if (ageHours <= 1) timeframeSections.sections["1hour"].items.push(candidate);
      else if (ageHours <= 4) timeframeSections.sections["4hour"].items.push(candidate);
      else timeframeSections.sections["1day"].items.push(candidate);
    });

    ["1hour", "4hour", "1day"].forEach(key => {
      const items = timeframeSections.sections[key].items;
      timeframeSections.summary[key].count = items.length;
      if (items.length > 0) {
        timeframeSections.summary[key].avgWinRate = items.reduce((s, it) => s + (it.timeframeMetrics.winRate || 0), 0) / items.length;
      }
    });

    solanaSmartMoney.timeframeSections = timeframeSections;

    const holderHistoryMap = {};
    for (const m of monitored.slice(0, 50)) {
      const history = await dbManager.getTokenHistory(m.token_address, 24);
      if (history?.length) {
        holderHistoryMap[m.token_address] = history.map(h => ({
          timestamp: new Date(h.timestamp).getTime(),
          totalHolders: h.holders_count,
          price: h.price_usd,
          marketCap: h.market_cap
        }));
      }
    }
    solanaSmartMoney.tokenHolderDetails = { history: holderHistoryMap };

    const dbStats = await dbManager.query("SELECT COUNT(*) as count FROM monitor_list");
    solanaSmartMoney.providerStatus = {
      dexscreener: true,
      latestProfilesTracked: dbStats[0]?.count || 0,
      discoveryCandidates: dbStats[0]?.count || 0,
      goplus: !!process.env.GOPLUS_API_KEY,
      helius: !!process.env.HELIUS_API_KEY,
      birdeye: !!process.env.BIRDEYE_API_KEY
    };

    const phoenixCards = parsedCandidates.map(c => {
      const score = Number(c.score || 0);
      let phoenixTier = "WATCH";
      if (score >= 90 || c.status === "STRONG_BUY") phoenixTier = "FIRE";
      else if (score >= 75) phoenixTier = "CANDIDATE";
      else if (score >= 55) phoenixTier = "PRE_IGN";
      else if (score < 40) phoenixTier = "CAPITUL";

      return {
        ca: c.token.mint, symbol: c.token.symbol, phoenixScore: score, phoenixTier, pair: c.pair,
        metrics: {
          smartMoney: c.smartWalletSignal?.walletBuyCount || 0,
          whale: c.whaleSignal?.whaleWalletCount || 0,
          vol24hUsd: c.pair?.volume?.h24 || 0,
          winRate: c.smartWalletSignal?.avgSmartScore || 0
        }
      };
    });

    solanaSmartMoney.phoenixScanner = {
      summary: { total: parsedCandidates.length },
      cards: phoenixCards
    };

    const dbSolanaPositions = await dbManager.getActivePositions('solana');
    const dbSolanaTrades = await dbManager.getPaperTrades(100);
    const livePaperStats = await dbManager.getPaperStats();

    if (livePaperStats) {
      solanaPaper.stats = {
        totalTrades: livePaperStats.total_trades || 0,
        profitTrades: livePaperStats.profit_trades || 0,
        lossTrades: livePaperStats.loss_trades || 0,
        winRate: livePaperStats.win_rate || 0,
        netPnlSol: livePaperStats.net_pnl_sol || 0,
        totalInvestedSol: livePaperStats.total_invested_sol || 0
      };
    }

    solanaPaper.activePositions = dbSolanaPositions.map(p => ({
      id: p.id, tokenAddress: p.token_address, symbol: p.symbol,
      entryPrice: p.entry_price, currentPrice: p.current_price, amountSol: p.amount_sol,
      targetTP: p.target_tp, targetSL: p.target_sl, openedAt: p.opened_at,
      isHold: !!p.is_hold,
      unrealizedPnlPct: p.entry_price > 0 ? (((p.current_price || p.entry_price) - p.entry_price) / p.entry_price) * 100 : 0
    }));

    solanaPaper.tradeHistory = dbSolanaTrades.map(t => ({
      id: t.id, tokenAddress: t.token_address, symbol: t.symbol,
      entryPrice: t.entry_price, exitPrice: t.exit_price, amountSol: t.amount_sol,
      targetTP: t.target_tp, targetSL: t.target_sl,
      pnlSol: t.pnl_sol, pnlPct: t.pnl_pct, result: t.result,
      trigger: t.trigger_type, closedAt: t.closed_at
    }));

    const dbCexPositions = await dbManager.getActivePositions('cex');
    const dbCexTrades = await dbManager.getCexTrades(100);
    const dbCexStats = await dbManager.getCexStats();
    
    if (dbCexStats) {
      cexPaper.stats = {
        totalTrades: dbCexStats.total_trades || 0,
        profitTrades: dbCexStats.profit_trades || 0,
        lossTrades: dbCexStats.loss_trades || 0,
        winRate: dbCexStats.win_rate || 0,
        netPnlUsdt: dbCexStats.net_pnl_usdt || 0,
        balanceUsdt: await dbManager.getCexBalance()
      };
    }

    cexPaper.activeTrades = dbCexPositions.map(p => ({
      id: p.id, symbol: p.symbol, entryPrice: p.entry_price, currentPrice: p.current_price || p.entry_price,
      amountUsdt: p.amount_usdt, targetTP: p.target_tp, targetSL: p.target_sl, openedAt: p.opened_at,
      isHold: !!p.is_hold,
      pnlPct: p.entry_price > 0 ? (((p.current_price || p.entry_price) - p.entry_price) / p.entry_price) * 100 : 0
    }));

    cexPaper.tradeHistory = dbCexTrades.map(t => ({
      id: t.id, symbol: t.symbol, entryPrice: t.entry_price, exitPrice: t.exit_price,
      targetTP: t.target_tp, targetSL: t.target_sl,
      amountUsdt: t.amount_usdt, pnlUsdt: t.pnl_usd, pnlPct: t.pnl_percent, result: t.result,
      trigger: t.trigger_type, closedAt: t.closed_at
    }));

  } catch (e) {
    console.error("[dashboard] Enrichment error:", e.message);
  }

  return {
    generatedAt: new Date().toISOString(),
    spot: spotState, futures: futuresState,
    solanaSmartMoney, solanaPaperTrading: solanaPaper,
    solanaPaperBalance, trackedWallets, cexPaper,
    recentLogs: readRecentLogs(LEDGER_FILES.log), sqliteTrades
  };
}

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin/users", adminRoutes);

// Test Diagnostic
app.get("/api/admin/test", (req, res) => res.json({ ok: true, msg: "Admin base path working" }));

app.get("/api/cex-paper", async (req, res) => {
  try {
    const cexPaper = await dbManager.getState("cex_bot_state") || { stats: {} };
    const dbCexPositions = await dbManager.getActivePositions('cex');
    const dbCexTrades = await dbManager.getCexTrades(100);
    const dbCexStats = await dbManager.getCexStats();
    
    if (dbCexStats) {
      cexPaper.stats = {
        totalTrades: dbCexStats.total_trades || 0,
        profitTrades: dbCexStats.profit_trades || 0,
        lossTrades: dbCexStats.loss_trades || 0,
        winRate: dbCexStats.win_rate || 0,
        netPnlUsdt: dbCexStats.net_pnl_usdt || 0,
        balanceUsdt: await dbManager.getCexBalance()
      };
    }

    cexPaper.activeTrades = dbCexPositions.map(p => ({
      id: p.id, symbol: p.symbol, entryPrice: p.entry_price, currentPrice: p.current_price || p.entry_price,
      amountUsdt: p.amount_usdt, targetTP: p.target_tp, targetSL: p.target_sl, openedAt: p.opened_at,
      isHold: !!p.is_hold,
      pnlPct: p.entry_price > 0 ? (((p.current_price || p.entry_price) - p.entry_price) / p.entry_price) * 100 : 0
    }));

    cexPaper.tradeHistory = dbCexTrades.map(t => ({
      id: t.id, symbol: t.symbol, entryPrice: t.entry_price, exitPrice: t.exit_price,
      targetTP: t.target_tp, targetSL: t.target_sl,
      amountUsdt: t.amount_usdt, pnlUsdt: t.pnl_usd, pnlPct: t.pnl_percent, result: t.result,
      trigger: t.trigger_type, closedAt: t.closed_at
    }));

    res.json(cexPaper);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/db-status", async (req, res) => {
  try {
    const tables = await dbManager.query("SELECT name FROM sqlite_master WHERE type='table'");
    const status = { connected: true, tables: tables.map(t => t.name), rows: {} };
    for (const t of status.tables) {
      const count = await dbManager.query(`SELECT count(*) as c FROM ${t}`);
      status.rows[t] = count[0].c;
    }
    res.json(status);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const payload = await buildDashboardPayload();
    res.json(payload);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/dashboard/live-prices", async (req, res) => {
  try {
    const positions = await dbManager.getActivePositions('solana');
    if (!positions?.length) return res.json([]);

    const mints = positions.map(p => p.token_address);
    const prices = await getUIPriceBatch(mints);
    
    const results = positions.map(pos => {
      const currentPrice = prices[pos.token_address]?.usd || pos.current_price;
      const entryPrice = Number(pos.entry_price);
      return { 
        id: pos.id, 
        currentPrice, 
        pnlPct: entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0 
      };
    });

    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/prices", async (req, res) => {
  try {
    const mints = req.query.mints ? req.query.mints.split(",") : [];
    if (!mints.length) return res.json({ prices: {} });
    
    const prices = await getUIPriceBatch(mints);
    res.json({ prices });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/cex/live-prices", async (req, res) => {
  try {
    const positions = await dbManager.getActivePositions('cex');
    if (!positions?.length) return res.json([]);

    const symbols = [...new Set(positions.map(p => p.symbol))];
    const exchange = createPublicExchange(process.env.CEX_EXCHANGE || "kraken");
    const tickers = await withRetry(() => withTimeout(() => exchange.fetchTickers(symbols), 8000), "fetchTickers");
    
    const results = positions.map(pos => {
      const ticker = tickers[pos.symbol];
      if (!ticker) return null;
      const currentPrice = Number(ticker.last || ticker.close || 0);
      const entryPrice = Number(pos.entry_price);
      return { id: pos.id, symbol: pos.symbol, currentPrice, pnlPercentage: ((currentPrice - entryPrice) / entryPrice) * 100 };
    }).filter(Boolean);

    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/webhook/helius", async (req, res) => {
  res.json({ status: "OK" });
  handleHeliusWebhook(req.body).catch(e => console.error("[WEBHOOK ERROR]", e.message));
});

// Protected Trading Routes
app.post("/api/paper-trade/manual-buy", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { token_address, amount, symbol } = req.body;
    const balance = await dbManager.getPaperBalance();
    if (balance < amount) return res.status(400).json({ error: "Saldo tidak cukup" });

    const price = await getExecutionPrice(token_address);
    const position = {
      id: `manual-${Date.now()}`,
      tokenAddress: token_address, symbol,
      entryPrice: price, currentPrice: price, amountSol: amount,
      targetTP: price * 1.5, targetSL: price * 0.8,
      openedAt: new Date().toISOString(), status: "OPEN",
      metadata: { source: "dashboard_manual", user: req.user.username }
    };

    await dbManager.saveOpenPosition('solana', position);
    await dbManager.updatePaperBalance(balance - amount);
    res.json({ success: true, entryPrice: price });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/solana-paper/toggle-hold", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { id, isHold } = req.body;
    if (!id) return res.status(400).json({ error: "ID required" });
    await dbManager.updatePositionHold(id, isHold);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/solana-paper/update-targets", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { id, tp, sl } = req.body;
    if (!id) return res.status(400).json({ error: "ID required" });
    await dbManager.updatePositionTargets(id, Number(tp), Number(sl));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/cex-paper/toggle-hold", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { id, isHold } = req.body;
    if (!id) return res.status(400).json({ error: "ID required" });
    await dbManager.updatePositionHold(id, isHold);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/cex-paper/update-targets", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { id, tp, sl } = req.body;
    if (!id) return res.status(400).json({ error: "ID required" });
    await dbManager.updatePositionTargets(id, Number(tp), Number(sl));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/close-position", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { mode, mint, id, tradeId, symbol } = req.body;
    if (mode === "solana-paper") {
      const result = await closeSolanaPaperPosition(mint, id);
      return res.json({ ok: true, closed: result.closed });
    }
    if (mode === "cex-paper") {
      const result = await closeCexTradeManually({ tradeId, symbol });
      return res.json({ ok: true, closed: result.closed });
    }
    res.status(400).json({ error: "Invalid mode" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/blacklist", verifyToken, requireApproved, requireRole(['USER', 'ADMIN']), async (req, res) => {
  try {
    const { mint, symbol, reason } = req.body;
    if (!mint) return res.status(400).json({ error: "Mint address required" });
    await dbManager.blacklistToken(mint, symbol || "UNKNOWN", reason || "Manual Blacklist");
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Static Assets
app.use(express.static(DASHBOARD_DIR));

// Start Server
async function startDashboard() {
  await dbManager.initDb();
  runBackgroundPolling();
  app.listen(PORT, () => {
    console.log(`[SERVER] 🔥 Express Dashboard siap di http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startDashboard();
}

module.exports = { startDashboard };
