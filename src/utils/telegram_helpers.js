/**
 * Telegram Notification Helpers
 * Provides institutional-grade formatting for Solana and CEX alerts.
 */

const formatMonitorAlert = (tokenData) => {
  const {
    name,
    symbol,
    mint,
    marketCap,
    liquidity,
    whaleCount,
    insiderCount,
    rugcheckStatus, // 'Good' or 'Danger'
    source
  } = tokenData;

  const rugEmoji = rugcheckStatus === 'Good' ? '🛡️' : '⚠️';
  
  return `
🔍 <b>[NEW MONITOR] ${name} ($${symbol})</b>

📄 <b>CA:</b> <code>${mint}</code>

📊 <b>Analysis Detail:</b>
💰 <b>Market Cap:</b> <code>$${formatNumber(marketCap)}</code>
💧 <b>Liquidity:</b> <code>$${formatNumber(liquidity)}</code>
🐋 <b>Whales:</b> <code>${whaleCount || 0}</code> detected
🕵️ <b>Insiders:</b> <code>${insiderCount || 0}</code> detected
${rugEmoji} <b>Rugcheck:</b> <code>${rugcheckStatus || 'Unknown'}</code>

🔗 <b>Quick Links:</b>
<a href="https://dexscreener.com/solana/${mint}">📈 DexScreener</a> | <a href="https://rugcheck.xyz/tokens/${mint}">🛡️ Rugcheck</a>

<i>Source: ${source || 'Solana Tracker'}</i>
`.trim();
};

const formatSolanaPaperAlert = (tradeData) => {
  const {
    type, // 'BUY' or 'SELL'
    symbol,
    mint,
    price,
    amountSol,
    amountToken,
    slippage,
    gasFee,
    pnl, // { grossPct, netPct } - for EXIT
    trigger // 'TP', 'SL', 'MANUAL'
  } = tradeData;

  const isBuy = type === 'BUY';
  const headerEmoji = isBuy ? '🟢' : '🔴';
  const headerText = isBuy ? '[BUY EXECUTION]' : `[${trigger || 'SELL'} EXECUTION]`;

  let message = `
${headerEmoji} <b>${headerText} ${symbol}</b>

💵 <b>Price:</b> <code>$${price.toFixed(8)}</code>
💰 <b>Modal:</b> <code>${amountSol.toFixed(3)} SOL</code>
💎 <b>Amount:</b> <code>${formatNumber(amountToken)} ${symbol}</code>

⛽ <b>Friction:</b>
📉 <b>Slippage:</b> <code>${slippage?.toFixed(2) || '0.00'}%</code>
⛽ <b>Gas Fee:</b> <code>${gasFee?.toFixed(5) || '0.00005'} SOL</code>
`;

  if (!isBuy && pnl) {
    const pnlEmoji = pnl.netPct >= 0 ? '📈' : '📉';
    const profitColor = pnl.netPct >= 0 ? '🟢' : '🔴';
    message += `
${pnlEmoji} <b>PnL Performance:</b>
📊 <b>Gross:</b> <code>${pnl.grossPct >= 0 ? '+' : ''}${pnl.grossPct.toFixed(2)}%</code>
${profitColor} <b>Net:</b> <code><b>${pnl.netPct >= 0 ? '+' : ''}${pnl.netPct.toFixed(2)}%</b></code>
`;
  }

  message += `\n📄 <code>${mint}</code>`;
  return message.trim();
};

const formatCexSpikeAlert = (cexData) => {
  const {
    pair,
    price,
    ema200,
    oiChange,
    liquidation,
    entryPullback,
    targetTP,
    targetSL,
    volumeRatio,
    rationale,
    stopLossPct,
    takeProfitPct
  } = cexData;

  const trendStatus = price > ema200 ? 'Bullish 🟢' : 'Bearish 🔴';
  const trendDetail = price > ema200 ? '(Above EMA 200)' : '(Below EMA 200)';
  
  return `
⚡ <b>[CEX VOLUME SPIKE] ${pair}</b>

📈 <b>Technical Signal:</b>
🚀 <b>Trend:</b> <code>${trendStatus}</code>
📊 <b>Vol Surge:</b> <code>${volumeRatio?.toFixed(1) || '0.0'}x Baseline</code>
💎 <b>EMA 200 (15m):</b> <code>$${ema200?.toFixed(6) || '0.00'}</code>
🌪️ <b>OI Momentum:</b> <code>${oiChange ? (oiChange >= 0 ? '+' : '-') + Math.abs(oiChange).toFixed(1) + '%' : 'Stable'}</code>

🎯 <b>Trade Plan:</b>
📥 <b>Entry (Limit):</b> <code>$${entryPullback?.toFixed(6) || price.toFixed(6)}</code>
💰 <b>Target TP:</b> <code>$${targetTP?.toFixed(6) || '0.00'}</code> (+${takeProfitPct?.toFixed(1) || '0.0'}%)
🛡️ <b>Stop Loss:</b> <code>$${targetSL?.toFixed(6) || '0.00'}</code> (-${stopLossPct?.toFixed(1) || '0.0'}%)

🧠 <b>Rationale:</b>
<i>${rationale || 'Volume breakout with trend confirmation and ATR-based volatility targeting.'}</i>

🔗 <a href="https://www.bybit.com/en-US/trade/spot/${pair.replace('/', '')}">Bybit</a> | <a href="https://www.binance.com/en/trade/${pair.replace('/', '_')}">Binance</a>
`.trim();
};

const formatWhaleDiscoveryAlert = (whaleData) => {
  const {
    address,
    symbol,
    mint,
    price,
    liquidity,
    source
  } = whaleData;

  return `
🐳 <b>[WHALE AUTO-DISCOVERY]</b>

🕵️ <b>Spied Whale:</b> <code>${address.slice(0, 12)}...</code>

💎 <b>Token Found:</b> <b>${symbol}</b>
📄 <b>CA:</b> <code>${mint}</code>

💰 <b>Stats:</b>
💵 <b>Price:</b> <code>$${price?.toFixed(8) || '0.00'}</code>
💧 <b>Liquidity:</b> <code>$${formatNumber(liquidity)}</code>

🔗 <a href="https://dexscreener.com/solana/${mint}">DexScreener</a> | <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>

<i>${source || 'Whale Portfolio Spy'}</i>
`.trim();
};

const formatSmartHunterAlert = (hunterData) => {
  const {
    address,
    winrate,
    pnl,
    trades,
    linkedToken
  } = hunterData;

  return `
🎯 <b>[SMART MONEY HUNTER] Dewa Found!</b>

👤 <b>Wallet:</b> <code>${address}</code>

📈 <b>Performance (24h):</b>
🔥 <b>Win Rate:</b> <code>${winrate.toFixed(1)}%</code>
💰 <b>Net PnL:</b> <code>+$${formatNumber(pnl)}</code>
📊 <b>Trades:</b> <code>${trades} trades</code>

🚀 <b>Caught from token:</b> <code>${linkedToken || 'Discovery'}</code>

<i>Status: Added to Smart Wallets list for tracking.</i>
`.trim();
};

/**
 * Utility to format large numbers
 */
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
  return Number(num).toLocaleString();
}

module.exports = {
  formatMonitorAlert,
  formatSolanaPaperAlert,
  formatCexSpikeAlert,
  formatWhaleDiscoveryAlert,
  formatSmartHunterAlert
};
