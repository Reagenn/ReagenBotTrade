const dbManager = require('./src/database/dbManager');

async function seed() {
  console.log("[SEED] Memulai seeding data dummy untuk tracked_wallets...");
  
  try {
    await dbManager.initDb();

    const dummyWallets = [
      {
        walletId: "7v6Yq2vB8eZ7fG3h8Jk9Lp1mN2oP3qR4sT5uV6wX7yZ8",
        type: "DEX",
        network: "solana",
        alias: "The Whale God 🐋",
        tags: ["Smart Money", "Early Buyer", "Asia"],
        profit_7d: 12500.5,
        roi_7d: 145.2,
        profit_30d: 45000,
        roi_30d: 320.5,
        avg_invested: 2500,
        win_rate: 82.5,
        activity: "Baru saja membeli $PNUT senilai 50 SOL"
      },
      {
        walletId: "Hk9Lp1mN2oP3qR4sT5uV6wX7yZ87v6Yq2vB8eZ7fG3h8",
        type: "DEX",
        network: "solana",
        alias: "Degen Sniper 🎯",
        tags: ["Sniper", "Super Degen", "Fast"],
        profit_7d: -1200.25,
        roi_7d: -15.4,
        profit_30d: 8500.75,
        roi_30d: 45.2,
        avg_invested: 500,
        win_rate: 65.0,
        activity: "Aktif trading di token baru < 1 jam"
      },
      {
        walletId: "Bybit_Master_Trader_001",
        type: "CEX",
        network: "bybit",
        alias: "Bybit Alpha 📈",
        tags: ["CEX Whale", "Swing Trader"],
        profit_7d: 5400.0,
        roi_7d: 12.5,
        profit_30d: 18000.0,
        roi_30d: 25.8,
        avg_invested: 15000,
        win_rate: 74.2,
        activity: "Menambah posisi LONG di BTC/USDT"
      },
      {
        walletId: "G3h8Jk9Lp1mN2oP3qR4sT5uV6wX7yZ87v6Yq2vB8eZ7f",
        type: "DEX",
        network: "solana",
        alias: "Inside Job 🕵️",
        tags: ["Insider", "High Conviction"],
        profit_7d: 45200.0,
        roi_7d: 1250.0,
        profit_30d: 110000.0,
        roi_30d: 3400.0,
        avg_invested: 100,
        win_rate: 98.0,
        activity: "Akurat menebak token FIRE sebelum listing"
      }
    ];

    for (const w of dummyWallets) {
      await dbManager.addTrackedWallet(w);
      console.log(`[SEED] Sukses menambahkan: ${w.alias}`);
    }

    console.log("\n✅ Seeding selesai! Silakan cek halaman Track Wallet di Dashboard atau jalankan 'npm run track:wallets'");
    process.exit(0);
  } catch (err) {
    console.error("[SEED ERROR]", err.message);
    process.exit(1);
  }
}

seed();
