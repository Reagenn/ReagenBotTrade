require("dotenv").config();

const { analyzeToken } = require("../src/solana/tokenValidator");

const mint = process.argv[2];
if (!mint) {
  console.error("Usage: npm run token:validate -- <MINT_ADDRESS>");
  process.exit(1);
}

analyzeToken(mint, { skipCache: true })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.approved ? 0 : 1;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
