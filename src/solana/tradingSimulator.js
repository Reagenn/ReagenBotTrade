/**
 * Paper trading simulator untuk token Solana (SPL).
 * State in-memory — siap dihubungkan ke stream harga (Jupiter, Birdeye, DexScreener).
 */

function round(value, decimals = 8) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function createPositionId(engine) {
  engine.nextPositionId = Number(engine.nextPositionId || 1) + 1;
  return `sim-${engine.nextPositionId - 1}`;
}

const DEX_FEE_RATE = 0.003;       // 0.3% fee per swap
const VIRTUAL_SLIPPAGE = 0.015;   // 1.5% slippage price impact per swap
const NETWORK_FEE_SOL = 0.001;     // 0.001 SOL flat priority fee
const dbManager = require("../database/dbManager");
const { getExecutionPrice, getExecutionPriceBatch } = require("./priceFetcher");

class SimulationEngine {
  /**
   * @param {{ takeProfitPct?: number, stopLossPct?: number, allowDuplicateToken?: boolean }} [options]
   */
  constructor(options = {}) {
    this.nextPositionId = 1;
    this.defaultTakeProfitPct = Number(options.takeProfitPct ?? 50);
    this.defaultStopLossPct = Number(options.stopLossPct ?? 20);
    this.allowDuplicateToken = options.allowDuplicateToken !== false;
    this.balanceSol = 0; // Will be synced from DB
  }

  /**
   * Buka posisi virtual saat smart money / sinyal buy terdeteksi.
   *
   * @param {string} tokenAddress - Mint SPL token
   * @param {number} entryPrice - Harga entry per token (dalam SOL)
   * @param {number} amountSol - Modal virtual (SOL)
   * @param {{ takeProfitPct?: number, stopLossPct?: number, symbol?: string, metadata?: object }} [options]
   * @returns {Promise<object|null>}
   */
  async simulateBuy(tokenAddress, entryPrice, amountSol, options = {}) {
    const mint = String(tokenAddress || "").trim();
    const price = Number(entryPrice);
    const sizeSol = Number(amountSol);

    if (!mint) {
      console.warn("[SimulationEngine] simulateBuy: tokenAddress wajib diisi.");
      return null;
    }
    if (!Number.isFinite(price) || price <= 0) {
      console.warn("[SimulationEngine] simulateBuy: entryPrice harus > 0.");
      return null;
    }
    if (!Number.isFinite(sizeSol) || sizeSol <= 0) {
      console.warn("[SimulationEngine] simulateBuy: amountSol harus > 0.");
      return null;
    }

    try {
      if (!this.allowDuplicateToken && await this.hasOpenPosition(mint)) {
        console.log(`[SimulationEngine] Skip buy — posisi ${options.symbol || mint.slice(0, 6)} masih terbuka.`);
        return null;
      }

      this.balanceSol = await dbManager.getPaperBalance();
      if (this.balanceSol < sizeSol) {
        console.warn(`[SimulationEngine] Saldo tidak cukup: butuh ${sizeSol} SOL, saldo saat ini ${this.balanceSol} SOL`);
        return null;
      }

      const takeProfitPct = Number(options.takeProfitPct ?? this.defaultTakeProfitPct);
      const stopLossPct = Number(options.stopLossPct ?? this.defaultStopLossPct);

      const netSolForBuying = sizeSol - NETWORK_FEE_SOL;
      if (netSolForBuying <= 0) {
        console.warn(`[SimulationEngine] amountSol ${sizeSol} terlalu kecil untuk menutupi network fee ${NETWORK_FEE_SOL}`);
        return null;
      }

      const swapFeeRate = DEX_FEE_RATE;
      const slippageRate = VIRTUAL_SLIPPAGE;
      
      const baseTokens = netSolForBuying / price;
      const virtualTokensBought = round(baseTokens * (1 - (swapFeeRate + slippageRate)), 12);
      
      const entryFeeSol = round(netSolForBuying * swapFeeRate, 8);
      const entrySlippageSol = round(netSolForBuying * slippageRate, 8);

      const targetTP = round(price * (1 + takeProfitPct / 100), 12);
      const targetSL = round(price * (1 - stopLossPct / 100), 12);

      const position = {
        id: `sim-${Date.now()}`, // Use timestamp for uniqueness across processes
        tokenAddress: mint,
        symbol: options.symbol || mint.slice(0, 6),
        entryPrice: round(price, 12),
        amountSol: round(sizeSol, 8),
        virtualTokensBought,
        takeProfitPct,
        stopLossPct,
        targetTP,
        targetSL,
        entryFeeSol,
        entrySlippageSol,
        entryNetworkFeeSol: NETWORK_FEE_SOL,
        currentPrice: round(price, 12),
        openedAt: new Date().toISOString(),
        status: "OPEN",
        metadata: options.metadata || null,
      };

      // Subtract balance
      const newBalance = round(this.balanceSol - sizeSol, 8);
      await dbManager.updatePaperBalance(newBalance);
      this.balanceSol = newBalance;

      // Save to SQLite
      await dbManager.saveOpenPosition('solana', position);

      console.log(
        `[SimulationEngine] BUY ${position.symbol} · ${position.amountSol} SOL @ ${position.entryPrice} · TP ${targetTP} (+${takeProfitPct}%) · SL ${targetSL} (-${stopLossPct}%)`,
      );

      return { ...position };
    } catch (err) {
      console.error("[SimulationEngine] Error in simulateBuy:", err.message);
      return null;
    }
  }

