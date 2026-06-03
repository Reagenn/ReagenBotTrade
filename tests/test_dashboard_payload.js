const { buildDashboardPayload } = require('../dashboard_server');
const dbManager = require('../src/database/dbManager');

async function test() {
  console.log("Testing dashboard payload building...");
  try {
    const payload = await buildDashboardPayload();
    console.log("Payload keys:", Object.keys(payload));
    console.log("CEX Paper Stats:", JSON.stringify(payload.cexPaper?.stats, null, 2));
    console.log("CEX Active Trades Count:", payload.cexPaper?.activeTrades?.length);
    if (payload.cexPaper?.activeTrades?.length > 0) {
      console.log("Sample Active Trade:", JSON.stringify(payload.cexPaper.activeTrades[0], null, 2));
    }
  } catch (err) {
    console.error("Test failed:", err.message);
  }
  process.exit(0);
}

test();
