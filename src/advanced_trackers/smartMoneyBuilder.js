require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");
const { analyzeWallet } = require("../solana/walletAnalyzer");
const axios = require("axios");
const dbManager = require("../database/dbManager");

// Database path for legacy smart money JSON (if still used)
const DB_PATH = path.resolve(__dirname, "../../data/smart_money_db.json");

// Helius RPC URL resolver
function getRpcUrl() {
  const configured = String(process.env.SOLANA_RPC_URL || "").trim();
  const heliusKey = String(process.env.HELIUS_API_KEY || "").trim();
  const useHelius =
    process.env.SOLANA_USE_HELIUS_RPC !== "false" &&
    heliusKey &&
    (!configured || configured.includes("api.mainnet-beta.solana.com"));

  if (useHelius) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }
  return configured || "https://api.mainnet-beta.solana.com";
}

const rpcHealth = require("../utils/rpc_health");

class SmartMoneyBuilder {
  constructor() {
    this.rpcUrl = getRpcUrl();
    this.heliusApiKey = String(process.env.HELIUS_API_KEY || "").trim();
    this.connection = new Connection(this.rpcUrl, "confirmed");
  }

  async executeWithRetry(fn, label, maxAttempts = 3, delayMs = 3000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const wait = await rpcHealth.rpcThrottle(Number(process.env.SOLANA_RPC_DELAY_MS || 1200));
        if (wait > 0) {
           if (rpcHealth.isRpcPaused()) {
             console.log(`[BUILDER] RPC sedang dalam masa jeda (rate limit), menunggu ${Math.round(wait / 1000)}s...`);
           }
           await new Promise(r => setTimeout(r, wait));
        }
        return await fn();
      } catch (e) {
        const isRateLimit = e.message.includes("429") || e.message.includes("max usage") || e.code === -32429;
        
        if (isRateLimit && attempt === maxAttempts) {
           console.error(`[BUILDER] RPC hit hard rate limit. Jeda global selama 60 detik.`);
           rpcHealth.setRpcPause(60000);
           throw e;
        }

        if (attempt === maxAttempts) throw e;

        const waitMs = isRateLimit ? Math.min(delayMs * (attempt + 1), 15000) : delayMs;
        console.warn(`[BUILDER] ${label} gagal (Percobaan ${attempt}/${maxAttempts}): ${e.message}. Mencoba kembali dalam ${waitMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }

  /**
   * a. Menggunakan koneksi Helius RPC untuk menarik 50 holder teratas dari sebuah koin.
   * @param {string} tokenAddress - SPL Token mint address
   * @returns {Promise<string[]>} Array alamat dompet owner teratas (maksimal 50)
   */
  async scoutTopHolders(tokenAddress) {
    if (!tokenAddress) {
      return [];
    }

    try {
      console.log(`[BUILDER] Memulai pencarian 50 holder teratas untuk koin: ${tokenAddress}`);
      
      let mintPubkey;
      try {
        mintPubkey = new PublicKey(tokenAddress);
      } catch (e) {
        console.error(`[BUILDER] Invalid token address: ${tokenAddress}`);
        return [];
      }

      // 1. Dapatkan Program Owner (standard SPL vs Token-2022)
      let tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      try {
        const mintInfo = await this.executeWithRetry(
          () => this.connection.getParsedAccountInfo(mintPubkey),
          "getParsedAccountInfo"
        );
        if (mintInfo.value?.owner) {
          tokenProgramId = mintInfo.value.owner;
        }
      } catch (e) {
        console.warn("[BUILDER] Gagal mengambil info program mint, default ke legacy SPL:", e.message);
      }

      // 2. Tarik semua akun program dengan slice data agar memuat Owner (offset 32) dan Balance (offset 64)
      const filters = [{ memcmp: { offset: 0, bytes: tokenAddress } }];
      if (tokenProgramId.toBase58() === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
        filters.unshift({ dataSize: 165 });
      }

      console.log(`[BUILDER] Menjalankan getProgramAccounts untuk program: ${tokenProgramId.toBase58()}...`);
      const accounts = await this.executeWithRetry(
        () => this.connection.getProgramAccounts(tokenProgramId, {
          dataSlice: { offset: 32, length: 40 },
          filters
        }),
        "getProgramAccounts"
      );

      console.log(`[BUILDER] Berhasil menarik ${accounts.length} akun token.`);

      // 3. Parse dan urutkan akun berdasarkan balance
      const parsedAccounts = [];
      for (const acc of accounts) {
        try {
          const data = acc.account.data;
          if (Buffer.isBuffer(data) && data.length >= 40) {
            const ownerBytes = data.slice(0, 32);
            const ownerAddress = new PublicKey(ownerBytes).toBase58();
            const amount = data.readBigUInt64LE(32);

            parsedAccounts.push({
              ownerAddress,
              amount: Number(amount)
            });
          }
        } catch (err) {
          // Abaikan akun corrupt
        }
      }

      // Urutkan descending dan buang duplikat owner
      const sortedHolders = parsedAccounts
        .sort((a, b) => b.amount - a.amount)
        .reduce((unique, item) => {
          if (!unique.some(u => u.ownerAddress === item.ownerAddress)) {
            unique.push(item);
          }
          return unique;
        }, [])
        .slice(0, 50)
        .map(h => h.ownerAddress);

      console.log(`[BUILDER] Terpilih ${sortedHolders.length} holder teratas untuk di-profile.`);
      return sortedHolders;
    } catch (error) {
      console.error("[BUILDER] Gagal melakukan scoutTopHolders:", error.message);
      return [];
    }
  }

  /**
   * b. Melakukan profiling win rate dari daftar dompet menggunakan modul walletAnalyzer.
   * @param {string[]} walletAddressesArray - Daftar alamat dompet
   * @returns {Promise<object[]>} Hasil profiling dompet
   */
  async profileWallets(walletAddressesArray) {
    if (!Array.isArray(walletAddressesArray) || !walletAddressesArray.length) {
      return [];
    }

    console.log(`[BUILDER] Memulai profiling terhadap ${walletAddressesArray.length} dompet...`);
    const results = [];

    for (let i = 0; i < walletAddressesArray.length; i++) {
      const address = walletAddressesArray[i];
      try {
        console.log(`[BUILDER] Profiling dompet (${i + 1}/${walletAddressesArray.length}): ${address.slice(0, 6)}...`);
        // Gunakan analyzeWallet dari walletAnalyzer
        const profile = await analyzeWallet(address, { limit: 40 });
        
        results.push({
          address,
          winRate: profile.winRate || 0,
          totalSwaps: profile.totalSwaps || 0,
          isSmartMoney: profile.isSmartMoney || false
        });
      } catch (err) {
        console.warn(`[BUILDER] Gagal profiling dompet ${address}:`, err.message);
      }

      // Berikan sedikit jeda untuk mencegah rate limit Helius RPC
      await new Promise(r => setTimeout(r, 400));
    }

    return results;
  }

  /**
   * c. Menyimpan dompet dengan Win Rate > 70% ke file lokal /data/smart_money_db.json.
   * @param {string} walletAddress - Alamat dompet
   * @param {number} winRate - Win Rate hasil analisis
   * @returns {Promise<boolean>} Status keberhasilan penyimpanan
   */
  async saveSmartMoney(walletAddress, winRate) {
    if (!walletAddress || winRate == null) {
      return false;
    }

    try {
      // Inisialisasi struktur DB jika belum ada
      let db = {
        updatedAt: new Date().toISOString(),
        wallets: []
      };

      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, "utf8").trim();
        if (raw) {
          db = JSON.parse(raw);
        }
      }

      db.wallets = Array.isArray(db.wallets) ? db.wallets : [];

      // Cari apakah sudah terdaftar, jika ya update win rate, jika tidak push baru
      const existingIdx = db.wallets.findIndex(w => w.address === walletAddress);
      if (existingIdx !== -1) {
        db.wallets[existingIdx].winRate = winRate;
        db.wallets[existingIdx].updatedAt = new Date().toISOString();
      } else {
        db.wallets.push({
          address: walletAddress,
          winRate: winRate,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      db.updatedAt = new Date().toISOString();
      
      // Buat folder parent jika belum ada
      const parentDir = path.dirname(DB_PATH);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
      console.log(`[BUILDER] Dompet ${walletAddress.slice(0, 6)}... berhasil disimpan dengan Win Rate: ${winRate}%`);
      return true;
    } catch (error) {
      console.error("[BUILDER] Gagal menyimpan ke database Smart Money lokal:", error.message);
      return false;
    }
  }

  /**
   * d. Mendaftarkan array dompet dari database lokal ke endpoint Webhook Helius API.
   * @param {string} webhookUrl - URL backend/listener Anda yang akan menerima ping POST dari Helius
   * @param {string|null} [webhookId] - Opsional. ID webhook jika ingin mengedit webhook yang sudah ada (PUT), null untuk membuat baru (POST)
   * @returns {Promise<object|null>} Response dari API Webhook Helius
   */
  async registerHeliusWebhook(webhookUrl, webhookId = null) {
    if (!webhookUrl) {
      throw new Error("[BUILDER] webhookUrl wajib diisi.");
    }

    if (!this.heliusApiKey) {
      throw new Error("[BUILDER] HELIUS_API_KEY tidak ditemukan di environment (.env). Webhook membutuhkan API key valid.");
    }

    try {
      // 1. Baca database lokal untuk mengambil daftar dompet
      if (!fs.existsSync(DB_PATH)) {
        console.warn("[BUILDER] Database Smart Money lokal tidak ditemukan. Batal meregistrasi webhook.");
        return null;
      }

      const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
      const wallets = (db.wallets || []).map(w => w.address);

      if (!wallets.length) {
        console.warn("[BUILDER] Tidak ada alamat dompet di database lokal. Webhook membutuhkan minimal 1 alamat.");
        return null;
      }

      console.log(`[BUILDER] Mendaftarkan ${wallets.length} dompet ke Webhook Helius...`);

      // Helius Webhook API URLs
      // POST untuk membuat webhook baru, PUT untuk memperbarui yang sudah ada
      const url = webhookId 
        ? `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${this.heliusApiKey}`
        : `https://api.helius.xyz/v0/webhooks?api-key=${this.heliusApiKey}`;

      const payload = {
        webhookURL: webhookUrl,
        transactionTypes: ["SWAP"],
        accountAddresses: wallets,
        webhookType: "enhanced" // Enhanced webhook menyajikan detail TX terurai (SWAP, NFT, dsb.)
      };

      const response = webhookId 
        ? await axios.put(url, payload, { timeout: 15000 })
        : await axios.post(url, payload, { timeout: 15000 });

      console.log(`[BUILDER] Webhook Helius berhasil ${webhookId ? "diperbarui" : "dibuat"}! ID Webhook: ${response.data?.id}`);
      return response.data;
    } catch (error) {
      console.error("[BUILDER] Gagal meregistrasikan Helius Webhook:", error.response?.data || error.message);
      return null;
    }
  }
}

module.exports = new SmartMoneyBuilder();
