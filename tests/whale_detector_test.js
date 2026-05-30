const solanaTracker = require("../src/adapters/solanaTracker");

async function runTest() {
  const tokenAddress = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK Mint Address
  console.log(`Menjalankan tes whale detector untuk token: ${tokenAddress}`);

  try {
    const result = await solanaTracker.getTokenWhales(tokenAddress);
    console.log("Hasil deteksi Whale:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Uji coba Whale detector gagal:", error.message);
  }
}

runTest();
