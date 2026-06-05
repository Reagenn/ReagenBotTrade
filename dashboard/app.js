const dashboardUrl = "/api/dashboard";

// Auth Check
const currentUser = JSON.parse(localStorage.getItem('reagen_user') || 'null');
const currentToken = localStorage.getItem('reagen_token');

if (!currentUser && !window.location.pathname.includes('login.html')) {
  window.location.href = '/login.html';
}

/**
 * Fetch with Auth Header
 */
async function fetchWithAuth(url, options = {}) {
  const headers = options.headers || {};
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }
  
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      }
    });

    // Handle token expiration/invalid
    if (res.status === 401 || res.status === 403) {
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
          const data = await res.json().catch(() => ({}));
          if (data.error && data.error.toLowerCase().includes('token')) {
              console.warn("[AUTH] Token expired or invalid, logging out...");
              localStorage.removeItem('reagen_token');
              localStorage.removeItem('reagen_user');
              window.location.href = '/login.html';
          }
      }
    }
    
    return res;
  } catch (err) {
    console.error(`[FETCH ERROR] ${url}:`, err);
    throw err;
  }
}

async function checkAdminConnectivity() {
    console.log("[DIAGNOSTIC] Checking Admin API connectivity...");
    try {
        const t1 = await fetchWithAuth("/api/admin/test");
        console.log("[DIAGNOSTIC] /api/admin/test status:", t1.status);
        
        const t2 = await fetchWithAuth("/api/admin/users/health");
        console.log("[DIAGNOSTIC] /api/admin/users/health status:", t2.status);
    } catch (e) {
        console.error("[DIAGNOSTIC] Connection failed:", e.message);
    }
}

const PAGE_TITLES = {
  phoenix: "Phoenix Scanner v4 · Reagen Console",
  monitor: "Solana Monitor · Reagen Console",
  "track-wallet": "Smart Wallet Tracker · Reagen Console",
  "solana-paper": "Solana Paper Trading · Reagen Console",
  "cex-spike": "CEX Volume Spike · Reagen Console",
  trading: "BTC Futures Trading · Reagen Console",
  users: "User Management · Reagen Admin",
};

const PHOENIX_TIER_LABELS = {
  FIRE: "FIRE",
  CANDIDATE: "CANDIDATE",
  PRE_IGN: "PRE-IGN",
  CAPITUL: "CAPITUL",
  WATCH: "WATCH",
};

let phoenixActiveFilter = "ALL";

// Basic UI components
window.ui = {
  toast: (message, type = "neutral") => {
    // Advanced toast with types
    const toast = document.createElement("div");
    toast.className = `ui-toast ui-toast-${type}`;
    
    let icon = "🔔";
    if (type === "success") icon = "✅";
    if (type === "error") icon = "🚨";
    if (type === "warning") icon = "⚠️";
    if (type === "blacklist") icon = "🚫";

    toast.innerHTML = `
      <span class="ui-toast-icon">${icon}</span>
      <span class="ui-toast-msg">${message}</span>
    `;
    
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("is-visible");
      setTimeout(() => {
        toast.classList.remove("is-visible");
        setTimeout(() => toast.remove(), 300);
      }, 4000); // Longer duration for better readability
    }, 10);
  }
};
// Mobile menu elements
const navMenuToggle = document.getElementById("navMenuToggle");
const navLinks = document.querySelector(".nav-links");

if (navMenuToggle && navLinks) {
  navMenuToggle.onclick = () => {
    navMenuToggle.classList.toggle("is-active");
    navLinks.classList.toggle("is-active");
  };

  // Close menu when clicking outside or on a link
  document.addEventListener("click", (e) => {
    if (!navMenuToggle.contains(e.target) && !navLinks.contains(e.target)) {
      navMenuToggle.classList.remove("is-active");
      navLinks.classList.remove("is-active");
    }
  });

  navLinks.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
      navMenuToggle.classList.remove("is-active");
      navLinks.classList.remove("is-active");
    });
  });
}

const ui = window.ui;

// User Status & Logout in Nav
function setupUserNav() {
  const navActionsEl = document.querySelector(".nav-actions");
  if (!navActionsEl || !currentUser) return;
  
  // Show Admin link if user is ADMIN
  const navAdminLink = document.getElementById("navAdminLink");
  if (navAdminLink && currentUser.role === 'ADMIN') {
    navAdminLink.style.display = 'flex';
  }

  // Remove SOL balance from navbar as requested
  const balanceBadge = document.getElementById("balanceBadge");
  if (balanceBadge) balanceBadge.remove();

  const userItem = document.createElement('div');
  userItem.className = 'nav-user-status-top';
  userItem.style.display = 'flex';
  userItem.style.alignItems = 'center';
  userItem.style.gap = '0.75rem';
  userItem.style.padding = '0.4rem 0.75rem';
  userItem.style.background = 'rgba(255, 255, 255, 0.04)';
  userItem.style.border = '1px solid var(--line-strong)';
  userItem.style.borderRadius = '2rem';
  userItem.style.marginRight = '0.5rem';
  
  const statusColor = currentUser.status === 'APPROVED' ? '#4ade80' : '#fbbf24';
  const isGuest = currentUser.role === 'GUEST';
  
  userItem.innerHTML = `
    <div style="display: flex; align-items: center; gap: 0.6rem;">
        <div style="width: 24px; height: 24px; border-radius: 50%; background: ${isGuest ? 'rgba(139, 156, 179, 0.1)' : 'rgba(94, 234, 212, 0.1)'}; display: flex; align-items: center; justify-content: center; font-size: 0.8rem;">
            ${isGuest ? '👤' : '🛡️'}
        </div>
        <div style="display: flex; flex-direction: column; line-height: 1.1;">
            <div style="font-weight: 700; font-size: 0.78rem; color: var(--text);">${currentUser.username}</div>
            <div style="font-size: 0.6rem; color: var(--muted); display: flex; align-items: center; gap: 0.2rem;">
                <span style="width: 5px; height: 5px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 4px ${statusColor}"></span>
                ${currentUser.role} · ${currentUser.status}
            </div>
        </div>
    </div>
    <div style="width: 1px; height: 16px; background: var(--line-strong); margin: 0 0.25rem;"></div>
    <button id="logoutBtn" style="background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.2); color: #f87171; cursor: pointer; font-size: 0.7rem; padding: 0.25rem 0.5rem; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 0.3rem; transition: all 0.2s; font-weight: 700; font-family: var(--font);" title="Logout">
        LOGOUT
    </button>
  `;
  
  // Insert before the status pill
  navActionsEl.insertBefore(userItem, navActionsEl.firstChild);
  
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn.onmouseover = () => { 
    logoutBtn.style.background = 'rgba(248, 113, 113, 0.2)';
    logoutBtn.style.borderColor = 'rgba(248, 113, 113, 0.4)';
  };
  logoutBtn.onmouseout = () => { 
    logoutBtn.style.background = 'rgba(248, 113, 113, 0.1)';
    logoutBtn.style.borderColor = 'rgba(248, 113, 113, 0.2)';
  };
  
  logoutBtn.onclick = () => {
    localStorage.removeItem('reagen_token');
    localStorage.removeItem('reagen_user');
    window.location.href = '/login.html';
  };
}
setupUserNav();


const el = {
  generatedAt: document.getElementById("generatedAt"),
  refreshButton: document.getElementById("refreshButton"),
  navLinks: [...document.querySelectorAll(".nav-link")],
  pageViews: [...document.querySelectorAll(".page-view")],
  topMetrics: document.getElementById("topMetrics"),
  runtimeSummary: document.getElementById("runtimeSummary"),
  monitorRuntime: document.getElementById("monitorRuntime"),
  spotSummary: document.getElementById("spotSummary"),
  futuresSummary: document.getElementById("futuresSummary"),
  spotTrades: document.getElementById("spotTrades"),
  futuresTrades: document.getElementById("futuresTrades"),
  recentLogs: document.getElementById("recentLogs"),
  solanaSmartMoney: document.getElementById("solanaSmartMoney"),
  solanaWhaleBuying: document.getElementById("solanaWhaleBuying"),
  solanaMustBuy: document.getElementById("solanaMustBuy"),
  whaleGuideText: document.getElementById("whaleGuideText"),
  smartGuideText: document.getElementById("smartGuideText"),
  smartMoneyRule: document.getElementById("smartMoneyRule"),
  briefingTime: document.getElementById("briefingTime"),
  briefingChips: document.getElementById("briefingChips"),
  briefingMustBuy: document.getElementById("briefingMustBuy"),
  briefingFire: document.getElementById("briefingFire"),
  briefingAlpha: document.getElementById("briefingAlpha"),
  briefingWatchlist: document.getElementById("briefingWatchlist"),
  timeframeFilterStats: document.getElementById("timeframeFilterStats"),
  timeframeChips: document.getElementById("timeframeChips"),
  timeframe1hList: document.getElementById("timeframe1hList"),
  timeframe4hList: document.getElementById("timeframe4hList"),
  timeframe1dList: document.getElementById("timeframe1dList"),
  timeframe1hCount: document.getElementById("timeframe1hCount"),
  timeframe4hCount: document.getElementById("timeframe4hCount"),
  timeframe1dCount: document.getElementById("timeframe1dCount"),
  mustBuyCount: document.getElementById("mustBuyCount"),
  fireCount: document.getElementById("fireCount"),
  alphaCount: document.getElementById("alphaCount"),
  watchCount: document.getElementById("watchCount"),
  providerStatus: document.getElementById("providerStatus"),
  solanaDiscoveryFire: document.getElementById("solanaDiscoveryFire"),
  solanaDiscoveryAlpha: document.getElementById("solanaDiscoveryAlpha"),
  spotCurve: document.getElementById("spotCurve"),
  futuresCurve: document.getElementById("futuresCurve"),
  closeSpotButton: document.getElementById("closeSpotButton"),
  closeFuturesButton: document.getElementById("closeFuturesButton"),
  spotActionStatus: document.getElementById("spotActionStatus"),
  futuresActionStatus: document.getElementById("futuresActionStatus"),
  tokenDetailSelect: document.getElementById("tokenDetailSelect"),
  holderTierSummary: document.getElementById("holderTierSummary"),
  holderTierChart: document.getElementById("holderTierChart"),
  holderChartLegend: document.getElementById("holderChartLegend"),
  holderSmartList: document.getElementById("holderSmartList"),
  holderWhaleList: document.getElementById("holderWhaleList"),
  phoenixSubtitle: document.getElementById("phoenixSubtitle"),
  phoenixSummary: document.getElementById("phoenixSummary"),
  phoenixTabs: document.getElementById("phoenixTabs"),
  phoenixGrid: document.getElementById("phoenixGrid"),
  phoenixHowBtn: document.getElementById("phoenixHowBtn"),
  phoenixRefreshBtn: document.getElementById("phoenixRefreshBtn"),
  phoenixHowDialog: document.getElementById("phoenixHowDialog"),
  paperSummaryGrid: document.getElementById("paperSummaryGrid"),
  paperOpenList: document.getElementById("paperOpenList"),
  paperOpenCount: document.getElementById("paperOpenCount"),
  paperConfigPanel: document.getElementById("paperConfigPanel"),
  paperCycleEvents: document.getElementById("paperCycleEvents"),
  paperHistoryList: document.getElementById("paperHistoryList"),
  paperHistoryCount: document.getElementById("paperHistoryCount"),
  cexSummaryGrid: document.getElementById("cexSummaryGrid"),
  cexOpenList: document.getElementById("cexOpenList"),
  cexOpenCount: document.getElementById("cexOpenCount"),
  cexSignalsList: document.getElementById("cexSignalsList"),
  cexScanMeta: document.getElementById("cexScanMeta"),
  cexHistoryList: document.getElementById("cexHistoryList"),
  cexHistoryCount: document.getElementById("cexHistoryCount"),
  cexExchangeBadge: document.getElementById("cexExchangeBadge"),
  solanaPaperBalance: document.getElementById("solanaPaperBalance"),
  dataFreshness: document.getElementById("dataFreshness"),
  tokenDetailsDialog: document.getElementById("tokenDetailsDialog"),
  tokenDetailsTitle: document.getElementById("tokenDetailsTitle"),
  tokenDetailsEyebrow: document.getElementById("tokenDetailsEyebrow"),
  tokenDetailsMeta: document.getElementById("tokenDetailsMeta"),
  tokenDetailsSummary: document.getElementById("tokenDetailsSummary"),
  tokenDetailsSeries: document.getElementById("tokenDetailsSeries"),
  tokenDetailsChanges: document.getElementById("tokenDetailsChanges"),
  tokenDetailsChart: document.getElementById("tokenDetailsChart"),
  tokenDetailsTooltip: document.getElementById("tokenDetailsTooltip"),
  tokenDetailsSmartList: document.getElementById("tokenDetailsSmartList"),
  tokenDetailsWhaleList: document.getElementById("tokenDetailsWhaleList"),
  holderDistributionChart: document.getElementById("holderDistributionChart"),
  trackedWalletsGrid: document.getElementById("trackedWalletsGrid"),
  trackedWalletCount: document.getElementById("trackedWalletCount"),
};

let holderDistributionChartInstance = null;

const HOLDER_CHART_SERIES = [
  { key: "totalHolders", label: "Total", color: "#f0f6fc" },
  { key: "under10", label: "Under $10", color: "#94a3b8" },
  { key: "over100", label: "Over $100", color: "#fb923c" },
  { key: "over1k", label: "Over $1K", color: "#60a5fa" },
  { key: "over10k", label: "Over $10K", color: "#4ade80" },
];

let lastSolanaPayload = null;
const livePairByMint = new Map();
let livePriceTimer = null;
const LIVE_PRICE_POLL_MS = 45000;
const LIVE_PRICE_MAX_MINTS = 24;

let tokenDetailsState = {
  mint: null,
  interval: "1h",
  range: "MAX",
  activeSeries: HOLDER_CHART_SERIES.map((series) => series.key),
};

// Wallet Filter State
let walletRawData = [];
let walletFilterState = {
  sort: "7D ROI ↓",
  tags: [] // Default empty array means "All" for all categories
};

function initWalletFilters() {
  const filtersEl = document.querySelector(".wallet-filters");
  if (!filtersEl) return;

  // Sync UI with initial state
  syncFilterUI();

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-chip");
    if (!btn) return;

    const group = btn.closest(".filter-chips");
    const category = group ? group.dataset.filterCategory : null;

    if (!category) {
      // This must be the "Sort" group
      const parent = btn.closest(".filter-group");
      parent.querySelectorAll(".filter-chip").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      walletFilterState.sort = btn.textContent.trim();
    } else {
      // This is a tag category
      const tag = btn.textContent.trim();
      
      if (tag.startsWith("All")) {
        // Reset this category
        group.querySelectorAll(".filter-chip").forEach(b => b.classList.remove("is-active", "is-active-blue"));
        const colorClass = (category === "dur" || category === "market") ? "is-active-blue" : "is-active";
        btn.classList.add(colorClass);
        
        // Remove all tags belonging to this category from state
        const sibs = Array.from(group.querySelectorAll(".filter-chip")).map(b => b.textContent.trim());
        walletFilterState.tags = walletFilterState.tags.filter(t => !sibs.includes(t));
      } else {
        const colorClass = (category === "dur" || category === "market") ? "is-active-blue" : "is-active";
        btn.classList.toggle(colorClass);
        const isActive = btn.classList.contains("is-active") || btn.classList.contains("is-active-blue");
        
        if (isActive) {
          if (!walletFilterState.tags.includes(tag)) walletFilterState.tags.push(tag);
          // Remove "All" active state if a specific tag is clicked
          const allBtn = group.querySelector(".filter-chip:first-child");
          if (allBtn) allBtn.classList.remove("is-active", "is-active-blue");
        } else {
          walletFilterState.tags = walletFilterState.tags.filter(t => t !== tag);
          // If no tags left in this category, reactivate "All"
          const categoryActive = Array.from(group.querySelectorAll(".filter-chip")).some(b => !b.textContent.startsWith("All") && (b.classList.contains("is-active") || b.classList.contains("is-active-blue")));
          if (!categoryActive) {
            const allBtn = group.querySelector(".filter-chip:first-child");
            if (allBtn) {
              const allColorClass = (category === "dur" || category === "market") ? "is-active-blue" : "is-active";
              allBtn.classList.add(allColorClass);
            }
          }
        }
      }
    }

    renderTrackedWallets(walletRawData);
  });
}

