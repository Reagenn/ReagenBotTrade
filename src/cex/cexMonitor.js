const { EMA, ATR, RSI } = require("technicalindicators");
const { createPublicExchange, withTimeout, withRetry } = require("./cexExchange");

const VOLUME_MA_PERIOD = 20;
const VOLUME_SPIKE_MULTIPLIER = 2.5;
const TREND_TIMEFRAME = "15m";
const TREND_TIMEFRAME_1H = "1h";
const EMA_TREND_PERIOD = 200;
const RSI_PERIOD = 14;
const RSI_OB_LIMIT = 68;
const MAX_UPPER_WICK_RATIO = Number(process.env.CEX_MAX_UPPER_WICK_RATIO || 0.35);
const ATR_PERIOD = 14;
const ATR_SL_MULTIPLIER = 2.0;
const ATR_TP_MULTIPLIER = 3.0;
const OHLCV_1M_LIMIT = 60;
const OHLCV_15M_LIMIT = 220;
const OHLCV_1H_LIMIT = 220;
const ignoredCoins = ['BTC/USDT', 'ETH/USDT', 'USDC/USDT'];

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function logSignalRejected(symbol, reason) {
  console.log(`[cexMonitor] Sinyal Batal ${symbol}: ${reason}`);
}

/**
 * Konversi OHLCV ccxt ke format { open, high, low, close, volume }.
 * @param {number[][]} rows
 */
function mapOhlcvRows(rows) {
  return (rows || []).map((row) => ({
    timestamp: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5] || 0),
  }));
}

/**
 * Upper Wick = (High - Close) / (High - Low)
 */
function computeUpperWickRatio(high, low, close) {
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) {
    return { ratio: null, valid: false };
  }

  const ratio = (high - close) / range;
  return { ratio: round(ratio, 4), valid: true };
}

function computeEma(values, period) {
  if (!values || values.length < period) return null;
  const series = EMA.calculate({ period, values });
  return series[series.length - 1];
}

function computeRsi(values, period) {
  if (!values || values.length < period + 1) return null;
  const series = RSI.calculate({ period, values });
  return series[series.length - 1];
}

function computeAtr(candles, period) {
  if (!candles || candles.length < period + 1) return null;
  const series = ATR.calculate({
    period,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
  });
  return series[series.length - 1];
}

