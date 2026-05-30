require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  const API_KEY = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(API_KEY);
  
  try {
    // Mencoba melakukan request sederhana untuk melihat apakah API merespon
    console.log("Mengecek koneksi API...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Hi");
    console.log("Respon API: " + result.response.text());
  } catch (error) {
    console.error("Detail Error:");
    console.error(error);
  }
}

listModels();
