const dbManager = require('./dbManager');

async function displayCexTrades() {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n--- CEX PAPER TRADING DASHBOARD (DATABASE) ---');

  // 1. Ambil Stats dari App State
  const state = await dbManager.getState("cex_bot_state");
  if (state && state.stats) {
    const stats = state.stats;
    console.log('\n📊 RINGKASAN STATISTIK:');
    console.log(`- Total Trades: ${stats.totalTrades || 0}`);
    console.log(`- Win Rate: ${stats.winRate || 0}% (${stats.profitTrades || 0}W / ${stats.lossTrades || 0}L)`);
    console.log(`- Net PnL: ${stats.netPnlUsdt || 0} USDT`);
    console.log(`- Total Fees: ${stats.totalFeesUsdt || 0} USDT`);
    console.log(`- Saldo: ${stats.balanceUsdt || 0} USDT`);
  }

  // 2. Tampilkan Posisi Aktif dari Database
  const dbPositions = await dbManager.getCexPositions();
  if (dbPositions.length > 0) {
    console.log('\n📌 POSISI AKTIF (Database):');
    console.table(dbPositions.map(p => ({
      ID: p.id,
      Symbol: p.symbol,
      Entry: p.entry_price,
      Current: p.current_price,
      Amount: p.amount_usdt + ' USDT',
      TP: p.target_tp,
      SL: p.target_sl,
      'Opened At': p.opened_at
    })));
  } else {
    console.log('\n📌 Tidak ada posisi aktif CEX di database.');
  }

  // 3. Tampilkan Riwayat Trade dari Database
  const dbTrades = await dbManager.getCexTrades(15);
  if (dbTrades.length > 0) {
    console.log('\n📜 RIWAYAT TRADE TERAKHIR (Database):');
    console.table(dbTrades.map(t => ({
      Symbol: t.symbol,
      'PnL USDT': (t.pnl_usd >= 0 ? '+' : '') + t.pnl_usd,
      'PnL %': (t.pnl_percent >= 0 ? '+' : '') + t.pnl_percent + '%',
      'Trigger': t.trigger_type,
      Entry: t.entry_price,
      Exit: t.exit_price,
      'Closed At': t.closed_at
    })));
  } else {
    console.log('\n📜 Tidak ada riwayat trade CEX di database.');
  }

  process.exit(0);
}

displayCexTrades().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
