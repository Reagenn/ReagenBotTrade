const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * cekSinyalSmartMoney
 * Fungsi untuk mendeteksi akumulasi Smart Money pada koin Solana.
 * 
 * @param {string} tokenAddress - Alamat kontrak (CA) token yang akan diperiksa.
 * @returns {Promise<boolean>} - True jika sinyal valid, False jika tidak.
 */
async function cekSinyalSmartMoney(tokenAddress) {
    if (!process.env.GMGN_API_KEY) {
        console.error("[⚠️ ERROR] GMGN_API_KEY tidak ditemukan di .env");
        return false;
    }

    try {
        const now = Math.floor(Date.now() / 1000);
        const windowSeconds = 300; // Rentang waktu 5 menit terakhir

        // 1. Tarik data traders dengan tag 'smart_degen' (Smart Money)
        // Kita ambil 50 trader terbaru untuk memastikan coverage window 5 menit
        const command = `gmgn-cli token traders --chain sol --address ${tokenAddress} --tag smart_degen --limit 50 --order-by profit --direction desc --raw`;
        
        const { stdout } = await execPromise(command, {
            env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY },
            timeout: 20000 // 20 detik timeout untuk API
        });

        // 2. Parsing JSON dari output CLI
        let rawJson = stdout;
        const jsonMatch = stdout.match(/\[.*\]|\{.*\}/s);
        if (jsonMatch) rawJson = jsonMatch[0];
        
        const data = JSON.parse(rawJson);
        const traders = data.data?.list || data.list || [];

        if (traders.length === 0) {
            return false; // Tidak ada aktivitas Smart Money
        }

        // 3. Filter aktivitas dalam 5 menit terakhir
        const recentActivity = traders.filter(t => (now - t.last_active_timestamp) <= windowSeconds);

        if (recentActivity.length < 3) {
            return false; // Kurang dari 3 dompet aktif
        }

        // 4. Analisis Beruntun (Consecutive Buys) & Massive Sells
        // Kita urutkan berdasarkan waktu (terbaru ke lama)
        const sortedActivity = recentActivity.sort((a, b) => b.last_active_timestamp - a.last_active_timestamp);
        
        let buyCount = 0;
        let massiveSellDetected = false;
        const uniqueWallets = new Set();

        for (const activity of sortedActivity) {
            const type = activity.token_transfer?.type; // 'buy' atau 'sell'
            const usdValue = parseFloat(activity.usd_value || 0);
            
            if (type === 'buy') {
                if (!uniqueWallets.has(activity.address)) {
                    buyCount++;
                    uniqueWallets.add(activity.address);
                }
            } else if (type === 'sell') {
                // Kriteria "SELL Masif": 
                // Kita asumsikan sell di atas $500 atau 50% dari estimasi buy volume di window ini sebagai masif
                // (Anda bisa menyesuaikan threshold ini sesuai selera risiko)
                if (usdValue > 500) {
                    massiveSellDetected = true;
                    break; 
                }
            }
        }

        // 5. Validasi Kondisi: Minimal 3 dompet BUY & Tidak ada massive SELL
        const isValidSignal = buyCount >= 3 && !massiveSellDetected;

        if (isValidSignal) {
            // Opsional: Tarik info token untuk log yang lebih cantik
            console.log(`\n\x1b[36m[🦈 SMART MONEY]\x1b[0m \x1b[32m${buyCount} Paus (Smart Money) terdeteksi membeli koin secara beruntun dalam 5 menit!\x1b[0m`);
            console.log(`\x1b[36m[🎯 SIGNAL]\x1b[0m CA: \x1b[33m${tokenAddress}\x1b[0m - \x1b[1mSINYAL BUY TERVALIDASI!\x1b[0m\n`);
            return true;
        }

        return false;

    } catch (err) {
        console.error(`[❌ GMGN TIMEOUT/ERROR] Gagal memproses ${tokenAddress.slice(0, 8)}: ${err.message}`);
        return false;
    }
}

module.exports = { cekSinyalSmartMoney };
