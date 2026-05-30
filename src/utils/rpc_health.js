/**
 * RPC Health and Throttling State
 * Shared across different modules to coordinate rate limit handling.
 */

const rpcState = {
  pausedUntil: 0,
  lastRequestAt: 0,
};

function isRpcPaused() {
  return Date.now() < rpcState.pausedUntil;
}

function setRpcPause(durationMs = 60000) {
  rpcState.pausedUntil = Date.now() + durationMs;
}

async function rpcThrottle(minDelayMs = 1000) {
  if (isRpcPaused()) {
    const wait = rpcState.pausedUntil - Date.now();
    if (wait > 0) {
      return wait;
    }
  }

  const now = Date.now();
  const elapsed = now - rpcState.lastRequestAt;
  if (elapsed < minDelayMs) {
    const wait = minDelayMs - elapsed;
    rpcState.lastRequestAt = now + wait;
    return wait;
  }

  rpcState.lastRequestAt = now;
  return 0;
}

function updateLastRequest() {
  rpcState.lastRequestAt = Date.now();
}

module.exports = {
  isRpcPaused,
  setRpcPause,
  rpcThrottle,
  updateLastRequest,
};
