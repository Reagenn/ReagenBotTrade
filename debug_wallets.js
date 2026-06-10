const dbManager = require('./src/database/dbManager');

async function check() {
  try {
    await dbManager.initDb();
    const wallets = await dbManager.getTrackedWallets();
    console.log("Tracked Wallets Count:", wallets.length);
    console.log("Wallets:", JSON.stringify(wallets, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
check();
