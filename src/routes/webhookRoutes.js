/**
 * Helius Webhook Handler (Institutional Grade)
 * Disiapkan untuk menerima real-time push data dari Helius.
 */

async function handleHeliusWebhook(reqBody) {
    if (!Array.isArray(reqBody) || reqBody.length === 0) return;

    const event = reqBody[0];
    const type = event.type;

    console.log(`[HELIUS WEBHOOK] Event diterima: ${type}`);

    if (type === 'SWAP') {
        console.log("[HELIUS WEBHOOK] Deteksi SWAP - Memproses copy trade logic...");
        // Logika Copy Trade bisa disuntikkan di sini
    } else if (type === 'CREATE_POOL') {
        console.log("[HELIUS WEBHOOK] Deteksi POOL BARU - Memproses sniping logic...");
        // Logika Sniping Pool Baru
    } else {
        console.log(`[HELIUS WEBHOOK] Mengabaikan event tipe: ${type}`);
    }
}

// Export as a native HTTP-compatible router function
module.exports = {
    handleHeliusWebhook
};
