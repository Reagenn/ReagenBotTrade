const { SMA, RSI, MACD, BollingerBands, ATR, ADX } = require("technicalindicators");

class StrategyEngine {
  constructor(config) {
    this.config = config;
  }

  generateSignal(higherTimeframeCandles, lowerTimeframeCandles) {
    const futuresMode = this.isFuturesMode();
    // Multi-timeframe logic reduces false positives: the higher timeframe
    // defines structural bias, while the lower timeframe searches for tactical entries.
    if (
      higherTimeframeCandles.length < Math.max(this.config.trendSmaSlow, this.config.adxPeriod) + 5 ||
      lowerTimeframeCandles.length < Math.max(this.config.bbPeriod, this.config.rsiPeriod, this.config.macdSlow, this.config.atrPeriod, this.config.breakoutLookback) + 5
    ) {
      return { action: "HOLD", reason: "Insufficient candle history for indicator computation." };
    }

    const higherCloses = higherTimeframeCandles.map((candle) => candle.close);
    const higherHighs = higherTimeframeCandles.map((candle) => candle.high);
    const higherLows = higherTimeframeCandles.map((candle) => candle.low);
    const lowerCloses = lowerTimeframeCandles.map((candle) => candle.close);
    const lowerHighs = lowerTimeframeCandles.map((candle) => candle.high);
    const lowerLows = lowerTimeframeCandles.map((candle) => candle.low);
    const lowerVolumes = lowerTimeframeCandles.map((candle) => candle.volume);

    // Trend filter: when fast SMA stays above slow SMA on the higher timeframe,
    // we treat pullbacks as higher-quality long setups.
    const fastTrend = SMA.calculate({
      values: higherCloses,
      period: this.config.trendSmaFast,
    });

    const slowTrend = SMA.calculate({
      values: higherCloses,
      period: this.config.trendSmaSlow,
    });

    const adxSeries = ADX.calculate({
      close: higherCloses,
      high: higherHighs,
      low: higherLows,
      period: this.config.adxPeriod,
    });

    // RSI measures stretch. We only engage when price is materially oversold/overbought,
    // which increases the odds of mean reversion into the prevailing trend.
    const rsiSeries = RSI.calculate({
      values: lowerCloses,
      period: this.config.rsiPeriod,
    });

    // Bollinger Bands translate recent volatility into dynamic support/resistance.
    // "Near band edge" is more robust than using a fixed price distance in crypto.
    const bbSeries = BollingerBands.calculate({
      values: lowerCloses,
      period: this.config.bbPeriod,
      stdDev: this.config.bbStdDev,
    });

    const atrSeries = ATR.calculate({
      close: lowerCloses,
      high: lowerHighs,
      low: lowerLows,
      period: this.config.atrPeriod,
    });

    // MACD cross is used as the momentum confirmation layer so we do not buy
    // every oversold reading blindly.
    const macdSeries = MACD.calculate({
      values: lowerCloses,
      fastPeriod: this.config.macdFast,
      slowPeriod: this.config.macdSlow,
      signalPeriod: this.config.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const latestCandle = lowerTimeframeCandles[lowerTimeframeCandles.length - 1];
    const previousCandle = lowerTimeframeCandles[lowerTimeframeCandles.length - 2];
    const previousMacd = macdSeries[macdSeries.length - 2];
    const latestMacd = macdSeries[macdSeries.length - 1];
    const latestRsi = rsiSeries[rsiSeries.length - 1];
    const latestBands = bbSeries[bbSeries.length - 1];
    const latestAtr = atrSeries[atrSeries.length - 1];
    const latestAdx = adxSeries[adxSeries.length - 1];
    const trendBias = this.determineTrendBias(fastTrend[fastTrend.length - 1], slowTrend[slowTrend.length - 1]);

    // Volume confirmation helps filter weak reversals; a reversal signal backed
    // by a participation spike is less likely to be pure noise.
    const volumeAverage = this.average(lowerVolumes.slice(-this.config.volumeLookback));
    const volumeSpike = latestCandle.volume >= volumeAverage * this.config.volumeSpikeMultiplier;

    const priceNearLowerBand = latestCandle.close <= latestBands.lower * (1 + this.config.bandProximityBuffer);
    const priceNearUpperBand = latestCandle.close >= latestBands.upper * (1 - this.config.bandProximityBuffer);
    const bullishMacdCross = previousMacd.MACD <= previousMacd.signal && latestMacd.MACD > latestMacd.signal;
    const bullishMacdMomentum = latestMacd.histogram > previousMacd.histogram;
    const bearishMacdCross = previousMacd.MACD >= previousMacd.signal && latestMacd.MACD < latestMacd.signal;
    const bearishMacdMomentum = latestMacd.histogram < previousMacd.histogram;
    const atrPct = latestAtr / latestCandle.close;
    const breakoutHigh = this.max(lowerHighs.slice(-this.config.breakoutLookback, -1));
    const breakoutLow = this.min(lowerLows.slice(-this.config.breakoutLookback, -1));
    const breakoutLong = latestCandle.close > breakoutHigh && latestCandle.volume >= volumeAverage * this.config.breakoutVolumeMultiplier;
    const breakoutShort = latestCandle.close < breakoutLow && latestCandle.volume >= volumeAverage * this.config.breakoutVolumeMultiplier;
    const pullbackBounce = latestCandle.close > previousCandle.close && previousCandle.low <= latestBands.middle;
    const pullbackReject = latestCandle.close < previousCandle.close && previousCandle.high >= latestBands.middle;
    const momentumRsiSupport = latestRsi >= this.config.rsiMomentumFloor && latestRsi <= this.config.rsiMomentumCeiling;
    const bearishMomentumSupport = latestRsi <= (100 - this.config.rsiMomentumFloor) && latestRsi >= (100 - this.config.rsiMomentumCeiling);
    const oversoldReclaim = latestRsi <= this.config.rsiOversoldRecovery && latestCandle.close >= latestBands.lower;
    const overboughtReject = latestRsi >= this.config.rsiOverboughtRejection && latestCandle.close <= latestBands.upper;
    const adxValue = latestAdx?.adx ?? 0;
    const marketRegime = this.detectMarketRegime({
      trendBias,
      adxValue,
      atrPct,
      latestClose: latestCandle.close,
      breakoutHigh,
      breakoutLow,
    });

    const scoreBreakdown = {
      trendAlignment: trendBias === "BULLISH" ? this.config.scoreWeights.trendAlignment : 0,
      regimeSupport: ["TRENDING_BULL", "VOLATILE_BREAKOUT", "TRANSITION"].includes(marketRegime) ? this.config.scoreWeights.regimeSupport : 0,
      priceLocation: priceNearLowerBand ? this.config.scoreWeights.priceLocation : 0,
      rsiStretch: latestRsi <= this.config.rsiOversold ? this.config.scoreWeights.rsiStretch : 0,
      rsiRecovery: oversoldReclaim ? this.config.scoreWeights.rsiRecovery : 0,
      macdCross: bullishMacdCross ? this.config.scoreWeights.macdCross : 0,
      macdMomentum: bullishMacdMomentum ? this.config.scoreWeights.macdMomentum : 0,
      volumeConfirmation: volumeSpike ? this.config.scoreWeights.volumeConfirmation : 0,
      breakoutContinuation: breakoutLong ? this.config.scoreWeights.breakoutContinuation : 0,
      pullbackBounce: pullbackBounce ? this.config.scoreWeights.pullbackBounce : 0,
      momentumSupport: momentumRsiSupport ? this.config.scoreWeights.momentumSupport : 0,
    };

    const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);

    const diagnostics = {
      trendBias,
      marketRegime,
      adx: adxValue,
      atr: latestAtr,
      atrPct,
      score,
      scoreThreshold: this.config.longScoreThreshold,
      scoreBreakdown,
      latestClose: latestCandle.close,
      latestRsi,
      latestBands,
      latestMacd,
      volumeSpike,
      latestVolume: latestCandle.volume,
      averageVolume: volumeAverage,
      breakoutHigh,
      breakoutLow,
      breakoutLong,
      breakoutShort,
      bullishMacdCross,
      bullishMacdMomentum,
      bearishMacdCross,
      bearishMacdMomentum,
      pullbackBounce,
      pullbackReject,
      momentumRsiSupport,
      bearishMomentumSupport,
      priceNearLowerBand,
      priceNearUpperBand,
      oversoldReclaim,
      overboughtReject,
    };

    const trendReady = trendBias === "BULLISH" || trendBias === "NEUTRAL";
    const reversalLongReady = trendReady && priceNearLowerBand && latestRsi <= this.config.rsiOversoldRecovery && bullishMacdCross;
    const breakoutLongReady = trendReady && breakoutLong && bullishMacdMomentum && momentumRsiSupport;
    const aggressivePullbackReady = trendReady && pullbackBounce && bullishMacdMomentum && volumeSpike;
    const opportunisticDipReady =
      trendReady &&
      priceNearLowerBand &&
      volumeSpike &&
      latestRsi <= this.config.rsiOversoldRecovery &&
      (bullishMacdMomentum || oversoldReclaim || latestRsi <= this.config.rsiOversold + this.config.rsiDipBuffer);

    if (
      score >= this.config.longScoreThreshold &&
      ["TRENDING_BULL", "VOLATILE_BREAKOUT", "RANGE_COMPRESSION", "TRANSITION"].includes(marketRegime) &&
      (reversalLongReady || breakoutLongReady || aggressivePullbackReady || opportunisticDipReady)
    ) {
      return {
        action: "LONG",
        reason: this.buildLongReason({
          reversalLongReady,
          breakoutLongReady,
          aggressivePullbackReady,
          opportunisticDipReady,
          marketRegime,
          score,
        }),
        diagnostics,
      };
    }

    if (futuresMode) {
      const shortScoreBreakdown = {
        trendAlignment: trendBias === "BEARISH" ? this.config.scoreWeights.trendAlignment : 0,
        regimeSupport: ["BEARISH_PRESSURE", "TRANSITION", "RANGE_COMPRESSION"].includes(marketRegime) ? this.config.scoreWeights.regimeSupport : 0,
        priceLocation: priceNearUpperBand ? this.config.scoreWeights.priceLocation : 0,
        rsiStretch: latestRsi >= this.config.rsiOverbought ? this.config.scoreWeights.rsiStretch : 0,
        rsiRecovery: overboughtReject ? this.config.scoreWeights.rsiRecovery : 0,
        macdCross: bearishMacdCross ? this.config.scoreWeights.macdCross : 0,
        macdMomentum: bearishMacdMomentum ? this.config.scoreWeights.macdMomentum : 0,
        volumeConfirmation: volumeSpike ? this.config.scoreWeights.volumeConfirmation : 0,
        breakoutContinuation: breakoutShort ? this.config.scoreWeights.breakoutContinuation : 0,
        pullbackBounce: pullbackReject ? this.config.scoreWeights.pullbackBounce : 0,
        momentumSupport: bearishMomentumSupport ? this.config.scoreWeights.momentumSupport : 0,
      };

      const shortScore = Object.values(shortScoreBreakdown).reduce((sum, value) => sum + value, 0);
      const shortTrendReady = trendBias === "BEARISH" || trendBias === "NEUTRAL";
      const reversalShortReady = shortTrendReady && priceNearUpperBand && latestRsi >= this.config.rsiOverboughtRejection && bearishMacdCross;
      const breakoutShortReady = shortTrendReady && breakoutShort && bearishMacdMomentum && bearishMomentumSupport;
      const aggressiveRejectReady = shortTrendReady && pullbackReject && bearishMacdMomentum && volumeSpike;
      const opportunisticPumpFadeReady =
        shortTrendReady &&
        priceNearUpperBand &&
        volumeSpike &&
        latestRsi >= this.config.rsiOverboughtRejection &&
        (bearishMacdMomentum || overboughtReject || latestRsi >= this.config.rsiOverbought - this.config.rsiDipBuffer);

      if (
        shortScore >= this.config.shortScoreThreshold &&
        ["BEARISH_PRESSURE", "TRANSITION", "RANGE_COMPRESSION"].includes(marketRegime) &&
        (reversalShortReady || breakoutShortReady || aggressiveRejectReady || opportunisticPumpFadeReady)
      ) {
        return {
          action: "SHORT",
          reason: this.buildShortReason({
            reversalShortReady,
            breakoutShortReady,
            aggressiveRejectReady,
            opportunisticPumpFadeReady,
            marketRegime,
            score: shortScore,
          }),
          diagnostics: {
            ...diagnostics,
            score: shortScore,
            scoreThreshold: this.config.shortScoreThreshold,
            scoreBreakdown: shortScoreBreakdown,
          },
        };
      }
    }

    return {
      action: "HOLD",
      reason: futuresMode ? "No valid futures setup detected." : "No valid spot long setup detected.",
      diagnostics,
    };
  }

  isFuturesMode() {
    return String(this.config.runMode).toLowerCase() === "futures";
  }

  determineTrendBias(fastSma, slowSma) {
    if (fastSma > slowSma) {
      return "BULLISH";
    }

    if (fastSma < slowSma) {
      return "BEARISH";
    }

    return "NEUTRAL";
  }

  average(values) {
    if (!values.length) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  max(values) {
    return values.length ? Math.max(...values) : 0;
  }

  min(values) {
    return values.length ? Math.min(...values) : 0;
  }

  detectMarketRegime({ trendBias, adxValue, atrPct, latestClose, breakoutHigh, breakoutLow }) {
    const nearBreakoutHigh = latestClose >= breakoutHigh * (1 - this.config.breakoutBufferPct);
    const nearBreakoutLow = latestClose <= breakoutLow * (1 + this.config.breakoutBufferPct);

    if (trendBias === "BULLISH" && adxValue >= this.config.adxTrendThreshold && atrPct >= this.config.atrTrendFloorPct) {
      return nearBreakoutHigh ? "VOLATILE_BREAKOUT" : "TRENDING_BULL";
    }

    if (adxValue < this.config.adxRangeThreshold && atrPct <= this.config.atrRangeCeilingPct) {
      return "RANGE_COMPRESSION";
    }

    if (trendBias === "BEARISH" && nearBreakoutLow) {
      return "BEARISH_PRESSURE";
    }

    return "TRANSITION";
  }

  buildLongReason({ reversalLongReady, breakoutLongReady, aggressivePullbackReady, opportunisticDipReady, marketRegime, score }) {
    if (breakoutLongReady) {
      return `Aggressive crypto breakout long detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    if (aggressivePullbackReady) {
      return `Bull trend pullback continuation detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    if (opportunisticDipReady) {
      return `Aggressive dip-buy setup detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    if (reversalLongReady) {
      return `Oversold reversal long detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    return `Spot long setup detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
  }

  buildShortReason({ reversalShortReady, breakoutShortReady, aggressiveRejectReady, opportunisticPumpFadeReady, marketRegime, score }) {
    if (breakoutShortReady) {
      return `Aggressive futures breakdown short detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    if (aggressiveRejectReady) {
      return `Bear trend rejection short detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    if (opportunisticPumpFadeReady) {
      return `Aggressive pump-fade short detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    if (reversalShortReady) {
      return `Overbought reversal short detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
    }

    return `Futures short setup detected in ${marketRegime} regime with score ${score.toFixed(1)}.`;
  }
}

module.exports = StrategyEngine;
