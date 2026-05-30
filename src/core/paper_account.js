const dbManager = require("../database/dbManager");
const logger = require("../utils/logger");
const { formatPct, formatPrice, formatQty } = require("../utils/log_helpers");

class PaperAccount {
  constructor(config) {
    this.config = config;
    this.stateKey = `paper_ledger_${config.runMode || "spot"}`;
    this.state = null;
  }

  async load() {
    const savedState = await dbManager.getState(this.stateKey);
    if (!savedState) {
      this.state = this.createInitialState();
      await this.persist();
      return this.state;
    }

    this.state = this.normalizeState(savedState);
    await this.persist();
    return this.state;
  }

  createInitialState() {
    return {
      runMode: this.config.runMode,
      baseCurrency: this.config.baseCurrency,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      balances: {
        cash: this.config.paperStartingBalance,
        asset: 0,
        marginLocked: 0,
      },
      performance: {
        realizedPnl: 0,
        paidFees: 0,
        wins: 0,
        losses: 0,
        tradesClosed: 0,
      },
      openPosition: null,
      trades: [],
      equitySnapshots: [],
    };
  }

  normalizeState(state) {
    const nextState = state || {};
    nextState.baseCurrency = nextState.baseCurrency || this.config.baseCurrency;
    nextState.runMode = nextState.runMode || this.config.runMode;
    nextState.startedAt = nextState.startedAt || new Date().toISOString();
    nextState.updatedAt = nextState.updatedAt || new Date().toISOString();
    nextState.balances = nextState.balances || {};
    nextState.balances.cash = Number.isFinite(nextState.balances.cash) ? nextState.balances.cash : this.config.paperStartingBalance;
    nextState.balances.asset = Number.isFinite(nextState.balances.asset) ? nextState.balances.asset : 0;
    nextState.balances.marginLocked = Number.isFinite(nextState.balances.marginLocked) ? nextState.balances.marginLocked : 0;
    delete nextState.balances.reserved;

    nextState.performance = nextState.performance || {};
    nextState.performance.realizedPnl = Number.isFinite(nextState.performance.realizedPnl) ? nextState.performance.realizedPnl : 0;
    nextState.performance.paidFees = Number.isFinite(nextState.performance.paidFees) ? nextState.performance.paidFees : 0;
    nextState.performance.wins = Number.isFinite(nextState.performance.wins) ? nextState.performance.wins : 0;
    nextState.performance.losses = Number.isFinite(nextState.performance.losses) ? nextState.performance.losses : 0;
    nextState.performance.tradesClosed = Number.isFinite(nextState.performance.tradesClosed) ? nextState.performance.tradesClosed : 0;
    nextState.trades = Array.isArray(nextState.trades) ? nextState.trades : [];
    nextState.equitySnapshots = Array.isArray(nextState.equitySnapshots) ? nextState.equitySnapshots : [];
    nextState.openPosition = nextState.openPosition || null;

    if (
      nextState.openPosition &&
      nextState.openPosition.mode !== "futures" &&
      nextState.balances.asset === 0 &&
      Number.isFinite(nextState.openPosition.amount)
    ) {
      nextState.balances.asset = nextState.openPosition.amount;
    }

    return nextState;
  }

  async persist() {
    if (!this.state) {
      return;
    }

    this.state.updatedAt = new Date().toISOString();
    
    // Create a copy without the large trades array if needed, 
    // but SQLite handles large strings okay, and we want full trades in history.
    // However, dbManager.saveTrade also saves trades individually.
    // For now, let's keep the core state clean.
    const stateToSave = { ...this.state };
    // Keep snapshots and trades in state for dashboard but individual trades are also in SQLite
    
    await dbManager.saveState(this.stateKey, stateToSave);
  }

  async getState() {
    if (!this.state) {
      return await this.load();
    }

    return this.state;
  }

  async getOpenPosition() {
    const s = await this.getState();
    return s.openPosition;
  }

  async getCashBalance() {
    const s = await this.getState();
    return s.balances.cash;
  }

  async getAssetBalance() {
    const s = await this.getState();
    return s.balances.asset;
  }

  async getMarginLocked() {
    const s = await this.getState();
    return s.balances.marginLocked;
  }

  isFuturesMode() {
    return String(this.config.runMode).toLowerCase() === "futures";
  }

  async estimateUnrealizedPnl(currentPrice) {
    const position = await this.getOpenPosition();
    if (!position || !currentPrice) {
      return 0;
    }

    const gross = position.mode === "futures"
      ? (position.side === "buy"
        ? (currentPrice - position.entryPrice) * position.amount
        : (position.entryPrice - currentPrice) * position.amount)
      : (currentPrice - position.entryPrice) * position.amount;
    const estimatedExitFee = currentPrice * position.amount * this.config.paperFeeRate;
    return gross - estimatedExitFee;
  }

