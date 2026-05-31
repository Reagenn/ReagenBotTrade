require('dotenv').config();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * GMGN.ai Adapter (CLI Mode)
 * Menggunakan gmgn-cli (Official AI Agent Skill) via child_process
 */

async function getSmartMoneyBuySignals() {
  if (!process.env.GMGN_API_KEY) {
    console.error("[GMGN ERROR] 🛑 GMGN_API_KEY tidak ditemukan!");
    console.error("[DEBUG PATH] Bot berjalan di direktori:", process.cwd());
    return [];
  }

  console.log(`[🎯 RADAR] Memindai sinyal beli beruntun dari Smart Money via GMGN...`);
  
  let stdoutRaw = "";
  try {
    const command = `gmgn-cli market signal --chain sol --signal-type 12 --raw`;
    const { stdout, stderr } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY }
    });
    
    stdoutRaw = stdout;
    if (stderr && stderr.trim().length > 0) {
      console.warn(`[GMGN CLI WARN] ${stderr.trim()}`);
    }

    let rawJson = stdout;
    const jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    const data = JSON.parse(rawJson);
    
    let signals = [];
    if (Array.isArray(data)) {
      signals = data;
    } else if (data && Array.isArray(data.data)) {
      signals = data.data;
    } else if (data && data.data && Array.isArray(data.data.signals)) {
      signals = data.data.signals;
    }

    console.log(`[🚀 GMGN RADAR] Ditemukan ${signals.length} sinyal beli Smart Money!`);
    return signals;

  } catch (err) {
    console.log("[GMGN BUY SIGNAL DEBUG] Gagal mengeksekusi atau mem-parsing JSON. Output mentah:");
    console.log("----------------------------------------");
    console.log(stdoutRaw || err.message);
    console.log("----------------------------------------");
    return [];
  }
}

async function getSmartMoneyExitSignals() {
  if (!process.env.GMGN_API_KEY) {
    console.error("[GMGN ERROR] 🛑 GMGN_API_KEY tidak ditemukan!");
    console.error("[DEBUG PATH] Bot berjalan di direktori:", process.cwd());
    return null;
  }

  console.log(`[🚨 RADAR] Memindai sinyal exit/jual dari Smart Money via GMGN...`);
  
  let stdoutRaw = "";
  try {
    const command = `gmgn-cli track smartmoney --chain sol --side sell --raw`;
    const { stdout, stderr } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY }
    });
    
    stdoutRaw = stdout;
    if (stderr && stderr.trim().length > 0) {
      console.warn(`[GMGN CLI WARN] ${stderr.trim()}`);
    }

    let rawJson = stdout;
    const jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    const data = JSON.parse(rawJson);
    
    let signals = [];
    if (Array.isArray(data)) {
      signals = data;
    } else if (data && Array.isArray(data.data)) {
      signals = data.data;
    } else if (data && data.data && Array.isArray(data.data.signals)) {
      signals = data.data.signals;
    }

    console.log(`[🚀 GMGN RADAR] Ditemukan ${signals.length} sinyal exit Smart Money!`);
    return signals;

  } catch (err) {
    console.log("[GMGN EXIT SIGNAL DEBUG] Gagal mengeksekusi atau mem-parsing JSON. Output mentah:");
    console.log("----------------------------------------");
    console.log(stdoutRaw || err.message);
    console.log("----------------------------------------");
    return [];
  }
}

async function getSmartMoneyHolders(tokenAddress, retryCount = 1) {
  if (!process.env.GMGN_API_KEY) {
    console.error("[GMGN ERROR] 🛑 GMGN_API_KEY tidak ditemukan!");
    console.error("[DEBUG PATH] Bot berjalan di direktori:", process.cwd());
    return null;
  }

  if (!tokenAddress) return [];

  console.log(`[🚀 GMGN VIP] Memanggil API resmi untuk token: ${tokenAddress} (Attempt ${2 - retryCount}/2)`);
  
  try {
    // Task 1 & 2: Use basic command without unsupported options
    let command = `gmgn-cli token holders --chain sol --address ${tokenAddress} --raw`;
    let { stdout, stderr } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
      timeout: 20000
    });

    let rawJson = stdout;
    let jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    let data = {};
    try { data = JSON.parse(rawJson); } catch(e) {}

    let holders = Array.isArray(data) ? data : (data?.data?.holders || data?.data || []);

    // Task 3 & 4: Fallback to 'token info' if 'holders' is empty
    if (holders.length === 0) {
      console.log(`[GMGN] Data holders kosong, mencoba jalur 'token info' sebagai fallback...`);
      command = `gmgn-cli token info --chain sol --address ${tokenAddress} --raw`;
      const fallback = await execPromise(command, {
        env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
        timeout: 20000
      });
      
      let fbJson = fallback.stdout;
      const fbMatch = fbJson.match(/\[.*\]|\{.*\}/s);
      if (fbMatch) fbJson = fbMatch[0];
      
      try {
        const fbData = JSON.parse(fbJson);
        // Sometimes smart money info is in data.smart_money or similar inside token info
        holders = fbData?.data?.holders || fbData?.data?.top_holders || [];
      } catch(e) {}
    }

    // Final Retry Logic if still empty
    if (holders.length === 0 && retryCount > 0) {
      console.log(`[GMGN] Data masih kosong, menunggu 2 detik untuk re-index...`);
      await new Promise(r => setTimeout(r, 2000));
      return getSmartMoneyHolders(tokenAddress, retryCount - 1);
    }

    // Mapping ke format standar bot
    const formattedHolders = holders.map(h => ({
      address: h.address || h.wallet_address || h.owner,
      winrate: Number(h.win_rate || h.winrate || 0) * 100,
      total_pnl: Number(h.total_pnl || h.pnl || 0),
      trade_count: Number(h.trade_count || h.trades || 0),
      tags: h.tags || []
    }));

    if (formattedHolders.length > 0) {
      console.log(`[✅ GMGN SUCCESS] Data Smart Money berhasil ditarik.`);
    }
    return formattedHolders;

  } catch (err) {
    console.error(`[GMGN ERROR] Gagal mengeksekusi gmgn-cli:`, err.message);
    return [];
  }
}

