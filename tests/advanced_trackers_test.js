const shyftAdapter = require("../src/advanced_trackers/shyftAdapter");
const bitqueryAdapter = require("../src/advanced_trackers/bitqueryAdapter");
const smartMoneyBuilder = require("../src/advanced_trackers/smartMoneyBuilder");
const fs = require("fs");
const path = require("path");

async function runTest() {
  console.log("========================================");
  console.log("TESTING ADVANCED TRACKERS MODULES");
  console.log("========================================\n");

  const testMint = "26YRpwvWhTSBSAkQbhNP6AXBNrJe8uRxibAn7ZXXpump"; // SPCX Mint Address

  // 2. Testing Shyft Adapter
  console.log("2. Testing Shyft Adapter...");
  try {
    const shyftResult = await shyftAdapter.getTopBuyers(testMint);
    console.log(`[OK] Shyft Result Count: ${shyftResult.length}`);
    if (shyftResult.length > 0) {
      console.log(`[OK] Top Holder: ${shyftResult[0].address} (${shyftResult[0].balance})`);
    }
  } catch (err) {
    console.error("[FAIL] Shyft Adapter error:", err.message);
  }
  console.log("----------------------------------------\n");

  // 3. Testing Bitquery Adapter
  console.log("3. Testing Bitquery Adapter...");
  try {
    const bitqueryResult = await bitqueryAdapter.getLargeSwaps(testMint, 1000);
    console.log(`[OK] Bitquery Result Count: ${bitqueryResult.length}`);
  } catch (err) {
    console.error("[FAIL] Bitquery Adapter error:", err.message);
  }
  console.log("----------------------------------------\n");

  // 4. Testing Smart Money Builder
  console.log("4. Testing Smart Money Builder...");
  try {
    // a. Scout Top Holders
    console.log("a. Scouting top holders (Helius RPC)...");
    const topHolders = await smartMoneyBuilder.scoutTopHolders(testMint);
    console.log(`[OK] Scouted Holders Count: ${topHolders.length}`);

    if (topHolders.length > 0) {
      // Limit to 2 wallets for testing speed
      const testWallets = topHolders.slice(0, 2);
      
      // b. Profile Wallets
      console.log("b. Profiling top 2 wallets (Helius PnL)...");
      const profiles = await smartMoneyBuilder.profileWallets(testWallets);
      console.log(`[OK] Profiles Count: ${profiles.length}`);
      
      // c. Save Smart Money if Win Rate >= 0 (using lower threshold for testing)
      console.log("c. Saving smart money wallets to local DB...");
      for (const profile of profiles) {
        // Save to DB to test write functionality
        const saved = await smartMoneyBuilder.saveSmartMoney(profile.address, profile.winRate);
        console.log(`[OK] Saved ${profile.address.slice(0, 6)}: ${saved}`);
      }

      // Check if DB exists and has content
      const dbPath = path.resolve(__dirname, "../data/smart_money_db.json");
      if (fs.existsSync(dbPath)) {
        const dbContent = JSON.parse(fs.readFileSync(dbPath, "utf8"));
        console.log(`[OK] smart_money_db.json has ${dbContent.wallets?.length || 0} wallets saved.`);
      }
    }

    // d. Webhook Registration (Mock or test depending on key presence)
    console.log("d. Testing Helius Webhook registration...");
    if (process.env.HELIUS_API_KEY) {
      // Test webhook registration with a mock localhost url
      // We do not expect it to succeed on Helius if local URL is invalid, but we test the code flow
      const webhookRes = await smartMoneyBuilder.registerHeliusWebhook("http://localhost:3088/webhook");
      console.log(`[OK] Webhook Result (Expected Null/Obj depending on key/url):`, webhookRes ? "Success" : "Bypassed/Failed");
    } else {
      console.log("[SKIP] Webhook test skipped because HELIUS_API_KEY is not configured.");
    }

  } catch (err) {
    console.error("[FAIL] Smart Money Builder error:", err.message);
  }
  console.log("========================================\n");
}

runTest().catch(console.error);
