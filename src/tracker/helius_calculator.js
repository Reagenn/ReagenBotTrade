require('dotenv').config();
const axios = require('axios');

/**
 * Helius Calculator Module
 * Membantu menghitung PnL dompet secara manual menggunakan API Helius gratis.
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = `https://api.helius.xyz/v0/addresses/{{address}}/transactions?api-key=${HELIUS_API_KEY}`;

/**
 * Menarik riwayat transaksi terakhir dari Helius
 * @param {string} walletAddress 
 * @returns {Promise<Array>}
 */
async function fetchWalletTransactions(walletAddress) {
  if (!HELIUS_API_KEY) {
    console.error("[HELIUS] API Key tidak ditemukan di .env");
    return [];
  }

  try {
    const url = HELIUS_RPC_URL.replace('{{address}}', walletAddress);
    const response = await axios.get(url);
    
    // Helius mengembalikan array transaksi langsung
    return response.data || [];
  } catch (error) {
    console.error(`[HELIUS ERROR] Gagal tarik transaksi untuk ${walletAddress}:`, error.message);
    return [];
  }
}

/**
 * Kalkulasi PnL sederhana berdasarkan tipe SWAP
 * Algoritma: 
 * - Jika beli (SOL keluar), modal ++
 * - Jika jual (SOL masuk), revenue ++
 * @param {Array} transactions 
 * @returns {Object}
 */
function calculateWalletPnL(transactions) {
  let totalSolOut = 0; // Modal (Beli koin pakai SOL)
  let totalSolIn = 0;  // Revenue (Jual koin dapat SOL)
  let totalSwaps = 0;
  let wins = 0;

  // Track per token pnl untuk estimasi winrate (sangat sederhana)
  const tokenPnL = {}; 

  transactions.forEach(tx => {
    // Kita hanya fokus pada transaksi SWAP
    if (tx.type === 'SWAP') {
      const events = tx.events?.swap;
      if (!events) return;

      const nativeTransfers = tx.nativeTransfers || [];
      
      // Deteksi aliran SOL
      // Helius v0 data structure: nativeTransfers mencatat perpindahan lamports (1 SOL = 1e9 lamports)
      // Kita cari perpindahan SOL dari/ke wallet target
      
      let solChange = 0;
      nativeTransfers.forEach(transfer => {
        if (transfer.fromUserAccount === tx.feePayer) {
          // SOL Keluar (Beli atau bayar fee)
          solChange -= (transfer.amount / 1e9);
        } else if (transfer.toUserAccount === tx.feePayer) {
          // SOL Masuk (Jual)
          solChange += (transfer.amount / 1e9);
        }
      });

      if (solChange < 0) {
        totalSolOut += Math.abs(solChange);
        totalSwaps++;
      } else if (solChange > 0) {
        totalSolIn += solChange;
        totalSwaps++;
        wins++; // Asumsi sederhana setiap jual adalah win jika masuk akal
      }
    }
  });

  const netProfitSol = totalSolIn - totalSolOut;
  const winRate = totalSwaps > 0 ? (wins / totalSwaps) * 100 : 0;

  return {
    netProfitSol: Number(netProfitSol.toFixed(4)),
    totalTrades: totalSwaps,
    winRate: Number(winRate.toFixed(1)),
    timestamp: new Date().toISOString()
  };
}

/**
 * Helper untuk mendapatkan profil dompet lengkap
 * @param {string} walletAddress 
 */
async function getHeliusWalletProfile(walletAddress) {
  const txs = await fetchWalletTransactions(walletAddress);
  const pnlData = calculateWalletPnL(txs);
  
  return {
    address: walletAddress,
    ...pnlData,
    source: 'Helius Manual Calc'
  };
}

module.exports = {
  fetchWalletTransactions,
  calculateWalletPnL,
  getHeliusWalletProfile
};
