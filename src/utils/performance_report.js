require("dotenv").config();
const dbManager = require("../database/dbManager");
const priceFetcher = require("../solana/priceFetcher");
const TelegramNotifier = require("./telegram_notifier");

async function generatePerformanceReport() {
  console.log("[REPORT] Generating Performance Report...");
  
  // 1. Get Monitor List Gainers
  const monitorList = await dbManager.getMonitorList(200);
  const coinsToTrack = monitorList.filter(c => c.price > 0).slice(0, 50); // Get up to 50 coins with valid initial price
  
  const addresses = coinsToTrack.map(c => c.token_address);
  const currentPrices = await priceFetcher.getUIPriceBatch(addresses);
  
  const performance = coinsToTrack.map(c => {
    const priceData = currentPrices[c.token_address];
    if (!priceData || !priceData.usd) return null;
    
    const currentPrice = priceData.usd;
    const initialPrice = c.price;
    const changePct = ((currentPrice - initialPrice) / initialPrice) * 100;
    
    return {
      symbol: c.symbol,
      address: c.token_address,
      initialPrice,
      currentPrice,
      changePct,
      addedAt: c.added_at
    };
  }).filter(Boolean);

  // Sort by changePct descending
  const topGainers = performance.sort((a, b) => b.changePct - a.changePct).slice(0, 5);
  const topLosers = performance.sort((a, b) => a.changePct - b.changePct).slice(0, 3);

  // 2. Get Active Paper Positions Performance
  const activePositions = await dbManager.getActivePositions('solana');
  const paperPerf = activePositions.map(p => {
    const priceData = currentPrices[p.token_address];
    if (!priceData || !priceData.usd) return null;
    
    const currentPrice = priceData.usd;
    const entryPrice = p.entry_price;
    const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    return {
      symbol: p.symbol,
      entryPrice,
      currentPrice,
      changePct,
      amountSol: p.amount_sol
    };
  }).filter(Boolean);

  // 3. Construct Message
  let message = `📊 <b>[PERFORMANCE REPORT]</b>\n\n`;

  if (activePositions.length > 0) {
    message += `💰 <b>ACTIVE PAPER POSITIONS</b>\n`;
    paperPerf.forEach(p => {
      const icon = p.changePct >= 0 ? '📈' : '📉';
      message += `${icon} <b>${p.symbol}</b>: <code>${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(2)}%</code> ($${p.currentPrice.toFixed(6)})\n`;
    });
    message += `\n`;
  }

  if (topGainers.length > 0) {
    message += `🚀 <b>TOP MONITOR GAINERS (Since Discovery)</b>\n`;
    topGainers.forEach((p, i) => {
      message += `${i+1}. <b>${p.symbol}</b>: <code>+${p.changePct.toFixed(2)}%</code>\n`;
      message += `   Discovered: $${p.initialPrice.toFixed(6)} → Now: $${p.currentPrice.toFixed(6)}\n`;
    });
    message += `\n`;
  }

  if (topLosers.length > 0 && topLosers[0].changePct < -10) {
    message += `🔻 <b>NOTABLE DROPS</b>\n`;
    topLosers.forEach(p => {
      if (p.changePct < -5) {
        message += `• <b>${p.symbol}</b>: <code>${p.changePct.toFixed(2)}%</code>\n`;
      }
    });
    message += `\n`;
  }

  message += `<i>Data analyzed from Monitor List entry points.</i>`;

  const notifier = new TelegramNotifier({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  });

  await notifier.sendMessage(message);
  console.log("[REPORT] Performance report sent to Telegram.");
}

if (require.main === module) {
  generatePerformanceReport().catch(console.error);
}

module.exports = { generatePerformanceReport };
