class RiskManager {
  constructor(config) {
    this.config = config;
    this.dailyState = {
      dayKey: null,
      startingEquity: null,
      lockedUntil: null,
    };
  }

  syncDailyState(equity, now = new Date()) {
    const dayKey = now.toISOString().slice(0, 10);

    // Each trading day gets its own reference equity so daily loss limits
    // are anchored to the same baseline and cannot drift intra-day.
    if (this.dailyState.dayKey !== dayKey) {
      this.dailyState.dayKey = dayKey;
      this.dailyState.startingEquity = equity;
      this.dailyState.lockedUntil = null;
    }
  }

  canTrade(now = new Date()) {
    if (!this.dailyState.lockedUntil) {
      return { allowed: true };
    }

    if (now >= this.dailyState.lockedUntil) {
      this.dailyState.lockedUntil = null;
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Circuit breaker active until ${this.dailyState.lockedUntil.toISOString()}.`,
    };
  }

  evaluateCircuitBreaker(currentEquity, now = new Date()) {
    this.syncDailyState(currentEquity, now);

    if (!this.dailyState.startingEquity) {
      this.dailyState.startingEquity = currentEquity;
      return { tripped: false };
    }

    const drawdown = (this.dailyState.startingEquity - currentEquity) / this.dailyState.startingEquity;

    // The circuit breaker is the capital-preservation fail-safe: once the
    // session loss reaches the hard threshold, the bot stands down for 24 hours.
    if (drawdown >= this.config.maxDailyDrawdownPct) {
      this.dailyState.lockedUntil = new Date(now.getTime() + this.config.cooldownHours * 60 * 60 * 1000);
      return {
        tripped: true,
        reason: `Daily drawdown reached ${(drawdown * 100).toFixed(2)}%.`,
        lockedUntil: this.dailyState.lockedUntil,
      };
    }

    return { tripped: false, drawdown };
  }

  computeRiskParameters({ equity, entryPrice, side, marketInfo, winRateEstimate, rewardRiskEstimate, atr }) {
    // Position size starts with fixed fractional risk so any single trade can only
    // damage a small slice of equity if the stop is hit.
    const atrStopDistancePct = atr ? (atr * this.config.atrStopMultiplier) / entryPrice : 0;
    const stopDistancePct = Math.max(this.config.stopLossPct, atrStopDistancePct);
    const stopPrice = side === "buy" ? entryPrice * (1 - stopDistancePct) : entryPrice * (1 + stopDistancePct);

    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    const capitalAtRisk = equity * this.config.maxRiskPerTradePct;

    const fixedFractionalSize = capitalAtRisk / riskPerUnit;

    // Kelly is deliberately capped. Full Kelly is too aggressive for noisy crypto
    // returns, so we blend it as an upper ceiling rather than letting it dominate risk.
    const kellyFraction = this.computeKellyFraction(winRateEstimate, rewardRiskEstimate);
    const kellyCappedSize = (equity * kellyFraction) / entryPrice;
    const rawPositionSize = Math.max(marketInfo.minAmount, Math.min(fixedFractionalSize, kellyCappedSize || fixedFractionalSize));

    return {
      rawPositionSize,
      stopPrice,
      stopDistancePct,
      initialRiskAmount: capitalAtRisk,
      activationPrice: side === "buy" ? entryPrice * (1 + this.config.trailingActivationPct) : entryPrice * (1 - this.config.trailingActivationPct),
    };
  }

  computeKellyFraction(winRateEstimate = 0.55, rewardRiskEstimate = 1.4) {
    const lossRate = 1 - winRateEstimate;
    const rawKelly = winRateEstimate - lossRate / rewardRiskEstimate;

    return Math.max(0, Math.min(rawKelly * this.config.kellyFractionCap, this.config.kellyFractionCap));
  }

  computeTrailingStop({ side, highestPrice, lowestPrice }) {
    // Once unrealized profit proves the trade idea is working, the trailing stop
    // converts open profit into protected equity while still allowing trend extension.
    if (side === "buy") {
      return highestPrice * (1 - this.config.trailingDistancePct);
    }

    return lowestPrice * (1 + this.config.trailingDistancePct);
  }
}

module.exports = RiskManager;