  async getEquity(currentPrice) {
    if (this.isFuturesMode()) {
      return (await this.getCashBalance()) + (await this.getMarginLocked()) + (await this.estimateUnrealizedPnl(currentPrice));
    }

    const assetMarkToMarket = currentPrice ? (await this.getAssetBalance()) * currentPrice : 0;
    return (await this.getCashBalance()) + assetMarkToMarket;
  }

  async canOpenPosition(requiredNotional) {
    return (await this.getCashBalance()) >= requiredNotional;
  }

  async canOpenFuturesPosition(requiredMargin, entryFee) {
    return (await this.getCashBalance()) >= requiredMargin + entryFee;
  }

  async openPosition({ symbol, side, amount, entryPrice, stopPrice, activationPrice, signal }) {
    const state = await this.getState();
    const entryFee = entryPrice * amount * this.config.paperFeeRate;
    const notional = entryPrice * amount;
    const cashReduction = notional + entryFee;

    if (cashReduction > state.balances.cash) {
      throw new Error(`Paper account has insufficient cash. Required ${cashReduction}, available ${state.balances.cash}.`);
    }

    state.balances.cash -= cashReduction;
    state.balances.asset += amount;
    state.performance.paidFees += entryFee;
    state.openPosition = {
      symbol,
      side,
      amount,
      entryPrice,
      stopPrice,
      activationPrice,
      highestPrice: entryPrice,
      lowestPrice: entryPrice,
      trailingActive: false,
      enteredAt: new Date().toISOString(),
      signalReason: signal.reason,
      entryFee,
    };

    const trade = {
      type: "ENTRY",
      symbol,
      side,
      amount,
      entryPrice,
      notional,
      fee: entryFee,
      timestamp: new Date().toISOString(),
      signalReason: signal.reason,
    };
    state.trades.push(trade);

    // SQLITE INDIVIDUAL TRADE
    await dbManager.saveTrade({
      pair: symbol,
      type: "BUY",
      price: entryPrice,
      amount: amount,
      trigger_type: "ENTRY"
    });

    await this.persist();
    logger.info({
      summary: {
        event: "PAPER_BUY",
        symbol,
        quantity: formatQty(amount),
        entryPrice: formatPrice(entryPrice),
        fee: formatPrice(entryFee),
        cashAfter: formatPrice(state.balances.cash),
        assetAfter: formatQty(state.balances.asset),
      },
    }, "Paper ledger updated after buy.");
    return state.openPosition;
  }

  async openFuturesPosition({ symbol, side, amount, entryPrice, leverage, signal, takeProfitPct, stopLossPct }) {
    const state = await this.getState();
    const notional = entryPrice * amount;
    const entryFee = notional * this.config.paperFeeRate;
    const requiredMargin = notional / leverage;

    if (!(await this.canOpenFuturesPosition(requiredMargin, entryFee))) {
      throw new Error(`Paper futures account has insufficient cash. Required ${requiredMargin + entryFee}, available ${state.balances.cash}.`);
    }

    state.balances.cash -= requiredMargin + entryFee;
    state.balances.marginLocked += requiredMargin;
    state.performance.paidFees += entryFee;
    state.openPosition = {
      mode: "futures",
      symbol,
      side,
      amount,
      entryPrice,
      leverage,
      marginLocked: requiredMargin,
      takeProfitPct,
      stopLossPct,
      enteredAt: new Date().toISOString(),
      signalReason: signal.reason,
      entryFee,
    };

    state.trades.push({
      type: "ENTRY",
      mode: "futures",
      symbol,
      side,
      amount,
      entryPrice,
      leverage,
      notional,
      marginLocked: requiredMargin,
      fee: entryFee,
      timestamp: new Date().toISOString(),
      signalReason: signal.reason,
    });

    // SQLITE INDIVIDUAL TRADE
    await dbManager.saveTrade({
      pair: symbol,
      type: side.toUpperCase() === "BUY" ? "LONG" : "SHORT",
      price: entryPrice,
      amount: amount,
      trigger_type: "ENTRY"
    });

    await this.persist();
    logger.info({
      summary: {
        event: "PAPER_FUTURES_OPEN",
        symbol,
        side: side.toUpperCase(),
        quantity: formatQty(amount),
        entryPrice: formatPrice(entryPrice),
        leverage: `${leverage}x`,
        marginLocked: formatPrice(requiredMargin),
        fee: formatPrice(entryFee),
        cashAfter: formatPrice(state.balances.cash),
      },
    }, "Paper futures position opened.");
    return state.openPosition;
  }

  async syncOpenPosition(position) {
    const state = await this.getState();
    state.openPosition = position ? { ...position } : null;
    await this.persist();
  }

