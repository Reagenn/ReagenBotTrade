require("dotenv").config();
const axios = require("axios");

class BitqueryAdapter {
  constructor() {
    this.apiKey = String(process.env.BITQUERY_API_KEY || "").trim();
    // Bitquery GraphQL v1 API Endpoint
    // PENTING: Anda dapat mengubahnya ke endpoint GraphQL v2 (streaming) jika Anda bermigrasi.
    // Dokumentasi Bitquery: https://docs.bitquery.io/
    this.endpoint = "https://graphql.bitquery.io";
  }

  /**
   * Mengambil daftar swap besar (Large Swaps) untuk token tertentu di Solana dalam 1 jam terakhir.
   * @param {string} tokenAddress - SPL Token mint address
   * @param {number} minUsdAmount - Batas minimum nilai swap dalam USD (misal: 10000 untuk $10,000)
   * @returns {Promise<object[]>} Daftar swap besar beserta dompet (fee payer/trader) dan nominal USD
   */
  async getLargeSwaps(tokenAddress, minUsdAmount = 10000) {
    if (!tokenAddress) {
      throw new Error("[BITQUERY] Token address wajib diisi.");
    }

    if (!this.apiKey) {
      console.warn("[BITQUERY] BITQUERY_API_KEY tidak ditemukan di environment (.env). Request akan dikirim tanpa key.");
    }

    // Hitung waktu sejak 1 jam yang lalu dalam format ISO (UTC)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

    // Query GraphQL Bitquery untuk mencari dexTrades di Solana
    // Query ini memfilter berdasarkan buyCurrency (token yang dibeli), tanggal (1 jam terakhir), dan nominal USD transaksi
    const query = `
      query ($tokenAddress: String!, $minUsd: Float!, $sinceTime: String!) {
        solana {
          dexTrades(
            options: { limit: 100, desc: "block.timestamp.time" }
            tradeAmountUsd: { gt: $minUsd }
            buyCurrency: { is: $tokenAddress }
            time: { since: $sinceTime }
          ) {
            block {
              timestamp {
                time
              }
            }
            tradeAmountUsd
            buyAmount
            buyCurrency {
              symbol
              address
            }
            transaction {
              signature
              feePayer
            }
            side
          }
        }
      }
    `;

    try {
      console.log(`[BITQUERY] Mengambil swap besar (> $${minUsdAmount}) untuk token: ${tokenAddress.slice(0, 6)}...`);

      const response = await axios.post(
        this.endpoint,
        {
          query: query,
          variables: {
            tokenAddress: tokenAddress,
            minUsd: Number(minUsdAmount),
            sinceTime: oneHourAgo
          }
        },
        {
          headers: {
            "Content-Type": "application/json",
            // Autentikasi API Key Bitquery menggunakan header X-API-KEY
            "X-API-KEY": this.apiKey
          },
          timeout: 120000
        }
      );

      if (response.data?.errors) {
        throw new Error(JSON.stringify(response.data.errors));
      }

      const trades = response.data?.data?.solana?.dexTrades || [];
      
      // Map response ke format yang lebih ringkas & mudah dibaca
      return trades.map((trade) => ({
        timestamp: trade.block?.timestamp?.time || null,
        amountUsd: Number(trade.tradeAmountUsd || 0),
        buyAmount: Number(trade.buyAmount || 0),
        signature: trade.transaction?.signature || null,
        walletAddress: trade.transaction?.feePayer || null, // Fee payer diasumsikan sebagai dompet pengeksekusi swap
      }));
    } catch (error) {
      console.error(`[BITQUERY] Gagal mengambil swap besar via Bitquery:`, error.response?.data || error.message);
      // Mengembalikan array kosong agar bot utama tidak terputus (fault tolerant)
      return [];
    }
  }
}

module.exports = new BitqueryAdapter();
