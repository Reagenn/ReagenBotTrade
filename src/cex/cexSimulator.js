/**
 * Paper trading in-memory untuk strategi CEX Volume Spike Breakout.
 */

const TAKER_FEE_RATE = 0.001; // 0.1% transaction fee
const dbManager = require("../database/dbManager");

function round(value, decimals = 8) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function createTradeId(simulator) {
  simulator.nextTradeId = Number(simulator.nextTradeId || 1) + 1;
  return `cex-${simulator.nextTradeId - 1}`;
}

class CexSimulator {
  /**
   * @param {{
   *   startingBalanceUsdt?: number,
   *   positionSizeUsdt?: number,
   *   takeProfitPct?: number,
   *   stopLossPct?: number,
   *   maxOpenPositions?: number,
   * }} [options]
   */
  constructor(options = {}) {
    this.balanceUsdt = 0; // Will be synced from DB
    this.positionSizeUsdt = Number(options.positionSizeUsdt ?? 100);
    this.takeProfitPct = Number(options.takeProfitPct ?? 3);
    this.stopLossPct = Number(options.stopLossPct ?? 1.5);
    this.maxOpenPositions = Number(options.maxOpenPositions ?? 8);
  }

  async hasOpenTrade(symbol) {
    const sym = String(symbol || "").toUpperCase();
    try {
      const active = await dbManager.getActivePositions('cex');
      // Pending orders logic might need a separate table or metadata filter
      // For now, let's assume 'cex' type covers both if we mark them in metadata
      return active.some((trade) => trade.symbol === sym);
    } catch (err) {
      console.error("[CexSimulator] Error in hasOpenTrade:", err.message);
      return false;
    }
  }

  /**
   * @param {{ symbol: string, entryPrice: number, signal?: object }} signal
   * @returns {Promise<object|null>}
   */
  async openFromBuySignal(signal) {
    const symbol = String(signal?.symbol || "").toUpperCase();
    const entryPrice = Number(signal?.entryPrice);

    if (!symbol || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }

    try {
      if (await this.hasOpenTrade(symbol)) {
        console.log(`[cexSimulator] Skip ${symbol} — sudah ada posisi aktif.`);
        return null;
      }

      const active = await dbManager.getActivePositions('cex');
      if (active.length >= this.maxOpenPositions) {
        console.log(`[cexSimulator] Skip ${symbol} — max open positions (${this.maxOpenPositions}).`);
        return null;
      }

      this.balanceUsdt = await dbManager.getCexBalance();
      const sizeUsdt = this.positionSizeUsdt;
      if (this.balanceUsdt < sizeUsdt) {
        console.warn(`[cexSimulator] Saldo tidak cukup untuk ${symbol} (butuh ${sizeUsdt} USDT).`);
        return null;
      }

      const hasDynamicLevels =
        Number.isFinite(Number(signal?.targetTP)) &&
        Number.isFinite(Number(signal?.targetSL)) &&
        Number(signal.targetTP) > entryPrice &&
        Number(signal.targetSL) > 0 &&
        Number(signal.targetSL) < entryPrice;

      const targetTP = hasDynamicLevels
        ? round(Number(signal.targetTP), 8)
        : round(entryPrice * (1 + this.takeProfitPct / 100), 8);
      const targetSL = hasDynamicLevels
        ? round(Number(signal.targetSL), 8)
        : round(entryPrice * (1 - this.stopLossPct / 100), 8);

      const baseAmount = sizeUsdt / entryPrice;
      const feeAmountToken = baseAmount * TAKER_FEE_RATE;
      const amountToken = round(baseAmount - feeAmountToken, 8);

      const trade = {
        id: `cex-${Date.now()}`,
        symbol,
        entryPrice: round(entryPrice, 8),
        currentPrice: round(entryPrice, 8),
        amountUsdt: round(sizeUsdt, 2),
        amountToken,
        targetTP,
        targetSL,
        atr: hasDynamicLevels ? round(Number(signal.atr || 0), 8) : null,
        tpSlMode: hasDynamicLevels ? "atr" : "percent",
        openedAt: new Date().toISOString(),
        status: "OPEN",
        metadata: signal?.signal || null,
      };

      // Update Balance
      const newBalance = round(this.balanceUsdt - sizeUsdt, 2);
      await dbManager.updateCexBalance(newBalance);
      this.balanceUsdt = newBalance;

      // Save to SQLite
      await dbManager.saveOpenPosition('cex', trade);

      console.log(
        `[cexSimulator] BUY ${symbol} @ ${entryPrice} · Cost ${sizeUsdt} USDT`,
      );

      return trade;
    } catch (err) {
      console.error("[CexSimulator] Error in openFromBuySignal:", err.message);
      return null;
    }
  }

