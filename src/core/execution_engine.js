const logger = require("../utils/logger");
const { formatPct, formatPrice, formatQty } = require("../utils/log_helpers");
const { calculatePnlPctFromPrices } = require("../utils/math_utils");

class ExecutionEngine {
  constructor({ dataFetcher, riskManager, config, paperAccount = null }) {
    this.dataFetcher = dataFetcher;
    this.riskManager = riskManager;
    this.config = config;
    this.paperAccount = paperAccount;
    this.activePosition = this.config.dryRun ? this.paperAccount?.getOpenPosition() || null : null;
  }

  async refreshExchangeMetadata(symbol) {
    const market = this.dataFetcher.exchange.market(symbol);

    return {
      market,
      minAmount: market.limits?.amount?.min || this.config.defaultMinAmount,
      minCost: market.limits?.cost?.min || 0,
    };
  }

  formatAmountForMarket(symbol, rawAmount) {
    const formatted = this.dataFetcher.exchange.amountToPrecision(symbol, rawAmount);
    return Number.parseFloat(formatted);
  }

  isFuturesMode() {
    return String(this.config.runMode).toLowerCase() === "futures";
  }

  deriveTargetRawSize(referencePrice, risk) {
    if (!this.isFuturesMode()) {
      return risk.rawPositionSize;
    }

    const configuredMargin = Number(this.config.futuresMarginUsd || 0);
    if (!Number.isFinite(configuredMargin) || configuredMargin <= 0 || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return risk.rawPositionSize;
    }

    const targetNotional = configuredMargin * this.config.futuresLeverage;
    return targetNotional / referencePrice;
  }

  async maybeEnterPosition({ signal, symbol, equity, ticker }) {
    if (this.activePosition) {
      return null;
    }

    if (!["LONG", "SHORT"].includes(signal.action)) {
      return null;
    }

    const side = signal.action === "SHORT" ? "sell" : "buy";
    const referencePrice = ticker?.last || ticker?.close || ticker?.bid || ticker?.ask;

    if (!referencePrice) {
      throw new Error("No executable market price available for order entry.");
    }

    const marketInfo = await this.refreshExchangeMetadata(symbol);
    const risk = this.riskManager.computeRiskParameters({
      equity,
      entryPrice: referencePrice,
      side,
      marketInfo,
      winRateEstimate: this.config.assumedWinRate,
      rewardRiskEstimate: this.config.assumedRewardRisk,
      atr: signal?.diagnostics?.atr,
    });

    const targetRawSize = this.deriveTargetRawSize(referencePrice, risk);
    const positionSize = this.formatAmountForMarket(symbol, targetRawSize);
    const orderCost = positionSize * referencePrice;

    if (!positionSize || positionSize <= 0) {
      logger.warn({ risk, rawPositionSize: risk.rawPositionSize, targetRawSize, positionSize }, "Computed position size is invalid; order skipped.");
      return null;
    }

    if (positionSize < marketInfo.minAmount) {
      logger.warn({ rawPositionSize: risk.rawPositionSize, targetRawSize, positionSize, minAmount: marketInfo.minAmount }, "Position size is below market minimum amount; order skipped.");
      return null;
    }

    if (marketInfo.minCost && orderCost < marketInfo.minCost) {
      logger.warn({ orderCost, minCost: marketInfo.minCost, positionSize }, "Position notional is below exchange minimum cost; order skipped.");
      return null;
    }

    const requiredNotional = orderCost * (1 + this.config.paperFeeRate);
    if (this.config.dryRun && this.paperAccount) {
      if (this.isFuturesMode()) {
        const requiredMargin = orderCost / this.config.futuresLeverage;
        const entryFee = orderCost * this.config.paperFeeRate;
        if (!this.paperAccount.canOpenFuturesPosition(requiredMargin, entryFee)) {
          logger.warn({ requiredMargin, entryFee, availableCash: this.paperAccount.getCashBalance() }, "Paper futures entry skipped due to insufficient virtual cash.");
          return null;
        }
      } else if (!this.paperAccount.canOpenPosition(requiredNotional)) {
        logger.warn({ requiredNotional, availableCash: this.paperAccount.getCashBalance() }, "Paper entry skipped due to insufficient virtual cash.");
        return null;
      }
    }

    // The execution layer is deliberately conservative:
    // it only acts after the strategy and risk layers agree on direction and size.
    const params = this.config.dryRun ? {} : { reduceOnly: false };
    const order =
      this.config.dryRun ?
        {
          id: `paper-${Date.now()}`,
          status: "closed",
          side,
          amount: positionSize,
          price: referencePrice,
        }
      : await this.dataFetcher.placeOrder(symbol, "market", side, positionSize, undefined, params);

    this.activePosition = {
      symbol,
      side,
      amount: positionSize,
      entryPrice: referencePrice,
      stopPrice: risk.stopPrice,
      activationPrice: risk.activationPrice,
      highestPrice: referencePrice,
      lowestPrice: referencePrice,
      trailingActive: false,
      entryOrderId: order.id,
      enteredAt: new Date().toISOString(),
    };

    if (this.config.dryRun && this.paperAccount) {
      this.activePosition = this.isFuturesMode()
        ? this.paperAccount.openFuturesPosition({
            symbol,
            side,
            amount: positionSize,
            entryPrice: referencePrice,
            leverage: this.config.futuresLeverage,
            signal,
            takeProfitPct: this.config.futuresTakeProfitPct,
            stopLossPct: this.config.futuresStopLossPct,
          })
        : this.paperAccount.openPosition({
            symbol,
            side,
            amount: positionSize,
            entryPrice: referencePrice,
            stopPrice: risk.stopPrice,
            activationPrice: risk.activationPrice,
            signal,
          });
    }

    logger.info(
      {
        order,
        risk,
        signal,
        summary: {
          action: this.isFuturesMode() ? (side === "buy" ? "LONG" : "SHORT") : "BUY",
          symbol,
          entryPrice: formatPrice(referencePrice),
          quantity: formatQty(positionSize),
          stopPrice: formatPrice(risk.stopPrice),
          trailingActivation: formatPrice(risk.activationPrice),
          rawQuantity: formatQty(targetRawSize),
          configuredMargin: this.isFuturesMode() ? formatPrice(this.config.futuresMarginUsd) : undefined,
          leverage: this.isFuturesMode() ? `${this.config.futuresLeverage}x` : undefined,
        },
      },
      this.isFuturesMode() ? "Futures paper entry executed." : "Spot paper entry executed.",
    );

    return this.activePosition;
  }