function syncFilterUI() {
  const filtersEl = document.querySelector(".wallet-filters");
  if (!filtersEl) return;

  // 1. Sync Sort
  const sortChips = filtersEl.querySelectorAll('.filter-group:first-child .filter-chip');
  sortChips.forEach(btn => {
    if (btn.textContent.trim() === walletFilterState.sort) {
      btn.classList.add('is-active');
    } else {
      btn.classList.remove('is-active');
    }
  });

  // 2. Sync Tags
  const tagGroups = filtersEl.querySelectorAll('.filter-chips');
  tagGroups.forEach(group => {
    const category = group.dataset.filterCategory;
    const chips = group.querySelectorAll('.filter-chip');
    let categoryHasActive = false;

    chips.forEach(btn => {
      const tag = btn.textContent.trim();
      const isColorBlue = (category === "dur" || category === "market");
      const colorClass = isColorBlue ? "is-active-blue" : "is-active";

      if (walletFilterState.tags.includes(tag)) {
        btn.classList.add(colorClass);
        categoryHasActive = true;
      } else if (!tag.startsWith("All")) {
        btn.classList.remove("is-active", "is-active-blue");
      }
    });

    // Handle "All" button
    const allBtn = chips[0];
    if (allBtn && allBtn.textContent.trim().startsWith("All")) {
      if (!categoryHasActive) {
        const isColorBlue = (category === "dur" || category === "market");
        allBtn.classList.add(isColorBlue ? "is-active-blue" : "is-active");
      } else {
        allBtn.classList.remove("is-active", "is-active-blue");
      }
    }
  });
}

function applyWalletFiltersAndSort(wallets) {
  let filtered = [...wallets];

  // 1. Apply Tags Filter
  if (walletFilterState.tags.length > 0) {
    filtered = filtered.filter(w => {
      const wTags = Array.isArray(w.tags) ? w.tags : [];
      return walletFilterState.tags.every(requiredTag => {
        if (requiredTag.startsWith("All")) return true;
        return wTags.some(t => t.toLowerCase() === requiredTag.toLowerCase());
      });
    });
  }

  // 2. Apply Sort
  const s = walletFilterState.sort;
  filtered.sort((a, b) => {
    if (s.includes("7D ROI")) return (b.roi7d || 0) - (a.roi7d || 0);
    if (s.includes("30D ROI")) return (b.roi30d || 0) - (a.roi30d || 0);
    if (s.includes("7D Profit")) return (b.profit7d || 0) - (a.profit7d || 0);
    if (s.includes("30D Profit")) return (b.profit30d || 0) - (a.profit30d || 0);
    if (s.includes("Avg Invested")) return (b.avgInvested || 0) - (a.avgInvested || 0);
    return 0;
  });

  return filtered;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(Number(value));
  const fractionDigits = abs > 0 && abs < 0.01 ? 8 : abs < 1 ? 6 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined) return "N/A";
  if (!Number.isFinite(value)) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatHolderValue(value) {
  if (value === null || value === undefined) return '<span class="status-wait">Loading...</span>';
  return formatNumber(value, 0);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function formatHours(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}h`;
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatAge(isoTime) {
  if (!isoTime) return "belum ada data";
  const diffMs = Date.now() - new Date(isoTime).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "baru saja";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

function getSignalCounts(candidate) {
  const smart = candidate?.smartWalletSignal || {};
  const whale = candidate?.whaleSignal || {};
  const holder = candidate?.holderAnalytics || {};
  const smartCount = Math.max(Number(smart.walletBuyCount || 0), Number(holder.smartMoney?.count || 0));
  const whaleCount = Math.max(Number(whale.whaleWalletCount || 0), Number(holder.whale?.count || 0));
  const holderScan = Boolean(holder.fetchedAt || holder.totalHolders);
  return { smartCount, whaleCount, holderScan };
}

function bucketHolderHistory(series, intervalMs) {
  if (!Array.isArray(series) || !series.length) return [];
  const buckets = new Map();
  for (const point of series) {
    const ts = Number(point.timestamp || 0);
    const bucketKey = Math.floor(ts / intervalMs) * intervalMs;
    buckets.set(bucketKey, { ...point, timestamp: bucketKey });
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
}

function filterHolderHistoryRange(series, rangeKey) {
  if (!Array.isArray(series)) return [];
  const ranges = {
    "7D": 7 * 24 * 60 * 60 * 1000,
    "30D": 30 * 24 * 60 * 60 * 1000,
    MAX: Infinity,
  };
  const windowMs = ranges[rangeKey] ?? ranges.MAX;
  const cutoff = Date.now() - windowMs;
  return series.filter((point) => Number(point.timestamp || 0) >= cutoff);
}

/* 
   TASK: Direct frontend fetching from DexScreener is disabled 
   to prevent 429 errors and CORS issues.
   Price updates are now handled by the backend scanner process.
*/
async function fetchLivePairSnapshot(mint) {
  return null;
}

function getDisplayPairMetrics(candidate) {
  const pair = candidate?.pair || {};
  return {
    isLive: false,
    liveFetchedAt: candidate.dataUpdatedAt || candidate.generatedAt || candidate.added_at,
    pair: pair
  };
}

async function refreshLiveMetricsForMints(mints) {
  // Logic removed: frontend no longer polls DexScreener directly.
  return;
}

function scheduleLivePriceRefresh() {
  // Logic removed: frontend no longer polls DexScreener directly.
  return;
}

function describeOpenPosition(position, mode) {
  if (!position) {
    return `No open ${mode} position.`;
  }

  const direction = position.side === "sell" ? "SHORT" : "LONG";
  const leverage = position.leverage ? ` | ${position.leverage}x` : "";
  return `${direction}${leverage} | Qty ${formatNumber(position.amount || 0, 6)} | Entry ${formatMoney(position.entryPrice || 0)}`;
}

function summarizeLedger(ledger) {
  if (!ledger) {
    return {
      balance: null,
      asset: null,
      marginLocked: null,
      realizedPnl: null,
      paidFees: null,
      wins: 0,
      losses: 0,
      tradesClosed: 0,
      openPosition: null,
      snapshots: [],
      trades: [],
    };
  }

  return {
    balance: ledger.balances?.cash ?? null,
    asset: ledger.balances?.asset ?? null,
    marginLocked: ledger.balances?.marginLocked ?? null,
    realizedPnl: ledger.performance?.realizedPnl ?? null,
    paidFees: ledger.performance?.paidFees ?? null,
    wins: ledger.performance?.wins ?? 0,
    losses: ledger.performance?.losses ?? 0,
    tradesClosed: ledger.performance?.tradesClosed ?? 0,
    openPosition: ledger.openPosition,
    snapshots: Array.isArray(ledger.equitySnapshots) ? ledger.equitySnapshots.slice(-90) : [],
    trades: Array.isArray(ledger.trades) ? ledger.trades.slice(-6).reverse() : [],
  };
}

function renderTrackedWallets(wallets) {
  if (!el.trackedWalletsGrid) return;
  
  // Save for re-filtering
  if (wallets !== walletRawData) walletRawData = wallets;

  try {
    const displayWallets = applyWalletFiltersAndSort(wallets || []);

    if (!displayWallets || displayWallets.length === 0) {
      el.trackedWalletsGrid.innerHTML = `<div class="briefing-empty"><p class="briefing-empty-title">Belum ada dompet yang sesuai filter.</p></div>`;
      if (el.trackedWalletCount) el.trackedWalletCount.textContent = "0 Wallets";
      return;
    }

    if (el.trackedWalletCount) el.trackedWalletCount.textContent = `${displayWallets.length} Wallets`;

    // Redesigned Grid Container
    el.trackedWalletsGrid.className = "tracked-wallet-grid";

    el.trackedWalletsGrid.innerHTML = displayWallets.map(w => {
      const p7 = Number(w.profit7d || 0);
      const r7 = Number(w.roi7d || 0);
      const p30 = Number(w.profit30d || 0);
      const r30 = Number(w.roi30d || 0);
      const avgInv = Number(w.avgInvested || 0);
      
      const tags = Array.isArray(w.tags) ? w.tags : [];
      const tagHtml = tags.map((t, i) => {
        const isBlue = i === 2; // Simple heuristic to match London/Asia blue tags in image
        return `<span class="wallet-tag ${isBlue ? 'wallet-tag-blue' : ''}">${t}</span>`;
      }).join("");

      // Chart Calculations
      const history = (w.history || []).slice(-7);
      let chartHtml = "";
      if (history.length > 0) {
        const profits = history.map(h => Number(h.profit));
        const maxVal = Math.max(...profits.map(p => Math.abs(p)));
        const yAxisMax = Math.ceil(maxVal / 100) * 100 || 100;
        
        // Y-axis labels
        const yLabels = [yAxisMax, Math.round(yAxisMax / 3), 0, -Math.round(yAxisMax / 3)].map(v => `$${v}`);
        const yLabelHtml = yLabels.map(l => `<span>${l}</span>`).join("");

        const bars = history.map((h) => {
          const val = Number(h.profit);
          const heightPct = (Math.abs(val) / yAxisMax) * 50; // Max 50% height for one side
          const isPositive = val >= 0;
          const dayLabel = h.date ? h.date.split('-').slice(1).join('-') : ""; // MM-DD
          
          return `
            <div class="bar-col">
              <div class="bar-wrapper">
                <div class="bar-hitbox" style="height: ${heightPct}%; background: ${isPositive ? '#4ade80' : '#f87171'}; bottom: ${isPositive ? '50%' : 'auto'}; top: ${isPositive ? 'auto' : '50%'}; position: absolute;"></div>
                <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.1); position: absolute; top: 50%;"></div>
              </div>
              <span class="bar-label">${dayLabel}</span>
            </div>
          `;
        }).join("");

        chartHtml = `
          <div class="chart-section">
            <span class="chart-title">DAILY PROFIT (7D)</span>
            <div class="chart-container">
              <div class="y-axis">${yLabelHtml}</div>
              <div class="chart-bars">${bars}</div>
            </div>
          </div>
        `;
      }

      const p7Tone = p7 >= 0 ? "good" : "bad";
      const p30Tone = p30 >= 0 ? "good" : "bad";

      return `
        <article class="wallet-card">
          <div class="wallet-card-header">
            <div class="wallet-card-title">${w.alias || (w.id ? shortenMint(w.id) : 'Unknown')}</div>
            <div class="wallet-card-tags">
              ${tagHtml}
            </div>
          </div>

          ${chartHtml}

          <div class="stats-divider"></div>

          <div class="stats-grid-2col">
            <div class="stat-item">
              <span class="stat-label">7D PROFIT</span>
              <span class="stat-value ${p7Tone}">${p7 >= 0 ? '+' : ''}${formatMoney(p7)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">30D PROFIT</span>
              <span class="stat-value ${p30Tone}">${p30 >= 0 ? '+' : ''}${formatMoney(p30)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">7D ROI</span>
              <span class="stat-value ${p7Tone}">${r7 >= 0 ? '+' : ''}${r7.toFixed(1)}%</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">30D ROI</span>
              <span class="stat-value ${p30Tone}">${r30 >= 0 ? '+' : ''}${r30.toFixed(1)}%</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">AVG INVESTED</span>
              <span class="stat-value neutral">${formatMoney(avgInv)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">ACTIVITY</span>
              <span class="stat-subvalue">${w.activity || 'N/A'}</span>
            </div>
          </div>
        </article>
      `;
    }).join("");
  } catch (renderErr) {
    console.error("[RENDER ERROR] renderTrackedWallets failed:", renderErr);
    el.trackedWalletsGrid.innerHTML = `<div class="trade-meta bad">Error rendering wallets: ${renderErr.message}</div>`;
  }
}

function renderTopMetrics(spot, futures) {
  if (!el.topMetrics) return;
  const items = [
    { label: "Spot Cash", value: formatMoney(spot.balance), tone: "" },
    { label: "Spot Realized PnL", value: formatMoney(spot.realizedPnl), tone: (spot.realizedPnl || 0) >= 0 ? "good" : "bad" },
    { label: "Futures Cash", value: formatMoney(futures.balance), tone: "" },
    { label: "Futures Realized PnL", value: formatMoney(futures.realizedPnl), tone: (futures.realizedPnl || 0) >= 0 ? "good" : "bad" },
  ];

  el.topMetrics.innerHTML = items.map((item) => `
    <article class="metric-card">
      <div class="metric-label">${item.label}</div>
      <div class="metric-value ${item.tone}">${item.value}</div>
    </article>
  `).join("");
}

function renderSummary(target, entries) {
  if (!target) return;
  target.innerHTML = entries.map((entry) => `
    <article class="summary-card">
      <div>
        <div class="summary-label">${entry.label}</div>
        <div class="summary-value">${entry.value}</div>
      </div>
      ${entry.badge ? `<span class="pill-inline">${entry.badge}</span>` : ""}
    </article>
  `).join("");
}

function renderCurve(svg, snapshots, color) {
  if (!svg) return;
  if (!snapshots.length) {
    svg.innerHTML = "";
    return;
  }

  const values = snapshots.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);

  const points = snapshots.map((point, index) => {
    const x = (index / Math.max(snapshots.length - 1, 1)) * 640;
    const y = 200 - ((point.equity - min) / spread) * 170;
    return `${x},${y}`;
  }).join(" ");

  svg.innerHTML = `
    <defs>
      <linearGradient id="curveFill-${svg.id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"></stop>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"></stop>
      </linearGradient>
    </defs>
    <path d="M0 210 L ${points.split(" ").join(" L ")} L 640 210 Z" fill="url(#curveFill-${svg.id})"></path>
    <polyline fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}"></polyline>
  `;
}

function renderTrades(target, trades, fallbackLabel) {
  if (!target) return;
  if (!trades.length) {
    target.innerHTML = `<article class="trade-item"><div class="trade-meta">${fallbackLabel}</div></article>`;
    return;
  }

  target.innerHTML = trades.map((trade) => {
    const side = (trade.type === "ENTRY" ? (trade.side === "buy" ? "LONG" : "SHORT") : "CLOSE").toLowerCase();

    return `
      <article class="trade-item">
        <div class="trade-top">
          <span class="trade-side ${side}">${trade.type === "ENTRY" ? side : "CLOSE"}</span>
          <span class="trade-meta">${formatTime(trade.timestamp)}</span>
        </div>
        <div><strong>${trade.symbol || "-"}</strong></div>
        <div class="trade-meta mono">
          Qty ${formatNumber(trade.amount || 0, 6)} | Entry ${formatMoney(trade.entryPrice || 0)}
          ${trade.exitPrice ? ` | Exit ${formatMoney(trade.exitPrice)}` : ""}
        </div>
        <div class="trade-meta mono">
          ${trade.netPnl !== undefined ? `PnL ${formatMoney(trade.netPnl)} | ` : ""}
          ${trade.pnlPct !== undefined ? `${formatPercent(trade.pnlPct)} | ` : ""}
          ${trade.reason || trade.signalReason || "-"}
        </div>
      </article>
    `;
  }).join("");
}

function renderLogs(logs) {
  if (!el.recentLogs) return;
  if (!logs.length) {
    el.recentLogs.innerHTML = `<article class="log-item"><div class="log-meta">No recent logs available.</div></article>`;
    return;
  }

  el.recentLogs.innerHTML = logs.slice().reverse().map((entry) => `
    <article class="log-item">
      <div class="log-top">
        <strong>${entry.msg || "Engine log"}</strong>
        <span class="log-meta">${formatTime(entry.time)}</span>
      </div>
      <div class="log-meta mono">${JSON.stringify(entry.summary || entry.signal || entry.breakerState || entry, null, 2)}</div>
    </article>
  `).join("");
}

function renderSignalRows(target, candidatesRaw, emptyMessage, type) {
  if (!target) return;
  // Global Filter: Remove garbage tickers
  const candidates = (candidatesRaw || []).filter(c => {
    const sym = (c.token?.symbol || "").trim();
    return sym && sym !== '?' && sym !== '-';
  });

  if (!candidates.length) {
    target.innerHTML = `<article class="trade-item"><div class="trade-meta">${emptyMessage}</div></article>`;
    return;
  }

  target.innerHTML = candidates.map((candidate, index) => {
    const pair = candidate.pair || {};
    const smart = candidate.smartWalletSignal || {};
    const whale = candidate.whaleSignal || {};
    const wallets = type === "whale" ? (whale.wallets || []) : (smart.wallets || []);
    const walletCount = type === "whale" ? (whale.whaleWalletCount || 0) : (smart.walletBuyCount || 0);
    const isMomentum = candidate.tier?.mode === "momentum" && walletCount === 0;
    const flowValue = isMomentum
      ? `Momentum · score ${formatNumber(candidate.score || 0, 0)}`
      : type === "whale"
        ? formatMoney(whale.whaleFlow24hUsd || 0)
        : formatMoney(smart.netAccumulatedUsd || 0);
    const walletLabels = wallets.map((wallet) => wallet.label).join(", ");
    const sourceHint = wallets
      .map((wallet) => wallet.signalSource)
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join(", ");
    const tone = candidate.status === "STRONG_BUY" ? "buy" : candidate.status === "BUY_ZONE" ? "long" : "close";
    const grade = candidate.tier?.grade || "B";
    const accumulation = candidate.labels?.accumulation || "ACCUMULATION_WATCH";
    const rugVal = candidate.rug_status;
    const liqVal = candidate.liq_status;

    console.log("[BADGE DEBUG] SignalRow", candidate.token?.symbol, "-> Rug:", rugVal, "| Liq:", liqVal);

    // Map new Auditor statuses to UI labels
    const rugRisk = (rugVal === 'SAFE' || rugVal === 'LOW') ? 'LOW' : (rugVal === 'WARNING' ? 'WARNING' : (rugVal === 'DANGER' ? 'HIGH' : 'PENDING'));
    const liquiditySafety = liqVal ? liqVal.toUpperCase() : 'PENDING';
    const pairAge = formatHours(candidate.pair?.pairAgeHours);
    const mustBuy = candidate.signals?.mustBuy?.value;
    
    const waktuAkumulasi = candidate.signals?.accumulationHourWIB || (candidate.added_at
      ? new Date(candidate.added_at).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'}) + ' WIB'
      : "—");

    const logoUrl = pair.info?.imageUrl || `https://dd.dexscreener.com/ds-data/tokens/solana/${candidate.token?.mint || ""}.png`;

    return `
      <article class="signal-row" data-briefing-mint="${candidate.token?.mint || ""}">
       <div class="signal-col">
         <div class="trade-top">
           <span class="trade-side ${tone}">#${index + 1} ${candidate.status}</span>
           <span class="trade-meta">${formatTime(candidate.generatedAt)}</span>
         </div>
         <div class="signal-value" style="display: flex; align-items: center; gap: 0.5rem;">
           <img src="${logoUrl}" alt="${candidate.token?.symbol || ""}" style="width: 1.5rem; height: 1.5rem; border-radius: 50%;" onerror="this.src='https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'; this.onerror=null;">
           ${candidate.token?.symbol || "-"} 
           <span class="grade-badge grade-${grade.toLowerCase()}">${grade}</span>
         </div>
         <div class="signal-subvalue mono">${candidate.token?.mint || ""}</div>
       </div>

        <div class="signal-col">
          <div class="signal-kicker">${type === "whale" ? "Whales" : "Smart Wallets"}</div>
          <div class="signal-value">${walletCount}</div>
          <div class="signal-subvalue">${walletLabels || "No wallet labels yet"}${sourceHint ? ` · ${sourceHint}` : ""}</div>
        </div>
        <div class="signal-col">
          <div class="signal-kicker">${type === "whale" ? "Whale Flow 24h" : "Net Flow 24h"}</div>
          <div class="signal-value">${flowValue}</div>
          <div class="signal-subvalue">Liq <span data-live="liquidity">${formatMoney(pair.liquidityUsd || 0)}</span> | MC <span data-live="marketcap">${formatMoney(pair.marketCap || 0)}</span></div>
        </div>
        <div class="signal-col">
          <div class="signal-kicker">Price / 24H</div>
          <div class="signal-value" data-live-price>${formatMoney(pair.priceUsd || 0)}</div>
          <div class="signal-subvalue"><span data-live-pricechange>${formatPercent(pair.priceChange24h || 0)}</span> | Score ${formatNumber(candidate.score || 0, 0)}</div>
        </div>
        <div class="signal-col">
          <div class="signal-kicker">Action</div>
          <div class="signal-value signal-actions">
            ${mustBuy ? '<span class="pill-inline pill-inline-hot">WAJIB BELI</span>' : ""}
            <button class="copy-button" data-copy="${candidate.token?.mint || ""}">Copy CA</button>
            <a class="pill-inline" href="${pair.url || `https://dexscreener.com/solana/${candidate.token?.mint}`}" target="_blank" rel="noreferrer">DEX</a>
            <button type="button" class="btn-blacklist" style="width: 1.5rem; height: 1.5rem; font-size: 0.65rem;" data-blacklist-mint="${candidate.token?.mint || ""}" data-blacklist-symbol="${candidate.token?.symbol || "-"}" title="Blacklist Token">✕</button>
          </div>
          <div class="signal-subvalue">${accumulation} | ${waktuAkumulasi} | Rug ${rugRisk} | Age ${pairAge} | Liq ${liquiditySafety}</div>
        </div>
      </article>
    `;
  }).join("");
}

function tagTone(kind, value) {
  if (kind === "smart" || kind === "whale") {
    const count = Number(value) || 0;
    if (count >= 2) return "tag-good";
    if (count >= 1) return "tag-warn";
    return "tag-neutral";
  }

  const normalized = String(value || "").toUpperCase().trim();
  if (normalized === "LOW" || normalized === "SAFE") return "tag-good";
  if (normalized === "MEDIUM" || normalized === "WATCH") return "tag-warn";
  if (normalized === "HIGH" || normalized === "WEAK") return "tag-bad";
  return "tag-neutral";
}

function applyScoreRings() {
  document.querySelectorAll(".briefing-score-ring[data-score], .phoenix-score[data-score]").forEach((element) => {
    const score = Math.min(100, Math.max(0, Number(element.getAttribute("data-score")) || 0));
    element.style.setProperty("--score-pct", String(score));
  });
}

function shortenMint(mint) {
  if (!mint || mint.length < 12) return mint || "-";
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function phoenixBarTone(score) {
  if (score >= 90) return "fire";
  if (score >= 75) return "hot";
  if (score >= 55) return "warm";
  return "cool";
}

function renderPhoenixSparkline(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return '<div class="phoenix-spark-empty">Menunggu histori holder</div>';
  }

  const values = points.map((p) => Number(p.v) || 0);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 200;
  const h = 48;
  const barW = w / values.length - 2;

  const bars = values
    .map((value, index) => {
      const height = Math.max(4, ((value - min) / range) * (h - 8));
      const x = index * (barW + 2) + 1;
      const y = h - height - 2;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="2" class="phoenix-spark-bar"/>`;
    })
    .join("");

  const lastLabel = points[points.length - 1]?.t
    ? new Date(points[points.length - 1].t).toLocaleDateString("id-ID", { day: "numeric", month: "numeric" })
    : "";

  return `
    <svg class="phoenix-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}</svg>
    <span class="phoenix-spark-label">${lastLabel}</span>
  `;
}

