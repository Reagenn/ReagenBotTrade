/**
 * Math Utilities for Bot
 */

/**
 * Calculates PnL percentage safely from entry and exit prices.
 * Uses Number() coercion to handle potential string inputs and ensure floating-point stability.
 */
function calculatePnlPctFromPrices(entryPrice, exitPrice) {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit)) {
    return 0;
  }

  // Calculate percentage: ((exit - entry) / entry) * 100
  const pct = ((exit - entry) / entry) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

/**
 * Calculates PnL percentage safely from PnL amount and invested amount.
 * Uses Number() coercion to handle potential string inputs and ensure floating-point stability.
 */
function calculatePnlPctFromAmount(pnlAmount, totalInvested) {
  const pnl = Number(pnlAmount);
  const invested = Number(totalInvested);

  if (!Number.isFinite(invested) || invested <= 0 || !Number.isFinite(pnl)) {
    return 0;
  }

  // Calculate percentage: (pnl / invested) * 100
  const pct = (pnl / invested) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

module.exports = { calculatePnlPctFromPrices, calculatePnlPctFromAmount };