function computeVolumeMa(candles, period) {
  if (!candles || candles.length < period) return 0;
  const volumes = candles.map((c) => c.volume);
  const sum = volumes.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * Monitor Volume Spike Breakout via OHLCV 1m + filter MTF / wick / ATR.
 */
class CexMonitor {
  constructor(options = {}) {
    this.exchangeId = options.exchangeId || process.env.CEX_EXCHANGE || "kraken";
    this.timeframe = options.timeframe || process.env.CEX_TIMEFRAME || "15m";
    this.universeLimit = Number(options.universeLimit ?? process.env.CEX_UNIVERSE_LIMIT ?? 40);
    this.minQuoteVolume24h = Number(options.minQuoteVolume24h ?? process.env.CEX_MIN_QUOTE_VOLUME_24H ?? 100000);
    this.exchange = null;
    this.marketsLoaded = false;
    this.symbolUniverse = [];
    this.lastBuyOpenedAt = 0;
    this.states = {}; // Track WAITING_PULLBACK per symbol
  }

  recordBuyOpened() {
    this.lastBuyOpenedAt = Date.now();
  }

  isCooldownActive() {
    if (!this.lastBuyOpenedAt) return false;
    const elapsed = Date.now() - this.lastBuyOpenedAt;
    return elapsed < 120000; // 2 minutes cooldown
  }

  async init() {
    this.exchange = createPublicExchange(this.exchangeId);
    await withRetry(() => withTimeout(() => this.exchange.loadMarkets(), undefined, "loadMarkets"), "loadMarkets");
    this.marketsLoaded = true;
    this.symbolUniverse = await this.buildUsdtUniverse();
    console.log(
      `[cexMonitor] ${this.exchangeId.toUpperCase()} · universe ${this.symbolUniverse.length} · filter EMA${EMA_TREND_PERIOD}/${TREND_TIMEFRAME} · wick≤${(MAX_UPPER_WICK_RATIO * 100).toFixed(0)}% · ATR TP/SL`,
    );
    return this;
  }

  async buildUsdtUniverse() {
    const tickers = await withRetry(
      () => withTimeout(() => this.exchange.fetchTickers(), undefined, "fetchTickers"),
      "fetchTickers",
    );

    const rows = [];

    for (const [symbol, ticker] of Object.entries(tickers)) {
      if (!symbol.endsWith("/USDT") && !symbol.endsWith("/USD")) continue;
      if (ignoredCoins.includes(symbol)) continue;

      const market = this.exchange.markets[symbol];
      if (!market || market.active === false) continue;
      if (market.spot === false && market.type && market.type !== "spot") continue;

      const quoteVolume = Number(ticker.quoteVolume ?? ticker.info?.turnover24h ?? 0);
      if (!Number.isFinite(quoteVolume) || quoteVolume < this.minQuoteVolume24h) continue;

      rows.push({ symbol, quoteVolume });
    }

    return rows
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, this.universeLimit)
      .map((row) => row.symbol);
  }

  async fetchOhlcv(symbol, timeframe, limit) {
    const rows = await withRetry(
      () =>
        withTimeout(
          () => this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit),
          undefined,
          `fetchOHLCV ${symbol} ${timeframe}`,
        ),
      `fetchOHLCV ${symbol} ${timeframe}`,
    );
    return mapOhlcvRows(rows);
  }

  /**
   * Pipeline: Volume Spike (15m) → MTF EMA200 (15m+1h) → Pullback Trigger → ATR TP/SL.
   */
  async analyzeSymbol(symbol) {
    if (ignoredCoins.includes(symbol)) {
      return { type: "NO_SIGNAL", symbol, signal: { reason: "ignored_coin" } };
    }

    // 1. Fetch Data (15m and 1h)
    const [candles15m, candles1h] = await Promise.all([
      this.fetchOhlcv(symbol, TREND_TIMEFRAME, OHLCV_15M_LIMIT),
      this.fetchOhlcv(symbol, TREND_TIMEFRAME_1H, OHLCV_1H_LIMIT),
    ]);

    if (candles15m.length < OHLCV_15M_LIMIT || candles1h.length < OHLCV_1H_LIMIT) {
      return { type: "NO_SIGNAL", symbol, signal: { reason: "insufficient_candles" } };
    }

    const latest15m = candles15m[candles15m.length - 1];
    const closes15m = candles15m.map((c) => c.close);
    const closes1h = candles1h.map((c) => c.close);

    // 2. Calculate Indicators on 15m
    const ema200_15m = computeEma(closes15m, EMA_TREND_PERIOD);
    const ema20_15m = computeEma(closes15m, 20);
    const ema50_15m = computeEma(closes15m, 50);
    const rsi15m = computeRsi(closes15m, RSI_PERIOD);
    const atr15m = computeAtr(candles15m, ATR_PERIOD);

    // 3. Calculate Indicators on 1h
    const ema200_1h = computeEma(closes1h, EMA_TREND_PERIOD);

    // Baseline Volume (SMA 20 of previous 20 closed candles)
    const avgVolume20 = computeVolumeMa(candles15m.slice(-21, -1), 20);

    const wick = computeUpperWickRatio(latest15m.high, latest15m.low, latest15m.close);
    const volumeRatio = avgVolume20 > 0 ? latest15m.volume / avgVolume20 : 0;

    const metrics = {
      symbol,
      timestamp: latest15m.timestamp,
      close: latest15m.close,
      rsi15m: round(rsi15m, 2),
      ema200_15m: round(ema200_15m, 8),
      ema200_1h: round(ema200_1h, 8),
      avgVolume20: round(avgVolume20, 2),
      currentVolume: latest15m.volume,
      volumeRatio: round(volumeRatio, 2),
      upperWickRatio: wick.ratio || 0,
    };

    // 4. MTF Trend Filter (Price must be above EMA200 on both 15m and 1h)
    const isAboveEma15m = latest15m.close > ema200_15m;
    const isAboveEma1h = candles1h[candles1h.length - 1].close > ema200_1h;

    if (!isAboveEma15m || !isAboveEma1h) {
      if (this.states[symbol]) delete this.states[symbol];
      return { type: "NO_SIGNAL", symbol, signal: { ...metrics, reason: "below_mtf_ema200" } };
    }

    // 5. State Machine Logic
    const state = this.states[symbol];

    if (state && state.status === "WAITING_PULLBACK") {
      // --- Trigger BUY Logic ---
      const isRed = latest15m.close < latest15m.open;
      const isLowVolume = latest15m.volume < avgVolume20;

      // Distance to EMA20, EMA50, or EMA200 < 0.5%
      const distEma20 = Math.abs(latest15m.close - ema20_15m) / latest15m.close;
      const distEma50 = Math.abs(latest15m.close - ema50_15m) / latest15m.close;
      const distEma200 = Math.abs(latest15m.close - ema200_15m) / latest15m.close;
      const isNearEma = Math.min(distEma20, distEma50, distEma200) < 0.005;

      if (rsi15m > RSI_OB_LIMIT) {
        console.log(`[cexMonitor] ${symbol} Pullback detected but RSI > ${RSI_OB_LIMIT} (${round(rsi15m, 1)}) -> REJECTED`);
        delete this.states[symbol];
        return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "overbought_at_trigger" } };
      }

      if (isRed && isLowVolume && isNearEma) {
        delete this.states[symbol];

        const targetSL = round(latest15m.close - ATR_SL_MULTIPLIER * atr15m, 8);
        const targetTP = round(latest15m.close + ATR_TP_MULTIPLIER * atr15m, 8);

        const rationale = `Pullback entry confirmed: Red candle + Low Volume + Near EMA Support + MTF EMA200 Alignment.`;

        return {
          type: "BUY_SIGNAL",
          symbol,
          entryPrice: latest15m.close,
          targetTP,
          targetSL,
          atr: atr15m,
          signal: {
            ...metrics,
            stopLossPct: round(((latest15m.close - targetSL) / latest15m.close) * 100, 2),
            takeProfitPct: round(((targetTP - latest15m.close) / latest15m.close) * 100, 2),
            rationale,
          },
          detectedAt: new Date().toISOString(),
        };
      }

      // Cleanup state if it hangs too long (e.g., 8 hours)
      if (Date.now() - state.detectedAt > 8 * 3600 * 1000) {
        delete this.states[symbol];
      }

      return { type: "NO_SIGNAL", symbol, signal: { ...metrics, reason: "waiting_pullback" } };
    } else {
      // --- Spike Detection Logic ---
      const candle_i1 = candles15m[candles15m.length - 2];
      const candle_i2 = candles15m[candles15m.length - 3];

      const isSpike1 = candle_i1.volume > avgVolume20 * VOLUME_SPIKE_MULTIPLIER && candle_i1.close > candle_i1.open;
      const isSpike2 = candle_i2.volume > avgVolume20 * VOLUME_SPIKE_MULTIPLIER && candle_i2.close > candle_i2.open;

      if (isSpike1 || isSpike2) {
        // RSI Filter for Spike
        if (rsi15m > RSI_OB_LIMIT) {
          console.log(`[cexMonitor] Spike Detected for ${symbol} but RSI > ${RSI_OB_LIMIT} (${round(rsi15m, 1)}) -> REJECTED`);
          return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "spike_overbought" } };
        }

        console.log(`[cexMonitor] Spike Detected for ${symbol} (Vol > ${VOLUME_SPIKE_MULTIPLIER}x), entering WAITING_PULLBACK mode.`);
        this.states[symbol] = {
          status: "WAITING_PULLBACK",
          detectedAt: Date.now(),
          spikeCandle: isSpike1 ? candle_i1 : candle_i2,
        };
        return { type: "NO_SIGNAL", symbol, signal: { ...metrics, reason: "spike_detected_waiting_pullback" } };
      }
    }

    return { type: "NO_SIGNAL", symbol, signal: metrics };
  }

  async scanForSignals() {
    if (!this.marketsLoaded) {
      await this.init();
    }

    if (this.isCooldownActive()) {
      const remainingSeconds = Math.ceil((120000 - (Date.now() - this.lastBuyOpenedAt)) / 1000);
      console.log(`[cexMonitor] Scan dilewati karena cooldown global aktif (${remainingSeconds}s tersisa).`);
      return {
        signals: [],
        rejected: 0,
        errors: [],
        scannedAt: new Date().toISOString(),
        universeSize: this.symbolUniverse.length,
      };
    }

    const signals = [];
    const rejected = [];
    const errors = [];

    for (const symbol of this.symbolUniverse) {
      try {
        const result = await this.analyzeSymbol(symbol);
        if (result?.type === "BUY_SIGNAL") {
          signals.push(result);
          const m = result.signal;
          console.log(
            `[cexMonitor] BUY_SIGNAL ${symbol} · vol ${m.volumeRatio}x · EMA200 OK · wick ${(m.upperWickRatio * 100).toFixed(1)}% · ATR SL -${m.stopLossPct}% TP +${m.takeProfitPct}% · TP ${result.targetTP} SL ${result.targetSL}`,
          );
        } else if (result?.type === "REJECTED") {
          rejected.push(result);
        }
      } catch (error) {
        errors.push({ symbol, error: error.message });
      }

      await new Promise((resolve) => setTimeout(resolve, Number(process.env.CEX_SCAN_SYMBOL_DELAY_MS || 500)));
    }

    if (rejected.length) {
      console.log(`[cexMonitor] Siklus: ${signals.length} sinyal · ${rejected.length} dibatalkan filter`);
    }

    return {
      signals,
      rejected: rejected.length,
      errors,
      scannedAt: new Date().toISOString(),
      universeSize: this.symbolUniverse.length,
    };
  }
}

module.exports = {
  CexMonitor,
  VOLUME_MA_PERIOD,
  VOLUME_SPIKE_MULTIPLIER,
  computeUpperWickRatio,
  computeEma,
  computeAtr,
  computeRsi,
};