function renderPhoenixScanner(input) {
  // Defensive Unpacking: If passed the whole solanaSmartMoney object, extract phoenixScanner
  const scanner = input?.phoenixScanner || input;

  if (!el.phoenixGrid) {
    console.error("[DOM ERROR] Wadah HTML phoenixGrid tidak ditemukan!");
    return;
  }
  
  if (!scanner || !Array.isArray(scanner.cards)) {
    console.warn("[DATA WARNING] Data phoenixScanner (cards) tidak valid atau kosong!", scanner);
    el.phoenixGrid.innerHTML = '<div class="trade-meta">Menunggu data scanner...</div>';
    return;
  }

  console.log("[RENDER TRACER] renderPhoenixScanner mulai. Cards count:", scanner.cards.length);

  if (el.phoenixSubtitle && scanner.subtitle) {
    el.phoenixSubtitle.textContent = scanner.subtitle;
  }

  const summary = scanner.summary || {};
  const counts = scanner.counts || {};
  const cards = scanner.cards || [];

  if (el.phoenixSummary) {
    el.phoenixSummary.innerHTML = `
      <div class="phoenix-stat phoenix-stat-fire"><span class="phoenix-stat-k">FIRE</span><strong>${summary.fire ?? 0}</strong></div>
      <div class="phoenix-stat phoenix-stat-candidate"><span class="phoenix-stat-k">CANDIDATE</span><strong>${summary.candidate ?? 0}</strong></div>
      <div class="phoenix-stat phoenix-stat-pre"><span class="phoenix-stat-k">PRE-IGN</span><strong>${summary.preIgn ?? 0}</strong></div>
      <div class="phoenix-stat phoenix-stat-total"><span class="phoenix-stat-k">Total tracked</span><strong>${summary.total ?? 0}</strong></div>
      <div class="phoenix-stat phoenix-stat-conv"><span class="phoenix-stat-k">With conviction</span><strong>${summary.withConviction ?? 0}</strong></div>
    `;
  }

  const tabDefs = [
    { id: "ALL", label: "All", count: cards.length },
    { id: "FIRE", label: "FIRE", count: counts.FIRE ?? 0 },
    { id: "CANDIDATE", label: "CANDIDATE", count: counts.CANDIDATE ?? 0 },
    { id: "PRE_IGN", label: "PRE-IGN", count: counts.PRE_IGN ?? 0 },
    { id: "CAPITUL", label: "CAPITUL", count: counts.CAPITUL ?? 0 },
  ];

  if (el.phoenixTabs) {
    el.phoenixTabs.innerHTML = tabDefs
      .map(
        (tab) => `
        <button
          type="button"
          class="phoenix-tab${phoenixActiveFilter === tab.id ? " is-active" : ""}"
          data-phoenix-filter="${tab.id}"
        >${tab.label} (${tab.count})</button>`
      )
      .join("");
  }

  const filtered =
    phoenixActiveFilter === "ALL"
      ? cards
      : cards.filter((card) => card.phoenixTier === phoenixActiveFilter);

  if (!filtered.length) {
    el.phoenixGrid.innerHTML = `
      <div class="phoenix-empty">
        <p>Belum ada token untuk filter <strong>${PHOENIX_TIER_LABELS[phoenixActiveFilter] || phoenixActiveFilter}</strong>.</p>
        <p class="phoenix-empty-hint">Pastikan <code>npm run monitor:solana</code> masih berjalan dan siklus monitor sudah selesai minimal sekali.</p>
      </div>`;
    return;
  }

  try {
    el.phoenixGrid.innerHTML = filtered
      .map((card) => {
      const score = Number(card.phoenixScore || 0);
      const tier = card.phoenixTier || "WATCH";
      const pair = card.pair || {};
      const metrics = card.metrics || {};
      const whales = metrics.whalesH10k || { label: "(flat 0d)", tone: "neutral" };
      const volEx = metrics.volExhaustion || { label: "flat 0d", tone: "neutral" };
      const vol24h = Number(metrics.vol24hUsd || 0);
      const priceChange = Number(pair.priceChange24h || 0);
      const isFire = tier === "FIRE";
      const winRate = Number(card.monitorWinRate ?? card.metrics?.winRate ?? 0);
      const winTone = winRate >= 65 ? "good" : winRate >= 45 ? "warn" : "neutral";
      const logoUrl = pair.info?.imageUrl || `https://dd.dexscreener.com/ds-data/tokens/solana/${card.ca || ""}.png`;

      return `
        <article class="phoenix-card phoenix-card-${tier.toLowerCase()}${isFire ? " phoenix-card-highlight" : ""}${card.persisted ? " phoenix-card-archived" : ""}">
          <header class="phoenix-card-head">
            <img class="phoenix-token-icon" src="${logoUrl}" alt="${card.symbol}" onerror="this.src='https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'; this.onerror=null;">
            <div class="phoenix-card-ident">
              <div class="phoenix-symbol-row">
                <span class="phoenix-symbol">${card.symbol || "-"}</span>
                ${isFire ? '<span class="phoenix-badge-fire">FIRE</span>' : `<span class="phoenix-badge-tier">${PHOENIX_TIER_LABELS[tier] || tier}</span>`}
                ${card.persisted ? '<span class="phoenix-badge-archived">arsip</span>' : ""}
              </div>
              <div class="phoenix-ca-row">
                <code class="phoenix-ca">${shortenMint(card.ca)}</code>
                <button type="button" class="copy-button phoenix-copy" data-copy="${card.ca || ""}" title="Copy CA">⧉</button>
              </div>
            </div>
            <div class="phoenix-score" data-score="${score}">
              <span class="phoenix-score-num">${formatNumber(score, 1)}</span>
            </div>
          </header>

          <div class="phoenix-bar phoenix-bar-${phoenixBarTone(score)}" style="--score-pct: ${score}%"></div>

          <div class="phoenix-card-actions">
            <span class="phoenix-pill">WATCH</span>
            <span class="phoenix-pill phoenix-pill-episode">Episode</span>
            ${card.dexUrl ? `<a class="phoenix-pill phoenix-pill-link" href="${card.dexUrl}" target="_blank" rel="noreferrer">DEX</a>` : ""}
            <button type="button" class="phoenix-pill btn-token-details" data-token-details="${card.ca || ""}">Details</button>
            <button type="button" class="btn-blacklist" style="width: 1.5rem; height: 1.5rem; font-size: 0.65rem;" data-blacklist-mint="${card.ca || ""}" data-blacklist-symbol="${card.symbol || "-"}" title="Blacklist Token">✕</button>
          </div>

          <div class="phoenix-spark-wrap">
            ${renderPhoenixSparkline(card.sparkline?.length ? card.sparkline : card.holderSparklineTotal)}
          </div>

          <div class="phoenix-metrics">
            <div class="phoenix-metric">
              <span class="phoenix-metric-k">ATP (All-Time)</span>
              <span class="phoenix-metric-v">--</span>
            </div>
            <div class="phoenix-metric">
              <span class="phoenix-metric-k">Now</span>
              <span class="phoenix-metric-v">${formatMoney(pair.priceUsd)}</span>
            </div>
            <div class="phoenix-metric">
              <span class="phoenix-metric-k">From ATP</span>
              <span class="phoenix-metric-v ${priceChange >= 0 ? "good" : "bad"}">${formatPercent(priceChange)}</span>
            </div>
            <div class="phoenix-metric phoenix-metric-wide">
              <span class="phoenix-metric-k">Whales h10k floor</span>
              <span class="phoenix-metric-v tone-${whales.tone || "neutral"}">${whales.label}</span>
            </div>
            <div class="phoenix-metric phoenix-metric-wide">
              <span class="phoenix-metric-k">Vol exhaustion</span>
              <span class="phoenix-metric-v tone-${volEx.tone || "neutral"}">${volEx.label}</span>
            </div>
            <div class="phoenix-metric phoenix-metric-wide">
              <span class="phoenix-metric-k">Vol 24h / spike</span>
              <span class="phoenix-metric-v">${formatMoney(vol24h)} · ${metrics.vol24hLabel || "normal"}</span>
            </div>
            <div class="phoenix-metric">
              <span class="phoenix-metric-k">Smart $</span>
              <span class="phoenix-metric-v">${metrics.smartMoney ?? 0}</span>
            </div>
            <div class="phoenix-metric">
              <span class="phoenix-metric-k">Whale</span>
              <span class="phoenix-metric-v">${metrics.whale ?? 0}</span>
            </div>
            <div class="phoenix-metric">
              <span class="phoenix-metric-k">Win rate</span>
              <span class="phoenix-metric-v tone-${winTone}">${formatNumber(winRate, 1)}%</span>
            </div>
            <div class="phoenix-metric phoenix-metric-wide">
              <span class="phoenix-metric-k">WR wallets</span>
              <span class="phoenix-metric-v">${metrics.winRateWallets ?? card.winRateInfo?.walletsWithWinRate ?? 0} tracked</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  } catch (err) {
    console.error("[RENDER ERROR] Phoenix Grid render failed:", err);
  }
}

function renderBriefingEmpty(tier, message) {
  const hints = {
    must: "Bagian ini baru terisi saat smart money, whale, freshness, dan safety sama-sama kuat.",
    fire: "Token perlu score ≥72, rug LOW, likuiditas SAFE. Cek lagi setelah siklus monitor berikutnya.",
    alpha: "Token score ≥62 bisa masuk Alpha (mode momentum) tanpa smart wallet wajib.",
    watch: "Semua kandidat lain akan muncul di kolom ini untuk dipantau.",
  };

  return `
    <div class="briefing-empty">
      <div class="briefing-empty-glow"></div>
      <div class="briefing-empty-icon">${tier === "fire" ? "🔥" : tier === "alpha" ? "⚡" : "👁"}</div>
      <p class="briefing-empty-title">${message}</p>
      <p class="briefing-empty-hint">${hints[tier] || hints.watch}</p>
    </div>
  `;
}

function renderBriefingCards(target, itemsRaw, emptyMessage, tier = "watch") {
  if (!target) return; // Safety check

  // Global Filter: Remove garbage tickers
  const items = (itemsRaw || []).filter(c => {
    const sym = (c.token?.symbol || "").trim();
    return sym && sym !== '?' && sym !== '-';
  });

  if (!items.length) {
    target.innerHTML = renderBriefingEmpty(tier, emptyMessage);
    return;
  }

  target.innerHTML = items.map((candidate) => {
    const mint = candidate.token?.mint || "";
    const { pair, isLive, liveFetchedAt } = getDisplayPairMetrics(candidate);
    
    const monitorAge = formatAge(candidate.dataUpdatedAt || candidate.generatedAt || candidate.added_at);
    const tierKey = candidate.tier?.key || tier;
    const tierBadge = candidate.tier?.badge || candidate.status || "WATCH";
    const grade = String(candidate.tier?.grade || "B").toLowerCase().replace("+", "-plus");
    const isMomentum = candidate.tier?.mode === "momentum";
    const priceChange = Number(pair.priceChange24h || 0);
    const priceTone = priceChange >= 0 ? "good" : "bad";
    
    // Task: Use standardized fields from SQLite without hardcoded defaults
    const rugVal = candidate.rug_status;
    const liqVal = candidate.liq_status;
    const smartVal = candidate.smart_money_count;
    const whaleVal = candidate.whale_count;

    console.log("[BADGE DEBUG]", candidate.token?.symbol, "-> Rug:", rugVal, "| Liq:", liqVal);

    // Map new Auditor statuses to UI labels
    const rugRisk = (rugVal === 'SAFE' || rugVal === 'LOW') ? 'LOW' : (rugVal === 'WARNING' ? 'WARNING' : (rugVal === 'DANGER' ? 'HIGH' : 'PENDING'));
    const liquiditySafety = liqVal ? liqVal.toUpperCase() : 'PENDING';
    
    const smartCount = smartVal != null ? Number(smartVal) : 'N/A';
    const whaleCount = whaleVal != null ? Number(whaleVal) : 'N/A';
    const insiderCount = candidate.insider_count || 0;
    
    const score = Number(candidate.score || 0);
    const mustBuy = candidate.signals?.mustBuy?.value;
    
    // Task: Fix Accumulation Time Formatting
    const waktuAkumulasi = candidate.signals?.accumulationHourWIB || (candidate.added_at 
      ? new Date(candidate.added_at).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'}) + ' WIB' 
      : 'Waktu tidak diketahui');
      
    const liveAgeText = isLive
      ? `Harga & vol live · ${formatAge(liveFetchedAt)}`
      : "Harga & vol · dari SQLite";

    // Task: Link to correct DexScreener template
    const dexUrl = pair.url || `https://dexscreener.com/solana/${mint}`;
    const logoUrl = pair.info?.imageUrl || `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`;

    return `
      <article class="briefing-card briefing-card-${tierKey}${isMomentum ? " briefing-card-momentum" : ""}${isLive ? " briefing-card-has-live" : ""}${candidate.persisted ? " briefing-card-archived" : ""}" data-briefing-mint="${mint}">
        <div class="briefing-card-top">
          <div class="briefing-card-ident">
            <div class="briefing-card-symbol-row">
              <img class="briefing-token-icon" src="${logoUrl}" alt="${candidate.token?.symbol || ""}" onerror="this.src='https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'; this.onerror=null;">
              <span class="briefing-card-symbol">${candidate.token?.symbol || "-"}</span>
              <span class="grade-badge grade-${grade}">${candidate.tier?.grade || "B"}</span>
              ${isMomentum ? '<span class="briefing-momentum-badge">Momentum</span>' : ""}
              ${candidate.persisted ? '<span class="briefing-archived-badge">arsip</span>' : ""}
            </div>
            <p class="briefing-card-sub">${candidate.tier?.subtitle || candidate.timing || "-"}</p>
            <p class="briefing-card-age" data-live-age>${liveAgeText}</p>
            <p class="briefing-card-age briefing-card-age-monitor">Score & sinyal · ${monitorAge}</p>
          </div>
          <div class="briefing-score-ring" data-score="${score}">
            <span class="briefing-score-value">${formatNumber(score, 0)}</span>
            <span class="briefing-score-label">Score</span>
          </div>
        </div>
        <div class="briefing-stat-grid${isLive ? " briefing-stat-grid-live" : ""}">
          <div class="briefing-stat briefing-stat-wide">
            <span class="briefing-stat-label">Price ${isLive ? '<span class="live-dot">LIVE</span>' : ""}</span>
            <span class="briefing-stat-value" data-live-price>$${formatMoney(pair.priceUsd || 0)}</span>
          </div>
          <div class="briefing-stat">
            <span class="briefing-stat-label">Market Cap</span>
            <span class="briefing-stat-value" data-live="marketcap">${formatMoney(pair.marketCap || 0)}</span>
          </div>
          <div class="briefing-stat">
            <span class="briefing-stat-label">Vol 24h</span>
            <span class="briefing-stat-value" data-live="volume">${formatMoney(pair.volume24hUsd || 0)}</span>
          </div>
          <div class="briefing-stat">
            <span class="briefing-stat-label">Harga 24h</span>
            <span class="briefing-stat-value ${priceTone}" data-live-pricechange>${formatPercent(priceChange)}</span>
          </div>
          <div class="briefing-stat">
            <span class="briefing-stat-label">Likuiditas</span>
            <span class="briefing-stat-value" data-live="liquidity">${formatMoney(pair.liquidityUsd || 0)}</span>
          </div>
        </div>
        <div class="briefing-tag-row">
          <span class="briefing-pill briefing-pill-tier">${tierBadge}</span>
          ${mustBuy ? '<span class="tag tag-hot">WAJIB BELI</span>' : ""}
          <span class="tag ${tagTone("smart", smartCount)}" title="Smart Money Wallets">Smart ${smartCount}</span>
          <span class="tag ${tagTone("whale", whaleCount)}" title="Whale Wallets">Whale ${whaleCount}</span>
          ${insiderCount > 0 ? `<span class="tag tag-insider" title="Potential Insider Wallets">Insider ${insiderCount}</span>` : ""}
          <span class="tag ${tagTone("rug", rugRisk)}">Rug ${rugRisk}</span>
          <span class="tag ${tagTone("liq", liquiditySafety)}">Liq ${liquiditySafety}</span>
        </div>
        <footer class="briefing-card-foot">
          <code class="briefing-ca" title="${mint}">${mint}</code>
          <span class="briefing-mini">${waktuAkumulasi}</span>
          <div class="briefing-card-actions">
            <button type="button" class="btn-paper-buy" data-action="manualBuy" data-address="${mint}" data-symbol="${candidate.token?.symbol || "-"}" data-price="${pair.priceUsd || 0}">🚀 BUY (Paper)</button>
            <button type="button" class="btn-token-details" data-token-details="${mint}">Token Details</button>
            <button type="button" class="copy-button" data-copy="${mint}">Copy CA</button>
            <a class="btn-dex" href="${dexUrl}" target="_blank" rel="noreferrer">DexScreener ↗</a>
            <button type="button" class="btn-blacklist" data-blacklist-mint="${mint}" data-blacklist-symbol="${candidate.token?.symbol || "-"}" title="Blacklist Token">✕</button>
          </div>
        </footer>
      </article>
    `;
  }).join("");
}

function findCandidateByMint(mint) {
  if (!mint || !lastSolanaPayload) return null;
  return (lastSolanaPayload.candidates || []).find((entry) => entry.token?.mint === mint) || null;
}

function renderTokenDetailsSummary(analytics, candidate, livePair) {
  if (!el.tokenDetailsSummary) return;
  if (!analytics) {
    el.tokenDetailsSummary.innerHTML = `<p class="trade-meta">HolderScan belum tersedia untuk token ini. Tunggu 1–2 siklus monitor atau buka lagi nanti.</p>`;
    return;
  }

  const pair = livePair || candidate?.pair || {};
  const mint = tokenDetailsState.mint || analytics.mint;
  const prev = (lastSolanaPayload?.tokenHolderDetails?.history?.[mint] || []).slice(-2)[0];

  const cards = [
    { label: "Total Holders", value: analytics.totalHolders, prev: prev?.totalHolders },
    { label: "Under $10", value: analytics.tiers?.under10, prev: prev?.under10 },
    { label: "Over $100", value: analytics.tiers?.over100, prev: prev?.over100 },
    { label: "Over $1K", value: analytics.tiers?.over1k, prev: prev?.over1k },
    { label: "Over $10K", value: analytics.tiers?.over10k, prev: prev?.over10k },
    { label: "Smart Money", value: analytics.smartMoney?.count, prev: prev?.smartMoney },
    { label: "Whale", value: analytics.whale?.count, prev: prev?.whale },
  ];

  el.tokenDetailsSummary.innerHTML = `
    <div class="token-details-price-row">
      <span>Harga live: <strong>${formatMoney(pair.priceUsd)}</strong></span>
      <span>24h: <strong class="${Number(pair.priceChange24h) >= 0 ? "good" : "bad"}">${formatPercent(pair.priceChange24h || 0)}</strong></span>
      <span>MC: ${formatMoney(pair.marketCap || 0)}</span>
      <span class="token-details-live-tag">${livePair ? "DexScreener live" : "Data monitor"}</span>
    </div>
    <div class="holder-tier-summary token-details-tier-grid">
      ${cards
        .map((card) => {
          const change = card.prev != null ? formatSignedChange(card.value, card.prev) : null;
          return `
            <article class="holder-stat-card">
              <div class="holder-stat-label">${card.label}</div>
              <div class="holder-stat-value">${formatHolderValue(card.value)}</div>
              <div class="holder-stat-change ${change ? change.tone : ""}">${change ? change.label : "—"}</div>
            </article>`;
        })
        .join("")}
    </div>`;
}

function renderTokenDetailsSeriesToggles() {
  if (!el.tokenDetailsSeries) return;
  el.tokenDetailsSeries.innerHTML = HOLDER_CHART_SERIES.map((series) => {
    const active = tokenDetailsState.activeSeries.includes(series.key);
    return `<button type="button" class="token-details-series-btn${active ? " is-active" : ""}" data-td-series="${series.key}">
      <span class="legend-dot" style="background:${series.color}"></span>${series.label}
    </button>`;
  }).join("");
}

function renderTokenDetailsChanges(series) {
  if (!el.tokenDetailsChanges || series.length < 2) {
    if (el.tokenDetailsChanges) {
      el.tokenDetailsChanges.innerHTML = `<span class="trade-meta">Perubahan tier muncul setelah 2+ titik histori.</span>`;
    }
    return;
  }

  const first = series[0];
  const last = series[series.length - 1];
  el.tokenDetailsChanges.innerHTML = HOLDER_CHART_SERIES.filter((def) =>
    tokenDetailsState.activeSeries.includes(def.key)
  )
    .map((def) => {
      const change = formatSignedChange(last[def.key], first[def.key]);
      return `<span class="token-details-change ${change.tone}">${def.label}: ${change.label}</span>`;
    })
    .join("");
}

function renderTokenDetailsChart(historySeries) {
  const svg = el.tokenDetailsChart;
  if (!svg) return;

  const intervalMs = tokenDetailsState.interval === "4h" ? 4 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const ranged = filterHolderHistoryRange(historySeries, tokenDetailsState.range);
  const bucketed = bucketHolderHistory(ranged, intervalMs);
  const activeDefs = HOLDER_CHART_SERIES.filter((def) => tokenDetailsState.activeSeries.includes(def.key));

  renderTokenDetailsChanges(bucketed);

  if (bucketed.length < 2 || !activeDefs.length) {
    svg.innerHTML = `<text x="550" y="160" fill="#8b9cb3" font-size="14" text-anchor="middle">Chart butuh minimal 2 snapshot holder (biarkan monitor jalan beberapa siklus).</text>`;
    return;
  }

  const width = 1100;
  const height = 320;
  const pad = { top: 24, right: 56, bottom: 36, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = bucketed.flatMap((point) => activeDefs.map((def) => Number(point[def.key] ?? 0)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = pad.top + innerH * (1 - ratio);
      const label = Math.round(min + spread * ratio);
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(148,178,207,0.12)" />
        <text x="${pad.left - 8}" y="${y + 4}" fill="#8b9cb3" font-size="10" text-anchor="end">${label}</text>`;
    })
    .join("");

  const lines = activeDefs
    .map((def) => {
      const points = bucketed
        .map((point, index) => {
          const x = pad.left + (index / Math.max(bucketed.length - 1, 1)) * innerW;
          const y = pad.top + innerH - ((Number(point[def.key] ?? 0) - min) / spread) * innerH;
          return `${x},${y}`;
        })
        .join(" ");
      return `<polyline fill="none" stroke="${def.color}" stroke-width="2.5" points="${points}" />`;
    })
    .join("");

  const labels = bucketed
    .filter((_, index) => index === 0 || index === bucketed.length - 1 || index % Math.ceil(bucketed.length / 6) === 0)
    .map((point, index, list) => {
      const fullIndex = bucketed.indexOf(point);
      const x = pad.left + (fullIndex / Math.max(bucketed.length - 1, 1)) * innerW;
      const date = new Date(point.timestamp).toLocaleString("id-ID", { month: "short", day: "numeric", hour: "2-digit" });
      return `<text x="${x}" y="${height - 10}" fill="#8b9cb3" font-size="10" text-anchor="middle">${date}</text>`;
    })
    .join("");

  svg.innerHTML = `<rect width="${width}" height="${height}" fill="transparent"/>${grid}${lines}${labels}`;
}

async function openTokenDetailsModal(mint) {
  if (!el.tokenDetailsDialog || !mint) return;

  const candidate = findCandidateByMint(mint);
  const details = lastSolanaPayload?.tokenHolderDetails || {};
  const analytics = details.byMint?.[mint] || candidate?.holderAnalytics || null;
  const history = details.history?.[mint] || [];
  const symbol = candidate?.token?.symbol || analytics?.symbol || mint.slice(0, 8);

  tokenDetailsState.mint = mint;

  el.tokenDetailsTitle.textContent = symbol;
  el.tokenDetailsEyebrow.textContent = candidate?.labels?.accumulation?.replace(/_/g, " ") || "TOKEN DETAILS";
  el.tokenDetailsMeta.textContent = `${mint} · histori ${history.length} titik · ${formatAge(analytics?.fetchedAt || candidate?.dataUpdatedAt)}`;

  renderTokenDetailsSeriesToggles();
  renderTokenDetailsSummary(analytics, candidate, null);
  renderHolderWalletList(el.tokenDetailsSmartList, analytics?.smartMoney?.wallets || [], "Belum ada smart holder terdeteksi.");
  renderHolderWalletList(el.tokenDetailsWhaleList, analytics?.whale?.wallets || [], "Belum ada whale holder terdeteksi.");
  renderTokenDetailsChart(history);

  el.tokenDetailsDialog.querySelectorAll("[data-td-interval]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tdInterval === tokenDetailsState.interval);
  });
  el.tokenDetailsDialog.querySelectorAll("[data-td-range]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tdRange === tokenDetailsState.range);
  });

  el.tokenDetailsDialog.showModal();

  // Task: Live fetch removed to prevent browser 429/CORS
  /*
  const livePair = await fetchLivePairSnapshot(mint);
  if (tokenDetailsState.mint === mint && livePair) {
    renderTokenDetailsSummary(analytics, candidate, livePair);
    if (el.tokenDetailsMeta) {
      el.tokenDetailsMeta.textContent = `${mint} · harga live ${formatAge(livePair.fetchedAt)} · histori ${history.length} titik`;
    }
  }
  */
}

function attachCopyHandlers() {
  document.querySelectorAll(".copy-button").forEach((button) => {
    button.onclick = async () => {
      const value = button.getAttribute("data-copy") || "";
      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
        const original = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = original;
        }, 1200);
      } catch {
        button.textContent = "Failed";
      }
    };
  });
}

function renderProviderHealth(payload) {
  const status = payload?.providerStatus || {};
  const cards = [
    {
      label: "DexScreener",
      value: status.dexscreener ? "Online" : "Issue",
      note: `${status.latestProfilesTracked || 0} profiles | ${status.discoveryCandidates || 0} discovery`,
      tone: status.dexscreener ? "good" : "bad",
    },
    {
      label: "GoPlus",
      value: status.goplus ? "Configured" : "Missing key",
      note: "Anti-rug security checks",
      tone: status.goplus ? "good" : "bad",
    },
    {
      label: "Helius",
      value: status.helius ? "Configured" : "Missing key",
      note: "Wallet flow and swap traces",
      tone: status.helius ? "good" : "bad",
    },
    {
      label: "Birdeye",
      value: status.birdeye ? "Configured" : "Missing key",
      note: "Wallet PnL and profiling",
      tone: status.birdeye ? "good" : "bad",
    },
  ];

  el.providerStatus.innerHTML = cards.map((card) => `
    <article class="metric-card">
      <div class="metric-label">${card.label}</div>
      <div class="metric-value ${card.tone}">${card.value}</div>
      <div class="trade-meta">${card.note}</div>
    </article>
  `).join("");
}

function renderDiscovery(payload) {
  const solanaSmartMoney = payload?.solanaSmartMoney || {};
  const allItems = solanaSmartMoney.candidates || [];
  
  const discoveryFire = allItems.filter(i => i.status === "DISCOVERY_FIRE" || (i.status === "STRONG_BUY" && String(i.timeframe).toUpperCase() === 'DISCOVERY'));
  const discoveryAlpha = allItems.filter(i => i.status === "DISCOVERY_ALPHA" || (i.status === "BUY_ZONE" && String(i.timeframe).toUpperCase() === 'DISCOVERY'));

  if (el.solanaDiscoveryFire) renderBriefingCards(el.solanaDiscoveryFire, discoveryFire, "Belum ada discovery FIRE.");
  if (el.solanaDiscoveryAlpha) renderBriefingCards(el.solanaDiscoveryAlpha, discoveryAlpha, "Belum ada discovery ALPHA.");
}

function renderTimeframeMonitorList(payload) {
  // Task: Robust payload unpacking (Look at root OR nested in solanaSmartMoney)
  const sections = payload?.timeframeSections || payload?.solanaSmartMoney?.timeframeSections;
  const stats = payload?.filterStats || payload?.solanaSmartMoney?.filterStats;

  console.log("[RENDER TRACER] renderTimeframeMonitorList dipanggil. Sections found:", !!sections);

  if (el.timeframeFilterStats) {
    if (!stats) {
      el.timeframeFilterStats.textContent = "Menunggu siklus monitor";
    } else {
      el.timeframeFilterStats.textContent = `${stats.monitored} monitor · ${stats.excluded} dikecualikan`;
      el.timeframeFilterStats.title = stats.exclusionCounts
        ? `Rug HIGH: ${stats.exclusionCounts.RUG_HIGH || 0} · Liq WEAK: ${stats.exclusionCounts.LIQ_WEAK || 0}`
        : "";
    }
  }

  if (!sections) {
    const empty = '<div class="trade-meta">Belum ada daftar timeframe. Tunggu siklus monitor selesai.</div>';
    if (el.timeframe1hList) el.timeframe1hList.innerHTML = empty;
    if (el.timeframe4hList) el.timeframe4hList.innerHTML = empty;
    if (el.timeframe1dList) el.timeframe1dList.innerHTML = empty;
    return;
  }

  const summary = sections.summary || {};
  if (el.timeframeChips) {
    el.timeframeChips.innerHTML = `
      <span class="briefing-chip briefing-chip-ok">1H · ${summary["1hour"]?.count || 0} · WR ${formatNumber(summary["1hour"]?.avgWinRate || 0, 1)}%</span>
      <span class="briefing-chip briefing-chip-ok">4H · ${summary["4hour"]?.count || 0} · WR ${formatNumber(summary["4hour"]?.avgWinRate || 0, 1)}%</span>
      <span class="briefing-chip briefing-chip-ok">1D · ${summary["1day"]?.count || 0} · WR ${formatNumber(summary["1day"]?.avgWinRate || 0, 1)}%</span>
    `;
  }

  const renderCol = (target, countEl, itemsRaw, emptyMsg) => {
    if (!target) {
      console.error("[DOM ERROR] Wadah HTML (renderCol) tidak ditemukan!");
      return;
    }

    // Defensive Unpacking: Ensure items is an array
    const items = (Array.isArray(itemsRaw) ? itemsRaw : []).filter(c => {
      const sym = (c.token?.symbol || "").trim();
      return sym && sym !== '?' && sym !== '-';
    });

    if (countEl) countEl.textContent = String(items.length);
    if (!items.length) {
      target.innerHTML = `<div class="trade-meta">${emptyMsg}</div>`;
      return;
    }

    try {
      target.innerHTML = items
        .map((candidate) => {
          const metrics = candidate.timeframeMetrics || {};
          const winRate = Number(metrics.winRate || candidate.monitorWinRate || 0);
          const winTone = winRate >= 65 ? "good" : winRate >= 45 ? "warn" : "neutral";
          
          // Task: Special badge for DISCOVERY
          const isDiscovery = String(candidate.timeframe).toUpperCase() === 'DISCOVERY';
          const tfBadge = isDiscovery 
            ? '<span class="timeframe-tag timeframe-tag-new">NEW</span>' 
            : (metrics.persisted ? '<span class="timeframe-tag">arsip</span>' : "");
          
          const logoUrl = candidate.pair?.info?.imageUrl || `https://dd.dexscreener.com/ds-data/tokens/solana/${candidate.token?.mint || ""}.png`;

          return `
            <div class="timeframe-row ${isDiscovery ? 'timeframe-row-discovery' : ''}" data-briefing-mint="${candidate.token?.mint || ""}">
              <div class="timeframe-row-main">
                <div class="timeframe-token-ident">
                  <img class="timeframe-token-icon" src="${logoUrl}" alt="${candidate.token?.symbol || ""}" onerror="this.src='https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'; this.onerror=null;">
                  <strong>${candidate.token?.symbol || "-"}</strong>
                </div>
                <span class="timeframe-win ${winTone}">${formatNumber(winRate, 1)}% WR</span>
              </div>
              <div class="timeframe-row-meta">
                <span>$ <span data-live-price>${formatMoney(candidate.pair?.priceUsd || 0)}</span></span>
                <span data-live-pricechange class="${(candidate.pair?.priceChange24h || 0) >= 0 ? 'good' : 'bad'}">${formatPercent(candidate.pair?.priceChange24h || 0)}</span>
                <span>MC <span data-live="marketcap">${formatMoney(candidate.pair?.marketCap || 0)}</span></span>
              </div>
              <div class="timeframe-row-meta">
                <span>Vol <span data-live="volume">${formatMoney(candidate.pair?.volume24hUsd || 0)}</span></span>
                <span>Liq <span data-live="liquidity">${formatMoney(candidate.pair?.liquidityUsd || 0)}</span></span>
              </div>
              <div class="timeframe-row-meta">
                <span>Score ${formatNumber(candidate.score || 0, 0)}</span>
                <span>Smart ${candidate.smart_money_count || 0}</span>
                ${candidate.insider_count > 0 ? `<span class="tag-insider-xs">Ins ${candidate.insider_count}</span>` : ""}
                ${tfBadge}
              </div>
              <div class="timeframe-row-actions" style="display: flex; gap: 0.4rem; align-items: center; margin-top: 0.45rem;">
                <button type="button" class="btn-token-details btn-token-details-sm" data-token-details="${candidate.token?.mint || ""}">Details</button>
                <a class="btn-dex" style="padding: 0.2rem 0.5rem; font-size: 0.68rem;" href="https://dexscreener.com/solana/${candidate.token?.mint || ""}" target="_blank" rel="noreferrer">Dex ↗</a>
                <button type="button" class="btn-blacklist" style="width: 1.5rem; height: 1.5rem; font-size: 0.65rem;" data-blacklist-mint="${candidate.token?.mint || ""}" data-blacklist-symbol="${candidate.token?.symbol || "-"}" title="Blacklist Token">✕</button>
              </div>
            </div>
          `;
        })
        .join("");
    } catch (renderErr) {
      console.error("[RENDER ERROR] renderCol map failed:", renderErr);
    }
  };

  renderCol(el.timeframe1hList, el.timeframe1hCount, sections.sections?.["1hour"]?.items, "Belum ada koin dengan akumulasi ≤1 jam.");
  renderCol(el.timeframe4hList, el.timeframe4hCount, sections.sections?.["4hour"]?.items, "Belum ada koin dengan akumulasi ≤4 jam.");
  renderCol(el.timeframe1dList, el.timeframe1dCount, sections.sections?.["1day"]?.items, "Belum ada koin dengan akumulasi ≤24 jam.");
}

