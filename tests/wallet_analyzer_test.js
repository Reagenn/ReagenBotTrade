require("dotenv").config();

const { analyzeWallet } = require("../src/solana/walletAnalyzer");

async function main() {
  const wallet = process.argv[2];
  if (!wallet) {
    console.log("Usage: node wallet_analyzer_test.js <WALLET_ADDRESS>");
    process.exit(1);
  }

  const result = await analyzeWallet(wallet, { includeTrades: true });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
