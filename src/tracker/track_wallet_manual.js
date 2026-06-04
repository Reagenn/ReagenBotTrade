require('dotenv').config();
const dbManager = require('../database/dbManager');
const { getFullWalletProfile } = require('./wallet_profiler');

/**
 * Script untuk memantau dompet secara manual
 * Penggunaan: node src/tracker/track_wallet_manual.js <ALAMAT_DOMPET> [ALIAS]
 */

async function main() {
  const args = process.argv.slice(2);
  const address = args[0];
  const alias = args[1] || "Manual Entry";

  if (!address) {
    console.log("Penggunaan: node src/tracker/track_wallet_manual.js <ALAMAT_DOMPET> [ALIAS]");
    process.exit(1);
  }

  console.log(`[TRACKER] Mengambil data untuk dompet: ${address}...`);

  try {
    // Inisialisasi DB
    await dbManager.initDb();

    // Ambil profil lengkap (termasuk PnL dari Helius)
    const profile = await getFullWalletProfile(address);
    
    console.log(`[TRACKER] Data ditemukan: WinRate ${profile.winRate}% | PnL: ${profile.netProfitSol} SOL`);

    // Tambahkan ke database tracked_wallets
    await dbManager.addTrackedWallet({
      walletId: address,
      type: "DEX",
      network: "solana",
      alias: alias,
      tags: profile.tags || ["Manual"],
      profit_7d: profile.netProfitSol * 150, // Estimasi dalam USD (asumsi $150 per SOL)
      win_rate: profile.winRate,
      activity: `Manually added at ${new Date().toLocaleString()}`
    });

    console.log(`[TRACKER] ✅ Sukses menambahkan wallet ${address.slice(0, 8)}... ke tracked wallets`);
    console.log("✅ Berhasil! Dompet sekarang muncul di Dashboard dan Terminal.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Gagal:", err.message);
    process.exit(1);
  }
}

main();
