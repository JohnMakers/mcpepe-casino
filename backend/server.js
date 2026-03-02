require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const crypto = require('crypto');
const anchor = require('@coral-xyz/anchor');

// Ensure you have copied idl.json into your backend folder!
const idl = require('./idl.json'); 

// 🛡️ Catch the Silent Assassins
process.on('uncaughtException', (err) => console.error('FATAL CRASH (Exception):', err));
process.on('unhandledRejection', (err) => console.error('FATAL CRASH (Rejection):', err));

const app = express();

// 🛡️ THE CORS FIX: Explicitly allow all pre-flight requests and cross-origin traffic
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 🔧 Use dedicated RPC if available, fallback to public. 
// .trim() removes invisible trailing spaces that cause 401 API Key errors!
const rawRpc = process.env.RPC_URL || "https://api.devnet.solana.com";
const RPC_URL = rawRpc.replace(/["']/g, "").trim(); 
const connection = new Connection(RPC_URL, "confirmed");

if (!process.env.HOUSE_PRIVATE_KEY) {
    console.error("❌ ERROR: HOUSE_PRIVATE_KEY is missing from .env file!");
    process.exit(1);
}

const secretArray = process.env.HOUSE_PRIVATE_KEY.split(',').map(Number);
const houseSecretKey = Uint8Array.from(secretArray);
const houseKeypair = Keypair.fromSecretKey(houseSecretKey);

console.log("🛡️ House Authority Pubkey:", houseKeypair.publicKey.toBase58());
console.log(`🔌 Connected to RPC: ${RPC_URL.includes("api.devnet") ? "Public (Warning: Rate Limits)" : "Custom"}`);

const activeWhackdGames = new Map(); 

// ==========================================
// COINFLIP ENDPOINT
// ==========================================
app.post('/api/play-coinflip', async (req, res) => {
    try {
        const { transactionBuffer, unhashedServerSeed, gameStatePubkey, playerPubkey } = req.body;
        
        // 1. House countersigns and broadcasts the Wager transaction
        const tx = Transaction.from(Buffer.from(transactionBuffer, 'base64'));
        tx.partialSign(houseKeypair);
        const playSignature = await connection.sendRawTransaction(tx.serialize());
        
        // Wait for the game state account to be created on-chain to prevent race conditions
        const latestBlockhash = await connection.getLatestBlockhash("processed");
        await connection.confirmTransaction({
            signature: playSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, "processed");

        // 2. House independently executes the Resolution transaction
        const wallet = new anchor.Wallet(houseKeypair);
        const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "processed" });
        const program = new anchor.Program(idl, provider);

        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault")], 
            program.programId
        );

        const resolveSignature = await program.methods.resolveCoinflip(unhashedServerSeed).accounts({
            gameState: new anchor.web3.PublicKey(gameStatePubkey),
            player: new anchor.web3.PublicKey(playerPubkey),
            vault: vaultPDA,
            authority: houseKeypair.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        }).rpc();

        res.json({ success: true, playSignature, resolveSignature });
    } catch (error) {
        console.error("❌ Coinflip Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// WHACKD! (MINES) ENDPOINTS
// ==========================================

// 1. Generate the Provably Fair Hash
app.post('/api/whackd/init', (req, res) => {
    try {
        const { playerPubkey, gamePubkey, clientSeed, mineCount, betAmount } = req.body;

        if (!playerPubkey || !gamePubkey) {
            return res.status(400).json({ success: false, error: "Missing player or game pubkey" });
        }

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
    } catch (error) {
        console.error("❌ Init Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Evaluate a Tile Click
app.post('/api/whackd/click', (req, res) => {
    try {
        const { playerPubkey, tileIndex } = req.body;
        const game = activeWhackdGames.get(playerPubkey);

        if (!game) return res.status(400).json({ success: false, error: "No active game found." });

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
    } catch (error) {
        console.error("❌ Click Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Cash Out
app.post('/api/whackd/cashout', (req, res) => {
    try {
        const { playerPubkey } = req.body;
        const game = activeWhackdGames.get(playerPubkey);

        if (!game || game.status === "busted") {
            return res.status(400).json({ success: false, error: "Invalid cashout." });
        }

        game.status = "cashed_out";
        resolveWhackdOnChain(playerPubkey, game.serverSeed, game.revealedMask, true);
        
        res.json({ success: true, serverSeed: game.serverSeed });
    } catch (error) {
        console.error("❌ Cashout Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// The House signs the transaction on Devnet
async function resolveWhackdOnChain(playerPubkeyStr, unhashedServerSeed, revealedMask, isCashout) {
    try {
        console.log(`[HOUSE] Resolving Whackd for ${playerPubkeyStr} on-chain...`);
        
        const game = activeWhackdGames.get(playerPubkeyStr);
        if (!game || !game.gamePubkey) throw new Error("Game state or Game Pubkey missing.");

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const gamePubkey = new anchor.web3.PublicKey(game.gamePubkey);

        const wallet = new anchor.Wallet(houseKeypair);
        const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "processed" });
        const program = new anchor.Program(idl, provider);

        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault")], 
            program.programId
        );

        const txSignature = await program.methods
            .resolveWhackd(unhashedServerSeed, revealedMask, isCashout)
            .accounts({
                whackdGame: gamePubkey,
                player: playerPubkey,
                authority: houseKeypair.publicKey,
                vault: vaultPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc(); 

        console.log(`✅ [HOUSE] Whackd Resolved successfully! TX: ${txSignature}`);
        activeWhackdGames.delete(playerPubkeyStr); 

    } catch (err) {
        console.error("❌ [HOUSE] Failed to resolve on-chain:", err);
    }
}

// ==========================================
// SERVER INITIALIZATION
// ==========================================
setInterval(() => {}, 1000 * 60 * 60);

const PORT = process.env.PORT || 3005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 McPepe House Backend ARMORED and running on port ${PORT}. Waiting for wagers...`);
}).on('error', (err) => {
    console.error("❌ SERVER BIND ERROR:", err);
});