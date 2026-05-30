const dbManager = require('./src/database/dbManager');

async function manualCleanup() {
  console.log("--- MANUAL DATABASE CLEANUP START ---");
  try {
    const result = await dbManager.removeDeadCoins();
    console.log(`Cleanup finished. Rows deleted: ${result.changes}`);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
  console.log("--- MANUAL DATABASE CLEANUP END ---");
  process.exit(0);
}

manualCleanup();