/**
 * Token Security Check (Anti-Rug Filter)
 * Memeriksa distribusi pemegang koin dan potensi rug pull via GMGN CLI
 */
async function getTokenSecurity(tokenAddress) {
  if (!process.env.GMGN_API_KEY) return null;

  let stdoutRaw = "";
  try {
    const command = `gmgn-cli token security --chain sol --address ${tokenAddress}`;
    const { stdout, stderr } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
      timeout: 15000
    });

    stdoutRaw = stdout;
    
    let rawJson = stdout;
    const jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    return JSON.parse(rawJson);
  } catch (err) {
    console.log("[🛡️ RAW SECURITY DEBUG] Gagal eksekusi atau parse JSON. Output mentah:");
    console.log("----------------------------------------");
    console.log(stdoutRaw || err.message);
    console.log("----------------------------------------");
    return null; // Return null to indicate failure (Safety First)
  }
}

/**
 * Dev Info Analysis
 * Memeriksa informasi developer dan distribusi holding-nya
 */
async function getDevInfo(tokenAddress) {
  if (!process.env.GMGN_API_KEY) return null;

  let stdoutRaw = "";
  try {
    const command = `gmgn-cli token info --chain sol --address ${tokenAddress} --raw`;
    const { stdout, stderr } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
      timeout: 15000
    });

    stdoutRaw = stdout;
    
    let rawJson = stdout;
    const jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    return JSON.parse(rawJson);
  } catch (err) {
    console.log("[🧐 RAW DEV DEBUG] Gagal eksekusi atau parse JSON. Output mentah:");
    console.log("----------------------------------------");
    console.log(stdoutRaw || err.message);
    console.log("----------------------------------------");
    return null; // Return null to indicate failure (Safety First)
  }
}

/**
 * Live Combat Execution
 * Eksekusi Market Buy dengan proteksi Anti-MEV via GMGN CLI
 */
async function executeMarketBuyAntiMEV(tokenAddress, amountInSol) {
  if (!process.env.GMGN_API_KEY) {
    console.error("[GMGN ERROR] 🛑 GMGN_API_KEY tidak ditemukan!");
    return null;
  }
  
  console.log(`[🚀 GMGN EXECUTION] Memulai Live Buy Anti-MEV untuk token: ${tokenAddress} sebesar ${amountInSol} SOL`);
  
  let stdoutRaw = "";
  try {
    const command = `gmgn-cli trade buy --chain sol --address ${tokenAddress} --amount ${amountInSol} --anti-mev --raw`;
    const { stdout, stderr } = await execPromise(command, {
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
      timeout: 60000 // Beri waktu 1 menit untuk eksekusi transaksi di chain
    });

    stdoutRaw = stdout;
    
    // Coba extract JSON
    let rawJson = stdout;
    const jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
    if (jsonMatch) rawJson = jsonMatch[0];

    let txHash = "Check GMGN Log";
    try {
      const data = JSON.parse(rawJson);
      txHash = data.txHash || data.hash || data.signature || data.data?.txHash || "success";
    } catch(e) {
      // Ekstrak fallback via Regex jika output CLI bukan JSON
      const hashMatch = stdout.match(/(?<=txHash: |hash: |signature: )[A-Za-z0-9]{87,88}/i);
      if (hashMatch) txHash = hashMatch[0];
    }

    console.log(`[⚡ LIVE TRADE SUCCESS] Pembelian Anti-MEV berhasil! Tx: ${txHash}`);
    return txHash;

  } catch (err) {
    console.log(`[💀 LIVE TRADE ERROR] Gagal melakukan eksekusi Market Buy! Output mentah:`);
    console.log("----------------------------------------");
    console.log(stdoutRaw || err.message);
    console.log("----------------------------------------");
    return null;
  }
}

module.exports = {
  getSmartMoneyHolders,
  getSmartMoneyBuySignals,
  getSmartMoneyExitSignals,
  getTokenSecurity,
  getDevInfo,
  executeMarketBuyAntiMEV
};

