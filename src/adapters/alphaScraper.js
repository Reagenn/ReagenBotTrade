require("dotenv").config();
const { EventEmitter } = require("events");

// Solana Contract Address (CA) Regex matching base58 string of length 32 to 44
const SOL_CA_REGEX = /([1-9A-HJ-NP-Za-km-z]{32,44})/;

class AlphaScraper extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.apiId = Number(process.env.TELEGRAM_API_ID || 0);
    this.apiHash = process.env.TELEGRAM_API_HASH || "";
    this.sessionString = process.env.TELEGRAM_SESSION || "";
  }

  /**
   * Initializes and listens to the specified Telegram channels.
   * Handles missing telegram module gracefully with a fallback/warning.
   * @param {string[]|number[]} channelIds - Array of channel IDs or usernames to listen to.
   */
  async listenToChannels(channelIds) {
    if (!channelIds || channelIds.length === 0) {
      console.warn("[📡 ALPHA] Tidak ada Channel ID yang diberikan untuk dipantau.");
      return;
    }

    try {
      // Dynamically check if 'telegram' is installed. If not, log instruction to install it.
      let TelegramModule;
      try {
        TelegramModule = require("telegram");
      } catch (e) {
        console.warn(
          "[📡 ALPHA] Library 'telegram' (GramJS) belum terinstal. Jalankan `npm install telegram` untuk mengaktifkan Telegram Listener asli."
        );
        console.log("[📡 ALPHA] Menjalankan Simulator/Mock Listener Telegram...");
        this.runMockListener(channelIds);
        return;
      }

      const { TelegramClient } = TelegramModule;
      const { StringSession } = require("telegram/sessions");
      const { NewMessage } = require("telegram/events");

      if (!this.apiId || !this.apiHash) {
        console.error(
          "[📡 ALPHA] TELEGRAM_API_ID atau TELEGRAM_API_HASH belum diatur di env. Gagal menginisialisasi Telegram Client."
        );
        return;
      }

      const session = new StringSession(this.sessionString);
      this.client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });

      console.log("[📡 ALPHA] Menghubungkan ke Telegram...");
      await this.client.connect();
      console.log("[📡 ALPHA] Telegram terhubung sukses!");

      // Start event handler for new messages
      this.client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message || !message.message) return;

        const text = message.message;
        const senderId = message.senderId;
        const peer = message.peerId;

        this.processTelegramMessage(text, { senderId, peer });
      }, new NewMessage({ chats: channelIds }));

      console.log(`[📡 ALPHA] Mendengarkan pesan dari channel: ${channelIds.join(", ")}`);
    } catch (error) {
      console.error("[📡 ALPHA] Gagal memulai Telegram Listener:", error.message);
    }
  }

  /**
   * Process incoming Telegram text to extract CA and analyze sentiment
   */
  processTelegramMessage(text, meta = {}) {
    console.log(`[📡 ALPHA] Sinyal dari Telegram diterima! Teks: "${text.substring(0, 60)}..."`);

    // Extract Solana Contract Address (CA) using Regex
    const match = text.match(SOL_CA_REGEX);
    if (!match) {
      return null;
    }

    const tokenAddress = match[1];
    console.log(`[📡 ALPHA] Berhasil mengekstrak CA Solana: ${tokenAddress}`);

    // Analyze sentiment
    const isBullish = this.analyzeSentiment(text);

    // Emit event for integration
    const payload = {
      tokenAddress,
      text,
      isBullish,
      meta,
      timestamp: new Date().toISOString()
    };

    this.emit("signal", payload);
    return payload;
  }

  /**
   * Placeholder/Dummy Sentiment Analysis
   * @param {string} text - Message content
   * @returns {boolean} - Returns true if bullish
   */
  analyzeSentiment(text) {
    if (!text) return false;

    const lowerText = text.toLowerCase();
    const bullishKeywords = ["moon", "gem", "send", "bullish", "pump", "x100", "solana sniper", "next btc", "10x"];

    // Check if any keyword matches
    const isBullish = bullishKeywords.some((keyword) => lowerText.includes(keyword));

    if (isBullish) {
      console.log("[📡 ALPHA] Analisis sentimen: BULLISH! 🚀");
    } else {
      console.log("[📡 ALPHA] Analisis sentimen: Neutral/Bearish.");
    }

    return isBullish;
  }

  /**
   * Mock listener for testing/fallback when gramjs is not installed
   */
  runMockListener(channelIds) {
    // Simulate incoming messages every 25 seconds for demonstration
    const mockMessages = [
      "Guys look at this absolute gem! Insane dev accumulation. CA: EPjFW31a5jaPga645cQ8tGYp1FjEtsgSL1zHRV1rzSyp to the moon!",
      "New coin launched, check CA: 2ojv9haXvhLIaQAchZJg17gUSV7qVL3JgJtT2P2Mkp22. Looks like a rug warning though.",
      "Big whale wallets buying fast: H8GQGoRsR2Yr6q8e3jL2TSZS1SZ7p4H2D36H249Tr57. Send it!",
    ];

    let messageIndex = 0;

    setInterval(() => {
      const channel = channelIds[Math.floor(Math.random() * channelIds.length)];
      const text = mockMessages[messageIndex % mockMessages.length];
      messageIndex++;

      console.log(`\n[📡 ALPHA] [Mock Telegram Channel: ${channel}] Pesan baru masuk...`);
      this.processTelegramMessage(text, { channel, isMock: true });
    }, 25000);
  }
}

module.exports = new AlphaScraper();
