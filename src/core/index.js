require("dotenv").config();

const path = require("path");
const DataFetcher = require("../data/data_fetcher");
const StrategyEngine = require("../strategy/strategy_engine");
const RiskManager = require("../strategy/risk_manager");
const ExecutionEngine = require("./execution_engine");
const PaperAccount = require("./paper_account");
const logger = require("../utils/logger");
const { buildSignalSummary, formatPrice, formatQty } = require("../utils/log_helpers");

const config = {
  runMode: process.env.RUN_MODE || "spot",
  exchangeId: process.env.EXCHANGE_ID || "binance",
  apiKey: process.env.EXCHANGE_API_KEY || "",
  apiSecret: process.env.EXCHANGE_API_SECRET || "",
  apiPassword: process.env.EXCHANGE_API_PASSWORD || "",
  marketType: process.env.MARKET_TYPE || "spot",
  symbol: process.env.SYMBOL || "BTC/USDT",
  baseCurrency: process.env.BASE_CURRENCY || "USDT",
  higherTimeframe: process.env.HIGHER_TIMEFRAME || "1h",
  lowerTimeframe: process.env.LOWER_TIMEFRAME || "5m",
  candleLimit: Number(process.env.CANDLE_LIMIT || 250),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 30000),
  maxRetries: Number(process.env.MAX_RETRIES || 5),
  retryBaseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 1000),
  retryMaxDelayMs: Number(process.env.RETRY_MAX_DELAY_MS || 30000),
  trendSmaFast: Number(process.env.TREND_SMA_FAST || 50),
  trendSmaSlow: Number(process.env.TREND_SMA_SLOW || 200),
  rsiPeriod: Number(process.env.RSI_PERIOD || 14),
  rsiOversold: Number(process.env.RSI_OVERSOLD || 30),
  rsiDipBuffer: Number(process.env.RSI_DIP_BUFFER || 5),
  rsiOverbought: Number(process.env.RSI_OVERBOUGHT || 70),
  rsiOverboughtRejection: Number(process.env.RSI_OVERBOUGHT_REJECTION || 65),
  macdFast: Number(process.env.MACD_FAST || 12),
  macdSlow: Number(process.env.MACD_SLOW || 26),
  macdSignal: Number(process.env.MACD_SIGNAL || 9),
  adxPeriod: Number(process.env.ADX_PERIOD || 14),
  adxTrendThreshold: Number(process.env.ADX_TREND_THRESHOLD || 22),
  adxRangeThreshold: Number(process.env.ADX_RANGE_THRESHOLD || 16),
  atrPeriod: Number(process.env.ATR_PERIOD || 14),
  atrTrendFloorPct: Number(process.env.ATR_TREND_FLOOR_PCT || 0.004),
  atrRangeCeilingPct: Number(process.env.ATR_RANGE_CEILING_PCT || 0.0025),
  atrStopMultiplier: Number(process.env.ATR_STOP_MULTIPLIER || 1.3),
  bbPeriod: Number(process.env.BB_PERIOD || 20),
  bbStdDev: Number(process.env.BB_STD_DEV || 2),
  bandProximityBuffer: Number(process.env.BAND_PROXIMITY_BUFFER || 0.003),
  breakoutLookback: Number(process.env.BREAKOUT_LOOKBACK || 20),
  breakoutVolumeMultiplier: Number(process.env.BREAKOUT_VOLUME_MULTIPLIER || 1.2),
  breakoutBufferPct: Number(process.env.BREAKOUT_BUFFER_PCT || 0.0015),
  volumeLookback: Number(process.env.VOLUME_LOOKBACK || 20),
  volumeSpikeMultiplier: Number(process.env.VOLUME_SPIKE_MULTIPLIER || 1.5),
  rsiOversoldRecovery: Number(process.env.RSI_OVERSOLD_RECOVERY || 35),
  rsiMomentumFloor: Number(process.env.RSI_MOMENTUM_FLOOR || 52),
  rsiMomentumCeiling: Number(process.env.RSI_MOMENTUM_CEILING || 68),
  longScoreThreshold: Number(process.env.LONG_SCORE_THRESHOLD || 5),
  shortScoreThreshold: Number(process.env.SHORT_SCORE_THRESHOLD || Number(process.env.LONG_SCORE_THRESHOLD || 5)),
  maxRiskPerTradePct: Number(process.env.MAX_RISK_PER_TRADE_PCT || 0.01),
  stopLossPct: Number(process.env.STOP_LOSS_PCT || 0.015),
  trailingActivationPct: Number(process.env.TRAILING_ACTIVATION_PCT || 0.02),
  trailingDistancePct: Number(process.env.TRAILING_DISTANCE_PCT || 0.005),
  maxDailyDrawdownPct: Number(process.env.MAX_DAILY_DRAWDOWN_PCT || 0.05),
  cooldownHours: Number(process.env.COOLDOWN_HOURS || 24),
  kellyFractionCap: Number(process.env.KELLY_FRACTION_CAP || 0.25),
  assumedWinRate: Number(process.env.ASSUMED_WIN_RATE || 0.55),
  assumedRewardRisk: Number(process.env.ASSUMED_REWARD_RISK || 1.4),
  dryRun: process.env.DRY_RUN !== "false",
  enableWebSocket: process.env.ENABLE_WEBSOCKET === "true",
  paperStartingBalance: Number(process.env.PAPER_STARTING_BALANCE || 10000),
  paperFeeRate: Number(process.env.PAPER_FEE_RATE || 0.001),
  futuresLeverage: Number(process.env.FUTURES_LEVERAGE || 100),
  futuresMarginUsd: Number(process.env.FUTURES_MARGIN_USD || 10),
  futuresTakeProfitPct: Number(process.env.FUTURES_TAKE_PROFIT_PCT || 50),
  futuresStopLossPct: Number(process.env.FUTURES_STOP_LOSS_PCT || 30),
  paperLedgerPath: process.env.RUN_MODE === "futures"
    ? (process.env.PAPER_FUTURES_LEDGER_PATH || path.join(__dirname, "../../data/paper-futures-ledger.json"))
    : (process.env.PAPER_SPOT_LEDGER_PATH || process.env.PAPER_LEDGER_PATH || path.join(__dirname, "../../data/paper-ledger.json")),
  paperMaxSnapshots: Number(process.env.PAPER_MAX_SNAPSHOTS || 2000),
  defaultMinAmount: Number(process.env.DEFAULT_MIN_AMOUNT || 0.0001),
  defaultAmountPrecision: Number(process.env.DEFAULT_AMOUNT_PRECISION || 6),
  scoreWeights: {
    trendAlignment: Number(process.env.SCORE_TREND_ALIGNMENT || 1.3),
    regimeSupport: Number(process.env.SCORE_REGIME_SUPPORT || 1.0),
    priceLocation: Number(process.env.SCORE_PRICE_LOCATION || 1.0),
    rsiStretch: Number(process.env.SCORE_RSI_STRETCH || 0.8),
    rsiRecovery: Number(process.env.SCORE_RSI_RECOVERY || 0.8),
    macdCross: Number(process.env.SCORE_MACD_CROSS || 1.2),
    macdMomentum: Number(process.env.SCORE_MACD_MOMENTUM || 0.8),
    volumeConfirmation: Number(process.env.SCORE_VOLUME_CONFIRMATION || 0.9),
    breakoutContinuation: Number(process.env.SCORE_BREAKOUT_CONTINUATION || 1.2),
    pullbackBounce: Number(process.env.SCORE_PULLBACK_BOUNCE || 1.0),
    momentumSupport: Number(process.env.SCORE_MOMENTUM_SUPPORT || 0.8),
  },
};

