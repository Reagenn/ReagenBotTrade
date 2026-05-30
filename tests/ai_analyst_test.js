require('dotenv').config();
const { analyzeWithAgent } = require('../src/core/aiAnalyst');

async function testAI() {
  console.log("🚀 Memulai Test AI Agent Analyst...");
  
  // Data simulasi token
  const mockToken = {
    symbol: "SOL",
    priceUsd: 145.20,
    liquidityUsd: 5000000,
    fdv: 80000000,
    volume24h: 12000000,
    buys24h: 1500,
    sells24h: 1200,
    priceChange24h: 5.4
  };

  const result = await analyzeWithAgent(mockToken);
  
  console.log("\n📊 HASIL ANALISIS AI:");
  console.log("--------------------");
  console.log(JSON.stringify(result, null, 2));
  console.log("--------------------");
  
  if (result.score > 0) {
    console.log("✅ Berhasil: Modul AI bekerja dengan benar!");
  } else {
    console.log("❌ Gagal: Cek log error di atas (kemungkinan API Key belum valid).");
  }
}

testAI();
