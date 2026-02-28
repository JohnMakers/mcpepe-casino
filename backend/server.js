require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');

// 🛡️ Catch the Silent Assassins
process.on('uncaughtException', (err) => console.error('FATAL CRASH (Exception):', err));
process.on('unhandledRejection', (err) => console.error('FATAL CRASH (Rejection):', err));

const app = express();
app.use(cors());
app.use(express.json());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

if (!process.env.HOUSE_PRIVATE_KEY) {
    console.error("❌ ERROR: HOUSE_PRIVATE_KEY is missing from .env file!");
    process.exit(1);
}

const secretArray = process.env.HOUSE_PRIVATE_KEY.split(',').map(Number);
const houseSecretKey = Uint8Array.from(secretArray);
const houseKeypair = Keypair.fromSecretKey(houseSecretKey);

console.log("🛡️ House Authority Pubkey:", houseKeypair.publicKey.toBase58());

app.post('/api/play-coinflip', async (req, res) => {
    console.log("🚨 INCOMING WAGER RECEIVED FROM FRONTEND!");
    try {
        const { transactionBuffer } = req.body;
        const tx = Transaction.from(Buffer.from(transactionBuffer, 'base64'));
        
        tx.partialSign(houseKeypair);
        
        const signature = await connection.sendRawTransaction(tx.serialize());
        console.log("✅ Executed Wager! Signature:", signature);
        
        res.json({ success: true, signature });
    } catch (error) {
        console.error("❌ Backend Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 🛡️ THE HEARTBEAT: Force the Node Event Loop to stay alive forever
setInterval(() => {}, 1000 * 60 * 60);

// Moved to Port 3005 to bypass any ghost processes
const PORT = process.env.PORT || 3005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 McPepe House Backend ARMORED and running on port ${PORT}. Waiting for wagers...`);
}).on('error', (err) => {
    console.error("❌ SERVER BIND ERROR:", err);
});