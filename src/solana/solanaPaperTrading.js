require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { SimulationEngine } = require("./tradingSimulator");
const { getTokenPrices, getTokenPrice, getUIPriceBatch } = require("./priceFetcher");
const { analyzeToken } = require("./tokenValidator");
const dbManager = require("../database/dbManager");
const heliusAdvanced = require("../services/heliusAdvancedService");
const heliusProfiler = require("../adapters/heliusProfiler");
const rugcheckAdapter = require("../adapters/rugcheckAdapter");

const config = {
  enabled: process.env.SOLANA_PAPER_TRADING_ENABLED !== "false",
  stateKey: "solana_paper_trading_state",
  buyAmountSol: Number(process.env.SIM_DEFAULT_BUY_SOL || process.env.SOLANA_PAPER_BUY_SOL || 0.5),
  takeProfitPct: Number(process.env.SIM_TAKE_PROFIT_PCT || 50),
  stopLossPct: Number(process.env.SIM_STOP_LOSS_PCT || 20),
  maxOpenPositions: Number(process.env.SOLANA_PAPER_MAX_OPEN || 20),
  maxHistory: Number(process.env.SOLANA_PAPER_MAX_HISTORY || 120),
  buyTriggers: String(process.env.SOLANA_PAPER_BUY_TRIGGERS || "fire,must_buy,buy_zone,strong_buy,phoenix_fire,phoenix_candidate,alpha,phoenix_pre_ign")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  usePriceFetcher: process.env.SOLANA_PAPER_USE_PRICE_FETCHER !== "false",
  priceFetchDelayMs: Number(process.env.PRICE_FETCH_BATCH_DELAY_MS || 150),
  useTokenValidator: process.env.SOLANA_PAPER_USE_TOKEN_VALIDATOR !== "false",
  minValidatorScore: Number(process.env.SOLANA_PAPER_MIN_VALIDATOR_SCORE || 60),
  sniperMode: process.env.SOLANA_INSTITUTIONAL_SNIPER_MODE === "true",
};

function createEngineFromSnapshot(snapshot) {
  const engine = new SimulationEngine({
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
    allowDuplicateToken: false,
  });

  if (snapshot?.engine) {
    engine.loadSnapshot(snapshot.engine);
  }

  return engine;
}

async function loadPaperTradingState() {
  const dbConfig = await dbManager.getBotConfig();
  const dbStats = await dbManager.getBotStats();
  
  const engine = createEngineFromSnapshot({
    engine: {
      defaultTakeProfitPct: dbConfig?.take_profit_pct,
      defaultStopLossPct: dbConfig?.stop_loss_pct,
      balanceSol: await dbManager.getPaperBalance()
    }
  });
  
  // Positions are now directly managed in SQLite by the engine.

  return {
    engine,
    config: dbConfig,
    stats: dbStats
  };
}

async function savePaperTradingState(payload) {
  // Update Bot Config from payload if present
  if (payload.config) {
    await dbManager.updateBotConfig({
      is_enabled: payload.enabled,
      buy_amount_sol: payload.config.buyAmountSol,
      take_profit_pct: payload.config.takeProfitPct,
      stop_loss_pct: payload.config.stopLossPct,
      buy_triggers: payload.config.buyTriggers,
      max_open_positions: payload.config.maxOpenPositions,
      quote_unit: payload.config.quoteUnit,
      use_price_fetcher: payload.config.usePriceFetcher,
      use_token_validator: payload.config.useTokenValidator
    });
  }

  // Update Bot Stats from payload if present
  if (payload.stats) {
    await dbManager.updateBotStats({
      total_trades: payload.stats.totalTrades,
      profit_trades: payload.stats.profitTrades,
      loss_trades: payload.stats.lossTrades,
      win_rate: payload.stats.winRate,
      net_pnl_sol: payload.stats.netPnlSol,
      total_fees_sol: payload.stats.totalFeesSol,
      total_invested_sol: payload.stats.totalInvestedSol,
      avg_pnl_sol: payload.stats.avgPnlSol
    });
  }

  // Clean up bulky arrays before saving to generic app_state
  const strippedState = { ...payload };
  delete strippedState.activePositions;
  delete strippedState.tradeHistory;
  
  await dbManager.saveState(config.stateKey, strippedState).catch(() => {});
}

