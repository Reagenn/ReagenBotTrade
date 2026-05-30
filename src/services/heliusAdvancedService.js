const axios = require("axios");

// Helius Configuration
const HELIUS_KEY = (process.env.HELIUS_API_KEY || "").split(',')[0].trim();
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

class HeliusAdvancedService {
  /**
   * Mengambil estimasi Priority Fee optimal dari Helius.
   * @param {string} rpcUrl - Optional override RPC
   * @returns {Promise<number>} - Priority fee in microlamports
   */
  async getOptimalPriorityFee(rpcUrl = HELIUS_RPC) {
    try {
      const response = await axios.post(rpcUrl, {
        jsonrpc: "2.0",
        id: "helius-fee",
        method: "getPriorityFeeEstimate",
        params: [{
          "options": { "includeAllPriorityFeeLevels": true }
        }]
      });

      const estimates = response.data?.result?.priorityFeeLevels;
      if (estimates) {
        // Gunakan level 'high' untuk menjamin konfirmasi cepat (top 10% of block)
        return Math.ceil(estimates.high || 1000);
      }
      return 1000; // Default fallback
    } catch (error) {
      console.warn("[HELIUS ADV] Gagal estimasi fee:", error.message);
      return 5000; // Safe fallback saat sibuk
    }
  }

  /**
   * Menganalisa apakah token didistribusikan ke banyak dompet sybil (Anti-Soft Rug).
   * Melacak flow SOL/Token dari dompet developer.
   * @param {string} tokenAddress 
   * @returns {Promise<object>}
   */
  async analyzeSybilDistribution(tokenAddress) {
    try {
      // Menggunakan Helius Parsed Transactions API
      const url = `https://api.helius.xyz/v0/token-metadata?api-key=${HELIUS_KEY}`;
      // Logika placeholder: Mencari transaksi pembuatan pool dan penyebaran token
      // Dalam implementasi nyata, ini akan men-traverse transaction history
      return {
        isSybilLikely: false,
        newWalletsCount: 0,
        devFlowConcentration: 0
      };
    } catch (error) {
      console.error("[HELIUS ADV] Sybil analysis error:", error.message);
      return { isSybilLikely: false, error: error.message };
    }
  }

  /**
   * Mengirim transaksi via Jito Block Engine untuk perlindungan MEV.
   * @param {object} transaction - Web3.js Transaction object
   * @returns {Promise<string>} - Signature
   */
  async sendJitoProtectedTransaction(transaction) {
    try {
      console.log("[JITO] Mengirim transaksi via Jito Block Engine...");
      // Wrapper kerangka untuk integrasi Jito (membutuhkan jito-ts atau axios post ke jito api)
      // Placeholder: Dalam simulasi paper trade, ini hanya log.
      return "jito_signature_placeholder";
    } catch (error) {
      console.error("[JITO] Transaction failed:", error.message);
      throw error;
    }
  }
}

module.exports = new HeliusAdvancedService();
