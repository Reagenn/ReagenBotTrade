const https = require('https');

async function checkUrl(url) {
    console.log(`Checking ${url}...`);
    return new Promise((resolve) => {
        const req = https.get(url, (res) => {
            console.log(`  Status: ${res.statusCode}`);
            resolve(true);
        });

        req.on('error', (e) => {
            console.error(`  Error: ${e.message}`);
            if (e.code) console.error(`  Code: ${e.code}`);
            resolve(false);
        });

        req.end();
    });
}

async function run() {
    console.log("Network Diagnostic:");
    await checkUrl('https://api.kraken.com/0/public/Assets');
    await checkUrl('https://api.bybit.com/v5/market/tickers?category=spot');
    await checkUrl('https://google.com');
}

run();
