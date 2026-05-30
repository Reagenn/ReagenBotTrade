const { EMA, ATR } = require("technicalindicators");
const { createPublicExchange, withTimeout, withRetry } = require("./cexExchange");

const VOLUME_MA_PERIOD = 15;
const VOLUME_SPIKE_MULTIPLIER = Number(process.env.CEX_VOLUME_SPIKE_MULTIPLIER || 3);
const TREND_TIMEFRAME = process.env.CEX_TREND_TIMEFRAME || "15m";
const EMA_TREND_PERIOD = Number(process.env.CEX_EMA_TREND_PERIOD || 200);
const MAX_UPPER_WICK_RATIO = Number(process.env.CEX_MAX_UPPER_WICK_RATIO || 0.35);
const ATR_PERIOD = Number(process.env.CEX_ATR_PERIOD || 14);
const ATR_SL_MULTIPLIER = Number(process.env.CEX_ATR_SL_MULTIPLIER || 1.5);
const ATR_TP_MULTIPLIER = Number(process.env.CEX_ATR_TP_MULTIPLIER || 3);
const OHLCV_1M_LIMIT = Number(process.env.CEX_OHLCV_1M_LIMIT || 60);
const OHLCV_15M_LIMIT = Number(process.env.CEX_OHLCV_15M_LIMIT || 220);
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

/**
 * EMA 200 pada timeframe 15m — bandingkan dengan close 1m saat ini.
 */
function computeTrendEma200(candles15m) {
  const closes = candles15m.map((c) => c.close).filter((v) => Number.isFinite(v));
  if (closes.length < EMA_TREND_PERIOD) {
    return { ema200: null, sufficient: false };
  }

  const emaSeries = EMA.calculate({ period: EMA_TREND_PERIOD, values: closes });
  const ema200 = emaSeries[emaSeries.length - 1];
  return { ema200: Number(ema200), sufficient: true };
}

/**
 * ATR(14) pada candle 1m — nilai terakhir untuk TP/SL dinamis.
 */
function computeAtr1m(candles1m) {
  if (candles1m.length < ATR_PERIOD + 2) {
    return { atr: null, sufficient: false };
  }

  const highs = candles1m.map((c) => c.high);
  const lows = candles1m.map((c) => c.low);
  const closes = candles1m.map((c) => c.close);

  const atrSeries = ATR.calculate({
    period: ATR_PERIOD,
    high: highs,
    low: lows,
    close: closes,
  });

  const atr = atrSeries[atrSeries.length - 1];
  return { atr: Number(atr), sufficient: Number.isFinite(atr) && atr > 0 };
}

/**
 * Monitor Volume Spike Breakout via OHLCV 1m + filter MTF / wick / ATR.
 */
class CexMonitor {
  constructor(options = {}) {
    this.exchangeId = options.exchangeId || process.env.CEX_EXCHANGE || "bybit";
    this.timeframe = options.timeframe || process.env.CEX_TIMEFRAME || "1m";
    this.universeLimit = Number(options.universeLimit ?? process.env.CEX_UNIVERSE_LIMIT ?? 40);
    this.minQuoteVolume24h = Number(options.minQuoteVolume24h ?? process.env.CEX_MIN_QUOTE_VOLUME_24H ?? 500000);
    this.exchange = null;
    this.marketsLoaded = false;
    this.symbolUniverse = [];
    this.lastBuyOpenedAt = 0;
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
      if (!symbol.endsWith("/USDT")) continue;
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
   * Moving Average Volume — rata-rata volume 15 candle sebelum candle terakhir (1m).
   */
  static computeVolumeBaseline(candles1m) {
    const rows = candles1m.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]);
    if (rows.length < VOLUME_MA_PERIOD + 1) {
      return null;
    }

    const latest = rows[rows.length - 1];
    const previous15 = rows.slice(-(VOLUME_MA_PERIOD + 1), -1);
    const volumes = previous15.map((candle) => Number(candle[5] || 0));
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / VOLUME_MA_PERIOD;