  async hasOpenPosition(tokenAddress) {
    const mint = String(tokenAddress || "").trim();
    try {
      const positions = await dbManager.getActivePositions('solana');
      return positions.some((p) => p.token_address === mint);
    } catch (err) {
      console.error("[SimulationEngine] Error in hasOpenPosition:", err.message);
      return false;
    }
  }

  /**
   * Perbarui harga & cek TP/SL otomatis.
   *
   * @param {Record<string, number>} uiPrices - { [tokenAddress]: currentPriceInSol } (Dari DexScreener/UI)
   * @returns {Promise<{ closed: object[], stillOpen: number }>}
   */
  async updatePricesAndCheckTriggers(uiPrices = {}) {
    const closedThisTick = [];
    let stillOpenCount = 0;

    try {
      const activePositions = await dbManager.getActivePositions('solana');
      if (activePositions.length === 0) return { closed: [], stillOpen: 0 };

      // JALUR EKSEKUSI: Ambil harga akurat Jupiter v2 untuk seluruh posisi aktif sekaligus
      const mints = [...new Set(activePositions.map(p => p.token_address))];
      const executionPrices = await getExecutionPriceBatch(mints);
      
      for (const posRow of activePositions) {
        // Map DB row to position object format
        const position = {
          id: posRow.id,
          tokenAddress: posRow.token_address,
          symbol: posRow.symbol,
          entryPrice: posRow.entry_price,
          amountSol: posRow.amount_sol,
          targetTP: posRow.target_tp,
          targetSL: posRow.target_sl,
          openedAt: posRow.opened_at,
          metadata: posRow.metadata ? JSON.parse(posRow.metadata) : null,
          virtualTokensBought: posRow.amount_sol / (posRow.entry_price || 0.000001)
        };

        // Prioritas: Jupiter (Execution) -> UI Map (DexScreener) -> Entry (Fallback)
        const currentPrice = executionPrices[position.tokenAddress] || uiPrices[position.tokenAddress] || position.entryPrice;

        if (!Number.isFinite(Number(currentPrice)) || Number(currentPrice) <= 0) {
          stillOpenCount++;
          continue;
        }

        const priceNum = round(Number(currentPrice), 12);
        
        // Update current price in DB using encapsulated method
        await dbManager.updatePositionPrice(position.id, priceNum).catch(() => {});

        if (priceNum >= position.targetTP) {
          const closed = await this.closePosition(position, priceNum, "TP");
          closedThisTick.push(closed);
          continue;
        }

        if (priceNum <= position.targetSL) {
          const closed = await this.closePosition(position, priceNum, "SL");
          closedThisTick.push(closed);
          continue;
        }

        stillOpenCount++;
      }
    } catch (err) {
      console.error("[SimulationEngine] Error in updatePricesAndCheckTriggers:", err.message);
    }

    return {
      closed: closedThisTick,
      stillOpen: stillOpenCount,
    };
  }

  async closePosition(position, exitPrice, trigger) {
    const exitPriceNum = round(exitPrice, 12);
    const pnlPct = position.entryPrice > 0 ? round(((exitPriceNum - position.entryPrice) / position.entryPrice) * 100, 2) : 0;

    try {
      // Use dbManager to handle logic (delete from positions, insert to trades, update balance)
      const result = await dbManager.closePosition('solana', position.id, exitPriceNum, pnlPct);
      
      // We need to match the closed object structure for recentEvents
      const closed = {
        ...position,
        status: "CLOSED",
        result: pnlPct >= 0 ? "PROFIT" : "LOSS",
        trigger,
        exitPrice: exitPriceNum,
        pnlPct,
        pnlSol: (position.amountSol * pnlPct) / 100,
        closedAt: new Date().toISOString(),
      };

      // Update trigger type in DB if it was TP/SL (dbManager defaults to MANUAL)
      if (trigger !== 'MANUAL') {
        await dbManager.updateTradeTrigger(position.id, trigger).catch(() => {});
      }

      console.log(`[${trigger} TRIGGERED] Token ${closed.symbol} | PnL: ${pnlPct}%`);

      return closed;
    } catch (err) {
      console.error('[SimulationEngine] Gagal close position SQLite:', err.message);
      return { ...position, status: "ERROR", trigger };
    }
  }

