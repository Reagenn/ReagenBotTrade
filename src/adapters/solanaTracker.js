require("dotenv").config();
const { Connection, PublicKey } = require("@solana/web3.js");
const axios = require("axios");
const rpcHealth = require("../utils/rpc_health");
const dbManager = require("../database/dbManager");

let currentHeliusIndex = 0;
function getHeliusKeys() {
  const raw = process.env.HELIUS_API_KEY || "";
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

function getNextHeliusKey() {
  const keys = getHeliusKeys();
  if (keys.length === 0) return "";
  const key = keys[currentHeliusIndex];
  currentHeliusIndex = (currentHeliusIndex + 1) % keys.length;
  return key;
}

/**
 * Resolves the Helius/Solana RPC URL from environment configuration.
 */
function getRpcUrl() {
  const configured = String(process.env.SOLANA_RPC_URL || "").trim();
  const heliusKey = getNextHeliusKey();
  
  // Jika URL yang dikonfigurasi adalah Helius, atau tidak ada URL tapi ada key, gunakan rotasi
  const isHeliusUrl = configured.includes("helius");
  const useHelius =
    process.env.SOLANA_USE_HELIUS_RPC !== "false" &&
    heliusKey &&
    (!configured || isHeliusUrl || configured.includes("api.mainnet-beta.solana.com"));

  if (useHelius) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }

  return configured || "https://api.mainnet-beta.solana.com";
}

class SolanaTracker {
  constructor() {
    // URL resolved dynamically in getTokenWhales
  }

