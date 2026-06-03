const chalk = require("chalk");
const Table = require("cli-table3");
const dbManager = require("../database/dbManager");

/**
 * Render Wallet Dashboard to Terminal
 */
async function renderWalletDashboard() {
  try {
    const wallets = await dbManager.getTrackedWallets();
    
    console.clear();
    console.log(chalk.cyan.bold("\n💎 SMART WALLET TRACKER - TERMINAL DASHBOARD"));
    console.log(chalk.dim(`Last Sync: ${new Date().toLocaleString()}\n`));

    if (!wallets || wallets.length === 0) {
      console.log(chalk.yellow("No wallets tracked yet. Use scanner to find smart money."));
      return;
    }

    wallets.forEach(w => {
      const typeLabel = w.type === 'CEX' ? chalk.bgBlue.white(" CEX ") : chalk.bgMagenta.white(" DEX ");
      const networkLabel = w.network.toUpperCase();
      const id = w.wallet_id;
      const shortId = `${id.slice(0, 8)}...${id.slice(-4)}`;
      
      let tags = [];
      try { tags = JSON.parse(w.tags || "[]"); } catch(e) {}
      const tagStr = tags.map(t => chalk.cyan(`[${t}]`)).join(" ");

      console.log(chalk.gray("========================================="));
      console.log(`${typeLabel} ${chalk.bold(`[${networkLabel}]`)} ${chalk.white(shortId)} ${w.alias ? chalk.yellow(`(${w.alias})`) : ""}`);
      console.log(`${chalk.gray("🏷️ Tags:")} ${tagStr}`);
      console.log(chalk.gray("-----------------------------------------"));
      
      const p7 = parseFloat(w.profit_7d || 0);
      const r7 = parseFloat(w.roi_7d || 0);
      
      const profitColor = p7 >= 0 ? chalk.green : chalk.red;
      const roiColor = r7 >= 0 ? chalk.green : chalk.red;

      console.log(`${chalk.white("📈 7D PROFIT :")} ${profitColor((p7 >= 0 ? "+" : "") + "$" + p7.toLocaleString())}`);
      console.log(`${chalk.white("🚀 7D ROI    :")} ${roiColor((r7 >= 0 ? "+" : "") + r7.toFixed(1) + "%")}`);
      console.log(`${chalk.white("💼 AVG INVEST:")} ${chalk.white("$" + (w.avg_invested || 0).toLocaleString())}`);
      console.log(`${chalk.white("🏆 WIN RATE  :")} ${chalk.cyan((w.win_rate || 0).toFixed(1) + "%")}`);
      
      if (w.activity) {
        console.log(`${chalk.white("🔥 ACTIVITY  :")} ${chalk.dim(w.activity)}`);
      }
      
      console.log(chalk.gray("=========================================\n"));
    });

  } catch (err) {
    console.error(chalk.red("Dashboard Error:"), err.message);
  }
}

// Run if called directly
if (require.main === module) {
  renderWalletDashboard();
  // Auto refresh every 30 seconds
  setInterval(renderWalletDashboard, 30000);
}

module.exports = { renderWalletDashboard };
