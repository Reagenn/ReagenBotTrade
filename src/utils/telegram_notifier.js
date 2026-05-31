const dbManager = require("../database/dbManager");
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
    this.sentAlerts = new Map(); // Fast local cache
    this.defaultDedupWindowMs = 2 * 60 * 60 * 1000; // 2 jam default deduplikasi
  }

  isConfigured() {
    return Boolean(this.botToken && this.chatId && this.botToken !== "your_telegram_bot_token" && this.chatId !== "your_telegram_chat_id");
  }

  /**
   * Internal deduplication check (Persistent via DB)
   * @param {string} key Unique key for the alert (e.g. "monitor:MINT")
   * @param {number} windowMs TTL for deduplication
   * @returns {Promise<boolean>} True if should send
   */
  async _shouldSend(key, windowMs = this.defaultDedupWindowMs) {
    if (!key) return true;
    
    const now = Date.now();
    
    // 1. Fast Memory Check
    const lastSentLocal = this.sentAlerts.get(key);
    if (lastSentLocal && (now - lastSentLocal) < windowMs) {
      console.log(`[Telegram] Deduplikasi LOKAL aktif untuk key: ${key}. Skip.`);
      return false;
    }
    
    // 2. Persistent DB Check
    const lastSentDb = await dbManager.checkNotificationSent(key, windowMs);
    if (lastSentDb) {
      const minutesLeft = Math.ceil((windowMs - (now - lastSentDb)) / 60000);
      console.log(`[Telegram] Deduplikasi DB aktif untuk key: ${key}. Skip kirim (Tunggu ${minutesLeft}m lagi).`);
      this.sentAlerts.set(key, lastSentDb); // Sync back to local
      return false;
    }
    
    return true;
  }

  /**
   * Mark alert as sent in both memory and DB
   */
  async _markSent(key) {
    if (!key) return;
    const now = Date.now();
    this.sentAlerts.set(key, now);
    await dbManager.markNotificationSent(key);

    // Background cleanup of memory cache
    if (this.sentAlerts.size > 1000) {
      for (const [k, v] of this.sentAlerts.entries()) {
        if (now - v > this.defaultDedupWindowMs * 2) this.sentAlerts.delete(k);
      }
    }
  }

  async sendMonitorAlert(tokenData, options = {}) {
    const key = `monitor:${tokenData.mint}`;
    const window = options.dedupWindowMs || 12 * 60 * 60 * 1000; // 12 jam default untuk monitor
    if (!(await this._shouldSend(key, window))) {
      return { skipped: true, reason: "duplicate", key };
    }

    const text = formatMonitorAlert(tokenData);
    const result = await this.sendMessage(text, options);
    if (result.success) await this._markSent(key);
    return result;
  }

  async sendWhaleDiscovery(whaleData, options = {}) {
    const key = `whale:${whaleData.mint || whaleData.address}`;
    const window = options.dedupWindowMs || 6 * 60 * 60 * 1000; // 6 jam untuk whale
    if (!(await this._shouldSend(key, window))) {
      return { skipped: true, reason: "duplicate", key };
    }

    const text = formatWhaleDiscoveryAlert(whaleData);
    const result = await this.sendMessage(text, options);
    if (result.success) await this._markSent(key);
    return result;
  }

  async sendSmartHunter(hunterData, options = {}) {
    const key = `hunter:${hunterData.address}`;
    const window = options.dedupWindowMs || 24 * 60 * 60 * 1000; // 24 jam untuk hunter
    if (!(await this._shouldSend(key, window))) {
      return { skipped: true, reason: "duplicate", key };
    }

    const text = formatSmartHunterAlert(hunterData);
    const result = await this.sendMessage(text, options);
    if (result.success) await this._markSent(key);
    return result;
  }

  async sendPaperTradeAlert(tradeData, options = {}) {
    const key = `trade:${tradeData.type}:${tradeData.mint}:${tradeData.trigger || 'MANUAL'}`;
    const window = 30 * 1000; // Tetap 30 detik untuk trade agar tidak double post
    if (!(await this._shouldSend(key, window))) {
      return { skipped: true, reason: "duplicate", key };
    }

    const text = formatSolanaPaperAlert(tradeData);
    const result = await this.sendMessage(text, options);
    if (result.success) await this._markSent(key);
    return result;
  }

  async sendCexSpikeAlert(cexData, options = {}) {
    const key = `cex:${cexData.pair}`;
    const window = options.dedupWindowMs || 4 * 60 * 60 * 1000;
    if (!(await this._shouldSend(key, window))) {
      return { skipped: true, reason: "duplicate", key };
    }

    const text = formatCexSpikeAlert(cexData);
    const result = await this.sendMessage(text, options);
    if (result.success) await this._markSent(key);
    return result;
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
