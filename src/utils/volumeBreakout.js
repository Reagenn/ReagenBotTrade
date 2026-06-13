/**
 * cekSinyalVolumeBreakout
 * Fungsi untuk mendeteksi lonjakan volume (breakout) mendadak pada koin baru.
 * 
 * @param {object} tokenData - Data JSON koin (dari DexScreener/Birdeye).
 * @returns {object} - Objek { valid: boolean, volumeSpike: number, rasio: number }
 */
function cekSinyalVolumeBreakout(tokenData) {
    try {
        // 1. Validasi keberadaan properti JSON (Safety Check)
        if (!tokenData || !tokenData.volume || !tokenData.txns) {
            return { valid: false };
        }

        // Ambil data volume (asumsikan struktur DexScreener/Birdeye yang umum)
        const vol5m = parseFloat(tokenData.volume.m5 || 0);
        const vol1m = parseFloat(tokenData.volume.m1 || 0); // Beberapa API custom/paid menyediakan m1

        // Jika vol1m tidak ada, kita bisa gunakan estimasi m5/5 sebagai baseline, 
        // tapi user secara spesifik meminta Volume 1m untuk pembanding.
        if (vol5m === 0 || vol1m === 0) return { valid: false };

        // 2. Hitung Rata-rata Volume per Menit (dari 5 menit terakhir)
        const avgVolPerMinute = vol5m / 5;

        // 3. Hitung Rasio Buy/Sell (1 menit terakhir)
        const txns1m = tokenData.txns.m1 || { buys: 0, sells: 0 };
        const buys = parseInt(txns1m.buys || 0);
        const sells = parseInt(txns1m.sells || 0);
        
        // Hindari division by zero untuk rasio
        const rasioBuySell = sells === 0 ? buys : buys / sells;

        // 4. Hitung Faktor Lonjakan (Spike Factor)
        const volumeSpikeFactor = vol1m / avgVolPerMinute;

        // 5. Logika Validasi Sinyal
        // Syarat: (Vol 1m > Avg 5m * 3) DAN (Rasio Buy/Sell > 2.0)
        const isVolumeSpike = vol1m > (avgVolPerMinute * 3);
        const isBullishRatio = rasioBuySell > 2.0;

        if (isVolumeSpike && isBullishRatio) {
            console.log(`\n\x1b[41m\x1b[37m[💥 BREAKOUT]\x1b[0m \x1b[33mVolume meledak ${volumeSpikeFactor.toFixed(1)}x lipat dengan rasio Buy/Sell ${rasioBuySell.toFixed(2)}. Eksekusi pembelian!\x1b[0m\n`);
            
            return {
                valid: true,
                volumeSpike: volumeSpikeFactor,
                rasio: rasioBuySell
            };
        }

        return { valid: false };

    } catch (err) {
        // Silent error handling agar bot tidak crash
        return { valid: false };
    }
}

module.exports = { cekSinyalVolumeBreakout };