const dataFetcher = new DataFetcher(config);
const strategyEngine = new StrategyEngine(config);
const riskManager = new RiskManager(config);
const paperAccount = config.dryRun ? new PaperAccount(config) : null;
const executionEngine = new ExecutionEngine({
  dataFetcher,
  riskManager,
  config,
  paperAccount,
});

let latestStreamPrice = null;
let tradingInterval = null;

function resolveRuntimeMode() {
  const normalized = String(config.runMode || "spot").toLowerCase();

  if (["spot", "spot-only", "spot_only"].includes(normalized)) {
    return "spot";
  }

  if (["futures", "future", "swap", "perpetual"].includes(normalized)) {
    return "futures";
  }

  throw new Error(`Unsupported RUN_MODE: ${config.runMode}`);
}

function applyRuntimeMode(mode) {
  config.runMode = mode;

  if (mode === "spot") {
    config.marketType = "spot";
    return {
      runnerName: "runSpotOnly",
      runtimeLabel: config.dryRun ? "PAPER_SPOT" : "LIVE_SPOT",
    };
  }

  config.marketType = config.marketType === "spot" ? "swap" : config.marketType;
  return {
    runnerName: "runFutures",
    runtimeLabel: config.dryRun ? "PAPER_FUTURES" : "LIVE_FUTURES",
  };
}

async function deriveEquity(balance) {
  const total = balance.total?.[config.baseCurrency];
  const free = balance.free?.[config.baseCurrency];

  if (typeof total === "number") {
    return total;
  }

  if (typeof free === "number") {
    return free;
  }

  throw new Error(`Unable to derive equity from balance for base currency ${config.baseCurrency}.`);
}

async function deriveOperatingEquity(referencePrice) {
  if (config.dryRun && paperAccount) {
    return paperAccount.getEquity(referencePrice);
  }

  const balance = await dataFetcher.fetchBalance();
  return deriveEquity(balance);
}

