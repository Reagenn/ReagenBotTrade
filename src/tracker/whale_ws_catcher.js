const WebSocket = require('ws');
const chalk = require('chalk');
const dbManager = require('../database/dbManager');
const { profileWhaleWallet } = require('./wallet_profiler');

/**
 * Real-Time Whale Catcher (PumpPortal Edition)
 * Monitors live trades on Solana and filters for high-value smart money.
 */

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const MIN_BUY_SOL = 65; // ~ $10,000 at $154/SOL

async function startWhaleCatcher() {
  console.log(chalk.cyan.bold('\n[🐳 WHALE CATCHER] Menghubungkan ke WebSocket PumpPortal...'));

  const ws = new WebSocket(PUMPPORTAL_WS);

  ws.on('open', () => {
    console.log(chalk.green('✅ WebSocket Terhubung!'));
    
    // Subscribe ke semua trade token baru/bonding curve
    const subscribeMsg = {
      method: "subscribeTokenTrade"
    };
    ws.send(JSON.stringify(subscribeMsg));
    console.log(chalk.yellow('[📡] Menunggu Whale beraksi... (Filter: > 65 SOL)'));

    // Heartbeat to keep log alive
    setInterval(() => {
      console.log(chalk.gray(`[💓] Heartbeat: Listening for whales... ${new Date().toLocaleTimeString()}`));
    }, 30000);
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      // Log activity to show WS is working
      if (message.txType === 'buy') {
        const solAmt = parseFloat(message.solAmount || 0);
        
        // Show small logs for any buy to prove life
        if (solAmt < MIN_BUY_SOL) {
          process.stdout.write(chalk.gray('.')); // Small dot for regular trades
        }

        if (solAmt >= MIN_BUY_SOL) {
          console.log(chalk.blue(`\n[!] High Volume Detected: ${solAmt.toFixed(2)} SOL from ${message.traderPublicKey.slice(0, 4)}...`));
          const walletAddress = message.traderPublicKey;
          const tokenAddress = message.mint;

          // Proses Profiling
          handleWhaleDetection(walletAddress, tokenAddress, solAmt);
        }
      }
    } catch (err) {
      // Quiet error
    }
  });

  ws.on('error', (err) => {
    console.error(chalk.red(`[WS ERROR] ${err.message}`));
  });

  ws.on('close', () => {
    console.log(chalk.red('❌ WebSocket Terputus! Mencoba menyambung kembali dalam 5 detik...'));
    setTimeout(startWhaleCatcher, 5000);
  });
}

/**
 * Logika Pukulan Ganda: Cek ROI sebelum simpan
 */
async function handleWhaleDetection(walletAddress, tokenAddress, amountSol) {
  try {
    process.stdout.write(chalk.gray(`\n[🔍] Menganalisis Dompet: ${walletAddress.slice(0, 8)}...`));
    
    // Panggil Profiler untuk ROI 7D/30D
    const profile = await profileWhaleWallet(walletAddress);

    // Filter Lanjutan: ROI 7D harus positif (Smart Money)
    if (profile.roi_7d > 0) {
      // Simpan ke Database
      await dbManager.addTrackedWallet({
        wallet_id: walletAddress,
        type: 'DEX',
        network: 'solana',
        alias: `Whale-${walletAddress.slice(0, 4)}`,
        tags: profile.tags,
        latest_token_bought: tokenAddress,
        roi_7d: profile.roi_7d,
        roi_30d: profile.roi_30d,
        win_rate: profile.winrate,
        activity: `Bought ${amountSol.toFixed(2)} SOL of ${tokenAddress.slice(0, 8)}`
      });

      // Terminal Alert Dramatis
      console.log(`\n${chalk.bgBlue.white.bold(' ========================================= ')}`);
      console.log(`${chalk.blue.bold(' 🚨 [WHALE ALERT] SMART MONEY DETECTED! ')}`);
      console.log(`${chalk.white(' 🏦 Wallet: ')}${chalk.cyan(walletAddress)}`);
      console.log(`${chalk.white(' 🪙 Membeli Token: ')}${chalk.magenta(tokenAddress)}`);
      console.log(`${chalk.white(' 💰 Jumlah Beli: ')}${chalk.green.bold(amountSol.toFixed(2))} SOL`);
      console.log(`${chalk.white(' 📈 7D ROI Wallet: ')}${chalk.green(`+${profile.roi_7d.toFixed(1)}%`)} | ${chalk.white('30D ROI: ')}${chalk.green(`+${profile.roi_30d.toFixed(1)}%`)}`);
      console.log(`${chalk.white(' 💾 Status: ')}${chalk.bgGreen.black(' Tersimpan di Database! ')}`);
      console.log(`${chalk.bgBlue.white.bold(' ========================================= ')}\n`);
    } else {
      process.stdout.write(chalk.red(` ROI Negatif (${profile.roi_7d.toFixed(1)}%). Diabaikan.\n`));
    }

  } catch (error) {
    console.error(chalk.red(`\n[DETECTION ERROR] Gagal memproses whale ${walletAddress}: ${error.message}`));
  }
}

// Jalankan jika dipanggil langsung
if (require.main === module) {
  startWhaleCatcher();
}

module.exports = { startWhaleCatcher };
