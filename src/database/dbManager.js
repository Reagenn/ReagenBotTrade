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
    // Tabel App State (Generic JSON storage)
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

    // Tabel Monitor List (REFACTORED V2)
    await run(`CREATE TABLE IF NOT EXISTS monitor_list (
      token_address TEXT PRIMARY KEY,
      symbol TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT, -- Menampung info penemuan (DISCOVERY, BIRDEYE_VIP, dll)
      holders_data TEXT,
      smart_money_data TEXT,
      whale_data TEXT,
      pair_data TEXT,
      discovery_tier TEXT,
      score REAL,
      strategy_status TEXT, -- Menampung info strategi (WATCHING, BUY_ZONE, dll)
      rug_status TEXT,
      liq_status TEXT,
      smart_money_count INTEGER,
      whale_count INTEGER,
      insider_count INTEGER,
      price REAL,
      market_cap REAL,
      timeframe TEXT -- Menampung info akumulasi (Tgl & Jam)
    )`);

    // Migration: Update columns to reflect new schema (Institutional Grade Migration)
    try { 
      const cols = await query("PRAGMA table_info(monitor_list)");
      
      // 1. Rename status to strategy_status if strategy_status doesn't exist
      if (cols.some(c => c.name === 'status') && !cols.some(c => c.name === 'strategy_status')) {
        console.log("[DB] Migrating: Adding strategy_status column...");
        await run("ALTER TABLE monitor_list ADD COLUMN strategy_status TEXT");
        await run("UPDATE monitor_list SET strategy_status = status");
        
        // After shifting status data to strategy_status, we repurpose status to hold discovery info (old timeframe)
        if (cols.some(c => c.name === 'timeframe')) {
          console.log("[DB] Migrating: Moving timeframe data to status and resetting timeframe...");
          await run("UPDATE monitor_list SET status = timeframe");
          await run("UPDATE monitor_list SET timeframe = NULL");
        }
      }

      // Ensure all necessary columns exist
      const requiredCols = [
        { name: 'rug_status', type: 'TEXT' },
        { name: 'liq_status', type: 'TEXT' },
        { name: 'pair_data', type: 'TEXT' },
        { name: 'smart_money_count', type: 'INTEGER' },
        { name: 'whale_count', type: 'INTEGER' },
        { name: 'insider_count', type: 'INTEGER' },
        { name: 'price', type: 'REAL' },
        { name: 'market_cap', type: 'REAL' },
        { name: 'timeframe', type: 'TEXT' }
      ];

      for (const col of requiredCols) {
        if (!cols.some(c => c.name === col.name)) {
          console.log(`[DB] Migrating: Adding missing column '${col.name}' to monitor_list`);
          await run(`ALTER TABLE monitor_list ADD COLUMN ${col.name} ${col.type}`);
        }
      }
    } catch (migErr) {
      console.warn('[DB] Migrasi skema monitor_list (non-fatal):', migErr.message);
    }

    // Tabel Blacklisted Tokens
    await run(`CREATE TABLE IF NOT EXISTS blacklisted_tokens (
      token_address TEXT PRIMARY KEY,
      symbol TEXT,
      reason TEXT,
      blacklisted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Solana Paper Trades
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

    // Tabel Solana Paper Positions
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

    // Tabel Konfigurasi Bot
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

    // Tabel Statistik Bot
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

    // Tabel Telegram Sent Notifications
    await run(`CREATE TABLE IF NOT EXISTS sent_notifications (
      alert_key TEXT PRIMARY KEY,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Smart Wallets
    await run(`CREATE TABLE IF NOT EXISTS smart_wallets (
      wallet_address TEXT PRIMARY KEY,
      winrate REAL,
      total_pnl REAL,
      trade_count INTEGER,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel API Quota Tracker
    await run(`CREATE TABLE IF NOT EXISTS api_quota_tracker (
      date TEXT PRIMARY KEY,
      helius_used INTEGER DEFAULT 0,
      birdeye_used INTEGER DEFAULT 0
    )`);

    // Auto-insert default config & stats if not exist
    await run(`INSERT OR IGNORE INTO bot_config (id, buy_triggers, quote_unit) VALUES (1, '["fire", "alpha", "must_buy"]', 'SOL')`);
    await run(`INSERT OR IGNORE INTO bot_stats (id) VALUES (1)`);

    console.log('[DB] Seluruh tabel berhasil diverifikasi/dibuat.');
  } catch (err) {
    console.error('[DB] Gagal inisialisasi tabel:', err.message);
  }
}

const dbManager = {
  db,
  initDb,
  query,
  run,

  // Balance Management
  getPaperBalance: async () => {
    const row = await dbManager.getState("solana_paper_balance");
    if (!row) {
      const defaultBalance = 100.0;
      await dbManager.saveState("solana_paper_balance", { balance: defaultBalance });
      return defaultBalance;
    }
    return Number(row.balance);
  },

  updatePaperBalance: async (newBalance) => {
    return await dbManager.saveState("solana_paper_balance", { balance: Number(newBalance) });
  },

  // Paper Trading Methods
  savePaperPosition: async (pos) => {
    const existing = await query(`SELECT id FROM solana_paper_positions WHERE token_address = ? LIMIT 1`, [pos.tokenAddress]);
    if (existing && existing.length > 0) {
      throw new Error(`Duplicate open position for ${pos.symbol}`);
    }

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

  getActivePositions: async (type = 'solana') => {
    if (type === 'solana') {
      return query(`SELECT * FROM solana_paper_positions ORDER BY opened_at DESC`);
    }
    return [];
  },

  closePosition: async (type, id, finalPrice, pnlPercent, trigger = 'MANUAL') => {
    if (type === 'solana') {
      const positions = await query(`SELECT * FROM solana_paper_positions WHERE id = ?`, [id]);
      if (!positions || positions.length === 0) throw new Error("ID posisi tidak valid");
      const pos = positions[0];

      const pnlSol = (pos.amount_sol * pnlPercent) / 100;
      const closedAt = new Date().toISOString();
      const resultLabel = pnlPercent >= 0 ? "PROFIT" : "LOSS";

      await run(`DELETE FROM solana_paper_positions WHERE id = ?`, [id]);

      const sqlTrade = `INSERT INTO solana_paper_trades 
                       (id, token_address, symbol, entry_price, exit_price, amount_sol, pnl_sol, pnl_pct, result, trigger_type, opened_at, closed_at, total_fees_sol) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await run(sqlTrade, [
        pos.id, pos.token_address, pos.symbol, pos.entry_price, finalPrice, pos.amount_sol, pnlSol, pnlPercent, resultLabel, trigger, pos.opened_at, closedAt, 0
      ]);

      const currentBalance = await dbManager.getPaperBalance();
      await dbManager.updatePaperBalance(currentBalance + pos.amount_sol + pnlSol);

      if (trigger === 'SL' || trigger === 'STOP_LOSS') {
        await dbManager.blacklistToken(pos.token_address, pos.symbol, "Hit SL - Auto Blacklist").catch(() => {});
      }

      return { success: true };
    }
    return { success: false };
  },

  // Monitor List Methods
  addToMonitor: async (data) => {
    try {
      const tokenAddress = String(data.token_address || data.tokenAddress || "").trim();
      if (!tokenAddress) throw new Error("token_address is missing");

      if (await dbManager.isBlacklisted(tokenAddress)) return { changes: 0 };

      const symbol = String(data.symbol || "?").toUpperCase();
      const discoveryStatus = String(data.status || data.timeframe || "DISCOVERY");
      const strategyStatus = String(data.strategy_status || data.status || "WATCHING");
      
      // Default timeframe to accumulation string if not provided
      const now = new Date();
      const accumulationTimeframe = data.timeframe || `Akumulasi ${now.toLocaleDateString('id-ID')} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

      const price = parseFloat(data.price || (data.pair_data ? data.pair_data.priceUsd : 0)) || 0;
      const mcap = parseFloat(data.market_cap || (data.pair_data ? (data.pair_data.fdv || data.pair_data.marketCap) : 0)) || 0;

      const safeJson = (val) => val ? JSON.stringify(val) : null;

      const sql = `INSERT OR REPLACE INTO monitor_list 
                   (token_address, symbol, added_at, status, holders_data, smart_money_data, whale_data, pair_data, discovery_tier, score, strategy_status, rug_status, liq_status, smart_money_count, whale_count, insider_count, price, market_cap, timeframe) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      return await run(sql, [
        tokenAddress, symbol, data.added_at || new Date().toISOString(), discoveryStatus,
        safeJson(data.holders_data), safeJson(data.smart_money_data), safeJson(data.whale_data), safeJson(data.pair_data),
        data.discovery_tier || "NEW", data.score || 0, strategyStatus, data.rug_status || "PENDING", data.liq_status || "PENDING",
        data.smart_money_count || 0, data.whale_count || 0, data.insider_count || 0, price, mcap, accumulationTimeframe
      ]);
    } catch (error) {
      console.error(`[DB ERROR] addToMonitor fail:`, error.message);
      return { error: error.message, changes: 0 };
    }
  },

  addMonitorCoin: async (data) => {
    return dbManager.addToMonitor(data);
  },

  getMonitorList: async (limit = 100) => {
    return query(`
      SELECT m.* FROM monitor_list m
      LEFT JOIN blacklisted_tokens b ON m.token_address = b.token_address
      WHERE b.token_address IS NULL
      ORDER BY m.added_at DESC
      LIMIT ?
    `, [limit]);
  },

  updateMonitorAnalytics: async (mint, data) => {
    const fields = [];
    const params = [];
    const mapping = {
      holders_data: 'holders_data',
      smart_money_data: 'smart_money_data',
      whale_data: 'whale_data',
      discovery_tier: 'discovery_tier',
      score: 'score',
      strategy_status: 'strategy_status',
      status: 'status',
      rug_status: 'rug_status',
      liq_status: 'liq_status',
      smart_money_count: 'smart_money_count',
      whale_count: 'whale_count'
    };

    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) {
        fields.push(`${col} = ?`);
        params.push(typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key]);
      }
    }

    if (fields.length === 0) return { changes: 0 };
    params.push(mint);
    return run(`UPDATE monitor_list SET ${fields.join(', ')} WHERE token_address = ?`, params);
  },

  // Blacklist
  blacklistToken: async (tokenAddress, symbol, reason) => {
    await run(`INSERT OR REPLACE INTO blacklisted_tokens (token_address, symbol, reason) VALUES (?, ?, ?)`, [tokenAddress, symbol, reason]);
    await run(`DELETE FROM monitor_list WHERE token_address = ?`, [tokenAddress]);
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

  // Generic State
  saveState: async (key, value) => {
    return run(`INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, [key, JSON.stringify(value)]);
  },

  getState: async (key) => {
    const rows = await query(`SELECT value FROM app_state WHERE key = ?`, [key]);
    if (rows && rows.length > 0) {
      try { return JSON.parse(rows[0].value); } catch (e) { return null; }
    }
    return null;
  },

  // Telegram Dedup
  checkNotificationSent: async (key, windowMs) => {
    const rows = await query(`SELECT sent_at FROM sent_notifications WHERE alert_key = ?`, [key]);
    if (!rows || rows.length === 0) return null;
    const lastSent = new Date(rows[0].sent_at).getTime();
    return (Date.now() - lastSent < windowMs) ? lastSent : null;
  },

  markNotificationSent: async (key) => {
    return run(`INSERT OR REPLACE INTO sent_notifications (alert_key, sent_at) VALUES (?, CURRENT_TIMESTAMP)`, [key]);
  },

  // Others
  saveTokenSnapshot: async (data) => {
    return run(`INSERT INTO token_snapshots (timestamp, token_address, token_name, holders_count, price_usd, market_cap) VALUES (?, ?, ?, ?, ?, ?)`, 
      [data.timestamp || new Date().toISOString(), data.token_address, data.token_name, data.holders_count, data.price_usd, data.market_cap]);
  },

  addOrUpdateSmartWallet: async (data) => {
    return run(`INSERT OR REPLACE INTO smart_wallets (wallet_address, winrate, total_pnl, trade_count, last_updated) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`, 
      [data.address, data.winrate, data.pnl, data.trades]);
  },

  checkApiQuota: async (apiName) => {
    const today = new Date().toISOString().split('T')[0];
    const limits = { helius: 95000, birdeye: 2850 };
    const limit = limits[apiName.toLowerCase()];
    if (!limit) return true;
    const rows = await query(`SELECT ${apiName.toLowerCase()}_used as used FROM api_quota_tracker WHERE date = ?`, [today]);
    return !rows || rows.length === 0 || rows[0].used < limit;
  },

  incrementApiUsage: async (apiName) => {
    const today = new Date().toISOString().split('T')[0];
    const column = `${apiName.toLowerCase()}_used`;
    await run(`INSERT OR IGNORE INTO api_quota_tracker (date, helius_used, birdeye_used) VALUES (?, 0, 0)`, [today]);
    return run(`UPDATE api_quota_tracker SET ${column} = ${column} + 1 WHERE date = ?`, [today]);
  },

  removeDeadCoins: async () => {
    const sql = `DELETE FROM monitor_list WHERE symbol IN ('?', '-', '', NULL) OR price = 0 OR market_cap = 0 OR strategy_status = 'DEAD' OR liq_status = 'WEAK' OR rug_status IN ('HIGH', 'DANGER') OR datetime(added_at) < datetime('now', '-1 day')`;
    return run(sql);
  }
};

module.exports = dbManager;