async function tradingCycle(runtimeMeta) {
  const now = new Date();

  if (config.dryRun && paperAccount) {
    paperAccount.load();
    executionEngine.activePosition = paperAccount.getOpenPosition();
  }

  const [higherTimeframeCandles, lowerTimeframeCandles, ticker] = await Promise.all([
    dataFetcher.fetchOHLCV(config.symbol, config.higherTimeframe, config.candleLimit),
    dataFetcher.fetchOHLCV(config.symbol, config.lowerTimeframe, config.candleLimit),
    dataFetcher.fetchTicker(config.symbol),
  ]);

  const executablePrice = latestStreamPrice || ticker.last || ticker.close;
  const equity = await deriveOperatingEquity(executablePrice);

  riskManager.syncDailyState(equity, now);

  const breakerState = riskManager.evaluateCircuitBreaker(equity, now);
  if (breakerState.tripped) {
    logger.error({ breakerState, equity }, "Circuit breaker tripped. Trading suspended.");
    return;
  }

  const tradingPermission = riskManager.canTrade(now);
  if (!tradingPermission.allowed) {
    logger.warn({ tradingPermission, equity }, "Trading cycle skipped because breaker is active.");
    return;
  }

  if (config.dryRun && paperAccount) {
    paperAccount.recordEquitySnapshot(executablePrice);
  }

  // Signal generation is separated from execution so the strategy stays testable
  // and can later be replayed on historical data without touching live order code.
  const signal = strategyEngine.generateSignal(higherTimeframeCandles, lowerTimeframeCandles);
  logger.info({
    summary: {
      runner: runtimeMeta.runnerName,
      marketType: config.marketType,
      symbol: config.symbol,
      action: signal.action,
      reason: signal.reason,
      price: formatPrice(executablePrice),
      equity: formatPrice(equity),
      paperCash: config.dryRun && paperAccount ? formatPrice(paperAccount.getCashBalance()) : undefined,
      paperAsset: config.dryRun && paperAccount ? formatQty(paperAccount.getAssetBalance()) : undefined,
      hasOpenPosition: Boolean(executionEngine.activePosition),
      indicators: buildSignalSummary(signal),
    },
  }, "Strategy cycle summary.");

  await executionEngine.maybeEnterPosition({
    signal,
    symbol: config.symbol,
    equity,
    ticker,
  });

  await executionEngine.manageOpenPosition(executablePrice);
}

async function startRuntime(runtimeMeta) {
  await dataFetcher.initialize();

  if (config.dryRun && paperAccount) {
    const state = paperAccount.load();
    logger.info({
      summary: {
        paperBalance: formatPrice(state.balances.cash),
        paperAsset: formatQty(state.balances.asset),
        realizedPnl: formatPrice(state.performance.realizedPnl),
        paidFees: formatPrice(state.performance.paidFees),
        wins: state.performance.wins,
        losses: state.performance.losses,
        tradesClosed: state.performance.tradesClosed,
        hasOpenPosition: Boolean(state.openPosition),
        ledgerPath: config.paperLedgerPath,
      },
    }, "Paper trading account loaded.");
  }

  // Streaming prices tighten exit management between polling cycles.
  // When disabled, the bot falls back to REST ticker snapshots only.
  if (config.enableWebSocket) {
    dataFetcher.on("ticker", (ticker) => {
      const nextPrice = Number(ticker.c || ticker.lastPrice);
      if (Number.isFinite(nextPrice)) {
        latestStreamPrice = nextPrice;
      }
    });

    dataFetcher.on("bookTicker", (bookTicker) => {
      const bid = Number(bookTicker.b);
      const ask = Number(bookTicker.a);

      if (Number.isFinite(bid) && Number.isFinite(ask)) {
        latestStreamPrice = (bid + ask) / 2;
      }
    });

    dataFetcher.connectMarketStream(config.symbol);
  } else {
    logger.warn("WebSocket market stream disabled. Using REST polling only.");
  }

  logger.info(
    {
      summary: {
        runner: runtimeMeta.runnerName,
        exchange: config.exchangeId,
        symbol: config.symbol,
        mode: runtimeMeta.runtimeLabel,
        marketType: config.marketType,
        enableWebSocket: config.enableWebSocket,
      },
    },
    "Trading agent started.",
  );

  await tradingCycle(runtimeMeta);
  tradingInterval = setInterval(async () => {
    try {
      await tradingCycle(runtimeMeta);
    } catch (error) {
      logger.error({ err: error }, "Unhandled error inside trading cycle.");
    }
  }, config.pollIntervalMs);
}

async function runSpotOnly() {
  const runtimeMeta = applyRuntimeMode("spot");
  return startRuntime(runtimeMeta);
}

async function runFutures() {
  const runtimeMeta = applyRuntimeMode("futures");
  return startRuntime(runtimeMeta);
}

async function bootstrap() {
  const runtimeMode = resolveRuntimeMode();

  if (runtimeMode === "spot") {
    return runSpotOnly();
  }

  return runFutures();
}

process.on("SIGINT", async () => {
  logger.warn("SIGINT received. Closing trading agent.");
  if (tradingInterval) {
    clearInterval(tradingInterval);
    tradingInterval = null;
  }
  await dataFetcher.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.warn("SIGTERM received. Closing trading agent.");
  if (tradingInterval) {
    clearInterval(tradingInterval);
    tradingInterval = null;
  }
  await dataFetcher.close();
  process.exit(0);
});

bootstrap().catch(async (error) => {
  logger.fatal({ err: error }, "Trading agent failed during bootstrap.");
  await dataFetcher.close();
  process.exit(1);
});