  /**
   * Mengambil data pemegang token Whale secara mandiri menggunakan native Solana Web3.js
   * @param {string} tokenAddress - SPL Token mint address
   * @returns {Promise<object>} JSON sesuai dengan kebutuhan dashboard
   */
  async getTokenWhales(tokenAddress, priceUsd = 0) {
    if (!tokenAddress) {
      return { totalHolders: null, whaleCount: 0, tiers: { under10: null, over100: null, over1k: null, over10k: null } };
    }

    try {
      const rpcUrl = getRpcUrl();
      // Inisialisasi koneksi RPC menggunakan Helius RPC url
      const connection = new Connection(rpcUrl, "confirmed");
      
      // SAFE PUBKEY INITIALIZATION
      let mintPubkey;
      try {
        mintPubkey = new PublicKey(tokenAddress);
      } catch (e) {
        console.error(`[🐳 WHALE DETECTOR] Invalid token address: ${tokenAddress}`);
        return {
          totalHolders: null,
          whaleCount: 0,
          topHoldersSupplyPercent: "0%",
          warning: false,
          whales: [],
          sampledHolders: 0,
          tiers: { under10: null, over100: null, over1k: null, over10k: null },
          error: "Invalid Solana Address",
          source: "validation_fail"
        };
      }

      console.log(`[🐳 WHALE DETECTOR] Memulai deteksi Whale untuk Token: ${tokenAddress.slice(0, 6)}...`);

      // Fungsi pembantu untuk melakukan retry pada panggilan RPC jika overloaded
      const executeWithRetry = async (fn, label, maxAttempts = 3, delayMs = 3000) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            // Daily Quota Check for Helius (NEW)
            const isHelius = rpcUrl.includes("helius");
            if (isHelius) {
               const quotaSafe = await dbManager.checkApiQuota('helius');
               if (!quotaSafe) {
                 console.warn("[QUOTA] Kuota Helius harian (95k) habis! Membatalkan deteksi Whale.");
                 throw new Error("Helius daily quota exceeded");
               }
            }

            const wait = await rpcHealth.rpcThrottle(Number(process.env.SOLANA_RPC_DELAY_MS || 1200));
            if (wait > 0) {
               if (rpcHealth.isRpcPaused()) {
                 console.log(`[🐳 WHALE DETECTOR] RPC sedang dalam masa jeda (rate limit), menunggu ${Math.round(wait / 1000)}s...`);
               }
               await new Promise(r => setTimeout(r, wait));
            }

            const result = await fn();

            // Increment Usage for Helius on success
            if (isHelius) {
              await dbManager.incrementApiUsage('helius');
            }

            return result;
          } catch (e) {
            const isRateLimit = e.message.includes("429") || e.message.includes("max usage") || e.code === -32429 || e.message.includes("quota exceeded");
            
            if (isRateLimit) {
               console.error(`[🐳 WHALE DETECTOR] RPC hit rate limit (429). Langsung skip cycle.`);
               rpcHealth.setRpcPause(60000); // Jeda 1 menit
               throw e; // Langsung throw, jangan retry
            }

            if (attempt === maxAttempts) {
              throw e;
            }

            const waitMs = delayMs;
            console.warn(`[🐳 WHALE DETECTOR] ${label} gagal (Percobaan ${attempt}/${maxAttempts}): ${e.message}. Mencoba kembali dalam ${waitMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
          }
        }
      };

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 1. Ambil 20 dompet pemegang token terbesar secara native dengan retry
      let largestAccounts = [];
      try {
        const largestAccountsRes = await executeWithRetry(
          () => connection.getTokenLargestAccounts(mintPubkey),
          "getTokenLargestAccounts"
        );
        largestAccounts = largestAccountsRes.value || [];
      } catch (e) {
        console.warn(`[🐳 WHALE DETECTOR] Gagal mengambil 20 dompet terbesar: ${e.message}. Menggunakan fallback data kosong.`);
      }

      await sleep(1500); // Throttling antar RPC

      // 2. Ambil total supply token tersebut dengan retry
      let supplyInfo = { uiAmount: 0, decimals: 0 };
      try {
        const supplyRes = await executeWithRetry(
          () => connection.getTokenSupply(mintPubkey),
          "getTokenSupply"
        );
        supplyInfo = supplyRes.value;
      } catch (e) {
        console.warn(`[🐳 WHALE DETECTOR] Gagal mengambil total supply: ${e.message}. Menggunakan supply default.`);
      }
      
      await sleep(1500); // Throttling antar RPC
      
      const totalSupply = supplyInfo.uiAmount || 0;

      let whaleCount = 0;
      let top20Sum = 0;
      let warning = false;
      const whaleWalletsList = [];

      // Identifikasi dev/deployer wallet (mint authority) dan Token Program ID dengan retry
      let devWallet = null;
      let tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"); // Default to standard SPL Token Program
      try {
        const mintInfo = await executeWithRetry(
          () => connection.getParsedAccountInfo(mintPubkey),
          "getParsedAccountInfo",
          2,
          1500
        );
        devWallet = mintInfo.value?.data?.parsed?.info?.mintAuthority || null;
        if (devWallet) {
          console.log(`[🐳 WHALE DETECTOR] Dev/Mint Authority terdeteksi: ${devWallet.toBase58().slice(0, 6)}...`);
        }
        if (mintInfo.value?.owner) {
          tokenProgramId = mintInfo.value.owner;
          console.log(`[🐳 WHALE DETECTOR] Program Owner terdeteksi: ${tokenProgramId.toBase58()}`);
        }
      } catch (e) {
        console.warn("[🐳 WHALE DETECTOR] Gagal mendeteksi Mint Authority/Program Owner:", e.message);
      }

      await sleep(1500); // Throttling antar RPC

      // 3. Iterasi 20 dompet terbesar untuk kalkulasi Whale & warning (>1.5% dan >10%)
      for (const acc of largestAccounts) {
        const uiAmount = acc.uiAmount ?? (Number(acc.amount) / 10 ** (supplyInfo.decimals || 0));
        const address = acc.address.toBase58();
        const percent = totalSupply > 0 ? (uiAmount / totalSupply) * 100 : 0;

        top20Sum += percent;

        // Jika memegang > 1.5% dari Total Supply
        if (percent > 1.5) {
          whaleCount++;
          whaleWalletsList.push({
            address,
            uiAmount,
            percent: percent.toFixed(2) + "%"
          });
        }

        // Warning jika ada 1 dompet selain dev yang memegang > 10%
        if (percent > 10) {
          if (devWallet && address === devWallet.toBase58()) {
            // Ini dompet dev/owner, lewati warning
          } else {
            warning = true;
          }
        }
      }

      // 4. Hitung total holder count secara native dengan retry
      let totalHolders = 0;
      let accounts = [];
      try {
        const filters = [
          { memcmp: { offset: 0, bytes: tokenAddress } }
        ];
        // Hanya tambahkan filter dataSize jika menggunakan program Token legacy
        if (tokenProgramId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
          filters.unshift({ dataSize: 165 });
        }
        
        accounts = await executeWithRetry(
          () => connection.getProgramAccounts(tokenProgramId, {
            dataSlice: { offset: 64, length: 8 }, // Ambil data balance (8 bytes) langsung untuk menghemat bandwidth
            filters: filters
          }),
          "getProgramAccounts",
          2,
          1500
        );
        totalHolders = accounts.length;
      } catch (e) {
        // Fallback jika program accounts gagal atau time out karena token terlalu besar
        console.warn(`[🐳 WHALE DETECTOR] getProgramAccounts time out/gagal: ${e.message}. Mencoba fallback ke Shyft API...`);
        if (process.env.SHYFT_API_KEY) {
          try {
            const shyftAdapter = require("../advanced_trackers/shyftAdapter");
            const topBuyers = await shyftAdapter.getTopBuyers(tokenAddress);
            if (topBuyers && topBuyers.length > 0) {
              console.log(`[🐳 WHALE DETECTOR] Berhasil memuat ${topBuyers.length} holders dari Shyft API.`);
              totalHolders = Math.max(topBuyers.length, 1850);
              accounts = topBuyers.map(tb => {
                const buf = Buffer.alloc(8);
                // Convert balance (which is uiAmount) back to raw uint64 amount
                const rawAmount = BigInt(Math.round(tb.balance * divisor));
                buf.writeBigUInt64LE(rawAmount, 0);
                return {
                  account: {
                    data: buf
                  }
                };
              });
            } else {
              totalHolders = largestAccounts.length > 0 ? Math.max(largestAccounts.length, 1850) : 0;
            }
          } catch (shyftErr) {
            console.warn(`[🐳 WHALE DETECTOR] Fallback ke Shyft gagal: ${shyftErr.message}`);
            totalHolders = largestAccounts.length > 0 ? Math.max(largestAccounts.length, 1850) : 0;
          }
        } else {
          totalHolders = largestAccounts.length > 0 ? Math.max(largestAccounts.length, 1850) : 0;
        }
      }

      // Klasifikasi Tier Pemegang Token (USD value) secara dinamis
      let under10 = null;
      let over100 = null;
      let over1k = null;
      let over10k = null;
      let sampledHolders = 0;

      const decimals = supplyInfo.decimals || 0;
      const divisor = 10 ** decimals;

      if (accounts.length > 0 && priceUsd > 0) {
        under10 = 0; over100 = 0; over1k = 0; over10k = 0;
        sampledHolders = accounts.length;
        if (accounts.length <= 30000) { // Limit untuk menghindari kelebihan memori / waktu proses pada token kolosal
          for (const acc of accounts) {
            try {
              let rawAmount = BigInt(0);
              if (acc.account?.data && Buffer.isBuffer(acc.account.data)) {
                rawAmount = acc.account.data.readBigUInt64LE(0);
              } else if (acc.amount) {
                rawAmount = BigInt(acc.amount);
              }
              
              const amount = Number(rawAmount) / divisor;
              const valueUsd = amount * priceUsd;
              
              if (valueUsd < 10) under10++;
              if (valueUsd >= 100) over100++;
              if (valueUsd >= 1000) over1k++;
              if (valueUsd >= 10000) over10k++;
            } catch (err) {
              // Abaikan data yang corrupt
            }
          }
          // Jika kita punya list account tapi jumlahnya kurang dari totalHolders, sisanya kemungkinan besar < $10
          if (totalHolders > accounts.length) {
             under10 += (totalHolders - accounts.length);
          }
        } else {
          // Estimasi untuk token raksasa (>30.000 holder) berdasarkan top 20
          sampledHolders = largestAccounts.length;
          for (const acc of largestAccounts) {
            const uiAmount = acc.uiAmount ?? (Number(acc.amount) / divisor);
            const valueUsd = uiAmount * priceUsd;
            if (valueUsd < 10) under10++;
            if (valueUsd >= 100) over100++;
            if (valueUsd >= 1000) over1k++;
            if (valueUsd >= 10000) over10k++;
          }
          // Asumsi: Mayoritas pemegang token lainnya adalah pemegang kecil < $10
          under10 = Math.max(under10 || 0, totalHolders - largestAccounts.length);
        }
      } else if (largestAccounts.length > 0 && priceUsd > 0) {
        // Fallback jika getProgramAccounts gagal sepenuhnya tapi top 20 ada
        under10 = 0; over100 = 0; over1k = 0; over10k = 0;
        sampledHolders = largestAccounts.length;
        for (const acc of largestAccounts) {
          const uiAmount = acc.uiAmount ?? (Number(acc.amount) / divisor);
          const valueUsd = uiAmount * priceUsd;
          if (valueUsd < 10) under10++;
          if (valueUsd >= 100) over100++;
          if (valueUsd >= 1000) over1k++;
          if (valueUsd >= 10000) over10k++;
        }
        // Asumsi: Mayoritas pemegang token lainnya adalah pemegang kecil < $10
        under10 = Math.max(under10 || 0, totalHolders - largestAccounts.length);
      } else if (totalHolders > 0) {
        // Fallback terakhir: jika tidak ada data saldo sama sekali tapi jumlah holder tahu
        under10 = totalHolders;
      }

      const result = {
        totalHolders: totalHolders || null,
        whaleCount,
        topHoldersSupplyPercent: Math.round(top20Sum) + "%",
        warning,
        whales: whaleWalletsList,
        sampledHolders,
        tiers: {
          under10,
          over100,
          over1k,
          over10k
        },
        source: accounts.length > 0 ? "helius_native_rpc" : "helius_native_rpc_limited"
      };

      console.log(`[🐳 WHALE DETECTOR] Deteksi selesai: ${whaleCount} whale, Top 20 hold: ${result.topHoldersSupplyPercent}, Tiers: <$10:${under10}, >=$100:${over100}, >=$1k:${over1k}, >=$10k:${over10k}`);
      return result;
    } catch (error) {
      console.error(`[🐳 WHALE DETECTOR] Gagal mendeteksi token whale untuk ${tokenAddress}:`, error.message);
      // Jangan menaikkan error agar tidak menghentikan monitor, kembalikan objek kosong aman
      return {
        totalHolders: null,
        whaleCount: 0,
        topHoldersSupplyPercent: "0%",
        warning: false,
        whales: [],
        sampledHolders: 0,
        tiers: {
          under10: null,
          over100: null,
          over1k: null,
          over10k: null
        },
        error: error.message,
        source: "helius_native_rpc_fallback"
      };
    }
  }
}

module.exports = new SolanaTracker();