  async manageOpenPosition(latestPrice) {
    if (!this.activePosition || !latestPrice) {
      return null;
    }

    if (this.isFuturesMode()) {
      return this.manageFuturesPosition(latestPrice);
    }

    const position = this.activePosition;
    position.highestPrice = Math.max(position.highestPrice, latestPrice);
    position.lowestPrice = Math.min(position.lowestPrice, latestPrice);

    if (!position.trailingActive) {
      // Trailing protection only activates after a 2% favorable move.
      // This prevents the stop from choking trades before they have enough room to develop.
      const activationReached = position.side === "buy" ? latestPrice >= position.activationPrice : latestPrice <= position.activationPrice;

      if (activationReached) {
        position.trailingActive = true;
        position.stopPrice = this.riskManager.computeTrailingStop({
          side: position.side,
          highestPrice: position.highestPrice,
          lowestPrice: position.lowestPrice,
        });

        logger.info({ position }, "Trailing stop activated.");
      }
    } else {
      position.stopPrice = this.riskManager.computeTrailingStop({
        side: position.side,
        highestPrice: position.highestPrice,
        lowestPrice: position.lowestPrice,
      });
    }

    const stopHit = position.side === "buy" ? latestPrice <= position.stopPrice : latestPrice >= position.stopPrice;

    if (!stopHit) {
      if (this.config.dryRun && this.paperAccount) {
        this.paperAccount.syncOpenPosition(position);
      }
      return null;
    }

    return this.exitPosition(latestPrice, "stop_or_trailing_exit");
  }

  async manageFuturesPosition(latestPrice) {
    const metrics = this.paperAccount?.calculateFuturesPositionMetrics(latestPrice);
    if (!metrics || !this.activePosition) {
      return null;
    }

    const takeProfitHit = metrics.pnlPctOnMargin >= this.config.futuresTakeProfitPct;
    const stopLossHit = metrics.pnlPctOnMargin <= -this.config.futuresStopLossPct;

    if (!takeProfitHit && !stopLossHit) {
      if (this.config.dryRun && this.paperAccount) {
        this.paperAccount.syncOpenPosition(this.activePosition);
      }
      return null;
    }

    return this.exitPosition(latestPrice, takeProfitHit ? "futures_take_profit" : "futures_stop_loss");
  }

  async exitPosition(referencePrice, reason) {
    if (!this.activePosition) {
      return null;
    }

    const position = this.activePosition;
    const exitSide = this.isFuturesMode()
      ? (position.side === "buy" ? "sell" : "buy")
      : "sell";

    const order =
      this.config.dryRun ?
        {
          id: `paper-close-${Date.now()}`,
          status: "closed",
          side: exitSide,
          amount: position.amount,
          price: referencePrice,
        }
      : await this.dataFetcher.placeOrder(position.symbol, "market", exitSide, position.amount, undefined, {
          reduceOnly: true,
        });

    const pnlPct = this.calculatePnlPct(position.side, position.entryPrice, referencePrice);
    let paperTradeRecord = null;

    if (this.config.dryRun && this.paperAccount) {
      paperTradeRecord = this.isFuturesMode()
        ? this.paperAccount.closeFuturesPosition(referencePrice, reason)
        : this.paperAccount.closePosition(referencePrice, reason);
    }

    logger.info(
      {
        reason,
        entryPrice: position.entryPrice,
        exitPrice: referencePrice,
        side: position.side,
        amount: position.amount,
        pnlPct,
        paperTradeRecord,
        order,
        summary: {
          action: this.isFuturesMode() ? "CLOSE" : "SELL",
          symbol: position.symbol,
          exitReason: reason,
          exitPrice: formatPrice(referencePrice),
          quantity: formatQty(position.amount),
          pnlPct: formatPct(pnlPct),
          netPnl: paperTradeRecord ? formatPrice(paperTradeRecord.netPnl) : null,
          leverage: this.isFuturesMode() ? `${this.config.futuresLeverage}x` : undefined,
        },
      },
      this.isFuturesMode() ? "Futures paper exit executed." : "Spot paper exit executed.",
    );

    this.activePosition = null;
    return order;
  }

  calculatePnlPct(side, entryPrice, exitPrice) {
    const pct = calculatePnlPctFromPrices(entryPrice, exitPrice);
    return side === "sell" ? -pct : pct;
  }
}

module.exports = ExecutionEngine;
