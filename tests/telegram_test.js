require("dotenv").config();

const TelegramNotifier = require("../src/utils/telegram_notifier");

async function main() {
  const notifier = new TelegramNotifier({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  });

  console.log("=== Tes Telegram AgentTrade ===\n");

  const test = await notifier.testConnection();
  if (!test.success) {
    console.log("Status: GAGAL");
    console.log("Alasan:", test.reason);
    if (test.hint) {
      console.log("\nPetunjuk:", test.hint);
    }
    console.log("\nLangkah perbaikan:");
    console.log("1. Buka bot Anda di Telegram (cari username dari @BotFather).");
    console.log("2. Tekan /start (wajib — tanpa ini chat tidak ditemukan).");
    console.log("3. Jalankan lagi perintah ini untuk melihat chat_id dari getUpdates.");
    await printRecentChatIds(process.env.TELEGRAM_BOT_TOKEN);
    process.exit(1);
  }

  const username = test.botInfo?.result?.username;
  const chat = test.chatInfo?.result;
  console.log("Status: OK");
  console.log("Bot: @" + username);
  console.log("Chat ID (.env):", process.env.TELEGRAM_CHAT_ID);
  console.log("Chat type:", chat?.type, chat?.title || chat?.first_name || "");

  const send = await notifier.sendMessage("Tes AgentTrade — jika Anda melihat pesan ini, notifikasi monitor siap dipakai.");
  if (send?.ok) {
    console.log("\nPesan tes berhasil dikirim ke Telegram Anda.");
  } else {
    console.log("\nPesan tes gagal:", send);
    process.exit(1);
  }
}

async function printRecentChatIds(botToken) {
  if (!botToken) {
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=5`);
    const payload = await response.json();
    const updates = payload?.result || [];

    if (!updates.length) {
      console.log("\ngetUpdates: belum ada pesan ke bot. Kirim /start ke bot lalu jalankan ulang npm run telegram:test");
      return;
    }

    console.log("\nChat ID terbaru dari getUpdates (salin yang benar ke TELEGRAM_CHAT_ID):");
    const seen = new Set();
    for (const update of updates) {
      const message = update.message || update.edited_message;
      const chat = message?.chat;
      if (!chat?.id || seen.has(chat.id)) {
        continue;
      }
      seen.add(chat.id);
      const label = [chat.type, chat.username, chat.first_name, chat.title].filter(Boolean).join(" | ");
      console.log(`  ${chat.id}  (${label})`);
    }
  } catch (error) {
    console.log("\ngetUpdates gagal:", error.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
