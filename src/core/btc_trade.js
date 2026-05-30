require("dotenv").config();
const dbManager = require("../database/dbManager");
const index = require("./index");

/**
 * ULTRA-CLEAN STARTUP FOR BTC TRADE ONLY
 */
async function startBtcOnly() {
  try {
    // 1. Silent Database Init
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    
    // Silence everything during init
    console.log = () => {}; 
    console.info = () => {};
    console.warn = () => {};

    await dbManager.initDb();
    
    // Restore logs
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;

    // 2. Identify Mode
    const mode = index.resolveRuntimeMode();
    
    // Task: Enforce Futures specifically for this script if needed
    // index.config.runMode = 'futures'; 

    // 3. THE ONLY LOG THE USER WANTS
    console.log(`\x1b[32m[SYSTEM] 📈 BTC ${mode.toUpperCase()} Trade dijalankan. Menunggu sinyal...\x1b[0m`);

    // 4. Start CEX Engine (No dashboard, no solana)
    if (mode === "spot") {
      await index.runSpotOnly();
    } else {
      await index.runFutures();
    }

  } catch (err) {
    console.error("[FATAL ERROR]", err.message);
    process.exit(1);
  }
}

// Global Rejection Handler
process.on("unhandledRejection", (reason) => {
  // Stay silent as requested, unless it's critical
});

startBtcOnly();
