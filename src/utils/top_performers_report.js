require("dotenv").config();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const TelegramNotifier = require("./telegram_notifier");

async function getTopPerformers() {
  const command = `gmgn-cli market trending --chain sol --interval 24h --limit 50 --raw`;
  try {
    const { stdout } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY }
    });
    
    const data = JSON.parse(stdout);
    if (!data || !data.data || !data.data.rank) return [];

    return data.data.rank
      .filter(t => t.price_change_percent > 0 && t.liquidity > 5000) // Filter positive and decent liquidity
      .sort((a, b) => b.price_change_percent - a.price_change_percent)
      .slice(0, 10); // Top 10
  } catch (err) {
    console.error("Error fetching top performers:", err.message);
    return [];
  }
}

async function sendTopPerformersReport() {
  const topTokens = await getTopPerformers();
  if (topTokens.length === 0) {
    console.log("No top performers found.");
    return;
  }

  let message = `🚀 <b>[SOLANA TOP PERFORMERS - 24H]</b>\n\n`;
  
  topTokens.forEach((t, index) => {
    const gain = t.price_change_percent.toFixed(2);
    const mcap = t.market_cap >= 1000000 ? (t.market_cap / 1000000).toFixed(2) + 'M' : (t.market_cap / 1000).toFixed(1) + 'K';
    const liq = t.liquidity >= 1000 ? (t.liquidity / 1000).toFixed(1) + 'K' : t.liquidity.toFixed(0);
    
    message += `${index + 1}. <b>${t.symbol}</b>: <code>+${gain}%</code>\n`;
    message += `💰 MC: <code>$${mcap}</code> | 💧 Liq: <code>$${liq}</code>\n`;
    message += `📄 <code>${t.address}</code>\n\n`;
  });

  message += `<i>Data based on 24h Trending rank via GMGN.ai</i>`;

  const notifier = new TelegramNotifier({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  });

  await notifier.sendMessage(message);
  console.log("Top performers report sent to Telegram.");
}

if (require.main === module) {
  sendTopPerformersReport().catch(console.error);
}

module.exports = { sendTopPerformersReport };
