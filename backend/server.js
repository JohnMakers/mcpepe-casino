require('dotenv').config();
const anchor = require('@coral-xyz/anchor');
const idl = require('./idl.json');
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const crypto = require('crypto');

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

// ==========================================
// COINFLIP ENDPOINT
// ==========================================
app.post('/api/play-coinflip', async (req, res) => {
    console.log("🚨 INCOMING COINFLIP WAGER RECEIVED FROM FRONTEND!");
    try {
        const { transactionBuffer } = req.body;
        const tx = Transaction.from(Buffer.from(transactionBuffer, 'base64'));
        
        tx.partialSign(houseKeypair);
        
        const signature = await connection.sendRawTransaction(tx.serialize());
        console.log("✅ Executed Coinflip Wager! Signature:", signature);
        
        res.json({ success: true, signature });
    } catch (error) {
        console.error("❌ Backend Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// WHACKD! ENDPOINTS
// ==========================================

// In-memory store for active Mines games. (Use Redis in production)
const activeWhackdGames = new Map(); 

// 1. Generate the Provably Fair Hash for the Frontend
app.post('/api/whackd/init', (req, res) => {
    const { playerPubkey, clientSeed, mineCount, betAmount } = req.body;

    const unhashedServerSeed = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(unhashedServerSeed).digest('hex');

    activeWhackdGames.set(playerPubkey, {
        gamePubkey: gamePubkey,
        serverSeed: unhashedServerSeed,
        clientSeed: clientSeed,
        mineCount: mineCount,
        betAmount: betAmount,
        revealedMask: 0,
        status: "waiting_for_tx"
    });

    console.log(`💣 Whackd! Game initialized for ${playerPubkey.substring(0,6)}...`);
    res.json({ success: true, serverSeedHash: hash });
});

// 2. Evaluate a Tile Click (Zero Gas, Instant)
app.post('/api/whackd/click', (req, res) => {
    const { playerPubkey, tileIndex } = req.body;
    const game = activeWhackdGames.get(playerPubkey);

    if (!game) return res.status(400).json({ error: "No active game found." });

    // Fisher-Yates shuffle to locate the bombs securely
    const combinedData = game.serverSeed + game.clientSeed;
    const hashBuffer = crypto.createHash('sha256').update(combinedData).digest();
    
    let board = Array.from({length: 25}, (_, i) => i);
    for (let i = 24; i > 0; i--) {
        const randByte = hashBuffer[i % 32];
        const j = randByte % (i + 1);
        [board[i], board[j]] = [board[j], board[i]];
    }

    let bombMask = 0;
    for (let i = 0; i < game.mineCount; i++) {
        bombMask |= (1 << board[i]);
    }

    game.revealedMask |= (1 << tileIndex);
    const hitBomb = (bombMask & (1 << tileIndex)) !== 0;

    if (hitBomb) {
        game.status = "busted";
        resolveWhackdOnChain(playerPubkey, game.serverSeed, game.revealedMask, false);
        return res.json({ success: true, status: "busted", bombMask: bombMask, serverSeed: game.serverSeed });
    } else {
        return res.json({ success: true, status: "safe", revealedMask: game.revealedMask });
    }
});

// 3. Cash Out (Trigger On-Chain Payout)
app.post('/api/whackd/cashout', (req, res) => {
    const { playerPubkey } = req.body;
    const game = activeWhackdGames.get(playerPubkey);

    if (!game || game.status === "busted") return res.status(400).json({ error: "Invalid cashout." });

    game.status = "cashed_out";
    resolveWhackdOnChain(playerPubkey, game.serverSeed, game.revealedMask, true);
    
    res.json({ success: true, serverSeed: game.serverSeed });
});

// The internal function where the Backend signs the transaction (To be completed)
async function resolveWhackdOnChain(playerPubkeyStr, unhashedServerSeed, revealedMask, isCashout) {
    try {
        console.log(`[HOUSE] Resolving Whackd for ${playerPubkeyStr} on-chain...`);
        
        const game = activeWhackdGames.get(playerPubkeyStr);
        if (!game || !game.gamePubkey) throw new Error("Game state or Game Pubkey missing.");

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const gamePubkey = new anchor.web3.PublicKey(game.gamePubkey);

        // A. Setup Anchor Provider for the House
        const wallet = new anchor.Wallet(houseKeypair);
        const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "processed" });
        const program = new anchor.Program(idl, provider);

        // B. Find the global Treasury Vault PDA
        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault")], 
            program.programId
        );

        // C. Execute the Smart Contract Instruction
        const txSignature = await program.methods
            .resolveWhackd(unhashedServerSeed, revealedMask, isCashout)
            .accounts({
                whackdGame: gamePubkey,
                player: playerPubkey,
                authority: houseKeypair.publicKey,
                vault: vaultPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc(); // .rpc() automatically builds, signs with houseKeypair, and broadcasts!

        console.log(`✅ [HOUSE] Whackd Resolved successfully! TX: ${txSignature}`);
        
        // Clean up the memory to prevent memory leaks
        activeWhackdGames.delete(playerPubkeyStr); 

    } catch (err) {
        console.error("❌ [HOUSE] Failed to resolve on-chain:", err);
    }
}

// ==========================================
// SERVER INITIALIZATION
// ==========================================

// 🛡️ THE HEARTBEAT: Force the Node Event Loop to stay alive forever
setInterval(() => {}, 1000 * 60 * 60);

// Moved to Port 3005 to bypass any ghost processes
const PORT = process.env.PORT || 3005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 McPepe House Backend ARMORED and running on port ${PORT}. Waiting for wagers...`);
}).on('error', (err) => {
    console.error("❌ SERVER BIND ERROR:", err);
});