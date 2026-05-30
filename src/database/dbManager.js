/**
 * Database Manager - SQLite Implementation
 * Handles institutional-grade data persistence for trades and snapshots.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path ke file database lokal
const DB_DIR = path.resolve(__dirname, '../../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

const DB_PATH = path.join(DB_DIR, 'bot_data.db');

// Inisialisasi koneksi database
const db = new sqlite3.Database(DB_PATH, async (err) => {
  if (err) {
    console.error('[DB] FATAL: Gagal menyambung ke SQLite:', err.message);
  } else {
    console.log('[DB] Terhubung ke SQLite (data/bot_data.db)');
    // Auto-init tables
    await initDb();
  }
});

db.on('error', (err) => {
  console.error('[DB] Runtime Database Error:', err.message);
});

/**
 * Promise wrappers untuk query SQL
 */
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

/**
 * Inisialisasi Tabel (Auto-create)
 */
async function initDb() {
  try {
    // Tabel App State (Generic JSON storage) - Create this first as it is critical for state
    await run(`CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Trades
    await run(`CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      pair TEXT,
      type TEXT, -- BUY / SELL
      price REAL,
      amount REAL,
      pnl_usd REAL,
      pnl_percent REAL,
      trigger_type TEXT -- TP / SL / MANUAL / ENTRY
    )`);

    // Tabel Token Snapshots (History Chart)
    await run(`CREATE TABLE IF NOT EXISTS token_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      token_address TEXT,
      token_name TEXT,
      holders_count INTEGER,
      price_usd REAL,
      market_cap REAL
    )`);

    // Tabel Monitor List
    await run(`CREATE TABLE IF NOT EXISTS monitor_list (
      token_address TEXT PRIMARY KEY,
      symbol TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      timeframe TEXT,
      holders_data TEXT,
      smart_money_data TEXT,
      whale_data TEXT,
      pair_data TEXT,
      discovery_tier TEXT,
      score REAL,
      status TEXT,
      rug_status TEXT,
      liq_status TEXT,
      smart_money_count INTEGER,
      whale_count INTEGER,
      price REAL,
      market_cap REAL
    )`);

    // Migration: Add columns to monitor_list if they don't exist
    try { await run("ALTER TABLE monitor_list ADD COLUMN rug_status TEXT"); } catch(e) {}
    try { await run("ALTER TABLE monitor_list ADD COLUMN liq_status TEXT"); } catch(e) {}
    try { await run("ALTER TABLE monitor_list ADD COLUMN pair_data TEXT"); } catch(e) {}
    try { await run("ALTER TABLE monitor_list ADD COLUMN smart_money_count INTEGER"); } catch(e) {}
    try { await run("ALTER TABLE monitor_list ADD COLUMN whale_count INTEGER"); } catch(e) {}
    try { await run("ALTER TABLE monitor_list ADD COLUMN price REAL"); } catch(e) {}
    try { await run("ALTER TABLE monitor_list ADD COLUMN market_cap REAL"); } catch(e) {}


    // Tabel Blacklisted Tokens (NEW)
    await run(`CREATE TABLE IF NOT EXISTS blacklisted_tokens (
      token_address TEXT PRIMARY KEY,
      symbol TEXT,
      reason TEXT,
      blacklisted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // ... (rest of tables) ...

    // Tabel Solana Paper Trades (Dedicated)
    await run(`CREATE TABLE IF NOT EXISTS solana_paper_trades (
      id TEXT PRIMARY KEY,
      token_address TEXT,
      symbol TEXT,
      entry_price REAL,
      exit_price REAL,
      amount_sol REAL,
      pnl_sol REAL,
      pnl_pct REAL,
      result TEXT, -- PROFIT / LOSS
      trigger_type TEXT,
      opened_at DATETIME,
      closed_at DATETIME,
      total_fees_sol REAL
    )`);

    // Tabel Solana Paper Positions (Active)
    await run(`CREATE TABLE IF NOT EXISTS solana_paper_positions (
      id TEXT PRIMARY KEY,
      token_address TEXT,
      symbol TEXT,
      entry_price REAL,
      current_price REAL,
      amount_sol REAL,
      target_tp REAL,
      target_sl REAL,
      opened_at DATETIME,
      metadata TEXT
    )`);

    // Tabel CEX Paper Trades (Dedicated)
    await run(`CREATE TABLE IF NOT EXISTS cex_paper_trades (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      entry_price REAL,
      exit_price REAL,
      amount_usdt REAL,
      pnl_usd REAL,
      pnl_percent REAL,
      result TEXT, -- PROFIT / LOSS
      trigger_type TEXT,
      opened_at DATETIME,
      closed_at DATETIME
    )`);

    // Tabel CEX Paper Positions (Active)
    await run(`CREATE TABLE IF NOT EXISTS cex_paper_positions (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      entry_price REAL,
      current_price REAL,
      amount_usdt REAL,
      target_tp REAL,
      target_sl REAL,
      opened_at DATETIME,
      metadata TEXT
    )`);

    // Tabel Konfigurasi Bot (Hanya boleh ada 1 baris data)
    await run(`CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_enabled BOOLEAN DEFAULT 1,
      buy_amount_sol REAL DEFAULT 0.5,
      take_profit_pct REAL DEFAULT 20,
      stop_loss_pct REAL DEFAULT 20,
      buy_triggers TEXT,
      max_open_positions INTEGER DEFAULT 12,
      quote_unit TEXT,
      use_price_fetcher BOOLEAN DEFAULT 1,
      use_token_validator BOOLEAN DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Statistik Bot (Hanya boleh ada 1 baris data)
    await run(`CREATE TABLE IF NOT EXISTS bot_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_trades INTEGER DEFAULT 0,
      profit_trades INTEGER DEFAULT 0,
      loss_trades INTEGER DEFAULT 0,
      win_rate REAL DEFAULT 0,
      net_pnl_sol REAL DEFAULT 0,
      total_fees_sol REAL DEFAULT 0,
      total_invested_sol REAL DEFAULT 0,
      avg_pnl_sol REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Log Siklus/Event
    await run(`CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      event_type TEXT,
      event_message TEXT
    )`);

    // Task: Cleanup garbage tickers from previous cycles
    await run("DELETE FROM monitor_list WHERE symbol = '?' OR symbol = '-' OR symbol IS NULL OR symbol = ''");
    
    // STARTUP CLEANUP: Sweep away "Ghost Data" (Price=0, Pending status, etc.)
    console.log("[STARTUP] Menjalankan pembersihan data cacat dan koin mati...");
    const cleanupSql = `
      DELETE FROM monitor_list 
      WHERE symbol = '?' 
         OR symbol = '-' 
         OR symbol IS NULL 
         OR symbol = ''
         OR price = 0 
         OR price IS NULL
         OR market_cap = 0 
         OR market_cap IS NULL
         OR liq_status IS NULL 
         OR rug_status IS NULL 
         OR liq_status = 'PENDING'
         OR status = 'DEAD'
    `;
    try {
      const result = await run(cleanupSql);
      if (result.changes > 0) {
        console.log(`[GC] Berhasil menghapus ${result.changes} koin hantu/mati dari monitor_list.`);
      }
    } catch(e) {
      console.warn("[GC] Gagal menjalankan pembersihan otomatis:", e.message);
    }

    // Tabel Smart Wallets (High Performance Traders)
    await run(`CREATE TABLE IF NOT EXISTS smart_wallets (
      wallet_address TEXT PRIMARY KEY,
      winrate REAL,
      total_pnl REAL,
      trade_count INTEGER,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel API Quota Tracker (Daily Reset)
    await run(`CREATE TABLE IF NOT EXISTS api_quota_tracker (
      date TEXT PRIMARY KEY,
      helius_used INTEGER DEFAULT 0,
      birdeye_used INTEGER DEFAULT 0
    )`);

    // Auto-insert default config & stats if not exist
    await run(`INSERT OR IGNORE INTO bot_config (id, buy_triggers, quote_unit) VALUES (1, '["fire", "alpha", "must_buy"]', 'SOL')`);
    await run(`INSERT OR IGNORE INTO bot_stats (id) VALUES (1)`);

    console.log('[DB] Seluruh tabel berhasil diverifikasi/dibuat.');

    // MIGRATION: Ensure 'result' and 'metadata' columns exist for legacy tables
    try {
      const solanaCols = await query("PRAGMA table_info(solana_paper_trades)");
      if (!solanaCols.some(c => c.name === 'result')) {
        console.log("[DB] Migrating: Adding 'result' to solana_paper_trades");
        await run("ALTER TABLE solana_paper_trades ADD COLUMN result TEXT");
        await run("UPDATE solana_paper_trades SET result = 'PROFIT' WHERE pnl_sol >= 0");
        await run("UPDATE solana_paper_trades SET result = 'LOSS' WHERE pnl_sol < 0");
      }

      const cexCols = await query("PRAGMA table_info(cex_paper_trades)");
      if (!cexCols.some(c => c.name === 'result')) {
        console.log("[DB] Migrating: Adding 'result' to cex_paper_trades");
        await run("ALTER TABLE cex_paper_trades ADD COLUMN result TEXT");
        await run("UPDATE cex_paper_trades SET result = 'PROFIT' WHERE pnl_usd >= 0");
        await run("UPDATE cex_paper_trades SET result = 'LOSS' WHERE pnl_usd < 0");
      }

      const cexPosCols = await query("PRAGMA table_info(cex_paper_positions)");
      if (!cexPosCols.some(c => c.name === 'metadata')) {
        console.log("[DB] Migrating: Adding 'metadata' to cex_paper_positions");
        await run("ALTER TABLE cex_paper_positions ADD COLUMN metadata TEXT");
      }
      
      const monitorCols = await query("PRAGMA table_info(monitor_list)");
      const newCols = ['holders_data', 'smart_money_data', 'whale_data', 'discovery_tier', 'score', 'status', 'pair_data', 'rug_status', 'liq_status', 'smart_money_count', 'whale_count', 'price', 'market_cap'];
      for (const col of newCols) {
        if (!monitorCols.some(c => c.name === col)) {
          console.log(`[DB] Migrating: Adding '${col}' to monitor_list`);
          const isNumeric = ['score', 'price', 'market_cap', 'smart_money_count', 'whale_count'].includes(col);
          const type = isNumeric ? (col.endsWith('_count') ? 'INTEGER' : 'REAL') : 'TEXT';
          await run(`ALTER TABLE monitor_list ADD COLUMN ${col} ${type}`);
        }
      }
      
      console.log('[DB] Migrasi skema selesai.');
    } catch (migErr) {
      console.warn('[DB] Migrasi skema (non-fatal):', migErr.message);
    }
  } catch (err) {
    console.error('[DB] Gagal inisialisasi tabel:', err.message);
  }
}

// Ekspor fungsi CRUD
const dbManager = {
  db,
  initDb,
  query, 
  run, // Ekspor fungsi run untuk update/delete
  
  // Trades
  saveTrade: async (data) => {
    const sql = `INSERT INTO trades (timestamp, pair, type, price, amount, pnl_usd, pnl_percent, trigger_type) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    return run(sql, [
      data.timestamp || new Date().toISOString(),
      data.pair,
      data.type,
      data.price,
      data.amount,
      data.pnl_usd || 0,
      data.pnl_percent || 0,
      data.trigger_type
    ]);
  },
  
  getTradeHistory: async (limit = 50) => {
    return query(`SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`, [limit]);
  },

  // Unified Wrappers for Ghost Trade Fixes
  saveOpenPosition: async (type, data) => {
    if (type === 'solana') {
      return await dbManager.savePaperPosition(data);
    } else if (type === 'cex') {
      return await dbManager.saveCexPosition(data);
    }
    throw new Error('Unknown type for saveOpenPosition');
  },

  closePosition: async (type, id, finalPrice, pnlPercent, trigger = 'MANUAL') => {
    if (type === 'solana') {
      // 1. SELECT detail posisi
      const positions = await query(`SELECT * FROM solana_paper_positions WHERE id = ?`, [id]);
      if (!positions || positions.length === 0) {
        console.error(`[DB] closePosition: ID ${id} tidak ditemukan di solana_paper_positions`);
        throw new Error("ID posisi tidak valid");
      }
      const pos = positions[0];

      // 2. Hitung PnL nominal (SOL)
      const pnlSol = (pos.amount_sol * pnlPercent) / 100;
      const closedAt = new Date().toISOString();
      const resultLabel = pnlPercent >= 0 ? "PROFIT" : "LOSS";

      // 3. DELETE dari posisi aktif
      await run(`DELETE FROM solana_paper_positions WHERE id = ?`, [id]);

      // 4. INSERT ke riwayat trade
      const sqlTrade = `INSERT INTO solana_paper_trades 
                       (id, token_address, symbol, entry_price, exit_price, amount_sol, pnl_sol, pnl_pct, result, trigger_type, opened_at, closed_at, total_fees_sol) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await run(sqlTrade, [
        pos.id,
        pos.token_address,
        pos.symbol,
        pos.entry_price,
        finalPrice,
        pos.amount_sol,
        pnlSol,
        pnlPercent,
        resultLabel,
        trigger,
        pos.opened_at,
        closedAt,
        0 // fees manual close simplify
      ]);

      // 5. Update Saldo Wallet (Modal + PnL)
      const currentBalance = await dbManager.getPaperBalance();
      const refundAmount = pos.amount_sol + pnlSol;
      const newBalance = currentBalance + refundAmount;
      await dbManager.updatePaperBalance(newBalance);

      console.log(`[DB] Solana position ${id} closed. Refund: ${refundAmount.toFixed(4)} SOL. New Balance: ${newBalance.toFixed(4)}`);
      
      return { 
        success: true, 
        newBalance,
        closed: {
          id: pos.id,
          symbol: pos.symbol,
          pnlPct: pnlPercent,
          pnlSol: pnlSol,
          result: resultLabel
        }
      };
    } else if (type === 'cex') {
      // 1. SELECT detail posisi
      const positions = await query(`SELECT * FROM cex_paper_positions WHERE id = ?`, [id]);
      if (!positions || positions.length === 0) {
        console.error(`[DB] closePosition: ID ${id} tidak ditemukan di cex_paper_positions`);
        throw new Error("ID posisi tidak valid");
      }
      const pos = positions[0];

      // 2. Hitung PnL nominal (USDT)
      const pnlUsdt = (pos.amount_usdt * pnlPercent) / 100;
      const closedAt = new Date().toISOString();
      const resultLabel = pnlPercent >= 0 ? "PROFIT" : "LOSS";

      // 3. DELETE dari posisi aktif
      await run(`DELETE FROM cex_paper_positions WHERE id = ?`, [id]);

      // 4. INSERT ke riwayat trade
      const sqlTrade = `INSERT INTO cex_paper_trades 
                       (id, symbol, entry_price, exit_price, amount_usdt, pnl_usd, pnl_percent, result, trigger_type, opened_at, closed_at) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await run(sqlTrade, [
        pos.id,
        pos.symbol,
        pos.entry_price,
        finalPrice,
        pos.amount_usdt,
        pnlUsdt,
        pnlPercent,
        resultLabel,
        trigger,
        pos.opened_at,
        closedAt
      ]);

      // 5. Update Saldo Wallet (Modal + PnL)
      const currentBalance = await dbManager.getCexBalance();
      const refundAmount = pos.amount_usdt + pnlUsdt;
      const newBalance = currentBalance + refundAmount;
      await dbManager.updateCexBalance(newBalance);

      console.log(`[DB] CEX position ${id} closed. Refund: ${refundAmount.toFixed(2)} USDT. New Balance: ${newBalance.toFixed(2)}`);
      
      return { 
        success: true, 
        newBalance,
        closed: {
          id: pos.id,
          symbol: pos.symbol,
          pnlPct: pnlPercent,
          pnlUsdt: pnlUsdt,
          result: resultLabel
        }
      };
    }
    throw new Error('Unknown type for closePosition');
  },

  getActivePositions: async (type) => {
    if (type === 'solana') {
      return await dbManager.getPaperPositions();
    } else if (type === 'cex') {
      return await dbManager.getCexPositions();
    }
    throw new Error('Unknown type for getActivePositions');
  },

  // Balance Management
  getPaperBalance: async () => {
    const row = await dbManager.getState("solana_paper_balance");
    if (!row) {
      const defaultBalance = 100.0; // Modal Awal 100 SOL
      await dbManager.saveState("solana_paper_balance", { balance: defaultBalance });
      return defaultBalance;
    }
    return Number(row.balance);
  },

  updatePaperBalance: async (newBalance) => {
    return await dbManager.saveState("solana_paper_balance", { balance: Number(newBalance) });
  },

  getCexBalance: async () => {
    const row = await dbManager.getState("cex_paper_balance");
    if (!row) {
      const defaultBalance = 1000.0;
      await dbManager.saveState("cex_paper_balance", { balance: defaultBalance });
      return defaultBalance;
    }
    return Number(row.balance);
  },

  updateCexBalance: async (newBalance) => {
    return await dbManager.saveState("cex_paper_balance", { balance: Number(newBalance) });
  },

  // Solana Paper Specific
  savePaperTrade: async (trade) => {
    const resultLabel = trade.pnlPct >= 0 ? "PROFIT" : "LOSS";
    const sql = `INSERT OR REPLACE INTO solana_paper_trades 
                 (id, token_address, symbol, entry_price, exit_price, amount_sol, pnl_sol, pnl_pct, result, trigger_type, opened_at, closed_at, total_fees_sol) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return run(sql, [
      trade.id,
      trade.tokenAddress,
      trade.symbol,
      trade.entryPrice,
      trade.exitPrice,
      trade.amountSol,
      trade.pnlSol,
      trade.pnlPct,
      resultLabel,
      trade.trigger,
      trade.openedAt,
      trade.closedAt,
      trade.totalFeesSol
    ]);
  },

  getPaperTrades: async (limit = 50) => {
    return query(`SELECT * FROM solana_paper_trades ORDER BY closed_at DESC LIMIT ?`, [limit]);
  },

  getPaperStats: async () => {
    const rows = await query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'PROFIT' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(pnl_sol) as net_pnl,
        SUM(amount_sol) as total_invested
      FROM solana_paper_trades
    `);
    
    const stats = rows[0] || { total: 0, wins: 0, losses: 0, net_pnl: 0, total_invested: 0 };
    const total = stats.total || 0;
    const wins = stats.wins || 0;
    
    return {
      totalTrades: total,
      profitTrades: wins,
      lossTrades: stats.losses || 0,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      netPnlSol: stats.net_pnl ?? 0,
      totalInvestedSol: stats.total_invested ?? 0
    };
  },

  savePaperPosition: async (pos) => {
    const sql = `INSERT OR REPLACE INTO solana_paper_positions 
                 (id, token_address, symbol, entry_price, current_price, amount_sol, target_tp, target_sl, opened_at, metadata) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return run(sql, [
      pos.id,
      pos.tokenAddress,
      pos.symbol,
      pos.entryPrice,
      pos.currentPrice,
      pos.amountSol,
      pos.targetTP,
      pos.targetSL,
      pos.openedAt,
      JSON.stringify(pos.metadata)
    ]);
  },

  getPaperPositions: async () => {
    return query(`SELECT * FROM solana_paper_positions ORDER BY opened_at DESC`);
  },

  deletePaperPosition: async (id) => {
    return run(`DELETE FROM solana_paper_positions WHERE id = ?`, [id]);
  },

  clearPaperPositions: async () => {
    return run(`DELETE FROM solana_paper_positions`);
  },

  // CEX Paper Specific
  saveCexTrade: async (trade) => {
    const resultLabel = trade.pnlPct >= 0 ? "PROFIT" : "LOSS";
    const sql = `INSERT OR REPLACE INTO cex_paper_trades 
                 (id, symbol, entry_price, exit_price, amount_usdt, pnl_usd, pnl_percent, result, trigger_type, opened_at, closed_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return run(sql, [
      trade.id,
      trade.symbol,
      trade.entryPrice,
      trade.exitPrice,
      trade.amountUsdt,
      trade.pnlUsdt,
      trade.pnlPct,
      resultLabel,
      trade.trigger,
      trade.openedAt,
      trade.closedAt
    ]);
  },

  getCexTrades: async (limit = 50) => {
    return query(`SELECT * FROM cex_paper_trades ORDER BY closed_at DESC LIMIT ?`, [limit]);
  },

  getCexStats: async () => {
    const rows = await query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN result = 'PROFIT' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses,
        SUM(pnl_usd) as net_pnl,
        SUM(amount_usdt) as total_invested
      FROM cex_paper_trades
    `);
    
    const stats = rows[0] || { total: 0, wins: 0, losses: 0, net_pnl: 0, total_invested: 0 };
    const total = stats.total || 0;
    const wins = stats.wins || 0;
    
    return {
      totalTrades: total,
      profitTrades: wins,
      lossTrades: stats.losses || 0,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      netPnlUsdt: stats.net_pnl ?? 0,
      totalInvestedUsdt: stats.total_invested ?? 0
    };
  },

  saveCexPosition: async (pos) => {
    const sql = `INSERT OR REPLACE INTO cex_paper_positions 
                 (id, symbol, entry_price, current_price, amount_usdt, target_tp, target_sl, opened_at, metadata) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    return run(sql, [
      pos.id,
      pos.symbol,
      pos.entryPrice,
      pos.currentPrice,
      pos.amount_usdt || pos.amountUsdt,
      pos.target_tp || pos.targetTP,
      pos.target_sl || pos.targetSL,
      pos.openedAt,
      JSON.stringify(pos.metadata || pos.signalMeta || {})
    ]);
  },

  getCexPositions: async () => {
    return query(`SELECT * FROM cex_paper_positions ORDER BY opened_at DESC`);
  },

  deleteCexPosition: async (id) => {
    return run(`DELETE FROM cex_paper_positions WHERE id = ?`, [id]);
  },

  clearCexPositions: async () => {
    return run(`DELETE FROM cex_paper_positions`);
  },

  // Snapshots
  saveTokenSnapshot: async (data) => {
    const sql = `INSERT INTO token_snapshots (timestamp, token_address, token_name, holders_count, price_usd, market_cap) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    return run(sql, [
      data.timestamp || new Date().toISOString(),
      data.token_address,
      data.token_name,
      data.holders_count,
      data.price_usd,
      data.market_cap
    ]);
  },

  getTokenHistory: async (address, limit = 100) => {
    return query(`SELECT * FROM token_snapshots WHERE token_address = ? ORDER BY timestamp DESC LIMIT ?`, [address, limit]);
  },

  // Monitor List
  addToMonitor: async (data) => {
    try {
      // 1. Extreme Sanitation: prevent undefined/NaN/null crashes
      const tokenAddress = String(data.token_address || data.tokenAddress || "").trim();
      if (!tokenAddress) {
        throw new Error("token_address is missing or empty");
      }

      // Prevent adding if blacklisted
      const blacklisted = await dbManager.isBlacklisted(tokenAddress);
      if (blacklisted) {
        console.log(`[DB] Skip addToMonitor: ${data.symbol || tokenAddress} is blacklisted.`);
        return { changes: 0 };
      }

      const symbol = String(data.symbol || "?").toUpperCase();
      const timeframe = String(data.timeframe || "DISCOVERY");
      const discoveryTier = String(data.discovery_tier || data.discoveryTier || "NEW");
      const status = String(data.status || "WATCHING");
      const score = Number(data.score || 0) || 0;
      
      const rugStatus = String(data.rug_status || data.rugStatus || "PENDING");
      const liqStatus = String(data.liq_status || data.liqStatus || "PENDING");
      const smCount = parseInt(data.smart_money_count || data.smartMoneyCount || 0) || 0;
      const whaleCount = parseInt(data.whale_count || data.whaleCount || 0) || 0;

      // Flatten metrics
      const price = parseFloat(data.price || (data.pair_data ? data.pair_data.priceUsd : 0)) || 0;
      const mcap = parseFloat(data.market_cap || (data.pair_data ? (data.pair_data.fdv || data.pair_data.marketCap) : 0)) || 0;

      // JSON fields sanitation
      const safeJson = (val) => val ? JSON.stringify(val) : null;
      const holdersData = safeJson(data.holders_data || data.holdersData);
      const smData = safeJson(data.smart_money_data || data.smartMoneyData);
      const whaleData = safeJson(data.whale_data || data.whaleData);
      const pairData = safeJson(data.pair_data || data.pairData);

      const sql = `INSERT OR REPLACE INTO monitor_list 
                   (token_address, symbol, added_at, timeframe, holders_data, smart_money_data, whale_data, pair_data, discovery_tier, score, status, rug_status, liq_status, smart_money_count, whale_count, price, market_cap) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      const params = [
        tokenAddress,
        symbol,
        data.added_at || new Date().toISOString(),
        timeframe,
        holdersData,
        smData,
        whaleData,
        pairData,
        discoveryTier,
        score,
        status,
        rugStatus,
        liqStatus,
        smCount,
        whaleCount,
        price,
        mcap
      ];

      const result = await run(sql, params);
      
      if (result.changes > 0) {
        console.log(`[DB SUCCESS] ✅ Koin ${symbol} (${tokenAddress.slice(0, 8)}...) resmi tersimpan di database!`);
      }
      return result;

    } catch (error) {
      console.error(`[DB ERROR EXTREME] Gagal insert ${data.token_address || "UNKNOWN"}. Alasan:`, error.message);
      return { error: error.message, changes: 0 };
    }
  },

  // Alias for user instruction consistency
  addMonitorCoin: async (data) => {
    return dbManager.addToMonitor(data);
  },

  removeDeadCoins: async () => {
    console.log("[GARBAGE COLLECTOR] 🧹 Menjalankan pembersihan database...");
    const sql = `
      DELETE FROM monitor_list 
      WHERE symbol = '?' 
         OR symbol = '-' 
         OR symbol IS NULL 
         OR symbol = ''
         OR price = 0 
         OR price IS NULL
         OR market_cap = 0 
         OR market_cap IS NULL
         OR liq_status IS NULL 
         OR rug_status IS NULL 
         OR liq_status = 'PENDING'
         OR status = 'DEAD'
         OR rug_status IN ('HIGH', 'DANGER')
         OR datetime(added_at) < datetime('now', '-1 day')
    `;
    try {
      const result = await run(sql);
      if (result.changes > 0) {
        console.log(`[GARBAGE COLLECTOR] 🧹 Membuang ${result.changes} koin basi/mati dari database agar sistem tetap fresh!`);
      }
      return result;
    } catch(e) {
      console.warn("[GARBAGE COLLECTOR] Gagal menjalankan pembersihan:", e.message);
      return { changes: 0 };
    }
  },

  updateMonitorAnalytics: async (mint, data) => {
    const fields = [];
    const params = [];
    
    if (data.holders_data) {
      fields.push("holders_data = ?");
      params.push(JSON.stringify(data.holders_data));
    }
    if (data.smart_money_data) {
      fields.push("smart_money_data = ?");
      params.push(JSON.stringify(data.smart_money_data));
    }
    if (data.whale_data) {
      fields.push("whale_data = ?");
      params.push(JSON.stringify(data.whale_data));
    }
    if (data.discovery_tier) {
      fields.push("discovery_tier = ?");
      params.push(data.discovery_tier);
    }
    if (data.score != null) {
      fields.push("score = ?");
      params.push(data.score);
    }
    if (data.status) {
      fields.push("status = ?");
      params.push(data.status);
    }
    if (data.rug_status) {
      fields.push("rug_status = ?");
      params.push(data.rug_status);
    }
    if (data.liq_status) {
      fields.push("liq_status = ?");
      params.push(data.liq_status);
    }
    if (data.smart_money_count != null) {
      fields.push("smart_money_count = ?");
      params.push(data.smart_money_count);
    }
    if (data.whale_count != null) {
      fields.push("whale_count = ?");
      params.push(data.whale_count);
    }

    if (fields.length === 0) return { changes: 0 };

    params.push(mint);
    return run(`UPDATE monitor_list SET ${fields.join(', ')} WHERE token_address = ?`, params);
  },

  deleteFromMonitorList: async (tokenAddress) => {
    return run(`DELETE FROM monitor_list WHERE token_address = ?`, [tokenAddress]);
  },

  blacklistToken: async (tokenAddress, symbol, reason) => {
    // 1. Add to blacklist table
    const sql = `INSERT OR REPLACE INTO blacklisted_tokens (token_address, symbol, reason) VALUES (?, ?, ?)`;
    await run(sql, [tokenAddress, symbol, reason]);

    // 2. Remove from monitor list automatically
    await dbManager.deleteFromMonitorList(tokenAddress);
    
    console.warn(`[BLACKLIST] Token ${symbol || tokenAddress} blacklisted. Reason: ${reason}`);
    return { success: true };
  },

  isBlacklisted: async (tokenAddress) => {
    const rows = await query(`SELECT 1 FROM blacklisted_tokens WHERE token_address = ?`, [tokenAddress]);
    return rows && rows.length > 0;
  },

  isCoinInMonitorList: async (tokenAddress) => {
    const rows = await query(`SELECT 1 FROM monitor_list WHERE token_address = ?`, [tokenAddress]);
    return rows && rows.length > 0;
  },

  // Smart Wallets
  addOrUpdateSmartWallet: async (data) => {
    const sql = `INSERT OR REPLACE INTO smart_wallets (wallet_address, winrate, total_pnl, trade_count, last_updated) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    return run(sql, [data.address, data.winrate, data.pnl, data.trades]);
  },

  getMonitorList: async (limit = 100) => {
    // Return monitored tokens that are NOT blacklisted
    return query(`
      SELECT m.* FROM monitor_list m
      LEFT JOIN blacklisted_tokens b ON m.token_address = b.token_address
      WHERE b.token_address IS NULL
      ORDER BY m.added_at DESC
      LIMIT ?
    `, [limit]);
  },

  // App State (Generic)
  saveState: async (key, value) => {
    const sql = `INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
    return run(sql, [key, JSON.stringify(value)]);
  },

  getState: async (key) => {
    const rows = await query(`SELECT value FROM app_state WHERE key = ?`, [key]);
    if (rows && rows.length > 0) {
      try {
        return JSON.parse(rows[0].value);
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  // Watchlist (Specific State Wrapper)
  getWatchlist: async () => {
    return await dbManager.getState("solana_watchlist") || { smartWallets: [], tokens: [] };
  },

  saveWatchlist: async (watchlist) => {
    return await dbManager.saveState("solana_watchlist", watchlist);
  },

  // Bot Config & Stats (New Structured Tables)
  getBotConfig: async () => {
    const rows = await query(`SELECT * FROM bot_config WHERE id = 1`);
    if (rows && rows.length > 0) {
      const cfg = rows[0];
      return {
        ...cfg,
        is_enabled: !!cfg.is_enabled,
        use_price_fetcher: !!cfg.use_price_fetcher,
        use_token_validator: !!cfg.use_token_validator,
        buy_triggers: JSON.parse(cfg.buy_triggers || '[]')
      };
    }
    return null;
  },

  updateBotConfig: async (data) => {
    const fields = [];
    const params = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = ?`);
      params.push(key === 'buy_triggers' ? JSON.stringify(value) : value);
    }
    params.push(1); // id = 1
    return run(`UPDATE bot_config SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
  },

  getBotStats: async () => {
    const rows = await query(`SELECT * FROM bot_stats WHERE id = 1`);
    return rows && rows.length > 0 ? rows[0] : null;
  },

  updateBotStats: async (data) => {
    const fields = [];
    const params = [];
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      fields.push(`${key} = ?`);
      params.push(value);
    }
    params.push(1); // id = 1
    return run(`UPDATE bot_stats SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
  },

  addSystemLog: async (type, message) => {
    return run(`INSERT INTO system_logs (event_type, event_message) VALUES (?, ?)`, [type, message]);
  },

  getRecentLogs: async (limit = 20) => {
    return query(`SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT ?`, [limit]);
  },

  // Update specific fields (Encapsulation for SimulationEngine)
  updatePositionPrice: async (id, currentPrice) => {
    return run(`UPDATE solana_paper_positions SET current_price = ? WHERE id = ?`, [currentPrice, id]);
  },

  updateTradeTrigger: async (id, triggerType) => {
    return run(`UPDATE solana_paper_trades SET trigger_type = ? WHERE id = ?`, [triggerType, id]);
  },

  // API Quota Manager
  checkApiQuota: async (apiName) => {
    const today = new Date().toISOString().split('T')[0];
    const limits = {
      helius: 95000,
      birdeye: 2850
    };
    
    const limit = limits[apiName.toLowerCase()];
    if (!limit) return true;

    const rows = await query(`SELECT ${apiName.toLowerCase()}_used as used FROM api_quota_tracker WHERE date = ?`, [today]);
    if (!rows || rows.length === 0) {
      return true;
    }

    return rows[0].used < limit;
  },

  incrementApiUsage: async (apiName) => {
    const today = new Date().toISOString().split('T')[0];
    const column = `${apiName.toLowerCase()}_used`;
    
    await run(`INSERT OR IGNORE INTO api_quota_tracker (date, helius_used, birdeye_used) VALUES (?, 0, 0)`, [today]);
    
    return run(`UPDATE api_quota_tracker SET ${column} = ${column} + 1 WHERE date = ?`, [today]);
  }
};

module.exports = dbManager;
