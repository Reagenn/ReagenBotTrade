require("dotenv").config();
const axios = require("axios");

class ShyftAdapter {
  constructor() {
    this.apiKey = String(process.env.SHYFT_API_KEY || "").trim();
    // Shyft.to API Base URL untuk Solana
    // PENTING: Anda dapat menggunakan endpoint v1 atau v2 sesuai kebutuhan fungsionalitas Shyft.
    // Dokumentasi Shyft: https://docs.shyft.to/
    this.baseUrl = "https://api.shyft.to/sol/v1";
  }

  /**
   * Mengambil daftar dompet dengan pembelian/kepemilikan token terbanyak untuk mendeteksi Whale awal.
   * @param {string} tokenAddress - SPL Token mint address
   * @returns {Promise<object[]>} Daftar dompet pembeli/holder teratas beserta saldo/persentase kepemilikan
   */
  async getTopBuyers(tokenAddress) {
    if (!tokenAddress) {
      throw new Error("[SHYFT] Token address wajib diisi.");
    }

    if (!this.apiKey) {
      console.warn("[SHYFT] SHYFT_API_KEY tidak ditemukan di environment (.env). Request akan dikirim tanpa key.");
    }

    try {
      console.log(`[SHYFT] Mengambil data top buyers/holders untuk token: ${tokenAddress.slice(0, 6)}...`);

      // SHYFT ENDPOINT NOTE:
      // Di bawah ini kita menggunakan endpoint `/token/get_owners` untuk mendapatkan data kepemilikan.
      // Jika Anda ingin menganalisis "akumulasi volume beli pertama" saat peluncuran token, 
      // Anda bisa beralih menggunakan endpoint transaksi Shyft: `/transaction/history` 
      // kemudian menyaring & menjumlahkan nilai transaksi masuk untuk setiap dompet.
      const url = `${this.baseUrl}/token/get_owners`;

      const response = await axios.get(url, {
        headers: {
          accept: "application/json",
          // Autentikasi API Key Shyft menggunakan header x-api-key
          "x-api-key": this.apiKey
        },
        params: {
          network: "mainnet-beta",
          token_address: tokenAddress
        },
        timeout: 10000
      });

      // Format response Shyft: { success: true, result: [ { address: '...', balance: 100 } ] }
      const holders = response.data?.result || [];
      
      // Urutkan berdasarkan balance terbanyak (descending) untuk mendapatkan top buyers/whales
      const sortedBuyers = holders
        .map(h => ({
          address: h.address,
          balance: Number(h.balance || 0),
          // Persentase kepemilikan (jiga ada di response)
          ownerPercent: h.owner_percent || 0
        }))
        .sort((a, b) => b.balance - a.balance);

      return sortedBuyers;
    } catch (error) {
      console.error(`[SHYFT] Gagal mengambil top buyers untuk token ${tokenAddress}:`, error.response?.data || error.message);
      // Mengembalikan array kosong agar bot tidak terputus (fault tolerant)
      return [];
    }
  }
}

module.exports = new ShyftAdapter();