function renderMorningBriefing(input) {
  console.log("[RENDER TRACER] renderMorningBriefing dipanggil.");
  
  // Defensive Unpacking: If passed the whole solanaSmartMoney object, extract candidates
  const candidates = Array.isArray(input) ? input : (input?.candidates || []);

  if (!Array.isArray(candidates)) {
    console.error("[RENDER ERROR] renderMorningBriefing: Parameter yang diterima bukan Array!", candidates);
    return;
  }

  // Global Filter: Remove garbage tickers and ensure basic data
  const validTokens = candidates.filter(c => {
    const sym = (c.token?.symbol || "").trim();
    return sym && sym !== '?' && sym !== '-' && c.token?.mint;
  });

  // Categorization with Type Casting & Score-First Priority
  const mustBuy = validTokens.filter(c => {
    const score = Number(c.score || 0);
    return score >= 85;
  });

  const fire = validTokens.filter(c => {
    const score = Number(c.score || 0);
    return score >= 72 && score < 85;
  });

  const alpha = validTokens.filter(c => {
    const score = Number(c.score || 0);
    return score >= 60 && score < 72;
  });

  // Catch-all Watchlist: Every valid token not in upper tiers must appear here
  const watchlist = validTokens.filter(c => 
    !mustBuy.some(m => m.token?.mint === c.token?.mint) && 
    !fire.some(f => f.token?.mint === c.token?.mint) && 
    !alpha.some(a => a.token?.mint === c.token?.mint)
  );

  console.log(`[DEBUG BRIEFING] Total koin diterima: ${validTokens.length} | Wajib: ${mustBuy.length} | FIRE: ${fire.length} | Alpha: ${alpha.length} | Watchlist: ${watchlist.length}`);

  if (el.briefingTime) {
    const genAt = input?.generatedAt || new Date().toISOString();
    el.briefingTime.textContent = formatTime(genAt);
  }

  if (el.mustBuyCount) el.mustBuyCount.textContent = String(mustBuy.length);
  if (el.fireCount) el.fireCount.textContent = String(fire.length);
  if (el.alphaCount) el.alphaCount.textContent = String(alpha.length);
  if (el.watchCount) el.watchCount.textContent = String(watchlist.length);

  if (el.briefingChips) {
    el.briefingChips.innerHTML = `
      <span class="briefing-chip briefing-chip-hot"><span class="chip-dot"></span>${mustBuy.length} WAJIB BELI</span>
      <span class="briefing-chip briefing-chip-fire"><span class="chip-dot"></span>${fire.length} FIRE</span>
      <span class="briefing-chip briefing-chip-alpha"><span class="chip-dot"></span>${alpha.length} ALPHA</span>
      <span class="briefing-chip briefing-chip-watch"><span class="chip-dot"></span>${watchlist.length} WATCHLIST</span>
    `;
  }

  renderBriefingCards(el.briefingMustBuy, mustBuy, "Belum ada kandidat wajib beli saat ini", "must");
  renderBriefingCards(el.briefingFire, fire, "Belum ada kandidat FIRE hari ini", "fire");
  renderBriefingCards(el.briefingAlpha, alpha, "Belum ada kandidat ALPHA hari ini", "alpha");
  renderBriefingCards(el.briefingWatchlist, watchlist, "Belum ada kandidat watchlist", "watch");
}

