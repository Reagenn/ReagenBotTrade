const db = require('../src/database/dbManager');

async function debugSync() {
  console.log("=== Debugging Stats Sync ===");
  
  const trades = await db.query('SELECT result, pnl_sol as pnl FROM solana_paper_trades');
  console.log("Found trades:", trades.length);
  
  if (trades.length > 0) {
    const total = trades.length;
    const profit = trades.filter(t => t.result === 'PROFIT').length;
    const loss = total - profit;
    const winRate = (profit / total) * 100;
    const netPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    
    console.log("Calculated:", { total, profit, loss, winRate, netPnl });
    
    const sql = `UPDATE bot_stats SET 
      total_trades = ?, 
      profit_trades = ?, 
      loss_trades = ?, 
      win_rate = ?, 
      net_pnl_sol = ?, 
      updated_at = CURRENT_TIMESTAMP 
      WHERE id = 1`;
      
    const result = await db.run(sql, [total, profit, loss, winRate, netPnl]);
    console.log("Update result:", result);
  }
  
  const stats = await db.query('SELECT * FROM bot_stats WHERE id = 1');
  console.log("Final stats in DB:", stats);
  process.exit(0);
}

debugSync();
