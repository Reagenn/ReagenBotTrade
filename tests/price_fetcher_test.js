require("dotenv").config();

const { getTokenPrice } = require("../src/solana/priceFetcher");

const mint = process.argv[2] || "So11111111111111111111111111111111111111112";

getTokenPrice(mint)
  .then((quote) => {
    console.log(JSON.stringify(quote, null, 2));
  })
  .catch((error) => {
    console.error(`Gagal: ${error.message}`);
    process.exitCode = 1;
  });
