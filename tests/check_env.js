require('dotenv').config();
console.log("Variabel yang terdeteksi:");
const key = process.env.GEMINI_API_KEY;
if (key) {
  console.log("GEMINI_API_KEY terdeteksi: " + key.substring(0, 8) + "...");
} else {
  console.log("GEMINI_API_KEY TIDAK TERDETEKSI.");
}