function candidateBuyTriggers(candidate) {
  const triggers = [];
  if (candidate?.signals?.mustBuy?.value) triggers.push("must_buy");
  if (candidate?.tier?.key === "fire") triggers.push("fire");
  if (candidate?.tier?.key === "alpha") triggers.push("alpha");
  if (String(candidate?.status || "").toUpperCase() === "BUY_ZONE") triggers.push("buy_zone");
  if (String(candidate?.status || "").toUpperCase() === "STRONG_BUY") triggers.push("strong_buy");
  if (candidate?.phoenixTier === "FIRE") triggers.push("phoenix_fire");
  if (candidate?.phoenixTier === "CANDIDATE") triggers.push("phoenix_candidate");
  if (candidate?.phoenixTier === "PRE_IGN") triggers.push("phoenix_pre_ign");
  return triggers;
}

function shouldOpenPaperPosition(candidate) {
  const matched = candidateBuyTriggers(candidate);
  return matched.some((trigger) => config.buyTriggers.includes(trigger));
}

/**
 * Evaluates conviction of the Institutional Sniper filters asynchronously.
 * @param {object} candidate
 * @param {object} telegramSignal
 * @returns {Promise<{ approved: boolean, isInsider: boolean, isSafe: boolean, isBullish: boolean }>}
 */
async function evaluateSniperConviction(candidate, telegramSignal) {
  const mint = candidate?.token?.mint;
  if (!mint) {
    return { approved: false, isInsider: false, isSafe: false, isBullish: false };
  }

  // 1. Check RugCheck API
  let isSafe = false;
  try {
    isSafe = await rugcheckAdapter.isTokenSafe(mint);
  } catch (err) {
    console.error(`[🛡️ RUGCHECK] Gagal memproses Rugcheck:`, err.message);
  }

  // 2. Check Telegram Sentiment
  const isBullish = telegramSignal ? telegramSignal.isBullish === true : false;
  if (telegramSignal) {
    console.log(`[📡 ALPHA] Sinyal Telegram terdeteksi untuk ${candidate.token?.symbol || mint.slice(0, 6)} (Bullish: ${isBullish})`);
  } else {
    console.log(`[📡 ALPHA] Tidak ada sinyal Telegram untuk ${candidate.token?.symbol || mint.slice(0, 6)}`);
  }

  // 3. Check Insider wallet activity
  let isInsider = false;
  const wallets = candidate?.smartWalletSignal?.wallets || [];
  
  if (wallets.length > 0) {
    const walletInsiderResults = await Promise.all(
      wallets.map(async (wallet) => {
        try {
          return await heliusProfiler.isInsiderWallet(wallet.address);
        } catch (e) {
          return false;
        }
      })
    );
    isInsider = walletInsiderResults.some((result) => result === true);
  } else {
    console.log(`[🕵️ HELIUS] Tidak ada histori wallet pembeli smart money untuk dicheck di ${candidate.token?.symbol || mint.slice(0, 6)}`);
  }

  const approved = isInsider && isSafe && isBullish;

  console.log(`[🏹 SNIPER CONVICTION CHECK] Token: ${candidate.token?.symbol || mint.slice(0, 6)}`);
  console.log(` - 🛡️ RUGCHECK Token Aman: ${isSafe ? "✅ Ya" : "❌ Tidak"}`);
  console.log(` - 📡 ALPHA Sentimen Bullish: ${isBullish ? "✅ Ya" : "❌ Tidak"}`);
  console.log(` - 🕵️ HELIUS Insider Aktif: ${isInsider ? "✅ Ya" : "❌ Tidak"}`);

  return { approved, isInsider, isSafe, isBullish };
}

