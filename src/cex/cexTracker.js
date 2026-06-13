const { createPublicExchange, withTimeout, withRetry } = require("./cexExchange");

/**
 * Pantau harga posisi aktif & eksekusi TP/SL virtual.
 */
class CexTracker {
  /**
   * @param {import('./cexSimulator').CexSimulator} simulator
   * @param {{ exchangeId?: string, pollIntervalMs?: number }} [options]
   */
  constructor(simulator, options = {}) {
    this.simulator = simulator;
    this.exchangeId = options.exchangeId || process.env.CEX_EXCHANGE || "kraken";
    this.pollIntervalMs = Number(options.pollIntervalMs ?? process.env.CEX_TRACKER_POLL_MS ?? 5000);
    this.exchange = createPublicExchange(this.exchangeId);
    this._timer = null;
    this._running = false;
  }

  async fetchLastPrice(symbol) {
    const ticker = await withRetry(
      () => withTimeout(() => this.exchange.fetchTicker(symbol), undefined, `ticker ${symbol}`),
      `ticker ${symbol}`,
    );
    return Number(ticker.last || ticker.close || 0);
  }

  /**
   * Satu tick: update mark price & cek TP/SL.
   */
  async asyncTick() {
    const activeTrades = await this.simulator.getActiveTrades();
    const openSymbols = [...new Set(activeTrades.map((trade) => trade.symbol))];
    
    if (!openSymbols.length) {
      return { closed: [], checked: 0 };
    }

    const closed = [];

    for (const symbol of openSymbols) {
      try {
        const price = await this.fetchLastPrice(symbol);
        if (!Number.isFinite(price) || price <= 0) continue;

        await this.simulator.updateMarkPrice(symbol, price);

        const trades = activeTrades.filter((trade) => trade.symbol === symbol);
        for (const trade of [...trades]) {
          // SKIP TP/SL check if position is on HOLD
          if (trade.isHold) continue;

          if (price >= trade.targetTP) {
            const result = await this.simulator.closeTrade(trade.id, price, "TP");
            if (result) closed.push(result);
          } else if (price <= trade.targetSL) {
            const result = await this.simulator.closeTrade(trade.id, price, "SL");
            if (result) closed.push(result);
          }
        }
      } catch (error) {
        console.warn(`[cexTracker] Gagal pantau ${symbol}: ${error.message}`);
      }
    }

    const stats = await this.simulator.getStats();
    if (closed.length || (stats && stats.totalTrades > 0)) {
      console.log(
        `[cexTracker] WR ${stats.winRate}% · ${stats.profitTrades}W/${stats.lossTrades}L · net ${stats.netPnlUsdt >= 0 ? "+" : ""}${stats.netPnlUsdt} USDT · open ${stats.openPositions}`,
      );
    }

    return { closed, checked: openSymbols.length, stats };
  }

  start() {
    if (this._running) return;
    this._running = true;

    const run = async () => {
      if (!this._running) return;
      try {
        await this.asyncTick();
      } catch (error) {
        console.warn(`[cexTracker] Tick error: ${error.message}`);
      }
    };

    run();
    this._timer = setInterval(run, this.pollIntervalMs);
    console.log(`[cexTracker] Polling harga setiap ${this.pollIntervalMs / 1000}s`);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = { CexTracker };
