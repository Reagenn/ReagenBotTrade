const axios = require('axios');

async function testDexScreener() {
  console.log("--- DEXSCREENER API DIAGNOSTIC START ---");
  
  // Test 1: Wrapped SOL (Random high-liquidity token)
  const mint = "So11111111111111111111111111111111111111112";
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  
  console.log(`[TEST] Requesting data for WSOL: ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    console.log(`[STATUS] Code: ${response.status} (${response.statusText})`);
    
    if (response.data && response.data.pairs && response.data.pairs.length > 0) {
      const bestPair = response.data.pairs[0];
      console.log(`[SUCCESS] Token Name: ${bestPair.baseToken.name}`);
      console.log(`[SUCCESS] Price USD: $${bestPair.priceUsd}`);
      console.log(`[SUCCESS] Liquidity: $${bestPair.liquidity?.usd || 0}`);
    } else {
      console.warn("[WARNING] Response received but no pairs found.");
    }

  } catch (err) {
    if (err.response) {
      console.error(`[ERROR] HTTP ${err.response.status}: ${err.response.statusText}`);
      console.error("[ERROR] Response Body:", JSON.stringify(err.response.data));
      
      if (err.response.status === 429) {
        console.error("!!! ALERT: You are being RATE LIMITED by DexScreener !!!");
      } else if (err.response.status === 403) {
        console.error("!!! ALERT: Access FORBIDDEN. Your IP might be blocked or require a different User-Agent !!!");
      }
    } else if (err.request) {
      console.error("[ERROR] No response received from server. Check your internet connection or firewall.");
    } else {
      console.error("[ERROR] Request setup failed:", err.message);
    }
  }

  // Test 2: Latest Profiles (Discovery Endpoint)
  const profileUrl = "https://api.dexscreener.com/token-profiles/latest/v1";
  console.log(`\n[TEST] Requesting Discovery Profiles: ${profileUrl}`);
  
  try {
    const response = await axios.get(profileUrl, { timeout: 10000 });
    console.log(`[STATUS] Code: ${response.status}`);
    console.log(`[SUCCESS] Received ${Array.isArray(response.data) ? response.data.length : 0} profiles.`);
  } catch (err) {
    console.error(`[ERROR] Discovery fetch failed: ${err.message}`);
  }

  console.log("\n--- DEXSCREENER API DIAGNOSTIC END ---");
}

testDexScreener();