function renderSolanaCandidates(payload) {
  const mustBuyRowsRaw = Array.isArray(payload?.mustBuyNow) ? payload.mustBuyNow : [];
  const smartRowsRaw = Array.isArray(payload?.smartMoneyBuying24h) ? payload.smartMoneyBuying24h : [];
  const whaleRowsRaw = Array.isArray(payload?.whaleBuying24h) ? payload.whaleBuying24h : [];

  // Global Filter: Remove garbage tickers
  const filterGarbage = (list) => (list || []).filter(c => {
    const sym = (c.token?.symbol || "").trim();
    return sym && sym !== '?' && sym !== '-';
  });

  const mustBuyRows = filterGarbage(mustBuyRowsRaw);
  const smartRows = filterGarbage(smartRowsRaw);
  const whaleRows = filterGarbage(whaleRowsRaw);

  const guide = payload?.differenceGuide || {};

  if (el.whaleGuideText) el.whaleGuideText.textContent = guide.whaleBuying || "Whale buying menyorot wallet dengan arus modal besar dalam 24 jam.";
  if (el.smartGuideText) el.smartGuideText.textContent = guide.smartMoney || "Smart money menyorot wallet berkualitas yang aktif akumulasi dalam 24 jam.";
  if (el.smartMoneyRule) el.smartMoneyRule.textContent = guide.ruleOfThumb || "Saat dua sinyal aktif pada token yang sama, konviksi setup biasanya lebih tinggi. Mode momentum: token score tinggi boleh tampil tanpa akumulasi wallet 24h.";


  const walletCount = payload?.watchlistStats?.smartWallets ?? 0;
  const smartEmpty =
    walletCount === 0
      ? "Watchlist smart wallet masih kosong — tunggu siklus Birdeye selesai (token_trending + top_traders)."
      : "Belum ada akumulasi 24h terdeteksi. Setelah 2–3 siklus monitor, cek lagi (saldo on-chain, Helius swap, atau top trader pada mint yang sama).";
  const whaleEmpty =
    "Belum ada whale flow ≥ ambang USD. Turunkan SOLANA_MIN_WHALE_ACCUMULATION_USD atau tunggu HolderScan / top trader volume besar.";

  renderSignalRows(
    el.solanaMustBuy,
    mustBuyRows,
    "Belum ada koin yang lolos status WAJIB BELI. Sistem menunggu konfirmasi smart money + whale yang masih fresh.",
    "smart"
  );
  renderSignalRows(el.solanaSmartMoney, smartRows, smartEmpty, "smart");
  renderSignalRows(el.solanaWhaleBuying, whaleRows, whaleEmpty, "whale");
}

function formatSignedChange(current, previous) {
  const delta = Number(current || 0) - Number(previous || 0);
  const pct = previous ? (delta / Number(previous)) * 100 : 0;
  const tone = delta >= 0 ? "good" : "bad";
  const sign = delta >= 0 ? "+" : "";
  return {
    delta,
    pct,
    tone,
    label: `${sign}${formatNumber(delta, 0)} (${sign}${pct.toFixed(1)}%)`,
  };
}

function renderHolderTierSummary(analytics, historySeries) {
  if (!analytics) {
    el.holderTierSummary.innerHTML = `<div class="trade-meta">Pilih token atau tunggu siklus monitor berikutnya.</div>`;
    return;
  }

  const prev = historySeries.length >= 2 ? historySeries[historySeries.length - 2] : null;
  const cur = historySeries.length ? historySeries[historySeries.length - 1] : null;

  const cards = [
    { key: "total", label: "Total Holders", value: analytics?.totalHolders || 0, prev: prev?.totalHolders, tone: "neutral" },
    { key: "under10", label: "Under $10", value: analytics?.tiers?.under10 || 0, prev: prev?.under10, sample: true },
    { key: "over100", label: "Over $100", value: analytics?.tiers?.over100 || 0, prev: prev?.over100, sample: true },
    { key: "over1k", label: "Over $1K", value: analytics?.tiers?.over1k || 0, prev: prev?.over1k, sample: true },
    { key: "over10k", label: "Over $10K", value: analytics?.tiers?.over10k || 0, prev: prev?.over10k, sample: true },
    { key: "smart", label: "Smart Money", value: analytics?.smartMoney?.count || 0, prev: prev?.smartMoney, tone: "smart" },
    { key: "whale", label: "Whale", value: analytics?.whale?.count || 0, prev: prev?.whale, tone: "whale" },
  ];

  el.holderTierSummary.innerHTML = cards.map((card) => {
    const change = card.prev != null ? formatSignedChange(card.value, card.prev) : null;
    return `
      <article class="holder-stat-card holder-stat-${card.key}">
        <div class="holder-stat-label">${card.label}${card.sample ? ` <span class="holder-stat-note">top ${analytics?.sampledHolders || 0}</span>` : ""}</div>
        <div class="holder-stat-value">${formatHolderValue(card.value)}</div>
        <div class="holder-stat-change ${change ? change.tone : ""}">${change ? change.label : "—"}</div>
      </article>
    `;
  }).join("");
}

function renderHolderChart(analytics) {
  if (!el.holderDistributionChart) return;

  const ctx = el.holderDistributionChart.getContext('2d');
  if (holderDistributionChartInstance) {
    holderDistributionChartInstance.destroy();
  }

  if (!analytics || !analytics.tiers) {
    return;
  }

  const tiers = analytics.tiers;
  const data = [
    Number(tiers.under10 || 0),
    Number(tiers.over100 || 0),
    Number(tiers.over1k || 0),
    Number(tiers.over10k || 0)
  ];

  // Neon Theme
  const colors = [
    'rgba(148, 163, 184, 0.8)', // Retail (Under $10) - Slate
    'rgba(251, 146, 60, 0.8)',  // Mid (Over $100) - Orange
    'rgba(96, 165, 250, 0.8)',  // Whale (Over $1k) - Blue
    'rgba(74, 222, 128, 0.8)'   // Mega Whale (Over $10k) - Green
  ];

  const borderColors = [
    '#94a3b8',
    '#fb923c',
    '#60a5fa',
    '#4ade80'
  ];

  holderDistributionChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Under $10', 'Over $100', 'Over $1k', 'Over $10k'],
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: borderColors,
        borderWidth: 1,
        hoverOffset: 10
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#8b9cb3',
            font: { size: 10, family: 'DM Sans' },
            padding: 15,
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.raw || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return ` ${label}: ${value.toLocaleString()} holders (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

function renderHolderHistoryChart(historySeries) {
  const svg = el.holderTierChart;
  if (!historySeries || historySeries.length === 0) {
    svg.innerHTML = `<text x="480" y="140" fill="#8b9cb3" font-size="14" text-anchor="middle">Data histori belum tersedia</text>`;
    return;
  }

  // Task: Force render even with 1 point by duplicating it to create a short line
  const effectiveSeries = historySeries.length === 1 
    ? [{...historySeries[0], timestamp: historySeries[0].timestamp - 1000}, historySeries[0]]
    : historySeries;

  const seriesDefs = [
    { key: "smartMoney", color: "#a78bfa", label: "Smart Money" },
    { key: "whale", color: "#fb923c", label: "Whale" },
    { key: "over10k", color: "#5eead4", label: "Over $10K" },
    { key: "totalHolders", color: "#f0f6fc", label: "Total" },
  ];

  const width = 960;
  const height = 280;
  const pad = { top: 20, right: 20, bottom: 30, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const allValues = effectiveSeries.flatMap((point) => seriesDefs.map((s) => point[s.key] ?? 0));
  const min = 0;
  const max = Math.max(...allValues) || 10;
  const spread = Math.max(max - min, 1);

  const lines = seriesDefs.map((series) => {
    const points = effectiveSeries.map((point, index) => {
      const x = pad.left + (index / Math.max(effectiveSeries.length - 1, 1)) * innerW;
      const y = pad.top + innerH - (((point[series.key] ?? 0) - min) / spread) * innerH;
      return `${x},${y}`;
    }).join(" ");
    return `<polyline fill="none" stroke="${series.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}" opacity="0.9"></polyline>`;
  }).join("");

  el.holderChartLegend.innerHTML = seriesDefs.map((s) => `
    <span class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label}</span>
  `).join("");

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    ${lines}
  `;
}

