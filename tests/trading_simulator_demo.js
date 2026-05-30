/**
 * Demo cepat paper trading simulator.
 * node trading_simulator_demo.js
 */

const { SimulationEngine } = require("../src/solana/tradingSimulator");

const engine = new SimulationEngine({
  takeProfitPct: 50,
  stopLossPct: 20,
});

const TOKEN_A = "So11111111111111111111111111111111111111112";
const TOKEN_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

engine.simulateBuy(TOKEN_A, 0.00001, 1, { symbol: "DEMO_A" });
engine.simulateBuy(TOKEN_B, 0.00002, 0.5, { symbol: "DEMO_B" });

console.log("\n--- Tick 1: harga naik sedikit (belum TP/SL) ---");
engine.updatePricesAndCheckTriggers({
  [TOKEN_A]: 0.000012,
  [TOKEN_B]: 0.000021,
});

console.log("\n--- Tick 2: TOKEN_A menyentuh TP (+50%) ---");
engine.updatePricesAndCheckTriggers({
  [TOKEN_A]: 0.000015,
  [TOKEN_B]: 0.000021,
});

console.log("\n--- Tick 3: TOKEN_B menyentuh SL (-20%) ---");
engine.updatePricesAndCheckTriggers({
  [TOKEN_B]: 0.000016,
});

console.log("\n--- Statistik simulasi ---");
console.log(JSON.stringify(engine.getSimulationStats(), null, 2));
