require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { createPublicExchange, withTimeout, withRetry } = require("./cexExchange");
const { CexMonitor } = require("./cexMonitor");
const { CexSimulator } = require("./cexSimulator");
const { CexTracker } = require("./cexTracker");

const dbManager = require("../database/dbManager");
const TelegramNotifier = require("../utils/telegram_notifier");

const config = {
  enabled: process.env.CEX_BOT_ENABLED !== "false",
  exchangeId: process.env.CEX_EXCHANGE || "kraken",
  scanIntervalMs: Number(process.env.CEX_SCAN_INTERVAL_MS || 60000),
  startingBalanceUsdt: Number(process.env.CEX_STARTING_BALANCE_USDT || 1000),
  positionSizeUsdt: Number(process.env.CEX_POSITION_SIZE_USDT || 100),
  takeProfitPct: Number(process.env.CEX_TAKE_PROFIT_PCT || 3),
  stopLossPct: Number(process.env.CEX_STOP_LOSS_PCT || 1.5),
  stateKey: "cex_bot_state",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};

const notifier = new TelegramNotifier({
  botToken: config.telegramBotToken,
  chatId: config.telegramChatId
});

async function readSnapshot() {
  return await dbManager.getState(config.stateKey);
}

async function writeSnapshot(payload) {
  await dbManager.saveState(config.stateKey, payload);
}

async function buildDashboardPayload(simulator, monitor, meta = {}) {
  const stats = await simulator.getStats();
  const activeTrades = await simulator.getActiveTrades();
  const tradeHistory = await simulator.getTradeHistory();

  return {
    generatedAt: new Date().toISOString(),
    enabled: config.enabled,
    exchangeId: config.exchangeId,
    strategy: "Volume Spike Breakout",
    config: {
      scanIntervalMs: config.scanIntervalMs,
      startingBalanceUsdt: config.startingBalanceUsdt,
      positionSizeUsdt: config.positionSizeUsdt,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      volumeSpikeMultiplier: Number(process.env.CEX_VOLUME_SPIKE_MULTIPLIER || 3),
      volumeMaPeriod: 15,
    },
    stats,
    virtualPortfolio: { balanceUsdt: simulator.balanceUsdt },
    activeTrades,
    pendingOrders: [], // Simulator now treats them as active or manages internally
    tradeHistory: tradeHistory.slice(0, 80),
    recentSignals: meta.recentSignals || [],
    lastScan: meta.lastScan || null,
    engine: simulator.exportSnapshot(),
  };
}

async function runScanCycle(monitor, simulator) {
  const scan = await monitor.scanForSignals();
  const opened = [];

  for (const signal of scan.signals) {
    if (monitor.isCooldownActive()) {
      console.log(`[cexBot] Skip membuka posisi untuk ${signal.symbol} karena cooldown global aktif.`);
      continue;
    }

    const trade = await simulator.openFromBuySignal(signal);
    if (trade) {
      opened.push(trade);
      monitor.recordBuyOpened();
      
      // Task: Telegram Notification for CEX Trade
      try {
        await notifier.sendCexSpikeAlert({
          pair: signal.symbol,
          price: signal.signal.close,
          ema200: signal.signal.ema200_15m,
          volumeRatio: signal.signal.volumeRatio,
          entryPullback: signal.entryPrice,
          targetTP: signal.targetTP,
          targetSL: signal.targetSL,
          rationale: signal.signal.rationale,
          stopLossPct: signal.signal.stopLossPct,
          takeProfitPct: signal.signal.takeProfitPct
        });
      } catch (tgErr) {
        console.warn(`[cexBot] Telegram alert gagal untuk ${signal.symbol}: ${tgErr.message}`);
      }
      
      // SQLite position and trade handled by simulator now
    }
  }

  if (opened.length) {
    console.log(`[cexBot] Siklus scan: ${opened.length} posisi baru dibuka.`);
  }

  return { scan, opened };
}