function renderHolderWalletList(target, wallets, emptyText) {
  if (!wallets?.length) {
    target.innerHTML = `<div class="holder-wallet-empty">${emptyText}</div>`;
    return;
  }

  target.innerHTML = wallets.map((wallet) => `
    <div class="holder-wallet-row">
      <code class="holder-wallet-addr">${wallet.address}</code>
      <span class="holder-wallet-meta">${wallet.holdingUsd != null ? formatMoney(wallet.holdingUsd) : formatMoney(wallet.volumeUsd24h || 0)} · ${wallet.source || "holder"}</span>
    </div>
  `).join("");
}

function renderTokenHolderDetails(solanaPayload, candidates) {
  const details = solanaPayload?.tokenHolderDetails || {};
  const byMint = details.byMint || {};
  const history = details.history || {};

  const mintMap = new Map();
  for (const candidate of candidates || []) {
    if (candidate?.token?.mint) {
      mintMap.set(candidate.token.mint, candidate.token.symbol || candidate.token.mint.slice(0, 8));
    }
  }
  for (const [mint, analytics] of Object.entries(byMint)) {
    if (!mintMap.has(mint)) {
      mintMap.set(mint, analytics.symbol || mint.slice(0, 8));
    }
  }

  const mintEntries = [...mintMap.entries()];
  if (!mintEntries.length) {
    el.tokenDetailSelect.innerHTML = `<option value="">—</option>`;
    renderHolderTierSummary(null, []);
    renderHolderChart(null);
    renderHolderHistoryChart([]);
    renderHolderWalletList(el.holderSmartList, [], "Belum ada data smart money.");
    renderHolderWalletList(el.holderWhaleList, [], "Belum ada data whale.");
    return;
  }

  const selectedMint = el.tokenDetailSelect.value || details.featuredMint || mintEntries[0][0];
  el.tokenDetailSelect.innerHTML = mintEntries
    .map(([mint, symbol]) => `<option value="${mint}" ${mint === selectedMint ? "selected" : ""}>${symbol}</option>`)
    .join("");

  const analytics =
    byMint[selectedMint] ||
    (candidates || []).find((entry) => entry.token?.mint === selectedMint)?.holderAnalytics;

  const series = history[selectedMint] || [];
  renderHolderTierSummary(analytics, series);
  renderHolderChart(analytics);
  renderHolderHistoryChart(series);
  renderHolderWalletList(
    el.holderSmartList,
    analytics?.smartMoney?.wallets || [],
    "Tidak ada smart wallet terdeteksi di top holder untuk token ini."
  );
  renderHolderWalletList(
    el.holderWhaleList,
    analytics?.whale?.wallets || [],
    `Tidak ada holder ≥ ${formatMoney(analytics?.whale?.thresholdUsd || 10000)}.`
  );
}

function renderMonitorRuntime(solanaPayload) {
  const stats = solanaPayload?.watchlistStats || {};
  const provider = solanaPayload?.providerStatus || {};
  const smartCount = Array.isArray(solanaPayload?.smartMoneyBuying24h)
    ? solanaPayload.smartMoneyBuying24h.length
    : 0;
  const whaleCount = Array.isArray(solanaPayload?.whaleBuying24h)
    ? solanaPayload.whaleBuying24h.length
    : 0;

  renderSummary(el.monitorRuntime, [
    { label: "Watchlist Wallets", value: String(stats.smartWallets || 0) },
    { label: "Watchlist Tokens", value: String(stats.tokens || 0) },
    { label: "Smart Money Rows", value: String(smartCount) },
    { label: "Whale Rows", value: String(whaleCount) },
    {
      label: "Birdeye",
      value: provider.birdeye ? "Ready" : "No key",
      badge: provider.birdeye ? "OK" : "OFF",
    },
    { label: "Solana Updated", value: formatTime(solanaPayload.generatedAt) },
  ]);
}

function renderRuntimeSummary(payload, spot, futures) {
  renderSummary(el.runtimeSummary, [
    { label: "Last Refresh", value: formatTime(payload.generatedAt) },
    { label: "Spot Open Position", value: spot.openPosition ? spot.openPosition.symbol : "None", badge: spot.openPosition ? spot.openPosition.side.toUpperCase() : null },
    { label: "Futures Open Position", value: futures.openPosition ? futures.openPosition.symbol : "None", badge: futures.openPosition ? futures.openPosition.side.toUpperCase() : null },
    { label: "Recent Logs", value: String(payload.recentLogs?.length || 0) },
  ]);
}

function renderSolanaPaperTrading(paper, balanceFromPayload) {
  if (!el.paperSummaryGrid) return;

  if (!paper) {
    el.paperSummaryGrid.innerHTML = `<div class="trade-meta">Menunggu siklus paper trading. Pastikan <code>npm run monitor:solana</code> berjalan.</div>`;
    if (el.paperOpenList) el.paperOpenList.innerHTML = "";
    if (el.paperHistoryList) el.paperHistoryList.innerHTML = "";
    return;
  }

  const stats = paper.stats || {};
  const cfg = paper.config || {};
  const netTone = Number(stats.netPnlSol || 0) >= 0 ? "good" : "bad";
  const wrTone = Number(stats.winRate || 0) >= 65 ? "good" : Number(stats.winRate || 0) >= 45 ? "warn" : "bad";

  // Gunakan balance dari payload jika ada, jika tidak fallback ke stats
  const currentBalance = balanceFromPayload != null ? balanceFromPayload : (stats.balanceSol ?? 10);

  el.paperSummaryGrid.innerHTML = `
    <article class="paper-stat-card">
      <span class="paper-stat-k">Saldo Virtual</span>
      <strong class="paper-stat-v">${formatNumber(currentBalance, 4)} SOL</strong>
      <span class="paper-stat-sub">Modal Awal 100 SOL · Ukuran Beli ${formatNumber(cfg.buyAmountSol || 0.5, 2)} SOL</span>
    </article>
    <article class="paper-stat-card">
      <span class="paper-stat-k">Win Rate Simulasi</span>
      <strong class="paper-stat-v ${wrTone}">${formatNumber(stats.winRate || 0, 1)}%</strong>
      <span class="paper-stat-sub">${stats.profitTrades || 0}W / ${stats.lossTrades || 0}L · ${stats.totalTrades || 0} trade</span>
    </article>
    <article class="paper-stat-card">
      <span class="paper-stat-k">Net P/L Virtual</span>
      <strong class="paper-stat-v ${netTone}">${formatNumber(stats.netPnlSol || 0, 4)} SOL</strong>
      <span class="paper-stat-sub">Invested ${formatNumber(stats.totalInvestedSol || 0, 4)} SOL</span>
    </article>
    <article class="paper-stat-card">
      <span class="paper-stat-k">Posisi Terbuka</span>
      <strong class="paper-stat-v">${paper.activePositions?.length || 0}</strong>
      <span class="paper-stat-sub">Max ${cfg.maxOpenPositions || 12}</span>
    </article>
  `;

  const open = paper.activePositions || [];
  if (el.paperOpenCount) el.paperOpenCount.textContent = String(open.length);

  if (el.paperOpenList) {
    if (!open.length) {
      el.paperOpenList.innerHTML = `<div class="trade-meta">Belum ada posisi terbuka. Buy otomatis saat sinyal FIRE / BUY_ZONE / Must Buy.</div>`;
    } else {
      el.paperOpenList.innerHTML = open
        .map((pos) => {
          const pnlTone = Number(pos.unrealizedPnlPct || 0) >= 0 ? "good" : "bad";
          const holdClass = pos.isHold ? "is-holding" : "";
          const holdLabel = pos.isHold ? "Release Hold" : "Hold Position";
          
          return `
            <article class="paper-position-card ${holdClass}" data-pos-mint="${pos.tokenAddress || ""}" data-entry-price="${pos.entryPrice || 0}">
              <div class="paper-position-head">
                <div style="display: flex; align-items: center; gap: 0.5rem">
                  <strong>${pos.symbol || "-"}</strong>
                  ${pos.isHold ? '<span class="hold-badge">HOLD</span>' : ""}
                </div>
                <span id="pnl-sol-${pos.id}" class="paper-position-pnl ${pnlTone}">${formatNumber(pos.unrealizedPnlPct || 0, 1)}%</span>
              </div>
              <div class="paper-position-meta">
                <span>Entry $${formatMoney(pos.entryPrice)}</span>
                <span class="live-price-now">Now <strong id="price-sol-${pos.id}">$${formatMoney(pos.currentPrice)}</strong></span>
                <span>${pos.amountSol} SOL</span>
              </div>
              <div class="paper-position-meta">
                <span>TP $${formatMoney(pos.targetTP)}</span>
                <span>SL $${formatMoney(pos.targetSL)}</span>
                <span>${formatAge(pos.openedAt)}</span>
              </div>
              
              <div class="paper-card-actions">
                <button
                  type="button"
                  class="paper-action-btn btn-hold"
                  data-hold-solana-paper
                  data-position-id="${pos.id || ""}"
                  data-is-hold="${pos.isHold ? "true" : "false"}"
                >${holdLabel}</button>

                <button
                  type="button"
                  class="paper-action-btn btn-target"
                  data-target-solana-paper
                  data-position-id="${pos.id || ""}"
                  data-symbol="${pos.symbol || ""}"
                  data-tp="${pos.targetTP}"
                  data-sl="${pos.targetSL}"
                >Set TP/SL</button>

                <button
                  type="button"
                  class="paper-close-btn"
                  data-close-solana-paper
                  data-mint="${pos.tokenAddress || ""}"
                  data-position-id="${pos.id || ""}"
                  data-symbol="${pos.symbol || ""}"
                  data-current-price="${pos.currentPrice || pos.entryPrice || 0}"
                  data-pnl-pct="${pos.unrealizedPnlPct || 0}"
                >Tutup posisi</button>
              </div>
            </article>
          `;
        })
        .join("");
    }
  }

  if (el.paperConfigPanel) {
    el.paperConfigPanel.innerHTML = `
      <div class="stack-row"><span>Buy size</span><strong>${cfg.buyAmountSol || 0.1} SOL</strong></div>
      <div class="stack-row"><span>Take Profit</span><strong>+${cfg.takeProfitPct || 50}%</strong></div>
      <div class="stack-row"><span>Stop Loss</span><strong>-${cfg.stopLossPct || 20}%</strong></div>
      <div class="stack-row"><span>Trigger buy</span><strong>${(cfg.buyTriggers || []).join(", ")}</strong></div>
    `;
  }

  const events = paper.recentEvents || [];
  if (el.paperCycleEvents) {
    el.paperCycleEvents.innerHTML = events.length
      ? events
          .slice()
          .reverse()
          .map((ev) => {
            const tone = ev.type === "TP" || ev.result === "PROFIT" ? "good" : ev.type === "SL" || ev.result === "LOSS" ? "bad" : "neutral";
            return `<div class="paper-event paper-event-${tone}"><span>${ev.type}</span> <strong>${ev.symbol || ev.mint?.slice(0, 6) || "-"}</strong> ${ev.pnlPct != null ? `${formatNumber(ev.pnlPct, 1)}%` : ""} <span class="paper-event-time">${formatAge(ev.at)}</span></div>`;
          })
          .join("")
      : `<div class="trade-meta">Belum ada event siklus terakhir.</div>`;
  }

  const history = paper.tradeHistory || [];
  if (el.paperHistoryCount) el.paperHistoryCount.textContent = String(history.length);

  if (el.paperHistoryList) {
    if (!history.length) {
      el.paperHistoryList.innerHTML = `<div class="trade-meta">Riwayat TP/SL akan muncul setelah posisi ditutup.</div>`;
    } else {
      el.paperHistoryList.innerHTML = `
        <div class="paper-history-head">
          <span>Token</span><span>Trigger</span><span>P/L SOL</span><span>P/L %</span><span>Waktu</span>
        </div>
        ${history
          .map((trade) => {
            const tone = trade.result === "PROFIT" ? "good" : "bad";
            return `
              <div class="paper-history-row">
                <span><strong>${trade.symbol || "-"}</strong></span>
                <span class="tag tag-${tone}">${trade.trigger || trade.result}</span>
                <span class="${tone}">${formatNumber(trade.pnlSol || 0, 4)}</span>
                <span class="${tone}">${formatNumber(trade.pnlPct || 0, 1)}%</span>
                <span>${formatAge(trade.closedAt)}</span>
              </div>
            `;
          })
          .join("")}
      `;
    }
  }
}

function renderCexPaperTrading(cex) {
  if (!el.cexSummaryGrid) return;

  console.log("[CEX DEBUG] Rendering CEX data:", cex);

  if (!cex || (!cex.activeTrades && !cex.tradeHistory && !cex.stats)) {
    el.cexSummaryGrid.innerHTML = `<div class="trade-meta">Menunggu bot CEX. Jalankan <code>npm run monitor:cex</code> di terminal.</div>`;
    if (el.cexOpenList) el.cexOpenList.innerHTML = "";
    if (el.cexSignalsList) el.cexSignalsList.innerHTML = "";
    if (el.cexHistoryList) el.cexHistoryList.innerHTML = "";
    return;
  }

  if (el.cexExchangeBadge) {
    el.cexExchangeBadge.textContent = String(cex.exchangeId || "bybit").toUpperCase();
  }

  const stats = cex.stats || {};
  const cfg = cex.config || {};
  const netTone = Number(stats.netPnlUsdt || 0) >= 0 ? "good" : "bad";
  const wrTone = Number(stats.winRate || 0) >= 65 ? "good" : Number(stats.winRate || 0) >= 45 ? "warn" : "bad";

  el.cexSummaryGrid.innerHTML = `
    <article class="paper-stat-card">
      <span class="paper-stat-k">Win Rate</span>
      <strong class="paper-stat-v ${wrTone}">${formatNumber(stats.winRate || 0, 1)}%</strong>
      <span class="paper-stat-sub">${stats.profitTrades || 0}W / ${stats.lossTrades || 0}L</span>
    </article>
    <article class="paper-stat-card">
      <span class="paper-stat-k">Net P/L</span>
      <strong class="paper-stat-v ${netTone}">${formatNumber(stats.netPnlUsdt || 0, 2)} USDT</strong>
      <span class="paper-stat-sub">Equity ${formatNumber(stats.equityUsdt || stats.balanceUsdt || 0, 2)} USDT</span>
    </article>
    <article class="paper-stat-card">
      <span class="paper-stat-k">Saldo Cash</span>
      <strong class="paper-stat-v">${formatNumber(stats.balanceUsdt || 0, 2)}</strong>
      <span class="paper-stat-sub">Start ${formatNumber(stats.startingBalanceUsdt || 1000, 0)} USDT</span>
    </article>
    <article class="paper-stat-card">
      <span class="paper-stat-k">Updated</span>
      <strong class="paper-stat-v paper-stat-v-sm">${formatAge(cex.generatedAt)}</strong>
      <span class="paper-stat-sub">Scan ${cfg.scanIntervalMs ? `${Math.round(cfg.scanIntervalMs / 1000)}s` : "60s"}</span>
    </article>
  `;

  const open = cex.activeTrades || [];
  if (el.cexOpenCount) el.cexOpenCount.textContent = String(open.length);

  if (el.cexOpenList) {
    if (!open.length) {
      el.cexOpenList.innerHTML = `<div class="trade-meta">Belum ada posisi. Menunggu BUY_SIGNAL (vol spike + di atas EMA200 15m + wick filter).</div>`;
    } else {
      el.cexOpenList.innerHTML = open
        .map((pos) => {
          const pnlTone = Number(pos.unrealizedPnlPct || 0) >= 0 ? "good" : "bad";
          return `
            <article class="paper-position-card">
              <div class="paper-position-head">
                <strong>${pos.symbol || "-"}</strong>
                <span id="pnl-cex-${pos.id}" class="paper-position-pnl ${pnlTone}">${formatNumber(pos.unrealizedPnlPct || pos.pnlPct || 0, 2)}%</span>
              </div>
              <div class="paper-position-meta">
                <span>Entry ${formatMoney(pos.entryPrice)}</span>
                <span class="live-price-now">Now <strong id="price-cex-${pos.id}">${formatMoney(pos.currentPrice)}</strong></span>
                <span>${formatNumber(pos.amountUsdt, 2)} USDT</span>
              </div>
              <div class="paper-position-meta">
                <span>TP ${formatMoney(pos.targetTP)}${pos.tpSlMode === "atr" ? " (ATR)" : ""}</span>
                <span>SL ${formatMoney(pos.targetSL)}</span>
                <span>Fee ${formatMoney(pos.fee || 0)}</span>
                <span>${formatAge(pos.openedAt)}</span>
              </div>
              <button
                type="button"
                class="paper-close-btn paper-close-btn-cex"
                data-close-cex-paper
                data-trade-id="${pos.id || ""}"
                data-symbol="${pos.symbol || ""}"
              >Tutup posisi</button>
            </article>
          `;
        })
        .join("");
    }
  }

  const signals = cex.recentSignals || [];
  if (el.cexSignalsList) {
    el.cexSignalsList.innerHTML = signals.length
      ? signals
          .slice(0, 12)
          .map((sig) => {
            const m = sig.signal || {};
            return `<div class="paper-event paper-event-good"><span>BUY</span> <strong>${sig.symbol}</strong> vol ${formatNumber(m.volumeRatio || 0, 1)}x · ${formatAge(sig.detectedAt)}</div>`;
          })
          .join("")
      : `<div class="trade-meta">Belum ada BUY_SIGNAL pada siklus terakhir.</div>`;
  }

  if (el.cexScanMeta && cex.lastScan) {
    const s = cex.lastScan;
    el.cexScanMeta.innerHTML = `
      <div class="stack-row"><span>Universe</span><strong>${s.universeSize || 0} pair</strong></div>
      <div class="stack-row"><span>Sinyal buy</span><strong>${s.buySignals || 0}</strong></div>
      <div class="stack-row"><span>Dibuka</span><strong>${s.opened || 0}</strong></div>
      <div class="stack-row"><span>Scan</span><strong>${formatAge(s.scannedAt)}</strong></div>
    `;
  }

  const history = cex.tradeHistory || [];
  if (el.cexHistoryCount) el.cexHistoryCount.textContent = String(history.length);

  if (el.cexHistoryList) {
    if (!history.length) {
      el.cexHistoryList.innerHTML = `<div class="trade-meta">Riwayat TP/SL muncul setelah posisi ditutup.</div>`;
    } else {
      el.cexHistoryList.innerHTML = `
        <div class="paper-history-head">
          <span>Pair</span><span>Trigger</span><span>P/L USDT</span><span>P/L %</span><span>Waktu</span>
        </div>
        ${history
          .map((trade) => {
            const tone = trade.result === "PROFIT" ? "good" : "bad";
            return `
              <div class="paper-history-row">
                <span><strong>${trade.symbol}</strong></span>
                <span class="tag tag-${tone}">${trade.trigger}</span>
                <span class="${tone}">${formatNumber(trade.pnlUsdt, 2)}</span>
                <span class="${tone}">${formatNumber(trade.pnlPct, 2)}%</span>
                <span>${formatAge(trade.closedAt)}</span>
              </div>
            `;
          })
          .join("")}
      `;
    }
  }
}