  /**
   * Tutup posisi manual (opsional, di luar TP/SL).
   */
  async forceClose(tokenAddress, currentPrice, reason = "MANUAL", positionId = null) {
    try {
      const active = await dbManager.getActivePositions('solana');
      const positionRow = active.find(p => (positionId && String(p.id) === String(positionId)) || p.token_address === tokenAddress);

      if (!positionRow) return null;

      const position = {
        id: positionRow.id,
        tokenAddress: positionRow.token_address,
        symbol: positionRow.symbol,
        entryPrice: positionRow.entry_price,
        amountSol: positionRow.amount_sol,
      };

      return await this.closePosition(position, currentPrice, reason);
    } catch (err) {
      console.error("[SimulationEngine] Error in forceClose:", err.message);
      return null;
    }
  }

  async getSimulationStats() {
    try {
      const stats = await dbManager.getPaperStats();
      const active = await dbManager.getActivePositions('solana');
      this.balanceSol = await dbManager.getPaperBalance();

      return {
        totalTrades: stats.totalTrades,
        profitTrades: stats.profitTrades,
        lossTrades: stats.lossTrades,
        winRate: round(stats.winRate, 1),
        netPnlSol: round(stats.netPnlSol, 8),
        totalInvestedSol: round(stats.totalInvestedSol, 8),
        avgPnlSol: round(stats.avgPnlSol || (stats.totalTrades > 0 ? stats.netPnlSol / stats.totalTrades : 0), 8),
        openPositions: active.length,
        balanceSol: round(this.balanceSol, 8),
        takeProfitPctDefault: this.defaultTakeProfitPct,
        stopLossPctDefault: this.defaultStopLossPct,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error("[SimulationEngine] Error in getSimulationStats:", err.message);
      return {};
    }
  }

  async getOpenPositions() {
    try {
      const rows = await dbManager.getActivePositions('solana');
      return rows.map(row => ({
        id: row.id,
        tokenAddress: row.token_address,
        symbol: row.symbol,
        entryPrice: row.entry_price,
        currentPrice: row.current_price,
        amountSol: row.amount_sol,
        targetTP: row.target_tp,
        targetSL: row.target_sl,
        openedAt: row.opened_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        virtualTokensBought: row.amount_sol / (row.entry_price || 0.000001)
      }));
    } catch (err) {
      console.error("[SimulationEngine] Error in getOpenPositions:", err.message);
      return [];
    }
  }

  async getTradeHistory() {
    try {
      const rows = await dbManager.getPaperTrades(100);
      return rows.map(row => ({
        id: row.id,
        tokenAddress: row.token_address,
        symbol: row.symbol,
        entryPrice: row.entry_price,
        exitPrice: row.exit_price,
        amountSol: row.amount_sol,
        pnlSol: row.pnl_sol,
        pnlPct: row.pnl_pct,
        trigger: row.trigger_type,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        result: row.pnl_sol >= 0 ? "PROFIT" : "LOSS"
      }));
    } catch (err) {
      console.error("[SimulationEngine] Error in getTradeHistory:", err.message);
      return [];
    }
  }

  reset() {
    // Dangerous, but keeping for interface compatibility. 
    // Should probably clear DB tables if really needed.
    console.warn("[SimulationEngine] reset() called. Use with caution as it does not clear DB.");
  }

  exportSnapshot() {
    return {
      nextPositionId: this.nextPositionId,
      defaultTakeProfitPct: this.defaultTakeProfitPct,
      defaultStopLossPct: this.defaultStopLossPct,
      balanceSol: this.balanceSol,
    };
  }

  loadSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    this.balanceSol = Number(snapshot.balanceSol ?? 10);
    if (Number.isFinite(snapshot.defaultTakeProfitPct)) {
      this.defaultTakeProfitPct = snapshot.defaultTakeProfitPct;
    }
    if (Number.isFinite(snapshot.defaultStopLossPct)) {
      this.defaultStopLossPct = snapshot.defaultStopLossPct;
    }
  }
}

module.exports = {
  SimulationEngine,
  round,
};