async function startBot() {
  if (!config.enabled) {
    console.log("[cexBot] CEX bot dinonaktifkan (CEX_BOT_ENABLED=false).");
    return;
  }

  const monitor = new CexMonitor({ exchangeId: config.exchangeId });
  await monitor.init();

  const simulator = new CexSimulator({
    startingBalanceUsdt: config.startingBalanceUsdt,
    positionSizeUsdt: config.positionSizeUsdt,
    takeProfitPct: config.takeProfitPct,
    stopLossPct: config.stopLossPct,
  });

  const snapshot = await readSnapshot();
  if (snapshot?.engine) {
    simulator.loadSnapshot(snapshot.engine);
  }
  
  // Sync balance from DB
  simulator.balanceUsdt = await dbManager.getCexBalance();

  const tracker = new CexTracker(simulator, { exchangeId: config.exchangeId });
  tracker.start();

  let recentSignals = snapshot?.recentSignals || [];
  let lastScan = snapshot?.lastScan || null;
  let scanning = false;
  let lastLocalWriteAt = 0;

  const persist = async () => {
    const disk = await readSnapshot();
    if (
      disk?.engine &&
      disk.manualOverrideAt &&
      new Date(disk.manualOverrideAt).getTime() > lastLocalWriteAt
    ) {
      simulator.loadSnapshot(disk.engine);
      recentSignals = disk.recentSignals || recentSignals;
      lastScan = disk.lastScan || lastScan;
    }

    const payload = await buildDashboardPayload(simulator, monitor, { recentSignals, lastScan });
    
    // Clean up bulky arrays for app_state
    const stripped = { ...payload };
    delete stripped.activeTrades;
    delete stripped.tradeHistory;
    
    await writeSnapshot(stripped);
    lastLocalWriteAt = Date.now();
  };

  const scanLoop = async () => {
    if (scanning) return;
    scanning = true;

    try {
      const { scan, opened } = await runScanCycle(monitor, simulator);
      lastScan = {
        scannedAt: scan.scannedAt,
        universeSize: scan.universeSize,
        buySignals: scan.signals.length,
        opened: opened.length,
        errors: scan.errors?.length || 0,
      };
      recentSignals = [...scan.signals, ...recentSignals].slice(0, 30);
      await persist();
    } catch (error) {
      console.error(`[cexBot] Scan gagal: ${error.message}`);
    } finally {
      scanning = false;
    }
  };

  const trackerPersist = setInterval(async () => {
    await persist();
  }, Number(process.env.CEX_OUTPUT_FLUSH_MS || 8000));

  // First run
  await scanLoop();
  
  // Recurring loop
  setInterval(scanLoop, config.scanIntervalMs);

  console.log(
    `[cexBot] Berjalan · ${config.exchangeId} · scan tiap ${config.scanIntervalMs / 1000}s · storage SQLite`,
  );

  process.on("SIGINT", async () => {
    tracker.stop();
    clearInterval(trackerPersist);
    await persist();
    console.log("[cexBot] Dihentikan, snapshot disimpan ke SQLite.");
    process.exit(0);
  });
}

async function closeCexTradeManually(params = {}) {
  const tradeId = String(params.tradeId || "").trim();
  const symbol = String(params.symbol || "").trim().toUpperCase();
  const snapshot = await readSnapshot();

  if (!snapshot?.engine) {
    throw new Error("State CEX paper belum ada — jalankan npm run monitor:cex.");
  }

  const simulator = new CexSimulator({
    startingBalanceUsdt: snapshot.config?.startingBalanceUsdt ?? config.startingBalanceUsdt,
    positionSizeUsdt: snapshot.config?.positionSizeUsdt ?? config.positionSizeUsdt,
    takeProfitPct: snapshot.config?.takeProfitPct ?? config.takeProfitPct,
    stopLossPct: snapshot.config?.stopLossPct ?? config.stopLossPct,
  });
  simulator.loadSnapshot(snapshot.engine);
  simulator.balanceUsdt = await dbManager.getCexBalance();

  const activeTrades = await simulator.getActiveTrades();
  const trade = activeTrades.find(
    (item) => (tradeId && String(item.id) === tradeId) || (symbol && item.symbol === symbol),
  );

  if (!trade) {
    throw new Error("Posisi CEX tidak ditemukan atau sudah ditutup.");
  }

  let exitPrice = Number(trade.currentPrice || trade.entryPrice || 0);
  try {
    const exchange = createPublicExchange(snapshot.exchangeId || config.exchangeId);
    const ticker = await withRetry(
      () => withTimeout(() => exchange.fetchTicker(trade.symbol), undefined, `ticker ${trade.symbol}`),
      `ticker ${trade.symbol}`,
    );
    exitPrice = Number(ticker.last || ticker.close || exitPrice);
  } catch (error) {
    console.warn(`[cexBot] Harga live gagal, pakai mark price: ${error.message}`);
  }

  const closed = await simulator.closeTrade(trade.id, exitPrice, "MANUAL");
  if (!closed) {
    throw new Error("Gagal menutup posisi CEX.");
  }

  // Update Balance
  simulator.balanceUsdt = await dbManager.getCexBalance();

  const payload = await buildDashboardPayload(simulator, null, {
    recentSignals: snapshot.recentSignals || [],
    lastScan: snapshot.lastScan || null,
  });
  
  const stripped = { ...payload };
  delete stripped.activeTrades;
  delete stripped.tradeHistory;
  
  stripped.manualOverrideAt = new Date().toISOString();
  await writeSnapshot(stripped);

  return { closed, payload };
}

if (require.main === module) {
  startBot().catch((error) => {
    console.error(`[cexBot] Fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  startBot,
  buildDashboardPayload,
  closeCexTradeManually,
  config,
  readSnapshot,
};