async function buildPriceMapFromCandidates(candidates, engine) {
  const prices = {};

  for (const candidate of candidates || []) {
    const mint = candidate?.token?.mint;
    const price = Number(candidate?.pair?.priceUsd || 0);
    if (mint && Number.isFinite(price) && price > 0) {
      prices[mint] = price;
    }
  }

  for (const position of await engine.getOpenPositions()) {
    if (prices[position.tokenAddress]) {
      continue;
    }
    const current = Number(position.currentPrice || position.entryPrice || 0);
    if (current > 0) {
      prices[position.tokenAddress] = current;
    }
  }

  return prices;
}

async function buildPriceMapForCycle(candidates, engine) {
  const prices = await buildPriceMapFromCandidates(candidates, engine);

  if (!config.usePriceFetcher) {
    return prices;
  }

  const openPositions = await engine.getOpenPositions();
  const openMints = openPositions
    .map((position) => position.tokenAddress)
    .filter(Boolean);

  if (!openMints.length) {
    return prices;
  }

  // JALUR UI: Ambil harga batch via DexScreener
  const fetchedPrices = await getUIPriceBatch(openMints);

  for (const mint of openMints) {
    if (fetchedPrices[mint]) {
      prices[mint] = fetchedPrices[mint];
    }
  }

  // Price sources for UI meta
  prices._priceSources = Object.fromEntries(
    openMints.map(mint => [mint, fetchedPrices[mint] ? "dexscreener_batch" : "unknown"])
  );

  return prices;
}

