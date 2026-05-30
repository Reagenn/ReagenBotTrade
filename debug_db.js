const dbManager = require('./src/database/dbManager');

async function debug() {
  console.log('--- DB DEBUG START ---');
  try {
    const tables = await dbManager.query("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables.map(t => t.name).join(', '));

    for (const table of tables) {
      const [{count}] = await dbManager.query(`SELECT count(*) as count FROM ${table.name}`);
      console.log(`Table ${table.name}: ${count} rows`);
    }

    const appStates = await dbManager.query("SELECT key, length(value) as len FROM app_state");
    console.log('App State Keys:', appStates);

  } catch (err) {
    console.error('Debug failed:', err.message);
  }
  console.log('--- DB DEBUG END ---');
  process.exit(0);
}

debug();
