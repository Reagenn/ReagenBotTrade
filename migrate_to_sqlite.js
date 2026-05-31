/**
 * Migration Script: JSON to SQLite
 */

const fs = require('fs');
const path = require('path');
const dbManager = require('./src/database/dbManager');

async function migrate() {
  console.log('🚀 Memulai migrasi data ke SQLite...');
  await dbManager.initDb();

  const dataDir = path.resolve(__dirname, './data');
  const rootDir = __dirname;
  
  // 1. Migrasi Trades dari berbagai file output
  const ledgerFiles = [
    'paper-ledger.json', 
    'paper-futures-ledger.json', 
    'cex-paper-output.json', 
    'solana-paper-trading-output.json',
    'data/paper-ledger.json',
    'data/paper-futures-ledger.json',
    'data/cex-paper-output.json',
    'data/solana-paper-trading-output.json'
  ];
  
  for (const file of ledgerFiles) {
    const filePath = path.isAbsolute(file) ? file : path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        let trades = [];
        
        if (file.includes('cex')) {
          trades = raw.tradeHistory || [];
        } else if (file.includes('solana-paper')) {
          trades = raw.tradeHistory || [];
        } else {
          trades = raw.trades || [];
        }

        if (trades.length === 0) continue;

        console.log(`[Migrasi] Memproses ${trades.length} trade dari ${file}...`);
        for (const t of trades) {
          // Normalisasi field
          const timestamp = t.timestamp || t.closedAt || t.openedAt;
          const pair = t.symbol || t.pair || 'UNKNOWN';
          const type = t.type || (t.side ? t.side.toUpperCase() : 'UNKNOWN');
          
          await dbManager.saveTrade({
            timestamp,
            pair,
            type,
            price: t.exitPrice || t.entryPrice || 0,
            amount: t.amount || t.amountUsdt || t.amountSol || 0,
            pnl_usd: t.pnlUsdt || t.pnlSol || 0,
            pnl_percent: t.pnlPct || 0,
            trigger_type: t.trigger || t.reason || 'LEGACY'
          });
        }
      } catch (e) {
        console.warn(`[Gagal] File ${file}: ${e.message}`);
      }
    }
  }

  // 2. Migrasi Monitor List & Snapshots dari solana-monitor-state.json
  const monitorStateFiles = ['solana-monitor-state.json', 'data/solana-monitor-state.json'];
  for (const file of monitorStateFiles) {
    const monitorStatePath = path.join(rootDir, file);
    if (fs.existsSync(monitorStatePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(monitorStatePath, 'utf8'));
        
        // Monitor List
        if (state.timeframeRegistry) {
          const entries = Object.entries(state.timeframeRegistry);
          console.log(`[Migrasi] Memproses ${entries.length} koin di monitor list...`);
          for (const [mint, data] of entries) {
            await dbManager.addToMonitor({
                token_address: data.mint,
                symbol: data.symbol,
                added_at: data.detected_at,
                status: data.seen1d ? '1D' : data.seen4h ? '4H' : '1H', // Use status instead of timeframe
                strategy_status: 'WATCHING',
                timeframe: `Migrasi ${new Date().toLocaleDateString('id-ID')}`
            });

          }
        }

        // Snapshots
        if (state.holderSnapshots) {
          const mints = Object.entries(state.holderSnapshots);
          console.log(`[Migrasi] Memproses snapshots untuk ${mints.length} koin...`);
          for (const [mint, history] of mints) {
            for (const snap of (history || [])) {
              await dbManager.saveTokenSnapshot({
                timestamp: new Date(snap.timestamp).toISOString(),
                token_address: mint,
                token_name: snap.symbol || '?',
                holders_count: snap.totalHolders || 0,
                price_usd: snap.priceUsd || 0,
                market_cap: snap.marketCap || 0
              });
            }
          }
        }
      } catch (e) {
        console.warn(`[Gagal] Monitor State: ${e.message}`);
      }
    }
  }

  // 3. Migrasi Smart Money DB
  const smDbFiles = ['smart_money_db.json', 'data/smart_money_db.json'];
  for (const file of smDbFiles) {
    const smDbPath = path.join(rootDir, file);
    if (fs.existsSync(smDbPath)) {
      try {
        console.log(`[Migrasi] Memproses ${file}...`);
        const smDb = JSON.parse(fs.readFileSync(smDbPath, 'utf8'));
        await dbManager.saveState('smart_money_db', smDb);
      } catch (e) {
        console.warn(`[Gagal] Smart Money DB ${file}: ${e.message}`);
      }
    }
  }

  // 4. Migrasi Watchlist
  const watchlistFiles = ['solana_watchlist.json', 'data/solana_watchlist.json'];
  for (const file of watchlistFiles) {
    const watchlistPath = path.join(rootDir, file);
    if (fs.existsSync(watchlistPath)) {
      try {
        console.log(`[Migrasi] Memproses ${file}...`);
        const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
        await dbManager.saveState('solana_watchlist', watchlist);
      } catch (e) {
        console.warn(`[Gagal] Watchlist ${file}: ${e.message}`);
      }
    }
  }

  console.log('✅ Migrasi Selesai! Data sekarang tersimpan di data/bot_data.db');
  process.exit(0);
}

migrate();
