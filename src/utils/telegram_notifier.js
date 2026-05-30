const {
  formatMonitorAlert,
  formatSolanaPaperAlert,
  formatCexSpikeAlert,
  formatWhaleDiscoveryAlert,
  formatSmartHunterAlert
} = require("./telegram_helpers");

class TelegramNotifier {
  constructor({ botToken, chatId }) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
  }

  isConfigured() {
    return Boolean(this.botToken && this.chatId && this.botToken !== "your_telegram_bot_token" && this.chatId !== "your_telegram_chat_id");
  }

  async sendMonitorAlert(tokenData) {
    const text = formatMonitorAlert(tokenData);
    return this.sendMessage(text);
  }

  async sendWhaleDiscovery(whaleData) {
    const text = formatWhaleDiscoveryAlert(whaleData);
    return this.sendMessage(text);
  }

  async sendSmartHunter(hunterData) {
    const text = formatSmartHunterAlert(hunterData);
    return this.sendMessage(text);
  }

  async sendPaperTradeAlert(tradeData) {
    const text = formatSolanaPaperAlert(tradeData);
    return this.sendMessage(text);
  }

  async sendCexSpikeAlert(cexData) {
    const text = formatCexSpikeAlert(cexData);
    return this.sendMessage(text);
  }

  async sendMessage(text, options = {}, attempt = 0) {
    if (!this.isConfigured()) {
      console.log("[Telegram] Not configured - skipping message");
      return { skipped: true, reason: "telegram_not_configured" };
    }

    const endpoint = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: options.parse_mode || "HTML",
          disable_web_page_preview: options.disable_web_page_preview ?? true,
          ...options
        }),
      });

      if (!response.ok) {
        const payload = await response.text();
        const errorData = JSON.parse(payload);

        if (response.status === 429 && attempt < this.maxRetries) {
          const retryAfter = errorData.parameters?.retry_after || 5;
          console.log(`[Telegram] Rate limited, retrying after ${retryAfter}s (attempt ${attempt + 1}/${this.maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
          return this.sendMessage(text, options, attempt + 1);
        }

        throw new Error(`Telegram sendMessage failed (${response.status}): ${payload}`);
      }

      const result = await response.json();
      console.log(`[Telegram] Message sent successfully to chat ${this.chatId}`);
      return result;
    } catch (error) {
      if (attempt < this.maxRetries) {
        console.log(`[Telegram] Error sending message, retrying (attempt ${attempt + 1}/${this.maxRetries}): ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        return this.sendMessage(text, options, attempt + 1);
      }

      console.error(`[Telegram] Failed to send message after ${this.maxRetries} attempts: ${error.message}`);
      throw error;
    }
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return {
        success: false,
        reason: "telegram_not_configured",
        hint: "Isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di file .env",
      };
    }

    try {
      const getMeResponse = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
      const getMePayload = await getMeResponse.json();

      if (!getMeResponse.ok || !getMePayload?.ok) {
        return {
          success: false,
          reason: getMePayload?.description || `getMe failed (${getMeResponse.status})`,
        };
      }

      const getChatResponse = await fetch(`https://api.telegram.org/bot${this.botToken}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId }),
      });
      const getChatPayload = await getChatResponse.json();

      if (!getChatResponse.ok || !getChatPayload?.ok) {
        const description = String(getChatPayload?.description || "chat validation failed");
        return {
          success: false,
          reason: description,
          botInfo: getMePayload,
          hint:
            description.toLowerCase().includes("chat not found") ?
              "Buka bot Anda di Telegram, tekan /start, lalu salin ulang TELEGRAM_CHAT_ID (npm run telegram:test). Untuk grup, gunakan ID negatif dari getUpdates."
            : "Periksa TELEGRAM_CHAT_ID di .env — harus ID chat tempat bot boleh mengirim pesan.",
        };
      }

      return {
        success: true,
        botInfo: getMePayload,
        chatInfo: getChatPayload,
      };
    } catch (error) {
      return { success: false, reason: error.message };
    }
  }
}

module.exports = TelegramNotifier;