async function buildPaperTradingPayload(engine, meta = {}) {
  const stats = await engine.getSimulationStats();
  const tradeHistory = await engine.getTradeHistory();
  const openPositions = await engine.getOpenPositions();
  
  const activePositions = openPositions.map((position) => {
    const currentPrice = Number(position.currentPrice || position.entryPrice || 0);
    const markValue = position.virtualTokensBought * currentPrice;
    const unrealizedPnl = markValue - position.amountSol;
    const unrealizedPct = position.amountSol > 0 ? (unrealizedPnl / position.amountSol) * 100 : 0;

    return {
      ...position,
      markValueSol: Number(markValue.toFixed(8)),
      unrealizedPnlSol: Number(unrealizedPnl.toFixed(8)),
      unrealizedPnlPct: Number(unrealizedPct.toFixed(2)),
      distanceToTpPct: position.targetTP > 0 ? Number((((position.targetTP - currentPrice) / currentPrice) * 100).toFixed(2)) : 0,
      distanceToSlPct: position.targetSL > 0 ? Number((((currentPrice - position.targetSL) / currentPrice) * 100).toFixed(2)) : 0,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    enabled: config.enabled,
    config: {
      buyAmountSol: config.buyAmountSol,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      buyTriggers: config.buyTriggers,
      maxOpenPositions: config.maxOpenPositions,
      quoteUnit: "Simulation: Buy with SOL (fixed amount) · Prices tracked in USD",
      usePriceFetcher: config.usePriceFetcher,
      useTokenValidator: config.useTokenValidator,
    },
    stats,
    activePositions,
    tradeHistory: tradeHistory.slice(-config.maxHistory),
    recentEvents: meta.recentEvents || [],
    cycle: meta.cycle || null,
    engine: engine.exportSnapshot(),
  };
}

/**
 * Jalankan siklus paper trading dari kandidat monitor Solana.
 * @param {object[]} candidates
 * @param {{ cycleCount?: number }} [meta]
 */
async function runSolanaPaperTradingCycle(candidates, meta = {}) {
  if (!config.enabled) {
    const emptyEngine = createEngineFromSnapshot(null);
    return await buildPaperTradingPayload(emptyEngine, { cycle: meta.cycleCount || null });
  }

  const { engine, config: dbConfig } = await loadPaperTradingState();
  const recentEvents = [];
  let buysOpened = 0;
  let totalChecked = 0;

  // Sync active triggers from DB for accurate logging
  const activeTriggers = dbConfig?.buy_triggers || config.buyTriggers;

  const ranked = [...(candidates || [])]
    .filter((candidate) => candidate?.token?.mint && candidate?.pair?.priceUsd)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  for (const candidate of ranked) {
    totalChecked++;
    const mint = candidate.token.mint;
    const symbol = candidate.token.symbol || mint.slice(0, 6);
    const triggers = candidateBuyTriggers(candidate);
    
    // GATE 1: CHECK POSITION LIMIT
    const openPositions = await engine.getOpenPositions();
    const maxPos = dbConfig?.max_open_positions || config.maxOpenPositions;
    if (openPositions.length >= maxPos) {
      console.log(`[REJECTED] Gagal beli ${symbol}, slot posisi aktif sudah penuh (${openPositions.length}/${maxPos}).`);
      break; // Stop further buys in this cycle
    }

    // GATE 2: CHECK TRIGGERS
    const matchedTriggers = triggers.filter(t => activeTriggers.includes(t));
    if (matchedTriggers.length === 0) {
      // console.log(`[REJECTED] Koin ${symbol} diabaikan karena sinyal [${triggers.join(",")}] tidak masuk dalam trigger config [${activeTriggers.join(",")}].`);
      continue;
    }

    console.log(`[AUTO-BUY CHECK] Sinyal koin ${symbol}: [${triggers.join(",")}] | Cocok dengan trigger config.`);

    // GATE 3: DUPLICATE CHECK
    if (await engine.hasOpenPosition(mint)) {
      // console.log(`[solanaPaper] Already have position for ${symbol}. Skipping.`);
      continue;
    }

    // GATE 4: TOKEN VALIDATOR (RUGCHECK etc)
    let tokenValidation = null;
    if (config.useTokenValidator) {
      tokenValidation = await analyzeToken(mint, {
        symbol: symbol,
        pair: candidate.pair,
        minScore: config.minValidatorScore,
      });

      if (!tokenValidation.approved) {
        console.log(`[REJECTED] Koin ${symbol} DIGAGALKAN oleh Validator/Rugcheck: ${tokenValidation.reasons.join(" | ")} (Score: ${tokenValidation.score})`);
        continue;
      }
    }

    // GATE 5: SNIPER CONVICTION
    const telegramSignal = meta.telegramSignals ? meta.telegramSignals.get(mint) : null;
    const sniperResult = await evaluateSniperConviction(candidate, telegramSignal);
    
    if (config.sniperMode && !sniperResult.approved) {
      console.log(`[REJECTED] Koin ${symbol} digagalkan oleh kriteria Sniper Mode.`);
      continue;
    }

    const entryPrice = Number(candidate.pair.priceUsd);

    // Institutional Upgrade: Dynamic Priority Fee
    let priorityFee = 1000; // default
    try {
      priorityFee = await heliusAdvanced.getOptimalPriorityFee();
      console.log(`[HELIUS ADV] Fee optimasi untuk ${symbol}: ${priorityFee} microlamports`);
    } catch (fErr) {}

    const opened = await engine.simulateBuy(mint, entryPrice, config.buyAmountSol, {
      symbol: candidate.token.symbol,
      metadata: {
        status: candidate.status,
        tier: candidate.tier?.key || null,
        phoenixTier: candidate.phoenixTier || null,
        score: candidate.score || 0,
        triggers: triggers,
        validatorScore: tokenValidation?.score ?? null,
        validatorChecks: tokenValidation?.checks ?? null,
        priorityFee: priorityFee, // Tracked in metadata
      },
    });

    if (opened) {
      buysOpened += 1;
      if (meta.cycleSummary) meta.cycleSummary.buysOpened += 1;
      recentEvents.push({
        type: "BUY",
        at: opened.openedAt,
        symbol: opened.symbol,
        mint,
        amountSol: opened.amountSol,
        entryPrice: opened.entryPrice,
      });

      // SQLITE POSITION AND TRADE (Handled by engine, but keeping legacy general trade if desired)
      await dbManager.saveTrade({
        pair: opened.symbol,
        type: "BUY",
        price: opened.entryPrice,
        amount: opened.amountSol,
        trigger_type: "ENTRY"
      }).catch(() => {});
    }
  }

  const priceMap = await buildPriceMapForCycle(candidates, engine);
  const priceSources = priceMap._priceSources || {};
  delete priceMap._priceSources;

  const tick = await engine.updatePricesAndCheckTriggers(priceMap);

  for (const closed of tick.closed || []) {
    recentEvents.push({
      type: closed.trigger,
      at: closed.closedAt,
      symbol: closed.symbol,
      mint: closed.tokenAddress,
      result: closed.result,
      pnlSol: closed.pnlSol,
      pnlPct: closed.pnlPct,
    });
  }

  if (buysOpened === 0 && totalChecked > 0) {
    console.log(`[SCAN CYCLE] Siklus selesai. Memeriksa ${totalChecked} koin, 0 dibeli karena tidak lolos kriteria keamanan atau filter.`);
  }

  const payload = await buildPaperTradingPayload(engine, {
    cycle: meta.cycleCount || null,
    recentEvents: recentEvents.slice(-20),
  });

  payload.cycleSummary = {
    buysOpened,
    closedThisCycle: tick.closed?.length || 0,
    stillOpen: tick.stillOpen,
    pricesTracked: Object.keys(priceMap).length,
    priceSources,
  };

  await savePaperTradingState(payload);
  return payload;
}

/**
 * Tutup posisi paper Solana manual dari dashboard.
 * @param {{ mint?: string, positionId?: string, currentPrice?: number }} params
 */
async function closePaperPositionManually(params = {}) {
  const mint = String(params.mint || "").trim();
  const positionId = String(params.positionId || "").trim();
  const manualPrice = Number(params.currentPrice);

  const { engine, stats: existingStats } = await loadPaperTradingState();
  const openPositions = await engine.getOpenPositions();

  const position = openPositions.find((item) => (positionId && String(item.id) === positionId) || (mint && item.tokenAddress === mint));

  if (!position) {
    console.error(`[solanaPaper] Tutup manual gagal: ID ${positionId} / Mint ${mint} tidak ditemukan.`);
    throw new Error("Posisi Solana paper tidak ditemukan atau sudah ditutup.");
  }

  let exitPrice = manualPrice && manualPrice > 0 ? manualPrice : Number(position.currentPrice || position.entryPrice || 0);
  
  // Jika harga tidak disediakan dari UI, coba fetch live
  if (!manualPrice || manualPrice <= 0) {
    try {
      const quote = await getTokenPrice(position.tokenAddress);
      if (quote && quote.priceUsd) exitPrice = Number(quote.priceUsd);
    } catch (error) {
      console.warn(`[solanaPaperTrading] Harga live gagal, pakai mark price: ${error.message}`);
    }
  }

  // forceClose di engine akan menghapus dari database dan memproses PnL
  const closed = await engine.forceClose(position.tokenAddress, exitPrice, "MANUAL", position.id);
  
  if (!closed) {
    throw new Error("Gagal memproses penutupan posisi di engine.");
  }

  // Ambil saldo terbaru dari DB
  const newBalance = await dbManager.getPaperBalance();
  engine.balanceSol = newBalance;

  console.log(`[solanaPaperTrading] Manual Close SUCCESS: ${closed.symbol}. New balance: ${newBalance.toFixed(4)} SOL`);

  const payload = await buildPaperTradingPayload(engine, {
    cycle: null,
    recentEvents: [
      {
        type: "MANUAL",
        at: closed.closedAt,
        symbol: closed.symbol,
        mint: closed.tokenAddress,
        result: closed.result,
        pnlSol: closed.pnlSol,
        pnlPct: closed.pnlPct,
      }
    ],
  });
  payload.manualOverrideAt = new Date().toISOString();
  payload.solanaPaperBalance = newBalance;

  await savePaperTradingState(payload);
  return { closed, payload, newBalance };
}

async function closeSolanaPaperPosition(mint, positionId) {
  return closePaperPositionManually({ mint, positionId });
}

module.exports = {
  config,
  loadPaperTradingState,
  runSolanaPaperTradingCycle,
  buildPaperTradingPayload,
  shouldOpenPaperPosition,
  closePaperPositionManually,
  closeSolanaPaperPosition,
};
