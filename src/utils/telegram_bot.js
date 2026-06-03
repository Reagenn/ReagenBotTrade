const dbManager = require("../database/dbManager");
const { formatMoney } = require("./log_helpers");

class TelegramBot {
  constructor({ botToken, chatId }) {
    this.botToken = botToken;
    this.chatId = Number(chatId);
    this.lastUpdateId = 0;
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) return;
    if (!this.botToken) {
      console.warn("[TelegramBot] Token tidak ditemukan, listener perintah tidak diaktifkan.");
      return;
    }
    
    console.log("[TelegramBot] Memulai listener perintah Telegram...");
    this.isRunning = true;
    this.poll();
  }

  async poll() {
    while (this.isRunning) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`);
        const payload = await response.json();
        
        if (payload.ok && payload.result.length > 0) {
          for (const update of payload.result) {
            this.lastUpdateId = update.update_id;
            await this.handleUpdate(update);
          }
        }
      } catch (err) {
        console.error("[TelegramBot] Polling error:", err.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  async handleUpdate(update) {
    const message = update.message;
    if (!message || !message.text) return;

    const text = message.text.trim();
    const fromId = message.chat.id;

    // Hanya respon jika dari Chat ID yang diizinkan (keamanan)
    if (fromId !== this.chatId) {
      console.log(`[TelegramBot] Pesan diabaikan dari chat unknown: ${fromId}`);
      return;
    }

    if (text === "/topkoinath") {
      await this.handleTopKoinAth(fromId);
    } else if (text === "/help" || text === "/start") {
      const helpMsg = "🤖 <b>AgentTrade Command Center</b>\n\n" +
                      "Gunakan perintah berikut:\n" +
                      "• /topkoinath - Lihat koin dengan kenaikan ATH tertinggi dari harga awal.\n" +
                      "• /help - Tampilkan daftar perintah ini.";
      await this.sendMessage(fromId, helpMsg);
    }
  }

  async handleTopKoinAth(chatId) {
    try {
      const topPerformers = await dbManager.getTopPerformers(15);
      
      if (!topPerformers || topPerformers.length === 0) {
        return this.sendMessage(chatId, "📭 Belum ada data koin top performer. Biarkan monitor berjalan untuk merekam data ATH.");
      }

      let msg = "🚀 <b>[TOP ATH PERFORMERS]</b>\n<i>Kenaikan tertinggi dari harga akumulasi</i>\n\n";
      
      topPerformers.forEach((p, i) => {
        const multiplier = Number(p.multiplier || 1).toFixed(1);
        const symbol = p.symbol || "UNK";
        const initial = formatMoney(p.initial_price);
        const ath = formatMoney(p.ath_price);
        const age = p.timeframe || "N/A";
        
        msg += `${i + 1}. <b>${symbol}</b>: <code>${multiplier}x</code>\n`;
        msg += `💰 Initial: $${initial} | 🏆 ATH: $${ath}\n`;
        msg += `🕒 ${age}\n`;
        msg += `📄 <code>${p.token_address}</code>\n\n`;
      });

      msg += `<i>Data direkam otomatis sejak monitor aktif.</i>`;
      await this.sendMessage(chatId, msg);
    } catch (err) {
      console.error("[TelegramBot] Error handling /topkoinath:", err.message);
      await this.sendMessage(chatId, "❌ Gagal mengambil data top performer.");
    }
  }

  async sendMessage(chatId, text) {
    try {
      await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      });
    } catch (err) {
      console.error("[TelegramBot] Gagal kirim pesan:", err.message);
    }
  }
}

module.exports = TelegramBot;
