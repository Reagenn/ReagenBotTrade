function formatPrice(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value).toFixed(digits);
}

function formatQty(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return Number(0).toFixed(digits);
  }

  return Number(value).toFixed(digits);
}

function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return `${Number(value).toFixed(digits)}%`;
}

function buildSignalSummary(signal) {
  const diagnostics = signal?.diagnostics || {};
  const scoreBreakdown = diagnostics.scoreBreakdown || {};
  return {
    action: signal?.action,
    reason: signal?.reason,
    trend: diagnostics.trendBias,
    price: formatPrice(diagnostics.latestClose),
    rsi: Number.isFinite(diagnostics.latestRsi) ? Number(diagnostics.latestRsi).toFixed(2) : null,
    bbLower: diagnostics.latestBands ? formatPrice(diagnostics.latestBands.lower) : null,
    bbUpper: diagnostics.latestBands ? formatPrice(diagnostics.latestBands.upper) : null,
    volumeSpike: diagnostics.volumeSpike,
    volume: Number.isFinite(diagnostics.latestVolume) ? Number(diagnostics.latestVolume).toFixed(4) : null,
    averageVolume: Number.isFinite(diagnostics.averageVolume) ? Number(diagnostics.averageVolume).toFixed(4) : null,
    regime: diagnostics.marketRegime,
    adx: Number.isFinite(diagnostics.adx) ? Number(diagnostics.adx).toFixed(2) : null,
    atrPct: Number.isFinite(diagnostics.atrPct) ? formatPct(diagnostics.atrPct * 100) : null,
    score: Number.isFinite(diagnostics.score) ? Number(diagnostics.score).toFixed(2) : null,
    scoreThreshold: Number.isFinite(diagnostics.scoreThreshold) ? Number(diagnostics.scoreThreshold).toFixed(2) : null,
    breakoutShort: diagnostics.breakoutShort,
    bearishMacdCross: diagnostics.bearishMacdCross,
    bearishMacdMomentum: diagnostics.bearishMacdMomentum,
    scoreBreakdown: Object.fromEntries(
      Object.entries(scoreBreakdown).map(([key, value]) => [key, Number(value).toFixed(2)])
    ),
  };
}

module.exports = {
  formatPct,
  formatPrice,
  formatQty,
  buildSignalSummary,
};
