const bcrypt = require('bcryptjs');
const dbManager = require('./src/database/dbManager');

async function createAdmin() {
  const username = 'regan';
  const password = 'regan12345';
  
  try {
    await dbManager.initDb();
    
    // Check if user already exists
    const existing = await dbManager.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing && existing.length > 0) {
      console.log(`[SETUP] User '${username}' sudah ada.`);
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await dbManager.run(
      `INSERT INTO users (username, password, role, status) VALUES (?, ?, 'ADMIN', 'APPROVED')`,
      [username, hashedPassword]
    );

    console.log(`[SUCCESS] Admin user '${username}' berhasil dibuat!`);
    console.log(`Role: ADMIN`);
    console.log(`Status: APPROVED`);
  } catch (err) {
    console.error('[ERROR] Gagal membuat admin:', err.message);
  } finally {
    process.exit(0);
  }
}

createAdmin();
