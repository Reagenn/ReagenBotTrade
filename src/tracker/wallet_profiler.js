/**
 * Wallet Profiler
 * Logic to determine wallet tags based on transaction behavior.
 */

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

module.exports = { profileWallet };