async function fetchUsers() {
  const pendingListEl = document.getElementById("pendingUsersList");
  const allListEl = document.getElementById("allUsersList");
  if (!pendingListEl || !allListEl) return;

  // RUN DIAGNOSTICS
  checkAdminConnectivity();

  try {
    // 1. Fetch Pending
    console.log("[ADMIN] Fetching pending users...");
    const resPending = await fetchWithAuth("/api/admin/users/pending");
    console.log("[ADMIN] Pending status:", resPending.status);
    
    if (!resPending.ok) {
        console.error("[ADMIN] Failed to fetch pending:", resPending.status);
        pendingListEl.innerHTML = `<p class="bad">Error ${resPending.status}: Gagal mengambil data pending.</p>`;
    } else {
        const pendingUsers = await resPending.json().catch(e => {
            console.error("[ADMIN] JSON Parse Error (Pending):", e.message);
            return null;
        });

        if (!pendingUsers) {
            pendingListEl.innerHTML = `<p class="bad">Error: Server mengembalikan format non-JSON.</p>`;
        } else if (pendingUsers.length === 0) {
          pendingListEl.innerHTML = `
            <div class="briefing-empty">
                <p class="briefing-empty-title">Tidak ada user pending</p>
            </div>
          `;
        } else {
          pendingListEl.innerHTML = pendingUsers.map(u => `
            <div class="panel" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(255,255,255,0.02); margin-bottom: 0.75rem;">
              <div>
                  <div style="font-weight: 700; font-size: 1rem; color: var(--text);">${u.username}</div>
                  <div style="font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem;">
                      ID: ${u.id} · Role: ${u.role} · Mendaftar: ${formatTime(u.created_at)}
                  </div>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button onclick="approveUser(${u.id}, '${u.username}')" class="btn-dex" style="background: var(--success); color: #000; border-color: var(--success); font-weight: 700;">
                    Izinkan
                </button>
                <button onclick="deleteUser(${u.id}, '${u.username}')" class="btn-blacklist" style="border-radius: 6px; width: auto; padding: 0 0.75rem; height: 2.2rem; font-size: 0.75rem;">
                    Hapus
                </button>
              </div>
            </div>
          `).join("");
        }
    }

    // 2. Fetch All
    console.log("[ADMIN] Fetching all users...");
    const resAll = await fetchWithAuth("/api/admin/users/all");
    console.log("[ADMIN] All users status:", resAll.status);

    if (!resAll.ok) {
        console.error("[ADMIN] Failed to fetch all users:", resAll.status);
        allListEl.innerHTML = `<p class="bad">Error ${resAll.status}: Gagal mengambil data user.</p>`;
    } else {
        const allUsers = await resAll.json().catch(e => {
            console.error("[ADMIN] JSON Parse Error (All):", e.message);
            return null;
        });

        if (!allUsers) {
             allListEl.innerHTML = `<p class="bad">Error: Server mengembalikan format non-JSON.</p>`;
        } else if (allUsers.length === 0) {
          allListEl.innerHTML = `<p class="muted">Belum ada user di database.</p>`;
        } else {
          allListEl.innerHTML = allUsers.map(u => {
            const isCurrent = currentUser && currentUser.username === u.username;
            return `
            <div class="panel" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(255,255,255,0.02); margin-bottom: 0.75rem; border-left: 3px solid ${u.status === 'APPROVED' ? 'var(--success)' : 'var(--muted)'};">
              <div>
                  <div style="font-weight: 700; font-size: 1rem; color: var(--text);">${u.username} ${isCurrent ? '<span style="font-size: 0.7rem; color: var(--accent);">(You)</span>' : ''}</div>
                  <div style="font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem;">
                      Role: <strong>${u.role}</strong> · Status: <span style="color: ${u.status === 'APPROVED' ? 'var(--success)' : 'var(--accent-strong)'}">${u.status}</span>
                  </div>
              </div>
              <div>
                ${!isCurrent ? `
                <button onclick="deleteUser(${u.id}, '${u.username}')" class="btn-blacklist" style="border-radius: 6px; width: auto; padding: 0 0.75rem; height: 2.2rem; font-size: 0.75rem;">
                    Hapus Akun
                </button>
                ` : '<span style="font-size: 0.7rem; color: var(--muted);">Self-protection active</span>'}
              </div>
            </div>
          `}).join("");
        }
    }
  } catch (err) {
    console.error("Fetch users error:", err);
  }
}

window.approveUser = async (id, username) => {
  if (!confirm(`Setujui pendaftaran ${username}?`)) return;
  try {
    const res = await fetchWithAuth(`/api/admin/users/approve/${id}`, { method: 'POST' });
    if (res.ok) {
      ui.toast(`User ${username} berhasil disetujui`, "success");
      fetchUsers();
    } else {
      const data = await res.json();
      ui.toast(data.error || "Gagal menyetujui user", "error");
    }
  } catch (err) { ui.toast(err.message, "error"); }
};

window.deleteUser = async (id, username) => {
  if (!confirm(`HAPUS PERMANEN user ${username}? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    const res = await fetchWithAuth(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (res.ok) {
      ui.toast(`User ${username} telah dihapus`, "blacklist");
      fetchUsers();
    } else {
      const data = await res.json();
      ui.toast(data.error || "Gagal menghapus user", "error");
    }
  } catch (err) { ui.toast(err.message, "error"); }
};

function switchPage(pageId) {
  const allowed = ["phoenix", "monitor", "track-wallet", "solana-paper", "cex-spike", "trading", "users"];
  const target = allowed.includes(pageId) ? pageId : "phoenix";

  console.log(`[NAV] Switching to page: ${target}`);

  el.pageViews.forEach((view) => {
    const isActive = view.id === `page-${target}`;
    view.classList.toggle("is-active", isActive);
    view.hidden = !isActive;
  });

  el.navLinks.forEach((link) => {
    const isActive = link.dataset.page === target;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-selected", String(isActive));
  });

  document.title = PAGE_TITLES[target] || PAGE_TITLES.monitor;
  window.location.hash = target;

  if (target === "users") {
    fetchUsers();
  }

  // Trigger immediate refresh if CEX or Solana paper is opened
  if (target === "cex-spike" || target === "solana-paper") {
    loadDashboard().catch(err => console.error("[NAV] Switch-load failed:", err));
  }
}

function renderAccountPanels(spot, futures) {
  if (el.spotSummary) {
    renderSummary(el.spotSummary, [
      { label: "Cash", value: formatMoney(spot.balance) },
      { label: "Asset", value: formatNumber(spot.asset || 0, 6) },
      { label: "Paid Fees", value: formatMoney(spot.paidFees) },
      { label: "Trade Record", value: `${spot.wins}W / ${spot.losses}L`, badge: `${spot.tradesClosed} closed` },
    ]);
  }

  if (el.futuresSummary) {
    renderSummary(el.futuresSummary, [
      { label: "Cash", value: formatMoney(futures.balance) },
      { label: "Margin Locked", value: formatMoney(futures.marginLocked) },
      { label: "Paid Fees", value: formatMoney(futures.paidFees) },
      { label: "Trade Record", value: `${futures.wins}W / ${futures.losses}L`, badge: `${futures.tradesClosed} closed` },
    ]);
  }

  if (el.closeSpotButton) el.closeSpotButton.disabled = !spot.openPosition;
  if (el.closeFuturesButton) el.closeFuturesButton.disabled = !futures.openPosition;
  if (el.spotActionStatus) el.spotActionStatus.textContent = describeOpenPosition(spot.openPosition, "spot");
  if (el.futuresActionStatus) el.futuresActionStatus.textContent = describeOpenPosition(futures.openPosition, "futures");
}

async function fetchCexPaperPayload() {
  try {
    const response = await fetchWithAuth("/api/cex-paper", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.error) return null;
    return payload;
  } catch {
    return null;
  }
}

async function loadDashboard() {
  if (el.generatedAt) el.generatedAt.textContent = "Refreshing...";
  const dashboardResponse = await fetchWithAuth(dashboardUrl, { cache: "no-store" });

  const payload = await dashboardResponse.json();
  console.log("[PAYLOAD AUDIT] Nama-nama key dari API:", Object.keys(payload));
  console.log("[FRONTEND TRACER] Data diterima dari API. Payload keys:", Object.keys(payload));
  
  const spot = summarizeLedger(payload.spot);
  const futures = summarizeLedger(payload.futures);
  const solanaPayload = payload.solanaSmartMoney || {};

  console.log("[FRONTEND TRACER] solanaPayload candidates count:", solanaPayload.candidates?.length || 0);

  if (el.solanaPaperBalance && payload.solanaPaperBalance != null) {
    el.solanaPaperBalance.textContent = formatNumber(payload.solanaPaperBalance, 2) + " SOL";
  }

  if (el.generatedAt) el.generatedAt.textContent = `Updated ${formatTime(payload.generatedAt)}`;
  if (el.dataFreshness) {
    const solanaAt = solanaPayload.generatedAt || payload.generatedAt;
    el.dataFreshness.textContent = `Monitor · ${formatAge(solanaAt)}`;
    el.dataFreshness.title = `Siklus terakhir: ${formatTime(solanaAt)}`;
  }
  lastSolanaPayload = {
    ...solanaPayload,
    candidates: (solanaPayload.candidates || []).filter((candidate) => {
      // Task: Show ALL tokens to see their real status (LOW/HIGH/WEAK/SAFE)
      // Removing the strict filter that was hiding non-perfect tokens
      return true;
    }),
  };
  renderSolanaPaperTrading(payload.solanaPaperTrading || payload.solanaSmartMoney?.paperTrading, payload.solanaPaperBalance);

  let cexPayload = payload.cexPaper;
  if (!cexPayload) {
    cexPayload = await fetchCexPaperPayload();
  }
  renderCexPaperTrading(cexPayload);

  // Unpack and distribute to renderers
  renderTrackedWallets(payload.trackedWallets);
  renderPhoenixScanner(solanaPayload);
  renderMorningBriefing(solanaPayload);
  renderTimeframeMonitorList(payload); // Pass root payload
  
  renderProviderHealth(solanaPayload);
  renderDiscovery(solanaPayload);
  renderTokenHolderDetails(solanaPayload, solanaPayload.candidates || []);
  renderMonitorRuntime(solanaPayload);
  renderSolanaCandidates(solanaPayload);
  renderTopMetrics(spot, futures);
  renderRuntimeSummary(payload, spot, futures);
  renderAccountPanels(spot, futures);
  renderCurve(el.spotCurve, spot.snapshots, "#5fd2c7");
  renderCurve(el.futuresCurve, futures.snapshots, "#ffb347");
  renderTrades(el.spotTrades, spot.trades, "No spot trades yet.");
  renderTrades(el.futuresTrades, futures.trades, "No futures trades yet.");
  renderLogs(payload.recentLogs || []);
  attachCopyHandlers();
  attachTokenDetailsHandlers();
  applyScoreRings();
}

function attachTokenDetailsHandlers() {
  document.querySelectorAll("[data-token-details]").forEach((button) => {
    button.onclick = () => openTokenDetailsModal(button.getAttribute("data-token-details"));
  });
}

async function postBlacklistToken(body) {
  const response = await fetchWithAuth("/api/blacklist", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.ok) return payload;
  throw new Error(payload.error || "Gagal blacklist token");
}

async function postClosePaperPosition(body) {
  const response = await fetchWithAuth("/api/close-position", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.ok) {
    return payload;
  }

  if (response.status === 404 && (body.mode === "solana-paper" || body.mode === "cex-paper")) {
    const legacyUrl = body.mode === "solana-paper" ? "/api/close-solana-paper" : "/api/close-cex-paper";
    const legacy = await fetch(legacyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const legacyPayload = await legacy.json();
    if (legacy.ok) {
      return legacyPayload;
    }
    throw new Error(legacyPayload.error || payload.hint || payload.error || "Endpoint close tidak ditemukan (404). Restart npm run dashboard.");
  }

  throw new Error(payload.hint || payload.error || "Gagal menutup posisi.");
}

async function closeSolanaPaperPosition(button) {
  if (currentUser.role === 'GUEST') return ui.toast("GUEST tidak bisa trading", "error");
  
  const mint = button.getAttribute("data-mint");
  const id = button.getAttribute("data-position-id");
  const currentPrice = Number(button.getAttribute("data-current-price"));
  const pnlPercent = Number(button.getAttribute("data-pnl-pct"));
  const symbol = button.getAttribute("data-symbol") || mint?.slice(0, 6) || "-";
  const originalLabel = button.textContent;

  if (!id) {
    ui.toast("Error: ID posisi tidak ditemukan.");
    return;
  }

  button.disabled = true;
  button.textContent = "Menutup...";

  try {
    const payload = await postClosePaperPosition({
      mode: "solana-paper",
      id: id,
      mint: mint,
      currentPrice: currentPrice,
      pnlPercent: pnlPercent
    });

    const closed = payload.closed;
    const pnlText = closed?.pnlPct != null ? ` P/L ${formatNumber(closed.pnlPct, 1)}%` : "";
    ui.toast(`[dashboard] Solana paper ${symbol} ditutup manual.${pnlText}`);
    
    // Refresh UI secara instan
    await loadDashboard();
  } catch (error) {
    console.error("[dashboard] Gagal tutup posisi:", error.message);
    alert(error.message);
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function toggleSolanaPaperHold(button) {
  if (currentUser.role === 'GUEST') return ui.toast("GUEST tidak bisa mengubah status hold", "error");

  const id = button.getAttribute("data-position-id");
  const isCurrentlyHolding = button.getAttribute("data-is-hold") === "true";
  const newHoldStatus = !isCurrentlyHolding;
  
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "...";

  try {
    const response = await fetchWithAuth("/api/solana-paper/toggle-hold", {
      method: "POST",
      body: JSON.stringify({ id, isHold: newHoldStatus }),
    });

    if (response.ok) {
      ui.toast(`Status HOLD posisi ${id} berhasil di${newHoldStatus ? "aktifkan" : "matikan"}.`);
      await loadDashboard();
    } else {
      const error = await response.json();
      throw new Error(error.error || "Gagal mengubah status hold");
    }
  } catch (err) {
    ui.toast(err.message, "error");
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function openUpdateTargetsDialog(button) {
  if (currentUser.role === 'GUEST') return ui.toast("GUEST tidak bisa mengubah target", "error");

  const id = button.getAttribute("data-position-id");
  const symbol = button.getAttribute("data-symbol");
  const tp = button.getAttribute("data-tp");
  const sl = button.getAttribute("data-sl");

  document.getElementById("targetPositionId").value = id;
  document.getElementById("targetSymbolDisplay").textContent = symbol;
  document.getElementById("targetTPInput").value = tp;
  document.getElementById("targetSLInput").value = sl;

  document.getElementById("updatePaperTargetsDialog").showModal();
}

async function blacklistToken(button) {
  if (currentUser.role === 'GUEST') return ui.toast("GUEST tidak memiliki akses", "error");

  const mint = button.getAttribute("data-blacklist-mint");
  const symbol = button.getAttribute("data-blacklist-symbol") || "UNKNOWN";
  
  if (!mint) return;
  
  const dialog = document.getElementById("blacklistDialog");
  const symbolDisplay = document.getElementById("blacklistSymbolDisplay");
  const mintDisplay = document.getElementById("blacklistMintDisplay");
  const confirmBtn = document.getElementById("confirmBlacklistBtn");

  symbolDisplay.textContent = symbol;
  mintDisplay.textContent = mint;
  
  dialog.showModal();

  // Handle confirmation
  confirmBtn.onclick = async () => {
    dialog.close();
    
    const originalContent = button.innerHTML;
    button.disabled = true;
    button.textContent = "...";

    try {
      await postBlacklistToken({ mint, symbol, reason: "Manual Blacklist from Dashboard" });
      ui.toast(`${symbol} telah diblokir selamanya.`, "blacklist");
      
      // Feedback visual instan
      const card = button.closest(".briefing-card") || button.closest(".timeframe-row") || button.closest(".phoenix-card") || button.closest(".signal-row");
      if (card) {
        card.style.transition = "all 0.6s cubic-bezier(0.4, 0, 0.2, 1)";
        card.style.opacity = "0";
        card.style.transform = "translateX(50px) scale(0.9)";
        card.style.pointerEvents = "none";
        setTimeout(() => card.remove(), 600);
      }
      
      // Refresh dashboard setelah delay singkat
      setTimeout(loadDashboard, 2000);
    } catch (err) {
      console.error("[BLACKLIST ERROR]", err);
      ui.toast("Gagal: " + err.message, "error");
      button.disabled = false;
      button.innerHTML = originalContent;
    }
  };
}

async function closeCexPaperPosition(button) {
  if (currentUser.role === 'GUEST') return ui.toast("GUEST tidak bisa trading", "error");

  const tradeId = button.getAttribute("data-trade-id");
  const symbol = button.getAttribute("data-symbol");
  const originalLabel = button.textContent;

  button.disabled = true;
  button.textContent = "Menutup...";

  try {
    const payload = await postClosePaperPosition({
      mode: "cex-paper",
      tradeId,
      symbol,
    });

    const closed = payload.closed;
    const pnlText = closed?.pnlPct != null ? ` P/L ${formatNumber(closed.pnlPct, 1)}%` : "";
    console.log(`[dashboard] CEX ${symbol} ditutup manual.${pnlText}`);
    await loadDashboard();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function closePosition(mode) {
  const button = mode === "futures" ? el.closeFuturesButton : el.closeSpotButton;
  const status = mode === "futures" ? el.futuresActionStatus : el.spotActionStatus;
  const originalLabel = button.textContent;

  button.disabled = true;
  button.textContent = "Closing...";
  status.textContent = `Closing ${mode} paper position...`;

  try {
    const response = await fetch("/api/close-position", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Failed to close ${mode} position.`);
    }

    const pnlText = payload.summary?.netPnl ? ` PnL ${payload.summary.netPnl}.` : ".";
    status.textContent = `${mode === "futures" ? "Futures" : "Spot"} position closed.${pnlText}`;
    await loadDashboard();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.textContent = originalLabel;
  }
}

