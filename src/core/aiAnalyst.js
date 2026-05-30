/**
 * AI Agent Analyst Module
 * Powered by Google Gemini 1.5 Pro for institutional-grade token reasoning.
 */

require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Hapus inisialisasi di luar fungsi
/**
 * Menganalisis metrik token menggunakan LLM Gemini Pro.
 * @param {object} tokenData - Data dari DexScreener/Birdeye
 * @returns {Promise<{score: number, analysis: string, trend: string}>}
 */
async function analyzeWithAgent(tokenData) {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY || API_KEY === "your_gemini_api_key") {
    console.warn("[AI Analyst] API Key belum diset di .env. Melewati analisis AI.");
    return { score: 0, analysis: "API Key missing", trend: "NEUTRAL" };
  }

  const genAI = new GoogleGenerativeAI(API_KEY);

  try {
    // Mencoba model terbaru Gemini 2.0 Experimental
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash-exp",
      generationConfig: { responseMimeType: "application/json" }
    });

    // Format data metrik ke dalam prompt yang rapi
    const prompt = `
      Kamu adalah AI trader institusional kuantitatif di ekosistem Solana. 
      Analisis data DEX berikut dan berikan prediksi.

      METRIK TOKEN:
      - Symbol: ${tokenData.symbol || "Unknown"}
      - Price: $${tokenData.priceUsd || 0}
      - Liquidity: $${tokenData.liquidityUsd || 0}
      - FDV: $${tokenData.fdv || 0}
      - Volume 24h: $${tokenData.volume24h || 0}
      - Txns (Buy/Sell) 24h: ${tokenData.buys24h || 0} / ${tokenData.sells24h || 0}
      - Price Change 24h: ${tokenData.priceChange24h || 0}%

      TUGAS:
      Evaluasi tingkat keyakinan (conviction) untuk melakukan trading pada token ini.
      Kamu WAJIB membalas murni dengan format JSON: 
      { 
        "score": number (1-100), 
        "analysis": "string maksimal 2 kalimat", 
        "trend": "BULLISH" | "BEARISH" | "NEUTRAL" 
      }
    `;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Parsing JSON dari Gemini
    return JSON.parse(responseText);

  } catch (error) {
    console.error("[AI Analyst] Gagal mendapatkan analisis dari Gemini:", error.message);
    
    // Fallback default jika API error/timeout agar bot tetap berjalan
    return { 
      score: 0, 
      analysis: "AI Analyst currently unavailable (Timeout/Error)", 
      trend: "NEUTRAL" 
    };
  }
}

module.exports = { analyzeWithAgent };
