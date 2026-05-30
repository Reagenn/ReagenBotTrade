require('dotenv').config();
const axios = require('axios');

async function testHelius() {
  console.log("--- HELIUS API DIAGNOSTIC START ---");
  
  const rawKeys = process.env.HELIUS_API_KEY || process.env.HELIUS_API_KEYS || "";
  const keys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);
  
  if (keys.length === 0) {
    console.error("[ERROR] No HELIUS_API_KEY or HELIUS_API_KEYS found in .env");
    process.exit(1);
  }

  console.log(`[INFO] Found ${keys.length} Helius API key(s).`);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    console.log(`\n[TEST] Testing Key #${i+1}: ${key.slice(0, 4)}...${key.slice(-4)}`);

    // Test 1: DAS API (getAssetsByOwner)
    const dasUrl = `https://mainnet.helius-rpc.com/?api-key=${key}`;
    const testWallet = "2ojv9haXvhLIaQAchZJg17gUSV7qVL3JgJtT2P2Mkp22"; // Binance Hot Wallet
    
    try {
      console.log(`[DAS API] Requesting assets for ${testWallet}...`);
      const dasResponse = await axios.post(dasUrl, {
        jsonrpc: "2.0",
        id: "test",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: testWallet,
          page: 1,
          limit: 3,
          displayOptions: { showFungible: true }
        }
      }, { timeout: 10000 });

      if (dasResponse.data.result) {
        console.log(`[SUCCESS] DAS API working. Found ${dasResponse.data.result.items?.length || 0} items.`);
      } else {
        console.error(`[ERROR] DAS API returned invalid response:`, JSON.stringify(dasResponse.data));
      }
    } catch (err) {
      console.error(`[ERROR] DAS API failed: ${err.message}`);
      if (err.response) console.error(`[DEBUG] Status: ${err.response.status}, Data:`, JSON.stringify(err.response.data));
    }

    // Test 2: Transactions API
    const txUrl = `https://api.helius.xyz/v0/addresses/${testWallet}/transactions?api-key=${key}`;
    try {
      console.log(`[TX API] Requesting transactions for ${testWallet}...`);
      const txResponse = await axios.get(txUrl, { timeout: 10000 });
      if (Array.isArray(txResponse.data)) {
        console.log(`[SUCCESS] Transactions API working. Received ${txResponse.data.length} txs.`);
      } else {
        console.error(`[ERROR] Transactions API returned non-array response.`);
      }
    } catch (err) {
      console.error(`[ERROR] Transactions API failed: ${err.message}`);
      if (err.response) console.error(`[DEBUG] Status: ${err.response.status}, Data:`, JSON.stringify(err.response.data));
    }
  }

  console.log("\n--- HELIUS API DIAGNOSTIC END ---");
}

testHelius();