el.navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    switchPage(link.dataset.page);
  });
});

if (el.tokenDetailSelect) {
  el.tokenDetailSelect.addEventListener("change", () => {
    if (lastSolanaPayload) {
      renderTokenHolderDetails(lastSolanaPayload, lastSolanaPayload.candidates || []);
    }
  });
}

if (el.refreshButton) {
  el.refreshButton.addEventListener("click", () => {
    loadDashboard().catch((error) => {
      if (el.generatedAt) el.generatedAt.textContent = `Refresh failed: ${error.message}`;
    });
  });
}

if (el.phoenixRefreshBtn) {
  el.phoenixRefreshBtn.addEventListener("click", () => {
    loadDashboard().catch((error) => {
      if (el.phoenixSubtitle) el.phoenixSubtitle.textContent = `Refresh gagal: ${error.message}`;
    });
  });
}

if (el.phoenixHowBtn && el.phoenixHowDialog) {
  el.phoenixHowBtn.addEventListener("click", () => el.phoenixHowDialog.showModal());
}

const manualBuyForm = document.getElementById("manualBuyForm");
if (manualBuyForm) {
  manualBuyForm.addEventListener("submit", (event) => {
    event.preventDefault(); // Prevent default form submission
    
    if (currentUser.role === 'GUEST') {
        ui.toast("GUEST tidak memiliki akses trading", "error");
        return;
    }
    if (currentUser.status !== 'APPROVED') {
        ui.toast("Akun Anda belum di-approve", "warning");
        return;
    }

    const symbol = document.getElementById("manualBuySymbol").textContent;
    const address = document.getElementById("manualBuyAddress").value;
    const price = document.getElementById("manualBuyPrice").value;
    const amount = document.querySelector('input[name="buyAmount"]:checked').value;
    
    fetchWithAuth('/api/paper-trade/manual-buy', {
      method: 'POST',
      body: JSON.stringify({
        symbol: symbol,
        token_address: address,
        entry_price: Number(price),
        amount: Number(amount)
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        ui.toast("Berhasil membeli " + symbol + " (" + amount + " SOL)");
        document.getElementById("manualBuyDialog").close();
        loadDashboard(); // Refresh UI
      } else {
        ui.toast("Gagal: " + (data.error || "Unknown error"), "error");
      }
    })
    .catch(err => ui.toast("Error: " + err.message, "error"));
  });
}

const updatePaperTargetsForm = document.getElementById("updatePaperTargetsForm");
if (updatePaperTargetsForm) {
  updatePaperTargetsForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (currentUser.role === 'GUEST') return ui.toast("GUEST tidak bisa mengubah target", "error");

    const id = document.getElementById("targetPositionId").value;
    const tp = document.getElementById("targetTPInput").value;
    const sl = document.getElementById("targetSLInput").value;

    const btn = updatePaperTargetsForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Menyimpan...";

    try {
      const response = await fetchWithAuth("/api/solana-paper/update-targets", {
        method: "POST",
        body: JSON.stringify({ id, tp, sl }),
      });

      if (response.ok) {
        ui.toast("Target TP & SL berhasil diperbarui.");
        document.getElementById("updatePaperTargetsDialog").close();
        await loadDashboard();
      } else {
        const error = await response.json();
        throw new Error(error.error || "Gagal memperbarui target");
      }
    } catch (err) {
      ui.toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}

document.addEventListener("click", (event) => {
  const manualBuyBtn = event.target.closest('[data-action="manualBuy"]');
  if (manualBuyBtn) {
    const symbol = manualBuyBtn.dataset.symbol;
    const address = manualBuyBtn.dataset.address;
    const price = manualBuyBtn.dataset.price;
    
    document.getElementById("manualBuySymbol").textContent = symbol;
    document.getElementById("manualBuyAddress").value = address;
    document.getElementById("manualBuyPrice").value = price;
    
    document.getElementById("manualBuyDialog").showModal();
    return;
  }

  const solanaCloseBtn = event.target.closest("[data-close-solana-paper]");
  if (solanaCloseBtn) {
    closeSolanaPaperPosition(solanaCloseBtn);
    return;
  }

  const solanaHoldBtn = event.target.closest("[data-hold-solana-paper]");
  if (solanaHoldBtn) {
    toggleSolanaPaperHold(solanaHoldBtn);
    return;
  }

  const solanaTargetBtn = event.target.closest("[data-target-solana-paper]");
  if (solanaTargetBtn) {
    openUpdateTargetsDialog(solanaTargetBtn);
    return;
  }

  const cexCloseBtn = event.target.closest("[data-close-cex-paper]");
  if (cexCloseBtn) {
    closeCexPaperPosition(cexCloseBtn);
    return;
  }

  const blacklistBtn = event.target.closest("[data-blacklist-mint]");
  if (blacklistBtn) {
    blacklistToken(blacklistBtn);
    return;
  }

  const seriesBtn = event.target.closest("[data-td-series]");
  if (seriesBtn && el.tokenDetailsDialog?.open) {
    const key = seriesBtn.dataset.tdSeries;
    if (tokenDetailsState.activeSeries.includes(key)) {
      tokenDetailsState.activeSeries = tokenDetailsState.activeSeries.filter((entry) => entry !== key);
    } else {
      tokenDetailsState.activeSeries.push(key);
    }
    renderTokenDetailsSeriesToggles();
    const history = lastSolanaPayload?.tokenHolderDetails?.history?.[tokenDetailsState.mint] || [];
    renderTokenDetailsChart(history);
    return;
  }

  const intervalBtn = event.target.closest("[data-td-interval]");
  if (intervalBtn && el.tokenDetailsDialog?.open) {
    tokenDetailsState.interval = intervalBtn.dataset.tdInterval;
    el.tokenDetailsDialog.querySelectorAll("[data-td-interval]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tdInterval === tokenDetailsState.interval);
    });
    renderTokenDetailsChart(lastSolanaPayload?.tokenHolderDetails?.history?.[tokenDetailsState.mint] || []);
    return;
  }

  const rangeBtn = event.target.closest("[data-td-range]");
  if (rangeBtn && el.tokenDetailsDialog?.open) {
    tokenDetailsState.range = rangeBtn.dataset.tdRange;
    el.tokenDetailsDialog.querySelectorAll("[data-td-range]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tdRange === tokenDetailsState.range);
    });
    renderTokenDetailsChart(lastSolanaPayload?.tokenHolderDetails?.history?.[tokenDetailsState.mint] || []);
  }
});

if (el.phoenixTabs) {
  el.phoenixTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-phoenix-filter]");
    if (!button) return;
    phoenixActiveFilter = button.dataset.phoenixFilter || "ALL";
    if (lastSolanaPayload) renderPhoenixScanner(lastSolanaPayload);
  });
}

function resolvePageFromHash() {
  const hash = window.location.hash.replace("#", "").toLowerCase();
  if (hash === "trading") return "trading";
  if (hash === "monitor") return "monitor";
  if (hash === "track-wallet" || hash === "track") return "track-wallet";
  if (hash === "solana-paper" || hash === "paper") return "solana-paper";
  if (hash === "cex-spike" || hash === "cex") return "cex-spike";
  if (hash === "users" || hash === "admin") return "users";
  return "phoenix";
}

window.addEventListener("hashchange", () => {
  switchPage(resolvePageFromHash());
});

switchPage(resolvePageFromHash());

if (el.closeSpotButton) {
  el.closeSpotButton.addEventListener("click", () => {
    closePosition("spot").catch((error) => {
      if (el.spotActionStatus) el.spotActionStatus.textContent = error.message;
    });
  });
}

if (el.closeFuturesButton) {
  el.closeFuturesButton.addEventListener("click", () => {
    closePosition("futures").catch((error) => {
      if (el.futuresActionStatus) el.futuresActionStatus.textContent = error.message;
    });
  });
}

initWalletFilters();

loadDashboard().catch((error) => {
  if (el.generatedAt) el.generatedAt.textContent = `Initial load failed: ${error.message}`;
});

setInterval(() => {
  loadDashboard().catch(() => {});
}, 30000);

// Real-time price updates every 10 seconds
async function startRealtimePriceUpdates() {
  setInterval(async () => {
    try {
      const monitorMints = Array.from(document.querySelectorAll("[data-briefing-mint]")).map(el => el.dataset.briefingMint);
      const positionMints = Array.from(document.querySelectorAll("[data-pos-mint]")).map(el => el.dataset.posMint);
      const allMints = [...new Set([...monitorMints, ...positionMints])].filter(Boolean);

      if (!allMints.length) return;

      // 1. Fetch live data for active positions from dedicated endpoint
      const paperResponse = await fetchWithAuth("/api/dashboard/live-prices", { cache: "no-store" });
      if (paperResponse.ok) {
        const liveData = await paperResponse.json().catch(() => null);
        if (Array.isArray(liveData)) {
          liveData.forEach(pos => {
            const priceEl = document.getElementById(`price-sol-${pos.id}`);
            const pnlEl = document.getElementById(`pnl-sol-${pos.id}`);
            if (priceEl) priceEl.textContent = `$${formatMoney(pos.currentPrice)}`;
            if (pnlEl) {
              pnlEl.textContent = `${formatNumber(pos.pnlPct, 1)}%`;
              pnlEl.className = `paper-position-pnl ${pos.pnlPct >= 0 ? "good" : "bad"}`;
            }
            const btn = document.querySelector(`[data-position-id="${pos.id}"]`);
            if (btn) {
              btn.setAttribute("data-current-price", pos.currentPrice);
              btn.setAttribute("data-pnl-pct", pos.pnlPct);
            }
          });
        }
      }

      // 2. Fetch prices for Monitor Cards
      const res = await fetchWithAuth(`/api/prices?mints=${allMints.join(",")}`);
      if (!res.ok) {
        console.warn("[PRICE UPDATE] Gagal mengambil harga dari endpoint, mempertahankan data SQLite.");
        return; // Ignore update, keep existing prices
      }

      const data = await res.json().catch(() => ({}));
      const prices = data.prices || {};
      document.querySelectorAll("[data-briefing-mint]").forEach(card => {
        const mint = card.dataset.briefingMint;
        const p = prices[mint];
        if (p) {
          const priceEl = card.querySelector("[data-live-price]");
          if (priceEl) priceEl.textContent = `$${formatMoney(p.usd)}`;
          
          const changeEl = card.querySelector("[data-live-pricechange]");
          if (changeEl) {
            changeEl.textContent = formatPercent(p.change24h);
            changeEl.className = `briefing-stat-value ${p.change24h >= 0 ? "good" : "bad"}`;
          }

          // Add live updates for Market Cap, Volume, and Liquidity
          const mcEl = card.querySelector('[data-live="marketcap"]');
          if (mcEl && p.marketCap) mcEl.textContent = `$${formatMoney(p.marketCap)}`;

          const volEl = card.querySelector('[data-live="volume"]');
          if (volEl && p.volume24h) volEl.textContent = `$${formatMoney(p.volume24h)}`;

          const liqEl = card.querySelector('[data-live="liquidity"]');
          if (liqEl && p.liquidityUsd) liqEl.textContent = `$${formatMoney(p.liquidityUsd)}`;
        }
      });
    } catch (e) {
      // console.warn("[realtime] Gagal update harga:", e.message);
    }
  }, 10000);
}

startRealtimePriceUpdates();

// CEX-specific faster polling (3 seconds) when tab is active
function startCexPricePolling() {
  setInterval(async () => {
    // Hanya polling jika tab CEX aktif
    if (window.location.hash !== "#cex-spike" && window.location.hash !== "#cex") return;

    try {
      const response = await fetchWithAuth("/api/cex/live-prices", { cache: "no-store" });
      if (!response.ok) return;

      const data = await response.json().catch(() => null);
      if (Array.isArray(data)) {
        data.forEach(pos => {
          const priceEl = document.getElementById(`price-cex-${pos.id}`);
          const pnlEl = document.getElementById(`pnl-cex-${pos.id}`);
          
          if (priceEl) priceEl.textContent = formatMoney(pos.currentPrice);
          if (pnlEl) {
            const val = Number(pos.pnlPercentage ?? pos.pnlPct ?? 0);
            pnlEl.textContent = `${formatNumber(val, 2)}%`;
            // Gunakan class good/bad sesuai standar dashboard ini
            pnlEl.className = `paper-position-pnl ${val >= 0 ? "good" : "bad"}`;
          }
        });
      }
    } catch (e) {
      // console.warn("[cex-poll] Gagal update harga:", e.message);
    }
  }, 3000);
}

startCexPricePolling();
