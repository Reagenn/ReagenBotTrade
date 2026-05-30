const fs = require('fs');
const path = require('path');
const dbManager = require('./dbManager');

async function migrateAndDisplay() {
  const jsonPath = path.resolve(__dirname, '../../data/solana-paper-trading-output.json');
  
  if (!fs.existsSync(jsonPath)) {
    console.error('File solana-paper-trading-output.json tidak ditemukan.');
    process.exit(1);
  }

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    // Tunggu DB init
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n--- MENGIMPORT DATA KE DATABASE ---');

    // 1. Import Active Positions
    if (data.activePositions && data.activePositions.length > 0) {
      await dbManager.clearPaperPositions();
      for (const pos of data.activePositions) {
        await dbManager.savePaperPosition(pos);
      }
      console.log(`Berhasil mengimport ${data.activePositions.length} posisi aktif.`);
    } else {
      console.log('Tidak ada posisi aktif untuk diimport.');
    }

    // 2. Import Trade History
    if (data.tradeHistory && data.tradeHistory.length > 0) {
      for (const trade of data.tradeHistory) {
        await dbManager.savePaperTrade(trade);
      }
      console.log(`Berhasil mengimport ${data.tradeHistory.length} riwayat trade.`);
    } else {
      console.log('Tidak ada riwayat trade untuk diimport.');
    }

    console.log('\n--- DATA SOLANA PAPER DARI DATABASE ---');

    // Tampilkan Stats Ringkas
    const stats = data.stats || {};
    console.log('\n📊 RINGKASAN STATISTIK:');
    console.log(`- Total Trades: ${stats.totalTrades || 0}`);
    console.log(`- Win Rate: ${stats.winRate || 0}% (${stats.profitTrades || 0}W / ${stats.lossTrades || 0}L)`);
    console.log(`- Net PnL: ${stats.netPnlSol || 0} SOL`);
    console.log(`- Total Investasi: ${stats.totalInvestedSol || 0} SOL`);

    // Ambil dan Tampilkan Posisi Aktif
    const dbPositions = await dbManager.getPaperPositions();
    if (dbPositions.length > 0) {
      console.log('\n📌 POSISI AKTIF (Database):');
      console.table(dbPositions.map(p => ({
        ID: p.id,
        Symbol: p.symbol,
        Entry: p.entry_price,
        Current: p.current_price,
        Amount: p.amount_sol + ' SOL',
        TP: p.target_tp,
        SL: p.target_sl,
        'Opened At': p.opened_at
      })));
    } else {
      console.log('\n📌 Tidak ada posisi aktif di database.');
    }

    // Ambil dan Tampilkan Riwayat Trade
    const dbTrades = await dbManager.getPaperTrades(10);
    if (dbTrades.length > 0) {
      console.log('\n📜 RIWAYAT TRADE TERAKHIR (Database):');
      console.table(dbTrades.map(t => ({
        Symbol: t.symbol,
        'PnL SOL': t.pnl_sol,
        'PnL %': t.pnl_pct + '%',
        'Trigger': t.trigger_type,
        Entry: t.entry_price,
        Exit: t.exit_price,
        'Closed At': t.closed_at
      })));
    } else {
      console.log('\n📜 Tidak ada riwayat trade di database.');
    }

    process.exit(0);
  } catch (err) {
    console.error('Terjadi kesalahan:', err.message);
    process.exit(1);
  }
}

migrateAndDisplay();
