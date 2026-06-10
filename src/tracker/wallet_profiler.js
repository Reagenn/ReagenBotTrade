const { getHeliusWalletProfile } = require('./helius_calculator');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Wallet Profiler
 * Logic to determine wallet tags based on transaction behavior.
 */

/**
 * Fetch 7D and 30D ROI using GMGN CLI
 * @param {string} walletAddress 
 */
async function profileWhaleWallet(walletAddress) {
  try {
    // Fetch 7d stats
    const cmd7d = `gmgn-cli portfolio stats --chain sol --wallet ${walletAddress} --period 7d --raw`;
    const { stdout: out7d } = await execPromise(cmd7d, { env: process.env });
    const data7d = JSON.parse(out7d.match(/\{.*\}/s)[0]);

    // Fetch 30d stats
    const cmd30d = `gmgn-cli portfolio stats --chain sol --wallet ${walletAddress} --period 30d --raw`;
    const { stdout: out30d } = await execPromise(cmd30d, { env: process.env });
    const data30d = JSON.parse(out30d.match(/\{.*\}/s)[0]);

    return {
      roi_7d: (data7d.pnl || 0) * 100, // Convert multiplier to percentage
      roi_30d: (data30d.pnl || 0) * 100,
      winrate: (data7d.winrate || 0) * 100,
      realized_profit: data7d.realized_profit || 0,
      tags: data7d.common?.tags || []
    };
  } catch (error) {
    console.error(`[PROFILER ERROR] Failed to fetch GMGN stats for ${walletAddress}:`, error.message);
    return { roi_7d: 0, roi_30d: 0, winrate: 0, realized_profit: 0, tags: [] };
  }
}

async function getFullWalletProfile(walletAddress) {
  const transactions = []; // Logic to fetch transactions if needed for tags
  const basicProfile = profileWallet(transactions);
  const heliusData = await getHeliusWalletProfile(walletAddress);
  
  return {
    ...basicProfile,
    ...heliusData
  };
}

function profileWallet(transactions) {
  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return {
      tags: ["inactive"],
      avgHoldDuration: 0,
      tradesPerDay: 0
    };
  }

  const tags = new Set();
  
  // 1. Market Time Analysis (UTC)
  const hours = transactions.map(t => new Date(t.timestamp).getUTCHours());
  const hourCounts = { asia: 0, london: 0, ny: 0 };
  
  hours.forEach(h => {
    if (h >= 0 && h < 8) hourCounts.asia++;
    else if (h >= 8 && h < 14) hourCounts.london++;
    else if (h >= 14 && h < 22) hourCounts.ny++;
    else hourCounts.asia++; // 22-00 fallback to Asia or transition
  });

  const primaryMarket = Object.keys(hourCounts).reduce((a, b) => hourCounts[a] > hourCounts[b] ? a : b);
  tags.add(primaryMarket.charAt(0).toUpperCase() + primaryMarket.slice(1));

  // 2. Playstyle Analysis
  // Trades per day (assuming transactions cover a certain range)
  const timestamps = transactions.map(t => new Date(t.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const daysDiff = Math.max(1, (maxTime - minTime) / (1000 * 60 * 60 * 24));
  const tradesPerDay = transactions.length / daysDiff;

  if (tradesPerDay > 10) tags.add("wide");
  
  // Check for 'super degen' (buys token < 1h old)
  const hasSuperDegen = transactions.some(t => {
    if (t.tokenCreatedSeconds && t.timestampSeconds) {
      const ageAtTrade = t.timestampSeconds - t.tokenCreatedSeconds;
      return ageAtTrade < 3600; // < 1 hour
    }
    return false;
  });
  if (hasSuperDegen) tags.add("super degen");

  // 3. Duration Analysis (Hold Time)
  // Assuming transaction data has 'holdDurationSeconds' or can be derived from buy/sell pairs
  const holdDurations = transactions
    .filter(t => t.type === 'sell' && t.holdDurationSeconds)
    .map(t => t.holdDurationSeconds);
    
  const avgHoldSeconds = holdDurations.length > 0 
    ? holdDurations.reduce((a, b) => a + b, 0) / holdDurations.length 
    : 0;

  if (avgHoldSeconds > 0 && avgHoldSeconds < 7200) { // < 2 hours
    tags.add("fast");
  }

  return {
    tags: Array.from(tags),
    avgHoldDuration: avgHoldSeconds,
    tradesPerDay: tradesPerDay
  };
}

module.exports = { profileWallet, getFullWalletProfile, profileWhaleWallet };