    return { avgVolume, latest, previous15, candle: candles1m[candles1m.length - 1] };
  }

  /**
   * Pipeline: volume spike → EMA200 15m → wick → ATR TP/SL.
   */
  async analyzeSymbol(symbol) {
    if (ignoredCoins.includes(symbol)) {
      return { type: "NO_SIGNAL", symbol, signal: { reason: "ignored_coin" } };
    }
    const candles1m = await this.fetchOhlcv(symbol, this.timeframe, OHLCV_1M_LIMIT);
    const baseline = CexMonitor.computeVolumeBaseline(candles1m);

    if (!baseline) {
      return { type: "NO_SIGNAL", symbol, signal: { reason: "insufficient_1m_candles" } };
    }

    const { avgVolume, candle: latest } = baseline;
    const latestVolume = Number(latest.volume || 0);
    const open = Number(latest.open || 0);
    const close = Number(latest.close || 0);
    const high = Number(latest.high || 0);
    const low = Number(latest.low || 0);
    const isGreenCandle = close > open;
    const volumeRatio = avgVolume > 0 ? latestVolume / avgVolume : 0;
    const isVolumeSpike = latestVolume > avgVolume * VOLUME_SPIKE_MULTIPLIER;

    const metrics = {
      symbol,
      timestamp: latest.timestamp,
      open,
      high,
      low,
      close,
      latestVolume,
      avgVolume15m: Number(avgVolume.toFixed(4)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      volumeSpikeMultiplier: VOLUME_SPIKE_MULTIPLIER,
      isGreenCandle,
      isVolumeSpike,
    };

    if (!isVolumeSpike || !isGreenCandle) {
      return { type: "NO_SIGNAL", symbol, signal: metrics };
    }

    // --- Filter 1: Multi-Timeframe EMA 200 (15m) ---
    const candles15m = await this.fetchOhlcv(symbol, TREND_TIMEFRAME, OHLCV_15M_LIMIT);
    const trend = computeTrendEma200(candles15m);

    if (!trend.sufficient || !Number.isFinite(trend.ema200)) {
      logSignalRejected(
        symbol,
        `Data ${TREND_TIMEFRAME} tidak cukup untuk EMA ${EMA_TREND_PERIOD} (butuh ${OHLCV_15M_LIMIT} candle)`,
      );
      return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "ema_data_insufficient" } };
    }

    metrics.ema200_15m = round(trend.ema200, 8);
    metrics.closeAboveEma200 = close > trend.ema200;

    if (close <= trend.ema200) {
      logSignalRejected(
        symbol,
        `Tren ${TREND_TIMEFRAME} sedang Bearish (close ${close} di bawah EMA ${EMA_TREND_PERIOD} @ ${round(trend.ema200, 6)})`,
      );
      return {
        type: "REJECTED",
        symbol,
        signal: { ...metrics, rejectReason: "below_ema200" },
      };
    }

    // --- Filter 2: Upper Wick Rejection ---
    const wick = computeUpperWickRatio(high, low, close);
    metrics.upperWickRatio = wick.ratio;
    metrics.maxUpperWickRatio = MAX_UPPER_WICK_RATIO;

    if (!wick.valid) {
      logSignalRejected(symbol, "Range candle 1m tidak valid (High = Low)");
      return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "invalid_candle_range" } };
    }

    if (wick.ratio > MAX_UPPER_WICK_RATIO) {
      logSignalRejected(
        symbol,
        `Upper Wick terlalu panjang (${(wick.ratio * 100).toFixed(1)}% > ${(MAX_UPPER_WICK_RATIO * 100).toFixed(0)}% — indikasi tekanan jual / bull trap)`,
      );
      return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "upper_wick_rejection" } };
    }

    // --- Filter 3: Dynamic TP/SL via ATR(14) 1m ---
    const atrResult = computeAtr1m(candles1m);
    if (!atrResult.sufficient) {
      logSignalRejected(symbol, `ATR ${ATR_PERIOD} tidak dapat dihitung (candle 1m kurang)`);
      return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "atr_insufficient" } };
    }

    const atr = atrResult.atr;
    let targetSL = round(close - ATR_SL_MULTIPLIER * atr, 8);
    let targetTP = round(close + ATR_TP_MULTIPLIER * atr, 8);

    // ATR Floor overrides (SL min 1.5%, TP min 2.5%)
    const rawSlPct = ((close - targetSL) / close) * 100;
    if (rawSlPct < 1.5) {
      targetSL = round(close * 0.985, 8); // -1.5%
    }
    const rawTpPct = ((targetTP - close) / close) * 100;
    if (rawTpPct < 2.5) {
      targetTP = round(close * 1.025, 8); // +2.5%
    }

    if (targetSL <= 0 || targetTP <= close) {
      logSignalRejected(symbol, `Level TP/SL tidak valid (ATR=${round(atr, 8)}, SL=${targetSL}, TP=${targetTP})`);
      return { type: "REJECTED", symbol, signal: { ...metrics, rejectReason: "invalid_atr_levels" } };
    }

    metrics.atr14_1m = round(atr, 8);
    metrics.atrSlMultiplier = ATR_SL_MULTIPLIER;
    metrics.atrTpMultiplier = ATR_TP_MULTIPLIER;
    metrics.targetSL = targetSL;
    metrics.targetTP = targetTP;
    metrics.stopLossPct = round(((close - targetSL) / close) * 100, 2);
    metrics.takeProfitPct = round(((targetTP - close) / close) * 100, 2);

    // --- Task 2: Retracement Entry (Midpoint of spike candle) ---
    const entryPrice = round((high + low) / 2, 8);
    console.log(`[ENTRY] Menunggu pullback di harga ${entryPrice} untuk ${symbol} (Midpoint Spike)`);

    const rationale = `Volume spike (${volumeRatio.toFixed(1)}x) confirmed by ${TREND_TIMEFRAME} trend (above EMA${EMA_TREND_PERIOD}). ATR-based volatility target: TP +${metrics.takeProfitPct}% / SL -${metrics.stopLossPct}%.`;

    return {
      type: "BUY_SIGNAL",
      symbol,
      entryPrice,
      targetTP,
      targetSL,
      atr,
      atrSlMultiplier: ATR_SL_MULTIPLIER,
      atrTpMultiplier: ATR_TP_MULTIPLIER,
      signal: { ...metrics, rationale },
      detectedAt: new Date().toISOString(),
    };
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

      await new Promise((resolve) => setTimeout(resolve, Number(process.env.CEX_SCAN_SYMBOL_DELAY_MS || 120)));
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
  computeTrendEma200,
  computeAtr1m,
};