  /**
   * @param {string} tradeId
   * @param {number} exitPrice
   * @param {"TP"|"SL"|"MANUAL"} trigger
   */
  async closeTrade(tradeId, exitPrice, trigger = "MANUAL") {
    try {
      const active = await dbManager.getActivePositions('cex');
      const tradeRow = active.find(t => String(t.id) === String(tradeId));

      if (!tradeRow) return null;

      const trade = {
        id: tradeRow.id,
        symbol: tradeRow.symbol,
        entryPrice: tradeRow.entry_price,
        amountUsdt: tradeRow.amount_usdt,
        amountToken: tradeRow.amount_usdt / tradeRow.entry_price, // Approx
      };

      const price = Number(exitPrice);
      if (!Number.isFinite(price) || price <= 0) {
        return null;
      }

      const grossRevenueUsdt = trade.amountToken * price;
      const exitFeeUsdt = grossRevenueUsdt * TAKER_FEE_RATE;
      const proceedsUsdt = round(grossRevenueUsdt - exitFeeUsdt, 2);
      const pnlUsdt = round(proceedsUsdt - trade.amountUsdt, 2);
      const pnlPct = trade.amountUsdt > 0 ? round((pnlUsdt / trade.amountUsdt) * 100, 2) : 0;

      // Use dbManager to handle closing logic (delete, insert, balance)
      const result = await dbManager.closePosition('cex', trade.id, price, pnlPct, trigger);

      const closed = {
        ...trade,
        exitPrice: round(price, 8),
        proceedsUsdt,
        pnlUsdt,
        pnlPct,
        result: pnlPct >= 0 ? "PROFIT" : "LOSS",
        trigger,
        closedAt: new Date().toISOString(),
        status: "CLOSED",
      };

      console.log(
        `[cexSimulator] ${trigger} ${trade.symbol} · P/L ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt} USDT (${pnlPct}%)`,
      );

      return closed;
    } catch (err) {
      console.error("[CexSimulator] Error in closeTrade:", err.message);
      return null;
    }
  }

  async updateMarkPrice(symbol, price) {
    const sym = String(symbol || "").toUpperCase();
    const mark = Number(price);
    if (!Number.isFinite(mark) || mark <= 0) return;

    try {
      // Update current price in DB for active trades
      await dbManager.run(`UPDATE cex_paper_positions SET current_price = ? WHERE symbol = ?`, [round(mark, 8), sym]);
    } catch (err) {
      // ignore update errors
    }
  }

  async getStats() {
    try {
      const stats = await dbManager.getCexStats();
      const active = await dbManager.getActivePositions('cex');
      this.balanceUsdt = await dbManager.getCexBalance();

      return {
        totalTrades: stats.totalTrades,
        profitTrades: stats.profitTrades,
        lossTrades: stats.lossTrades,
        winRate: round(stats.winRate, 1),
        netPnlUsdt: round(stats.netPnlUsdt, 2),
        openPositions: active.length,
        balanceUsdt: this.balanceUsdt,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error("[CexSimulator] Error in getStats:", err.message);
      return {};
    }
  }

  async getActiveTrades() {
    try {
      const rows = await dbManager.getActivePositions('cex');
      return rows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        entryPrice: row.entry_price,
        currentPrice: row.current_price,
        amountUsdt: row.amount_usdt,
        targetTP: row.target_tp,
        targetSL: row.target_sl,
        openedAt: row.opened_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
    } catch (err) {
      return [];
    }
  }

  async getTradeHistory() {
    try {
      const rows = await dbManager.getCexTrades(100);
      return rows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        entryPrice: row.entry_price,
        exitPrice: row.exit_price,
        amountUsdt: row.amount_usdt,
        pnlUsdt: row.pnl_usd,
        pnlPct: row.pnl_percent,
        result: row.result,
        trigger: row.trigger_type,
        openedAt: row.opened_at,
        closedAt: row.closed_at
      }));
    } catch (err) {
      return [];
    }
  }

  exportSnapshot() {
    return {
      balanceUsdt: this.balanceUsdt,
      config: {
        positionSizeUsdt: this.positionSizeUsdt,
        takeProfitPct: this.takeProfitPct,
        stopLossPct: this.stopLossPct,
        maxOpenPositions: this.maxOpenPositions,
      },
    };
  }

  loadSnapshot(snapshot) {
    if (!snapshot) return;
    this.balanceUsdt = Number(snapshot.balanceUsdt ?? 1000);
    if (snapshot.config) {
      this.positionSizeUsdt = Number(snapshot.config.positionSizeUsdt ?? this.positionSizeUsdt);
      this.takeProfitPct = Number(snapshot.config.takeProfitPct ?? this.takeProfitPct);
      this.stopLossPct = Number(snapshot.config.stopLossPct ?? this.stopLossPct);
      this.maxOpenPositions = Number(snapshot.config.maxOpenPositions ?? this.maxOpenPositions);
    }
  }
}

module.exports = { CexSimulator };
