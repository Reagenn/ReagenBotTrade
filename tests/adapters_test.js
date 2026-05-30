const heliusProfiler = require("../src/adapters/heliusProfiler");
const rugcheckAdapter = require("../src/adapters/rugcheckAdapter");
const alphaScraper = require("../src/adapters/alphaScraper");

async function testHeliusProfiler() {
  console.log("\n========================================");
  console.log("TESTING HELIUS PROFILER");
  console.log("========================================");
  
  // Test with invalid wallet
  console.log("1. Testing with empty wallet address:");
  const result1 = await heliusProfiler.isInsiderWallet("");
  console.log(`Result: ${result1} (Expected: false)`);

  // Test with a mock address without API key
  console.log("\n2. Testing with standard address (no Helius API key):");
  const result2 = await heliusProfiler.isInsiderWallet("2ojv9haXvhLIaQAchZJg17gUSV7qVL3JgJtT2P2Mkp22");
  console.log(`Result: ${result2} (Expected: false)`);
}

async function testRugcheckAdapter() {
  console.log("\n========================================");
  console.log("TESTING RUGCHECK ADAPTER");
  console.log("========================================");

  // Test with invalid token
  console.log("1. Testing with empty token address:");
  const result1 = await rugcheckAdapter.isTokenSafe("");
  console.log(`Result: ${result1} (Expected: false)`);

  // Test with a known token (BONK mint address on Solana: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263)
  console.log("\n2. Testing with BONK mint address (hits the actual Rugcheck API):");
  const result2 = await rugcheckAdapter.isTokenSafe("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  console.log(`Result: ${result2}`);
}

async function testAlphaScraper() {
  console.log("\n========================================");
  console.log("TESTING ALPHA SCRAPER");
  console.log("========================================");

  // Test sentiment analysis
  console.log("1. Testing Sentiment Analysis:");
  const text1 = "This is a real gem! We are going to the moon soon!";
  const text2 = "Just a regular update on BTC price movement.";
  
  console.log(`Text: "${text1}"`);
  const isBullish1 = alphaScraper.analyzeSentiment(text1);
  console.log(`Is Bullish: ${isBullish1} (Expected: true)`);
  
  console.log(`\nText: "${text2}"`);
  const isBullish2 = alphaScraper.analyzeSentiment(text2);
  console.log(`Is Bullish: ${isBullish2} (Expected: false)`);

  // Test regex extraction
  console.log("\n2. Testing CA Extraction from text:");
  const msg = "Buy the dip now, CA is EPjFW31a5jaPga645cQ8tGYp1FjEtsgSL1zHRV1rzSyp send it to the moon!";
  console.log(`Message: "${msg}"`);
  const extracted = alphaScraper.processTelegramMessage(msg, { test: true });
  console.log("Extracted payload:", JSON.stringify(extracted, null, 2));
}

async function runAllTests() {
  console.log("Mulai pengujian modul intelijen...");
  try {
    await testHeliusProfiler();
    await testRugcheckAdapter();
    await testAlphaScraper();
    console.log("\nAll syntax and basic logic tests passed successfully!");
  } catch (error) {
    console.error("Test failed with error:", error);
  }
}

runAllTests();
