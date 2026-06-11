# AgentTrade 🤖

Institutional-style crypto trading agent built with Node.js. Features include Solana Smart Money monitoring, CEX breakout trading, and a comprehensive web dashboard.

## 🚀 Fitur Utama
- **Solana Smart Money Monitor**: Melacak pergerakan whale dan smart money di jaringan Solana.
- **CEX Breakout Bot**: Strategi breakout volume di bursa CEX (Bybit/Binance).
- **Web Dashboard**: Visualisasi trade, monitoring posisi, dan manajemen bot secara real-time.
- **SQLite Integration**: Penyimpanan data yang persisten dan cepat.
- **Paper Trading**: Simulasi trading tanpa resiko finansial.

---

## 🛠 Panduan Instalasi (Step-by-Step)

### 1. Prasyarat
Pastikan Anda sudah menginstal:
- [Node.js](https://nodejs.org/) (Versi 16 atau lebih baru)
- npm (biasanya terinstal bersama Node.js)

### 2. Clone Repositori & Install Dependensi
```bash
# Masuk ke direktori project
cd AgentTrade

# Install package yang dibutuhkan
npm install
```

### 3. Konfigurasi Environment
Salin file `.env.example` menjadi `.env` dan isi API Key yang dibutuhkan.
```bash
cp .env.example .env
```
**Penting:** Isi minimal `HELIUS_API_KEY` atau `BIRDEYE_API_KEY` untuk fitur Solana, dan `JWT_SECRET` untuk keamanan dashboard.

### 4. Migrasi Data (Jika ada data lama)
Jika Anda memiliki data dari versi sebelumnya (file JSON di folder `data`), jalankan migrasi ke SQLite:
```bash
node migrate_to_sqlite.js
```
Script ini akan memindahkan data trade, watchlist, dan monitor list dari JSON ke database SQLite (`data/bot_data.db`).

### 5. Setup Akun Admin Dashboard
Buat akun admin pertama untuk login ke dashboard:
```bash
node setup_admin.js
```
**Default Admin:**
- Username: `regan`
- Password: `regan12345`
*(Sangat disarankan untuk mengubah password setelah login)*

### 6. Seed Data Dummy (Opsional)
Untuk melihat tampilan dashboard dengan data contoh (Tracked Wallets), jalankan:
```bash
node seed_dummy_wallets.js
```

---

## 🚦 Menjalankan Bot

### Menjalankan Dashboard (Utama)
Dashboard akan berjalan di `http://localhost:3088`.
```bash
npm start
```

### Menjalankan Monitor Solana
Melacak smart money secara aktif di background:
```bash
npm run monitor:solana
```

### Menjalankan Bot CEX
Menjalankan strategi trading di bursa CEX:
```bash
npm run monitor:cex
```

---

## 📊 Script Lainnya
- `npm run telegram:test`: Tes notifikasi Telegram.
- `npm run track:wallets`: Dashboard terminal untuk monitoring wallet.
- `npm run report:top`: Laporan performer terbaik.
- `npm run check`: Melakukan syntax check pada semua file inti.

---

## 🛡 Keamanan
- Jangan pernah membagikan file `.env` Anda.
- Gunakan `JWT_SECRET` yang kuat.
- Selalu pantau log di folder `data/trading-agent.log`.

---
*Dibuat dengan ❤️ untuk komunitas trader.*
