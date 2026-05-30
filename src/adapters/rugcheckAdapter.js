const axios = require("axios");

// Cache TTL: 10 minutes
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

class RugcheckAdapter {
  constructor() {
    this.goplusToken = process.env.GOPLUS_ACCESS_TOKEN || "";
  }

  /**
   * Main audit function for a token.
   * @param {string} mint - Token address
   * @returns {Promise<object>} - Rich audit report
   */
  async analyzeToken(mint) {
    if (!mint) return this._emptyReport("INVALID_ADDRESS");

    // 1. Check Cache
    const cached = cache.get(mint);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // console.log(`[🛡️ AUDITOR] Using cached report for ${mint.slice(0, 6)}`);
      return cached.data;
    }

    let report = {
      status: 'SAFE',
      score: 0,
      risks: [],
      lpBurnedPercent: 0,
      top10HoldersPercent: 0,
      details: {},
      source: 'rugcheck'
    };

    try {
      // 2. Try Rugcheck.xyz
      const rcUrl = `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`;
      const rcRes = await axios.get(rcUrl, { timeout: 4500 }).catch(() => null);

      if (rcRes && rcRes.data) {
        const data = rcRes.data;
        report.score = data.score || 0;
        
        // Parse LP Burned
        if (Array.isArray(data.markets)) {
            const bestMarket = data.markets[0];
            if (bestMarket && bestMarket.lp) {
                report.lpBurnedPercent = Number(bestMarket.lp.burnedPercent || 0);
            }
        }

        // Parse Top Holders
        if (Array.isArray(data.topHolders)) {
            report.top10HoldersPercent = data.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);
        }

        // Parse Risks from Rugcheck
        if (Array.isArray(data.risks)) {
            data.risks.forEach(r => {
                if (r.level === 'danger' || r.level === 'warning') {
                    report.risks.push(`${r.name}: ${r.description}`);
                }
            });
        }
        
        report.details = data;
      } else {
        // 3. Fallback to GoPlus Security
        // console.log(`[🛡️ AUDITOR] Rugcheck down/limit, falling back to GoPlus for ${mint.slice(0, 6)}`);
        const gpUrl = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`;
        const headers = this.goplusToken ? { Authorization: `Bearer ${this.goplusToken}` } : {};
        const gpRes = await axios.get(gpUrl, { headers, timeout: 5000 }).catch(() => null);

        const gpData = gpRes?.data?.result?.[mint] || gpRes?.data?.data?.[mint];
        if (gpData) {
            report.source = 'goplus';
            report.details = gpData;
            
            // Map GoPlus metrics to our report
            if (gpData.is_mintable === '1') report.risks.push("Mint Authority Active");
            if (gpData.freezable === '1') report.risks.push("Freeze Authority Active");
            
            const buyTax = parseFloat(gpData.buy_tax || 0);
            const sellTax = parseFloat(gpData.sell_tax || 0);
            if (buyTax > 10 || sellTax > 10) report.risks.push(`High Tax Detected: B:${buyTax}% S:${sellTax}%`);
            
            // LP and Holders from GoPlus if available
            report.top10HoldersPercent = (parseFloat(gpData.top_10_holders_percent || 0)) * 100;
        }
      }

      // 4. Final Scoring Logic (Cross-Source)
      this._applyCustomRules(report);

      // Save to cache
      cache.set(mint, { timestamp: Date.now(), data: report });
      return report;

    } catch (error) {
      console.error(`[🛡️ AUDITOR] Critical audit failure for ${mint}:`, error.message);
      return this._emptyReport("AUDIT_FAILED");
    }
  }

  /**
   * Simple wrapper for boolean safety check (Backward Compatibility)
   */
  async isTokenSafe(mint) {
    const report = await this.analyzeToken(mint);
    return report.status !== 'DANGER';
  }

  _applyCustomRules(report) {
    if (report.source === 'none') {
        report.status = 'PENDING';
        return;
    }

    const risks = report.risks.join(" ").toLowerCase();
    const score = Number(report.score || 0);

    // HARD BLOCKERS -> DANGER
    if (
        risks.includes("mint authority") || 
        risks.includes("freeze authority") || 
        risks.includes("high tax") ||
        score > 1000 ||
        (report.details && report.details.status === 'danger')
    ) {
        report.status = 'DANGER';
    }

    // SOFT RUGS / SUSPICIOUS -> WARNING
    else if (
        report.top10HoldersPercent > 30 ||
        (report.lpBurnedPercent > 0 && report.lpBurnedPercent < 70) ||
        score > 400 ||
        risks.includes("concentration") ||
        risks.includes("low lp") ||
        risks.includes("warning")
    ) {
        report.status = 'WARNING';
        if (report.top10HoldersPercent > 30 && !risks.includes("concentration")) {
            report.risks.push(`High Holder Concentration (${report.top10HoldersPercent.toFixed(1)}%)`);
        }
    }

    // SAFE -> Requires clean audit
    else {
        report.status = 'SAFE';
    }
  }

  _emptyReport(reason) {
    return {
      status: 'DANGER',
      score: 0,
      risks: [reason],
      lpBurnedPercent: 0,
      top10HoldersPercent: 0,
      source: 'none'
    };
  }
}

module.exports = new RugcheckAdapter();