  async closePosition(exitPrice, reason) {
    const state = await this.getState();
    const position = state.openPosition;

    if (!position) {
      return null;
    }

    const exitFee = exitPrice * position.amount * this.config.paperFeeRate;
    const grossPnl = (exitPrice - position.entryPrice) * position.amount;
    const netPnl = grossPnl - exitFee;
    const saleProceeds = exitPrice * position.amount;

    state.balances.cash += saleProceeds - exitFee;
    state.balances.asset = Math.max(0, state.balances.asset - position.amount);
    state.performance.realizedPnl += netPnl;
    state.performance.paidFees += exitFee;
    state.performance.tradesClosed += 1;

    if (netPnl >= 0) {
      state.performance.wins += 1;
    } else {
      state.performance.losses += 1;
    }

    const tradeRecord = {
      type: "EXIT",
      symbol: position.symbol,
      side: position.side,
      amount: position.amount,
      entryPrice: position.entryPrice,
      exitPrice,
      grossPnl,
      netPnl,
      pnlPct: ((exitPrice - position.entryPrice) / position.entryPrice) * 100,
      fee: exitFee,
      timestamp: new Date().toISOString(),
      reason,
    };

    state.trades.push(tradeRecord);
    state.openPosition = null;

    // SQLITE INDIVIDUAL TRADE
    await dbManager.saveTrade({
      pair: position.symbol,
      type: "SELL",
      price: exitPrice,
      amount: position.amount,
      pnl_usd: netPnl,
      pnl_percent: tradeRecord.pnlPct,
      trigger_type: reason || "EXIT"
    });

    await this.persist();

    logger.info({
      summary: {
        event: "PAPER_SELL",
        symbol: position.symbol,
        quantity: formatQty(position.amount),
        exitPrice: formatPrice(exitPrice),
        netPnl: formatPrice(netPnl),
        pnlPct: formatPct(tradeRecord.pnlPct),
        cashAfter: formatPrice(state.balances.cash),
        assetAfter: formatQty(state.balances.asset),
      },
    }, "Paper ledger updated after sell.");
    return tradeRecord;
  }

  async calculateFuturesPositionMetrics(currentPrice) {
    const position = await this.getOpenPosition();
    if (!position || position.mode !== "futures" || !currentPrice) {
      return null;
    }

    const grossPnl = position.side === "buy"
      ? (currentPrice - position.entryPrice) * position.amount
      : (position.entryPrice - currentPrice) * position.amount;
    const pnlPctOnMargin = position.marginLocked > 0 ? (grossPnl / position.marginLocked) * 100 : 0;

    return {
      grossPnl,
      unrealizedPnl: grossPnl,
      pnlPctOnMargin,
    };
  }

  async closeFuturesPosition(exitPrice, reason) {
    const state = await this.getState();
    const position = state.openPosition;

    if (!position || position.mode !== "futures") {
      return null;
    }

    const exitNotional = exitPrice * position.amount;
    const exitFee = exitNotional * this.config.paperFeeRate;
    const grossPnl = position.side === "buy"
      ? (exitPrice - position.entryPrice) * position.amount
      : (position.entryPrice - exitPrice) * position.amount;
    const netPnl = grossPnl - exitFee;

    state.balances.cash += position.marginLocked + netPnl;
    state.balances.marginLocked = Math.max(0, state.balances.marginLocked - position.marginLocked);
    state.performance.realizedPnl += netPnl;
    state.performance.paidFees += exitFee;
    state.performance.tradesClosed += 1;

    if (netPnl >= 0) {
      state.performance.wins += 1;
    } else {
      state.performance.losses += 1;
    }

    const pnlPct = position.marginLocked > 0 ? (netPnl / position.marginLocked) * 100 : 0;
    const tradeRecord = {
      type: "EXIT",
      mode: "futures",
      symbol: position.symbol,
      side: position.side,
      amount: position.amount,
      entryPrice: position.entryPrice,
      exitPrice,
      leverage: position.leverage,
      grossPnl,
      netPnl,
      pnlPct,
      fee: exitFee,
      timestamp: new Date().toISOString(),
      reason,
    };

    state.trades.push(tradeRecord);
    state.openPosition = null;

    // SQLITE INDIVIDUAL TRADE
    await dbManager.saveTrade({
      pair: position.symbol,
      type: "CLOSE",
      price: exitPrice,
      amount: position.amount,
      pnl_usd: netPnl,
      pnl_percent: pnlPct,
      trigger_type: reason || "EXIT"
    });

    await this.persist();

    logger.info({
      summary: {
        event: "PAPER_FUTURES_CLOSE",
        symbol: position.symbol,
        side: position.side.toUpperCase(),
        exitPrice: formatPrice(exitPrice),
        netPnl: formatPrice(netPnl),
        pnlPct: formatPct(pnlPct),
        cashAfter: formatPrice(state.balances.cash),
      },
    }, "Paper futures position closed.");
    return tradeRecord;
  }

  async recordEquitySnapshot(price) {
    const state = await this.getState();
    state.equitySnapshots.push({
      timestamp: new Date().toISOString(),
      price,
      equity: await this.getEquity(price),
      cash: state.balances.cash,
      asset: state.balances.asset,
      marginLocked: state.balances.marginLocked,
    });

    if (state.equitySnapshots.length > this.config.paperMaxSnapshots) {
      state.equitySnapshots.shift();
    }

    await this.persist();
  }
}

module.exports = PaperAccount;
