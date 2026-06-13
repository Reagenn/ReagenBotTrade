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
    // Tabel App State
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
      trigger_type TEXT
    )`);

    // Tabel Token Snapshots
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
      status TEXT,
      holders_data TEXT,
      smart_money_data TEXT,
      whale_data TEXT,
      pair_data TEXT,
      discovery_tier TEXT,
      score REAL,
      strategy_status TEXT,
      rug_status TEXT,
      liq_status TEXT,
      smart_money_count INTEGER,
      whale_count INTEGER,
      insider_count INTEGER,
      price REAL,
      market_cap REAL,
      timeframe TEXT,
      initial_price REAL,
      ath_price REAL
    )`);

    // Migration for monitor_list
    try {
      const cols = await query("PRAGMA table_info(monitor_list)");
      if (cols.some(c => c.name === 'status') && !cols.some(c => c.name === 'strategy_status')) {
        await run("ALTER TABLE monitor_list ADD COLUMN strategy_status TEXT");
        await run("UPDATE monitor_list SET strategy_status = status");
        if (cols.some(c => c.name === 'timeframe')) {
          await run("UPDATE monitor_list SET status = timeframe");
          await run("UPDATE monitor_list SET timeframe = NULL");
        }
      }
      const required = ['rug_status', 'liq_status', 'pair_data', 'smart_money_count', 'whale_count', 'insider_count', 'price', 'market_cap', 'timeframe', 'initial_price', 'ath_price'];
      for (const col of required) {
        if (!cols.some(c => c.name === col)) {
          await run(`ALTER TABLE monitor_list ADD COLUMN ${col} ${col.includes('count') || col.includes('price') || col.includes('cap') || col === 'ath_price' ? 'REAL' : 'TEXT'}`);
        }
      }
    } catch (e) { console.error("[DB] Monitor migration error:", e.message); }

    // Tabel Blacklist
    await run(`CREATE TABLE IF NOT EXISTS blacklisted_tokens (
      token_address TEXT PRIMARY KEY,
      symbol TEXT,
      reason TEXT,
      blacklisted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Paper Trading (Solana)
    await run(`CREATE TABLE IF NOT EXISTS solana_paper_trades (
      id TEXT PRIMARY KEY,
      token_address TEXT, symbol TEXT, entry_price REAL, exit_price REAL, amount_sol REAL, pnl_sol REAL, pnl_pct REAL, result TEXT, trigger_type TEXT, opened_at DATETIME, closed_at DATETIME, target_tp REAL, target_sl REAL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS solana_paper_positions (
      id TEXT PRIMARY KEY, token_address TEXT, symbol TEXT, entry_price REAL, current_price REAL, amount_sol REAL, target_tp REAL, target_sl REAL, opened_at DATETIME, metadata TEXT, is_hold INTEGER DEFAULT 0
    )`);

    // Migration for solana_paper_positions
    try {
      const paperCols = await query("PRAGMA table_info(solana_paper_positions)");
      if (!paperCols.some(c => c.name === 'is_hold')) {
        await run("ALTER TABLE solana_paper_positions ADD COLUMN is_hold INTEGER DEFAULT 0");
      }
    } catch (e) { console.error("[DB] Paper positions migration error:", e.message); }

    // Migration for solana_paper_trades
    try {
      const solHistoryCols = await query("PRAGMA table_info(solana_paper_trades)");
      if (!solHistoryCols.some(c => c.name === 'target_tp')) {
        await run("ALTER TABLE solana_paper_trades ADD COLUMN target_tp REAL");
      }
      if (!solHistoryCols.some(c => c.name === 'target_sl')) {
        await run("ALTER TABLE solana_paper_trades ADD COLUMN target_sl REAL");
      }
    } catch (e) { console.error("[DB] Solana history migration error:", e.message); }

    // Tabel Paper Trading (CEX)
    await run(`CREATE TABLE IF NOT EXISTS cex_paper_positions (
      id TEXT PRIMARY KEY, symbol TEXT, entry_price REAL, current_price REAL, amount_usdt REAL, amount_token REAL, target_tp REAL, target_sl REAL, opened_at DATETIME, metadata TEXT
    )`);
    await run(`CREATE TABLE IF NOT EXISTS cex_paper_trades (
      id TEXT PRIMARY KEY, symbol TEXT, entry_price REAL, exit_price REAL, amount_usdt REAL, amount_token REAL, pnl_usd REAL, pnl_percent REAL, result TEXT, trigger_type TEXT, opened_at DATETIME, closed_at DATETIME, target_tp REAL, target_sl REAL
    )`);

    // Migration for cex_paper_trades
    try {
      const cexHistoryCols = await query("PRAGMA table_info(cex_paper_trades)");
      if (!cexHistoryCols.some(c => c.name === 'target_tp')) {
        await run("ALTER TABLE cex_paper_trades ADD COLUMN target_tp REAL");
      }
      if (!cexHistoryCols.some(c => c.name === 'target_sl')) {
        await run("ALTER TABLE cex_paper_trades ADD COLUMN target_sl REAL");
      }
    } catch (e) { console.error("[DB] CEX history migration error:", e.message); }

    // Tabel Statistik Bot (RECONSTRUCTED)
    await run(`CREATE TABLE IF NOT EXISTS bot_stats (
      id INTEGER PRIMARY KEY,
      total_trades INTEGER NOT NULL DEFAULT 0,
      profit_trades INTEGER NOT NULL DEFAULT 0,
      loss_trades INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      net_pnl_sol REAL NOT NULL DEFAULT 0,
      net_pnl_usdt REAL NOT NULL DEFAULT 0,
      total_fees_sol REAL NOT NULL DEFAULT 0,
      total_invested_sol REAL NOT NULL DEFAULT 0,
      avg_pnl_sol REAL NOT NULL DEFAULT 0,
      active_positions INTEGER NOT NULL DEFAULT 0,
      max_open_positions INTEGER NOT NULL DEFAULT 12,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Force remove restrictive constraint if it still exists from old schema
    try {
        const createSql = (await query("SELECT sql FROM sqlite_master WHERE name='bot_stats'"))[0].sql;
        // Check if all essential columns are NOT NULL
        const isSafe = createSql.includes("total_fees_sol REAL NOT NULL") && 
                       createSql.includes("avg_pnl_sol REAL NOT NULL") &&
                       !createSql.includes("CHECK (id = 1)");

        if (!isSafe) {
            console.log("[DB] Migrating bot_stats: Enforcing NOT NULL on all columns...");
            await run("ALTER TABLE bot_stats RENAME TO bot_stats_old");
            await run(`CREATE TABLE bot_stats (
                id INTEGER PRIMARY KEY,
                total_trades INTEGER NOT NULL DEFAULT 0,
                profit_trades INTEGER NOT NULL DEFAULT 0,
                loss_trades INTEGER NOT NULL DEFAULT 0,
                win_rate REAL NOT NULL DEFAULT 0,
                net_pnl_sol REAL NOT NULL DEFAULT 0,
                net_pnl_usdt REAL NOT NULL DEFAULT 0,
                total_fees_sol REAL NOT NULL DEFAULT 0,
                total_invested_sol REAL NOT NULL DEFAULT 0,
                avg_pnl_sol REAL NOT NULL DEFAULT 0,
                active_positions INTEGER NOT NULL DEFAULT 0,
                max_open_positions INTEGER NOT NULL DEFAULT 12,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            // Map columns explicitly to avoid issues with different column counts and NULLs
            const cols = (await query("PRAGMA table_info(bot_stats_old)")).map(c => c.name);
            const targetCols = ['id', 'total_trades', 'profit_trades', 'loss_trades', 'win_rate', 'net_pnl_sol', 'net_pnl_usdt', 'total_fees_sol', 'total_invested_sol', 'avg_pnl_sol', 'active_positions', 'max_open_positions'];
            const commonCols = targetCols.filter(c => cols.includes(c));
            
            if (commonCols.length > 0) {
                const selectPart = commonCols.map(c => {
                    if (c === 'id') return c;
                    if (c === 'max_open_positions') return `COALESCE(${c}, 12)`;
                    return `COALESCE(${c}, 0)`;
                }).join(', ');
                await run(`INSERT INTO bot_stats (${commonCols.join(', ')}) SELECT ${selectPart} FROM bot_stats_old`);
            }
            await run("DROP TABLE bot_stats_old");
        }
    } catch(e) { console.error("[DB] bot_stats migration error:", e.message); }

    // Tabel Bot Config (RECONSTRUCTED)
    await run(`CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY,
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

    // Tabel Users (RBAC)
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'GUEST',
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    try {
        const configSql = (await query("SELECT sql FROM sqlite_master WHERE name='bot_config'"))[0].sql;
        if (configSql.includes("CHECK (id = 1)")) {
            console.log("[DB] Migrating bot_config: Removing restrictive ID check...");
            await run("ALTER TABLE bot_config RENAME TO bot_config_old");
            await run(`CREATE TABLE bot_config (
                id INTEGER PRIMARY KEY,
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
            await run("INSERT INTO bot_config (id, is_enabled, buy_amount_sol, take_profit_pct, stop_loss_pct, buy_triggers, max_open_positions, updated_at) SELECT id, is_enabled, buy_amount_sol, take_profit_pct, stop_loss_pct, buy_triggers, max_open_positions, updated_at FROM bot_config_old");
            await run("DROP TABLE bot_config_old");
        }
    } catch(e) {}

    // Tabel Telegram
    await run(`CREATE TABLE IF NOT EXISTS sent_notifications (
      alert_key TEXT PRIMARY KEY,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel Smart Wallets
    await run(`CREATE TABLE IF NOT EXISTS smart_wallets (
      wallet_address TEXT PRIMARY KEY, winrate REAL, total_pnl REAL, trade_count INTEGER, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabel API Quota
    await run(`CREATE TABLE IF NOT EXISTS api_quota_tracker (
      date TEXT PRIMARY KEY, helius_used INTEGER DEFAULT 0, birdeye_used INTEGER DEFAULT 0
    )`);

    // Tabel Tracked Wallets
    await run(`CREATE TABLE IF NOT EXISTS tracked_wallets (
      wallet_id TEXT PRIMARY KEY,
      type TEXT, -- DEX / CEX
      network TEXT, -- solana, base, bsc, bybit, bitget
      alias TEXT,
      tags TEXT, -- JSON
      latest_token_bought TEXT,
      profit_7d REAL DEFAULT 0,
      roi_7d REAL DEFAULT 0,
      profit_30d REAL DEFAULT 0,
      roi_30d REAL DEFAULT 0,
      avg_invested REAL DEFAULT 0,
      win_rate REAL DEFAULT 0,
      activity TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration for tracked_wallets
    try {
      const trackedCols = await query("PRAGMA table_info(tracked_wallets)");
      if (!trackedCols.some(c => c.name === 'latest_token_bought')) {
        await run("ALTER TABLE tracked_wallets ADD COLUMN latest_token_bought TEXT");
      }
    } catch (e) { console.error("[DB] Tracked wallets migration error:", e.message); }

    // Tabel Tracked Wallet History
    await run(`CREATE TABLE IF NOT EXISTS tracked_wallet_history (
      wallet_id TEXT,
      date TEXT, -- YYYY-MM-DD
      profit REAL DEFAULT 0,
      PRIMARY KEY (wallet_id, date)
    )`);

    await run(`INSERT OR IGNORE INTO bot_stats (id) VALUES (1)`);

    await run(`INSERT OR IGNORE INTO bot_stats (id) VALUES (2)`);
    await run(`INSERT OR IGNORE INTO bot_config (id, buy_triggers) VALUES (1, '["fire", "alpha"]')`);

    console.log('[DB] Seluruh tabel berhasil diverifikasi/dibuat.');
  } catch (err) {
    console.error('[DB] Gagal inisialisasi tabel:', err.message);
  }
}

const dbManager = {
  db, initDb, query, run,

  // Balances
  getPaperBalance: async () => {
    const row = await dbManager.getState("solana_paper_balance");
    return row ? Number(row.balance) : 100.0;
  },
  updatePaperBalance: async (val) => { return dbManager.saveState("solana_paper_balance", { balance: Number(val) }); },
  getCexBalance: async () => {
    const row = await dbManager.getState("cex_paper_balance");
    return row ? Number(row.balance) : 1000.0;
  },
  updateCexBalance: async (val) => { return dbManager.saveState("cex_paper_balance", { balance: Number(val) }); },

  // Positions
  saveOpenPosition: async (type, pos) => {
    if (type === 'solana') {
      return run(`INSERT OR REPLACE INTO solana_paper_positions (id, token_address, symbol, entry_price, current_price, amount_sol, target_tp, target_sl, opened_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pos.id, pos.tokenAddress, pos.symbol, pos.entryPrice, pos.currentPrice, pos.amountSol, pos.targetTP, pos.targetSL, pos.openedAt, JSON.stringify(pos.metadata)]);
    }
    if (type === 'cex') {
      return run(`INSERT OR REPLACE INTO cex_paper_positions (id, symbol, entry_price, current_price, amount_usdt, amount_token, target_tp, target_sl, opened_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pos.id, pos.symbol, pos.entryPrice, pos.currentPrice, pos.amountUsdt, pos.amountToken, pos.targetTP, pos.targetSL, pos.openedAt, JSON.stringify(pos.metadata)]);
    }
  },
  getActivePositions: async (type = 'solana') => {
    return query(`SELECT * FROM ${type === 'solana' ? 'solana_paper_positions' : 'cex_paper_positions'} ORDER BY opened_at DESC`);
  },
  closePosition: async (type, id, price, pnlPct, trigger = 'MANUAL') => {
    const pos = (await query(`SELECT * FROM ${type === 'solana' ? 'solana_paper_positions' : 'cex_paper_positions'} WHERE id = ?`, [id]))[0];
    if (!pos) throw new Error("Posisi tidak ditemukan");
    
    await run(`DELETE FROM ${type === 'solana' ? 'solana_paper_positions' : 'cex_paper_positions'} WHERE id = ?`, [id]);
    
    const now = new Date().toISOString();
    if (type === 'solana') {
      const pnlSol = (pos.amount_sol * pnlPct) / 100;
      await run(`INSERT INTO solana_paper_trades (id, token_address, symbol, entry_price, exit_price, amount_sol, pnl_sol, pnl_pct, result, trigger_type, opened_at, closed_at, target_tp, target_sl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pos.id, pos.token_address, pos.symbol, pos.entry_price, price, pos.amount_sol, pnlSol, pnlPct, pnlPct >= 0 ? "PROFIT" : "LOSS", trigger, pos.opened_at, now, pos.target_tp, pos.target_sl]);
      
      const current = await dbManager.getPaperBalance();
      await dbManager.updatePaperBalance(current + pos.amount_sol + pnlSol);
      
      // Update Stats Solana
      await dbManager.syncPaperStats('solana');
    } else {
      const pnlUsdt = (pos.amount_usdt * pnlPct) / 100;
      await run(`INSERT INTO cex_paper_trades (id, symbol, entry_price, exit_price, amount_usdt, amount_token, pnl_usd, pnl_percent, result, trigger_type, opened_at, closed_at, target_tp, target_sl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [pos.id, pos.symbol, pos.entry_price, price, pos.amount_usdt, pos.amount_token, pnlUsdt, pnlPct, pnlPct >= 0 ? "PROFIT" : "LOSS", trigger, pos.opened_at, now, pos.target_tp, pos.target_sl]);
      
      const current = await dbManager.getCexBalance();
      await dbManager.updateCexBalance(current + pos.amount_usdt + pnlUsdt);
      
      // Update Stats CEX
      await dbManager.syncPaperStats('cex');
    }
    return { success: true };
  },

  syncPaperStats: async (type = 'solana') => {
    try {
      const table = type === 'solana' ? 'solana_paper_trades' : 'cex_paper_trades';
      const id = type === 'solana' ? 1 : 2;
      const pnlCol = type === 'solana' ? 'pnl_sol' : 'pnl_usd';
      const amountCol = type === 'solana' ? 'amount_sol' : 'amount_usdt';

      const trades = await query(`SELECT result, ${pnlCol} as pnl, ${amountCol} as amount FROM ${table}`);
      if (!trades.length) return;

      const total = trades.length;
      const profit = trades.filter(t => t.result === 'PROFIT').length;
      const loss = total - profit;
      const winRate = (profit / total) * 100;
      const netPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      const totalInvested = trades.reduce((sum, t) => sum + (t.amount || 0), 0);
      const avgPnl = total > 0 ? netPnl / total : 0;

      if (type === 'solana') {
        await dbManager.updateBotStats({
          total_trades: total,
          profit_trades: profit,
          loss_trades: loss,
          win_rate: winRate,
          net_pnl_sol: netPnl,
          total_invested_sol: totalInvested,
          avg_pnl_sol: avgPnl
        }, 1);
      } else {
        await dbManager.updateBotStats({
          total_trades: total,
          profit_trades: profit,
          loss_trades: loss,
          win_rate: winRate,
          net_pnl_usdt: netPnl
        }, 2);
      }
      
      console.log(`[DB] Stats synced for ${type.toUpperCase()}: ${profit}W / ${loss}L (${winRate.toFixed(1)}%)`);
    } catch (err) {
      console.error(`[DB] Sync stats error (${type}):`, err.message);
    }
  },
  updatePositionPrice: async (id, price) => {
    await run(`UPDATE solana_paper_positions SET current_price = ? WHERE id = ?`, [price, id]).catch(() => {});
    return run(`UPDATE cex_paper_positions SET current_price = ? WHERE id = ?`, [price, id]).catch(() => {});
  },
  updatePositionHold: async (id, isHold) => {
    const holdVal = isHold ? 1 : 0;
    await run(`UPDATE solana_paper_positions SET is_hold = ? WHERE id = ?`, [holdVal, id]).catch(() => {});
    return run(`UPDATE cex_paper_positions SET is_hold = ? WHERE id = ?`, [holdVal, id]).catch(() => {});
  },
  updatePositionTargets: async (id, tp, sl) => {
    await run(`UPDATE solana_paper_positions SET target_tp = ?, target_sl = ? WHERE id = ?`, [tp, sl, id]).catch(() => {});
    return run(`UPDATE cex_paper_positions SET target_tp = ?, target_sl = ? WHERE id = ?`, [tp, sl, id]).catch(() => {});
  },
  updateTradeTrigger: async (id, trigger) => {
    await run(`UPDATE solana_paper_trades SET trigger_type = ? WHERE id = ?`, [trigger, id]).catch(() => {});
    return run(`UPDATE cex_paper_trades SET trigger_type = ? WHERE id = ?`, [trigger, id]).catch(() => {});
  },

  // Stats & Config
  getPaperTrades: async (limit = 50) => { return query(`SELECT * FROM solana_paper_trades ORDER BY closed_at DESC LIMIT ?`, [limit]); },
  getCexTrades: async (limit = 50) => { return query(`SELECT * FROM cex_paper_trades ORDER BY closed_at DESC LIMIT ?`, [limit]); },
  getPaperStats: async () => { return (await query(`SELECT * FROM bot_stats WHERE id = 1`))[0] || null; },
  getCexStats: async () => { return (await query(`SELECT * FROM bot_stats WHERE id = 2`))[0] || null; },
  getBotStats: async () => { return dbManager.getPaperStats(); },
  updateBotStats: async (s, id = 1) => {
    const fields = [];
    const params = [];
    
    const isValid = (val) => val !== undefined && val !== null && !Number.isNaN(val);
    
    if (isValid(s.total_trades)) { fields.push("total_trades = ?"); params.push(s.total_trades); }
    if (isValid(s.profit_trades)) { fields.push("profit_trades = ?"); params.push(s.profit_trades); }
    if (isValid(s.loss_trades)) { fields.push("loss_trades = ?"); params.push(s.loss_trades); }
    if (isValid(s.win_rate)) { fields.push("win_rate = ?"); params.push(s.win_rate); }
    if (isValid(s.net_pnl_sol)) { fields.push("net_pnl_sol = ?"); params.push(s.net_pnl_sol); }
    if (isValid(s.net_pnl_usdt)) { fields.push("net_pnl_usdt = ?"); params.push(s.net_pnl_usdt); }
    if (isValid(s.total_fees_sol)) { fields.push("total_fees_sol = ?"); params.push(s.total_fees_sol); }
    if (isValid(s.total_invested_sol)) { fields.push("total_invested_sol = ?"); params.push(s.total_invested_sol); }
    if (isValid(s.avg_pnl_sol)) { fields.push("avg_pnl_sol = ?"); params.push(s.avg_pnl_sol); }
    if (isValid(s.active_positions)) { fields.push("active_positions = ?"); params.push(s.active_positions); }
    if (isValid(s.max_open_positions)) { fields.push("max_open_positions = ?"); params.push(s.max_open_positions); }
    
    if (fields.length === 0) return { changes: 0 };
    
    fields.push("updated_at = CURRENT_TIMESTAMP");
    const sql = `UPDATE bot_stats SET ${fields.join(", ")} WHERE id = ?`;
    params.push(id);
    
    return run(sql, params);
  },
  getBotConfig: async () => {
    const c = (await query(`SELECT * FROM bot_config WHERE id = 1`))[0];
    if (c) return { tradeMode: (process.env.TRADE_MODE || 'PAPER').toUpperCase(), isEnabled: !!c.is_enabled, buyAmountSol: c.buy_amount_sol, takeProfitPct: c.take_profit_pct, stopLossPct: c.stop_loss_pct, maxOpenPositions: c.max_open_positions, buyTriggers: JSON.parse(c.buy_triggers || '[]') };
    return { tradeMode: 'PAPER', isEnabled: true, buyAmountSol: 0.05, takeProfitPct: 20, stopLossPct: 10, maxOpenPositions: 12, buyTriggers: ["fire", "alpha"] };
  },
  updateBotConfig: async (c) => {
    return run(`UPDATE bot_config SET is_enabled = ?, buy_amount_sol = ?, take_profit_pct = ?, stop_loss_pct = ?, buy_triggers = ?, max_open_positions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [c.is_enabled ? 1 : 0, c.buy_amount_sol, c.take_profit_pct, c.stop_loss_pct, JSON.stringify(c.buy_triggers), c.max_open_positions]);
  },

  // Monitor
  addToMonitor: async (d) => {
    try {
      const mint = (d.token_address || d.tokenAddress || "").trim();
      if (!mint) return { error: "missing CA", isNew: false };
      const existing = await query(`SELECT initial_price, ath_price, discovery_tier FROM monitor_list WHERE token_address = ?`, [mint]);
      const isNew = !existing?.length;
      const now = new Date();
      const accum = `Akumulasi ${now.toLocaleDateString('id-ID')} ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      const currentPrice = parseFloat(d.price || 0);
      const initialPrice = isNew ? currentPrice : (existing[0].initial_price || currentPrice);
      const athPrice = isNew ? currentPrice : Math.max(existing[0].ath_price || 0, currentPrice);

      const sql = `INSERT OR REPLACE INTO monitor_list (token_address, symbol, added_at, status, holders_data, smart_money_data, whale_data, pair_data, discovery_tier, score, strategy_status, rug_status, liq_status, smart_money_count, whale_count, insider_count, price, market_cap, timeframe, initial_price, ath_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const res = await run(sql, [mint, (d.symbol || "?").toUpperCase(), d.added_at || now.toISOString(), d.status || "DISCOVERY", JSON.stringify(d.holders_data), JSON.stringify(d.smart_money_data), JSON.stringify(d.whale_data), JSON.stringify(d.pair_data), d.discovery_tier || "NEW", d.score || 0, d.strategy_status || d.status || "WATCHING", d.rug_status || "PENDING", d.liq_status || "PENDING", d.smart_money_count || 0, d.whale_count || 0, d.insider_count || 0, currentPrice, parseFloat(d.market_cap || 0), d.timeframe || accum, initialPrice, athPrice]);
      return { ...res, isNew, oldData: isNew ? null : existing[0] };
    } catch (error) { return { error: error.message, isNew: false }; }
  },
  getMonitorList: async (limit = 100) => { return query(`SELECT m.* FROM monitor_list m LEFT JOIN blacklisted_tokens b ON m.token_address = b.token_address WHERE b.token_address IS NULL ORDER BY m.added_at DESC LIMIT ?`, [limit]); },
  getMonitoredMints: async () => { return (await query(`SELECT token_address FROM monitor_list`)).map(r => r.token_address); },
  getTopPerformers: async (limit = 10) => {
    return query(`SELECT *, (ath_price / initial_price) as multiplier FROM monitor_list WHERE initial_price > 0 AND ath_price > 0 ORDER BY multiplier DESC LIMIT ?`, [limit]);
  },
  updateAthPrice: async (mint, currentPrice) => {
    return run(`UPDATE monitor_list SET ath_price = CASE WHEN ath_price < ? THEN ? ELSE ath_price END WHERE token_address = ?`, [currentPrice, currentPrice, mint]);
  },
  removeDeadCoins: async () => {
    // Fitur ini dinonaktifkan atas permintaan user (Keep all tokens)
    return { changes: 0 };
  },

  // Blacklist
  clearBlacklist: async () => {
    return run(`DELETE FROM blacklisted_tokens`);
  },
  isBlacklisted: async (mint) => { return (await query(`SELECT 1 FROM blacklisted_tokens WHERE token_address = ?`, [mint])).length > 0; },
  getBlacklistedMints: async () => { return (await query(`SELECT token_address FROM blacklisted_tokens`)).map(r => r.token_address); },
  blacklistToken: async (mint, symbol, reason) => {
    await run(`INSERT OR REPLACE INTO blacklisted_tokens (token_address, symbol, reason) VALUES (?, ?, ?)`, [mint, symbol, reason]);
    await run(`DELETE FROM monitor_list WHERE token_address = ?`, [mint]);
    return { success: true };
  },

  // Smart Wallets
  addOrUpdateSmartWallet: async (w) => {
    const addr = w.wallet_address || w.address;
    if (!addr) return;
    return run(`INSERT OR REPLACE INTO smart_wallets (wallet_address, winrate, total_pnl, trade_count, last_updated) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`, 
      [addr, w.winrate || w.winRate || 0, w.total_pnl || w.pnl || 0, w.trade_count || w.trades || 0]);
  },

  // Watchlist & Helper
  isCoinInMonitorList: async (mint) => {
    const rows = await query(`SELECT 1 FROM monitor_list WHERE token_address = ?`, [mint]);
    return rows.length > 0;
  },
  getWatchlist: async () => {
    return (await dbManager.getState("solana_watchlist")) || { tokens: [], smartWallets: [] };
  },
  saveWatchlist: async (data) => {
    return dbManager.saveState("solana_watchlist", data);
  },

  // Tracked Wallets
  addTrackedWallet: async (w) => {
    const sql = `INSERT OR REPLACE INTO tracked_wallets (wallet_id, type, network, alias, tags, latest_token_bought, profit_7d, roi_7d, profit_30d, roi_30d, avg_invested, win_rate, activity, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    return run(sql, [w.wallet_id || w.walletId, w.type, w.network, w.alias, JSON.stringify(w.tags || []), w.latest_token_bought || w.latestToken, w.profit_7d || 0, w.roi_7d || 0, w.profit_30d || 0, w.roi_30d || 0, w.avg_invested || 0, w.win_rate || 0, w.activity]);
  },
  getTrackedWallets: async () => {
    return query(`SELECT * FROM tracked_wallets ORDER BY profit_7d DESC`);
  },
  saveTrackedWalletHistory: async (walletId, date, profit) => {
    return run(`INSERT OR REPLACE INTO tracked_wallet_history (wallet_id, date, profit) VALUES (?, ?, ?)`, [walletId, date, profit]);
  },
  getTrackedWalletHistory: async (walletId, limit = 7) => {
    return query(`SELECT * FROM tracked_wallet_history WHERE wallet_id = ? ORDER BY date DESC LIMIT ?`, [walletId, limit]);
  },

  // Compatibility Aliases & Helpers
  getCexPositions: async () => dbManager.getActivePositions('cex'),
  getPaperPositions: async () => dbManager.getActivePositions('solana'),
  clearPaperPositions: async () => {
    await run(`DELETE FROM solana_paper_positions`);
    return run(`DELETE FROM cex_paper_positions`);
  },
  savePaperPosition: async (pos) => dbManager.saveOpenPosition('solana', pos),
  savePaperTrade: async (trade) => {
    const now = new Date().toISOString();
    const res = await run(`INSERT INTO solana_paper_trades (id, token_address, symbol, entry_price, exit_price, amount_sol, pnl_sol, pnl_pct, result, trigger_type, opened_at, closed_at, target_tp, target_sl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [trade.id || `T-${Date.now()}`, trade.token_address || trade.tokenAddress, trade.symbol, trade.entry_price || trade.entryPrice, trade.exit_price || trade.exitPrice, trade.amount_sol || trade.amountSol, trade.pnl_sol || trade.pnlSol, trade.pnl_pct || trade.pnlPct, trade.result, trade.trigger_type || trade.triggerType, trade.opened_at || trade.openedAt, trade.closed_at || trade.closedAt || now, trade.target_tp || trade.targetTP, trade.target_sl || trade.targetSL]);
    await dbManager.syncPaperStats('solana');
    return res;
  },

  // Others
  saveState: async (k, v) => { return run(`INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`, [k, JSON.stringify(v)]); },
  getState: async (k) => { const r = (await query(`SELECT value FROM app_state WHERE key = ?`, [k]))[0]; return r ? JSON.parse(r.value) : null; },
  saveTrade: async (d) => { return run(`INSERT INTO trades (timestamp, pair, type, price, amount, pnl_usd, pnl_percent, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [d.timestamp || new Date().toISOString(), d.pair, d.type, d.price, d.amount, d.pnl_usd, d.pnl_percent, d.trigger_type]); },
  getTradeHistory: async (limit = 50) => { return query(`SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`, [limit]); },
  getTokenHistory: async (mint, limit = 24) => { return query(`SELECT * FROM token_snapshots WHERE token_address = ? ORDER BY timestamp DESC LIMIT ?`, [mint, limit]); },
  saveTokenSnapshot: async (d) => { return run(`INSERT INTO token_snapshots (timestamp, token_address, token_name, holders_count, price_usd, market_cap) VALUES (?, ?, ?, ?, ?, ?)`, [d.timestamp || new Date().toISOString(), d.token_address, d.token_name, d.holders_count, d.price_usd, d.market_cap]); },
  checkNotificationSent: async (k, ms) => {
    const r = (await query(`SELECT sent_at FROM sent_notifications WHERE alert_key = ?`, [k]))[0];
    if (!r) return null;
    const last = new Date(r.sent_at).getTime();
    return (Date.now() - last < ms) ? last : null;
  },
  markNotificationSent: async (k) => { return run(`INSERT OR REPLACE INTO sent_notifications (alert_key, sent_at) VALUES (?, ?)`, [k, new Date().toISOString()]); },
  checkApiQuota: async (api) => {
    const today = new Date().toISOString().split('T')[0];
    const limit = api.toLowerCase() === 'birdeye' ? 2850 : 95000;
    const rows = await query(`SELECT ${api.toLowerCase()}_used as used FROM api_quota_tracker WHERE date = ?`, [today]);
    return !rows?.length || rows[0].used < limit;
  },
  incrementApiUsage: async (api) => {
    const today = new Date().toISOString().split('T')[0];
    const col = `${api.toLowerCase()}_used`;
    await run(`INSERT OR IGNORE INTO api_quota_tracker (date, helius_used, birdeye_used) VALUES (?, 0, 0)`, [today]);
    return run(`UPDATE api_quota_tracker SET ${col} = ${col} + 1 WHERE date = ?`, [today]);
  }
};

module.exports = dbManager;
