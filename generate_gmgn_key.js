const crypto = require("crypto");

// Meminta Node.js membuatkan kunci Ed25519 yang asli
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });

console.log("=== MASUKKAN KE FILE .env KAMU ===");
console.log(privatePem);
console.log("\n=== PASTE INI KE WEBSITE GMGN ===");
console.log(publicPem);
