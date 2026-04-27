require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const crypto = require('crypto');
const anchor = require('@coral-xyz/anchor');
const rateLimit = require('express-rate-limit');

const idl = require('./idl.json'); 

if (!idl.types) idl.types = [];

const PROGRAM_ID_STRING = "7pKD7FV7Pebd8ZSYgzoTHE79aFnoPLGnudHH4fpvxgSw";
const PROGRAM_ID = new anchor.web3.PublicKey(PROGRAM_ID_STRING);
idl.address = PROGRAM_ID_STRING;
if (!idl.metadata) idl.metadata = {};
idl.metadata.address = PROGRAM_ID_STRING;

process.on('uncaughtException', (err) => console.error('FATAL CRASH (Exception):', err));
process.on('unhandledRejection', (err) => console.error('FATAL CRASH (Rejection):', err));

const app = express();

// 🔒 B-H2 FIX: lock CORS to an explicit allowlist.
// Default allowlist covers the known production + preview frontends; can be
// extended at deploy time via ALLOWED_ORIGINS=comma,separated,list in .env.
const DEFAULT_ALLOWED_ORIGINS = [
    'https://mcpepe-casino.vercel.app',
    'https://mcpepe.casino',
    'https://www.mcpepe.casino',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
];
const ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const ALLOWED_ORIGINS = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...ENV_ORIGINS])];

// Match any Vercel preview deployment for this project (mcpepe-casino-*.vercel.app)
const VERCEL_PREVIEW_RE = /^https:\/\/mcpepe-casino-[a-z0-9-]+\.vercel\.app$/i;

console.log("🛡️  CORS allowlist:", ALLOWED_ORIGINS);

app.use(cors({
    origin: (origin, cb) => {
        // Same-origin / server-to-server requests omit the Origin header.
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        if (VERCEL_PREVIEW_RE.test(origin)) return cb(null, true);
        console.warn(`⛔ CORS blocked origin: ${origin}`);
        return cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 600,
}));

app.use(express.json({ limit: '64kb' }));

// 🔒 B-H3 FIX: rate limiting. Global cap protects against blanket spam, then a
// tighter limit is applied to the wager-spawning / payout endpoints so a single
// IP cannot exhaust house fee-payer SOL or fill the in-memory game maps.
const globalLimiter = rateLimit({
    windowMs: 60_000,        // 1 minute
    max: 120,                // 120 req/min/IP across all endpoints
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, slow down." }
});
const wagerLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,                 // 30 wager-affecting calls/min/IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many wager requests." }
});
app.use(globalLimiter);
// Apply the stricter limit to every game-mutating route.
app.use([
    '/api/play-coinflip',
    '/api/whackd/init',
    '/api/whackd/click',
    '/api/whackd/cashout',
    '/api/rps/commitment',
    '/api/rps/resolve',
    '/api/roulette/seed',
    '/api/roulette/resolve',
    '/api/blackjack/seed',
    '/api/blackjack/init',
    '/api/blackjack/action',
    '/api/patriots/seed',
    '/api/patriots/play',
    '/api/pumpit/seed',
    '/api/pumpit/process',
    '/api/pumpit/cashout',
], wagerLimiter);

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

// =============================================================================
// 🔒 B-C3 HELPER: read on-chain `bet_amount` from a game-state account.
// Layout for BlackjackGame and PatriotsState both start with:
//   [0..8]   anchor discriminator
//   [8..40]  player: Pubkey (32 bytes)
//   [40..48] bet_amount: u64 little-endian
// Returns a BigInt (lamports) so we can directly compare against request body.
// =============================================================================
async function readOnChainBetAmount(gameStatePubkeyStr) {
    const acc = await connection.getAccountInfo(new anchor.web3.PublicKey(gameStatePubkeyStr), "confirmed");
    if (!acc || acc.data.length < 48) {
        throw new Error("Game state account not found or malformed.");
    }
    return acc.data.readBigUInt64LE(40);
}


// ==========================================
// COINFLIP ENDPOINT
// ==========================================
app.post('/api/play-coinflip', async (req, res) => {
    try {
        const { transactionBuffer, unhashedServerSeed, gameStatePubkey, playerPubkey } = req.body;
        
        if (!unhashedServerSeed) {
            return res.status(400).json({ success: false, error: "Missing server seed." });
        }

        const tx = anchor.web3.Transaction.from(Buffer.from(transactionBuffer, 'base64'));
        
        let gameStatePubkeyObj, playerPubkeyObj;
        if (gameStatePubkey && playerPubkey) {
            gameStatePubkeyObj = new anchor.web3.PublicKey(gameStatePubkey);
            playerPubkeyObj = new anchor.web3.PublicKey(playerPubkey);
        } else {
            const initIx = tx.instructions[tx.instructions.length - 2];
            const playIx = tx.instructions[tx.instructions.length - 1];
            gameStatePubkeyObj = initIx.keys[0].pubkey;
            playerPubkeyObj = playIx.keys[1].pubkey;
        }

        tx.partialSign(houseKeypair);
        const playSignature = await connection.sendRawTransaction(tx.serialize());
        
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
        const confirmation = await connection.confirmTransaction({
            signature: playSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, "confirmed");

        if (confirmation.value.err) {
            throw new Error(`Wager transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault")], 
            PROGRAM_ID 
        );

        console.log(`Waiting for Helius to sync gameState: ${gameStatePubkeyObj.toBase58()}`);
        let accountReady = false;
        for (let i = 0; i < 10; i++) {
            const accInfo = await connection.getAccountInfo(gameStatePubkeyObj, "confirmed");
            if (accInfo) {
                accountReady = true;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!accountReady) throw new Error("Network failed to sync the game state in time.");

        const sighash = crypto.createHash('sha256').update("global:resolve_coinflip").digest().slice(0, 8);
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer]);

        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gameStatePubkeyObj, isSigner: false, isWritable: true },
                { pubkey: playerPubkeyObj, isSigner: false, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        let resolveSignature;
        let retries = 10;
        
        while (retries > 0) {
            try {
                const resolveTx = new anchor.web3.Transaction().add(resolveIx);
                const freshBlockhash = await connection.getLatestBlockhash("confirmed");
                resolveTx.recentBlockhash = freshBlockhash.blockhash;
                resolveTx.feePayer = houseKeypair.publicKey;
                resolveTx.sign(houseKeypair);

                resolveSignature = await connection.sendRawTransaction(resolveTx.serialize(), { skipPreflight: true });
                
                await connection.confirmTransaction({
                    signature: resolveSignature,
                    blockhash: freshBlockhash.blockhash,
                    lastValidBlockHeight: freshBlockhash.lastValidBlockHeight
                }, "confirmed");

                break; 
            } catch (err) {
                console.log(`⚠️ Network retry... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("Resolution completely failed after 10 forced attempts.");
            }
        }

        // 🔥 THE FIX: Coinflip specific success response
        res.json({ success: true, resolveSignature });

    } catch (error) {
        console.error("❌ Coinflip Resolve Error:", error);
        res.status(500).json({ success: false, error: error.message || JSON.stringify(error) });
    }
});

// ==========================================
// WHACKD! (MINES) ENDPOINTS
// ==========================================
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
        const safeError = error.message ? error.message : JSON.stringify(error);
        res.status(500).json({ success: false, error: safeError });
    }
});

app.post('/api/whackd/click', async (req, res) => {
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
            resolveWhackdOnChain(playerPubkey, game.serverSeed, game.revealedMask, false)
                .catch(err => console.error("On-chain bust resolution failed:", err));
                
            return res.json({ success: true, status: "busted", bombMask: bombMask, serverSeed: game.serverSeed });
        } else {
            return res.json({ success: true, status: "safe", revealedMask: game.revealedMask });
        }
    } catch (error) {
        console.error("❌ Click Error:", error);
        const safeError = error.message ? error.message : JSON.stringify(error);
        res.status(500).json({ success: false, error: safeError });
    }
});

app.post('/api/whackd/cashout', async (req, res) => {
    try {
        const { playerPubkey } = req.body;
        const game = activeWhackdGames.get(playerPubkey);

        if (!game || game.status === "busted") {
            return res.status(400).json({ success: false, error: "Invalid cashout." });
        }

        game.status = "cashed_out";
        await resolveWhackdOnChain(playerPubkey, game.serverSeed, game.revealedMask, true);
        
        res.json({ success: true, serverSeed: game.serverSeed });
    } catch (error) {
        console.error("❌ Cashout Error:", error);
        const safeError = error.message ? error.message : JSON.stringify(error);
        res.status(500).json({ success: false, error: safeError });
    }
});

async function resolveWhackdOnChain(playerPubkeyStr, unhashedServerSeed, revealedMask, isCashout) {
    try {
        console.log(`[HOUSE] Resolving Whackd for ${playerPubkeyStr} on-chain...`);
        
        const game = activeWhackdGames.get(playerPubkeyStr);
        if (!game || !game.gamePubkey) throw new Error("Game state or Game Pubkey missing.");

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const gamePubkey = new anchor.web3.PublicKey(game.gamePubkey);

        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault")], 
            PROGRAM_ID 
        );

        const sighash = crypto.createHash('sha256').update("global:resolve_whackd").digest().slice(0, 8);
        
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        
        const revealedTilesBuffer = Buffer.alloc(4);
        revealedTilesBuffer.writeUInt32LE(Number(revealedMask), 0);
        
        const isCashoutBuffer = Buffer.alloc(1);
        isCashoutBuffer.writeUInt8(isCashout ? 1 : 0, 0);
        
        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer, revealedTilesBuffer, isCashoutBuffer]);

        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gamePubkey, isSigner: false, isWritable: true },
                { pubkey: playerPubkey, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        let txSignature;
        let retries = 10;
        while (retries > 0) {
            try {
                const resolveTx = new anchor.web3.Transaction().add(resolveIx);
                const freshBlockhash = await connection.getLatestBlockhash("confirmed");
                resolveTx.recentBlockhash = freshBlockhash.blockhash;
                resolveTx.feePayer = houseKeypair.publicKey;
                resolveTx.sign(houseKeypair);

                txSignature = await connection.sendRawTransaction(resolveTx.serialize(), { skipPreflight: true });
                
                await connection.confirmTransaction({
                    signature: txSignature,
                    blockhash: freshBlockhash.blockhash,
                    lastValidBlockHeight: freshBlockhash.lastValidBlockHeight
                }, "confirmed");

                break;
            } catch (err) {
                console.log(`⚠️ Network hit a snag in Whackd. Retrying... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("RPC completely failed to sync after 10 forced attempts.");
            }
        }

        console.log(`✅ [HOUSE] Whackd Resolved successfully! TX: ${txSignature}`);
        activeWhackdGames.delete(playerPubkeyStr); 

    } catch (err) {
        console.error("❌ [HOUSE] Failed to resolve on-chain:", err);
        throw err; 
    }
}

// ==========================================
// ROCK PAPER SCISSORS ENDPOINTS
// ==========================================
// 🔒 C-8 FIX (revised): the House generates (houseMove, salt) BEFORE the
// player picks their move and returns only the SHA-256 hash. The player then
// embeds that hash in their `rps_play_hand` tx, so the on-chain account
// permanently records the commitment. At resolve time the House reveals the
// preimage; the program verifies hash(move||salt) == stored commitment.
//
// Map keyed by playerPubkey -> { houseMove, secretSalt, hashedCommitmentHex }
// A new entry overwrites any unresolved one (player abandoned the round).
const activeRpsCommitments = new Map();

app.post('/api/rps/commitment', (req, res) => {
    try {
        const { playerPubkey } = req.body || {};
        if (!playerPubkey) {
            return res.status(400).json({ success: false, error: "Missing playerPubkey." });
        }

        const houseMove = crypto.randomInt(1, 4); // 1..3 inclusive
        const secretSalt = crypto.randomBytes(16);
        const preimage = Buffer.concat([Buffer.from([houseMove]), secretSalt]);
        const hashedCommitment = crypto.createHash('sha256').update(preimage).digest();

        activeRpsCommitments.set(playerPubkey, {
            houseMove,
            secretSalt: secretSalt.toString('hex'),
            hashedCommitmentHex: hashedCommitment.toString('hex'),
            createdAt: Date.now(),
        });

        // Only the HASH leaves the server. The (move, salt) are kept private
        // until /api/rps/resolve sends them on chain.
        res.json({
            success: true,
            hashedCommitment: hashedCommitment.toString('hex'),
        });
    } catch (error) {
        console.error("❌ RPS Commitment Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/rps/resolve', async (req, res) => {
    try {
        const { playerPubkeyStr, gameStatePubkeyStr } = req.body;

        if (!playerPubkeyStr || !gameStatePubkeyStr) {
            return res.status(400).json({ success: false, error: "Missing keys." });
        }

        // Look up the (move, salt) the House committed to BEFORE the player played.
        const commitment = activeRpsCommitments.get(playerPubkeyStr);
        if (!commitment) {
            console.warn(`⚠️ RPS resolve called without a stored commitment for ${playerPubkeyStr}. Map size: ${activeRpsCommitments.size}`);
            return res.status(400).json({
                success: false,
                error: "No active RPS commitment for this player. Call /api/rps/commitment before play_hand."
            });
        }
        const { houseMove, secretSalt: secretSaltHex, hashedCommitmentHex } = commitment;
        const secretSalt = Buffer.from(secretSaltHex, 'hex');

        const gameStatePubkey = new anchor.web3.PublicKey(gameStatePubkeyStr);

        const sighash = crypto.createHash('sha256').update("global:rps_resolve_hand").digest().slice(0, 8);
        // resolve_hand args: house_move: u8, secret_salt: [u8;16]
        const ixData = Buffer.concat([sighash, Buffer.from([houseMove]), secretSalt]);

        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gameStatePubkey, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
            ],
            data: ixData
        });

        console.log(`[HOUSE] Cranking RPS resolve for ${playerPubkeyStr}... Move: ${houseMove}`);

        let resolveSignature;
        let retries = 10;
        while (retries > 0) {
            try {
                const resolveTx = new anchor.web3.Transaction().add(resolveIx);
                const freshBlockhash = await connection.getLatestBlockhash("confirmed");
                resolveTx.recentBlockhash = freshBlockhash.blockhash;
                resolveTx.feePayer = houseKeypair.publicKey;
                resolveTx.sign(houseKeypair);

                resolveSignature = await connection.sendRawTransaction(resolveTx.serialize(), { skipPreflight: true });

                await connection.confirmTransaction({
                    signature: resolveSignature,
                    blockhash: freshBlockhash.blockhash,
                    lastValidBlockHeight: freshBlockhash.lastValidBlockHeight
                }, "confirmed");

                break;
            } catch (err) {
                console.log(`⚠️ Network hit a snag in RPS. Retrying... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("RPS resolution failed after 10 forced attempts.");
            }
        }

        // Reveal the preimage to the player so they can independently verify
        // hash(houseMove||serverSalt) == hashedCommitment recorded on-chain.
        activeRpsCommitments.delete(playerPubkeyStr);
        res.json({
            success: true,
            resolveSignature,
            houseMove,
            serverSeedHash: hashedCommitmentHex,
            serverSalt: secretSaltHex
        });

    } catch (error) {
        console.error("❌ RPS Resolve Error:", error);
        res.status(500).json({ success: false, error: error.message || JSON.stringify(error) });
    }
});

// ==========================================
// ROULETTE ENDPOINTS
// ==========================================
// 🔒 B-C2 FIX: hold each player's pre-bet server seed server-side. Returning
// it before the player commits to bets fully breaks the commit-reveal scheme.
const activeRouletteSeeds = new Map();

app.post('/api/roulette/seed', (req, res) => {
    try {
        const { playerPubkey } = req.body || {};
        if (!playerPubkey) {
            return res.status(400).json({ success: false, error: "Missing playerPubkey." });
        }

        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

        // Stash for reveal at /api/roulette/resolve. Only the HASH leaves the server.
        activeRouletteSeeds.set(playerPubkey, { serverSeed, serverSeedHash, createdAt: Date.now() });

        res.json({
            success: true,
            serverSeedHash
        });
    } catch (error) {
        console.error("❌ Roulette Seed Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/roulette/resolve', async (req, res) => {
    try {
        const { playerPublicKey, gamePda } = req.body;

        if (!playerPublicKey || !gamePda) {
            return res.status(400).json({ success: false, error: "Missing required parameters" });
        }

        // 🔒 B-C2 FIX: server holds the canonical serverSeed; clients can no
        // longer supply it (and therefore can no longer pre-compute outcomes).
        const seedRec = activeRouletteSeeds.get(playerPublicKey);
        if (!seedRec) {
            return res.status(400).json({ success: false, error: "No active roulette seed for this player. Fetch /api/roulette/seed first." });
        }
        const serverSeed = seedRec.serverSeed;

        const playerPubkeyObj = new anchor.web3.PublicKey(playerPublicKey);
        const gameStatePubkeyObj = new anchor.web3.PublicKey(gamePda);
        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault")], 
            PROGRAM_ID 
        );

        // Build the raw instruction data exactly like Coinflip to ensure RPC compatibility
        const sighash = crypto.createHash('sha256').update("global:resolve_roulette").digest().slice(0, 8);
        const seedBuffer = Buffer.from(serverSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer]);

        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gameStatePubkeyObj, isSigner: false, isWritable: true },
                { pubkey: playerPubkeyObj, isSigner: false, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        console.log(`[HOUSE] Resolving Roulette for ${playerPublicKey.substring(0,8)}...`);

        let resolveSignature;
        let retries = 10;
        
        while (retries > 0) {
            try {
                const resolveTx = new anchor.web3.Transaction().add(resolveIx);
                const freshBlockhash = await connection.getLatestBlockhash("confirmed");
                resolveTx.recentBlockhash = freshBlockhash.blockhash;
                resolveTx.feePayer = houseKeypair.publicKey;
                resolveTx.sign(houseKeypair);

                resolveSignature = await connection.sendRawTransaction(resolveTx.serialize(), { skipPreflight: true });
                
                await connection.confirmTransaction({
                    signature: resolveSignature,
                    blockhash: freshBlockhash.blockhash,
                    lastValidBlockHeight: freshBlockhash.lastValidBlockHeight
                }, "confirmed");

                break; 
            } catch (err) {
                console.log(`⚠️ Network retry... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("Resolution completely failed after 10 forced attempts.");
            }
        }

        console.log(`✅ [HOUSE] Roulette Resolved successfully! TX: ${resolveSignature}`);
        // 🔒 B-C2 FIX: reveal seed only AFTER on-chain resolve, then evict.
        activeRouletteSeeds.delete(playerPublicKey);
        res.json({ success: true, txSignature: resolveSignature, serverSeed });

    } catch (error) {
        console.error("❌ Roulette Resolve Error:", error);
        res.status(500).json({ success: false, error: error.message || JSON.stringify(error) });
    }
});

// ==========================================
// BLACKJACK ENDPOINTS & ENGINE
// ==========================================
const activeBlackjackGames = new Map();

app.post('/api/blackjack/seed', (req, res) => {
    try {
        const { playerPubkey } = req.body;
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
        
        // Store the seed temporarily before the user locks their TX
        activeBlackjackGames.set(playerPubkey, { 
            serverSeed, 
            serverSeedHash,
            status: "waiting_for_tx" 
        });
        
        res.json({ success: true, serverSeedHash });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Provably Fair Deck Generator (Infinite Deck)
function getNextCard(serverSeed, clientSeed, nonce, cardIndex) {
    const hmac = crypto.createHmac('sha256', serverSeed);
    hmac.update(`${clientSeed}:${nonce}:${cardIndex}`);
    const hash = hmac.digest('hex');
    
    // Convert hex to 0-51 card (Stake/Rainbet standard algorithm)
    for (let i = 0; i < hash.length; i += 2) {
        const byte = parseInt(hash.substring(i, i + 2), 16);
        if (byte < 208) return byte % 52;
    }
    return 0; // Fallback
}

// Hand Evaluator
function getHandInfo(hand) {
    let total = 0;
    let aces = 0;
    for (let card of hand) {
        let rank = card % 13;
        if (rank < 9) total += rank + 2; // 2-10
        else if (rank < 12) total += 10; // J, Q, K
        else { total += 11; aces++; }    // Ace
    }
    
    let isSoft = false;
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    if (aces > 0 && total <= 21) isSoft = true;
    
    return { total, isSoft, isBlackjack: hand.length === 2 && total === 21 };
}

app.post('/api/blackjack/init', async (req, res) => {
    try {
        const { playerPubkey, gamePubkey, clientSeed, betAmount } = req.body;
        if (!playerPubkey || !gamePubkey) return res.status(400).json({ error: "Missing keys" });

        const game = activeBlackjackGames.get(playerPubkey);
        if (!game || game.status !== "waiting_for_tx") {
            return res.status(400).json({ error: "Game session not initialized. Fetch seed first." });
        }

        // 🔒 B-C3 FIX: ensure the betAmount the client claims matches what was
        // actually escrowed on-chain. Without this, a player could escrow 0.01 SOL
        // and claim payouts based on a fictional 10 SOL "bet".
        try {
            const onChainBet = await readOnChainBetAmount(gamePubkey);
            if (onChainBet !== BigInt(betAmount)) {
                return res.status(400).json({
                    error: `Bet mismatch: body=${betAmount} on-chain=${onChainBet.toString()}`
                });
            }
        } catch (e) {
            return res.status(400).json({ error: `Could not verify on-chain bet: ${e.message}` });
        }

        const serverSeed = game.serverSeed;
        const serverSeedHash = game.serverSeedHash;
        const nonce = 1;

        // Deal initial 4 cards: Player 1, Dealer 1, Player 2, Dealer 2 (Hidden)
        const p1 = getNextCard(serverSeed, clientSeed, nonce, 0);
        const d1 = getNextCard(serverSeed, clientSeed, nonce, 1);
        const p2 = getNextCard(serverSeed, clientSeed, nonce, 2);
        const d2 = getNextCard(serverSeed, clientSeed, nonce, 3);

        const playerHands = [[p1, p2]];
        const dealerCards = [d1, d2];
        const playerInfo = getHandInfo(playerHands[0]);
        const dealerInfo = getHandInfo(dealerCards);

        let status = "playing";
        let payout = 0;
        let resolved = false;

        // Check Naturals
        if (playerInfo.isBlackjack) {
            resolved = true;
            status = "resolved";
            if (dealerInfo.isBlackjack) {
                payout = betAmount; // Push
            } else {
                payout = betAmount + (betAmount * 1.5); // 3:2 Blackjack win
            }
        } else if (dealerInfo.isBlackjack && (d1 % 13 >= 9)) {
            resolved = true;
            status = "resolved";
        }

        // Update active game state
        Object.assign(game, {
            clientSeed, nonce, betAmount: Number(betAmount),
            playerHands, currentHandIndex: 0,
            dealerCards, cardIndex: 4,
            status, payout, gamePubkey,
            insuranceBought: false,
            splitBetAmount: 0 
        });

        if (resolved) {
            resolveBlackjackOnChain(playerPubkey, serverSeed, payout).catch(console.error);
        }

        res.json({ 
            success: true, 
            serverSeedHash,
            playerHands,
            dealerCards: [d1],
            status,
            payout,
            insuranceOffered: (d1 % 13 === 12) && !playerInfo.isBlackjack
        });

    } catch (error) {
        console.error("❌ Blackjack Init Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/blackjack/action', async (req, res) => {
    try {
        const { playerPubkey, action } = req.body; // action: 'hit', 'stand', 'double', 'split', 'insurance'
        const game = activeBlackjackGames.get(playerPubkey);

        if (!game || game.status !== "playing") return res.status(400).json({ error: "Invalid game state." });

        let hand = game.playerHands[game.currentHandIndex];
        let handInfo = getHandInfo(hand);

        if (action === "insurance" && game.dealerCards[0] % 13 === 12 && hand.length === 2) {
            game.insuranceBought = true;
            // Note: Frontend must charge 0.5x bet on-chain separately
            return res.json({ success: true, state: _sanitizeState(game) });
        }

        if (action === "split" && hand.length === 2 && (hand[0] % 13) === (hand[1] % 13) && game.playerHands.length === 1) {
            game.playerHands.push([hand[1]]);
            game.playerHands[0] = [hand[0]];
            game.splitBetAmount = game.betAmount; 
            
            // Deal one card to first hand
            game.playerHands[0].push(getNextCard(game.serverSeed, game.clientSeed, game.nonce, game.cardIndex++));
            
            // If splitting Aces, force stand
            if (hand[0] % 13 === 12) {
                game.playerHands[1].push(getNextCard(game.serverSeed, game.clientSeed, game.nonce, game.cardIndex++));
                game.status = "dealer_turn";
            }
        } 
        else if (action === "double" && hand.length === 2) {
            game.playerHands[game.currentHandIndex].push(getNextCard(game.serverSeed, game.clientSeed, game.nonce, game.cardIndex++));
            game.betAmount *= 2; 
            game.currentHandIndex++; // Force stand after double
        }
        else if (action === "hit") {
            game.playerHands[game.currentHandIndex].push(getNextCard(game.serverSeed, game.clientSeed, game.nonce, game.cardIndex++));
            if (getHandInfo(game.playerHands[game.currentHandIndex]).total >= 21) {
                game.currentHandIndex++; // Auto-stand on bust or 21
            }
        }
        else if (action === "stand") {
            game.currentHandIndex++;
        }

        // Check if player turn is completely over
        if (game.currentHandIndex >= game.playerHands.length || game.status === "dealer_turn") {
            game.status = "dealer_turn";
            
            // Evaluate Dealer (Stand on Soft 17)
            let dInfo = getHandInfo(game.dealerCards);
            let allBust = game.playerHands.every(h => getHandInfo(h).total > 21);

            if (!allBust) {
                while (dInfo.total < 17) {
                    game.dealerCards.push(getNextCard(game.serverSeed, game.clientSeed, game.nonce, game.cardIndex++));
                    dInfo = getHandInfo(game.dealerCards);
                }
            }

            // Calculate Payouts
            game.payout = 0;
            const dealerTotal = dInfo.total;

            for (let i = 0; i < game.playerHands.length; i++) {
                let pTotal = getHandInfo(game.playerHands[i]).total;
                let activeBet = (i === 1) ? game.splitBetAmount : game.betAmount;

                if (pTotal > 21) {
                    // Bust
                } else if (dealerTotal > 21 || pTotal > dealerTotal) {
                    game.payout += activeBet * 2; // Win 1:1
                } else if (pTotal === dealerTotal) {
                    game.payout += activeBet; // Push
                }
            }

            // Insurance payout
            if (game.insuranceBought && dInfo.isBlackjack) {
                game.payout += game.betAmount; // 2:1 on the half bet = full bet
            }

            game.status = "resolved";

            // 🔒 B-C3 FIX: final cross-check that the total escrowed amount on
            // chain equals the off-chain accounting (initial bet + double + split)
            // before the house signs the payout transfer.
            try {
                const onChainBet = await readOnChainBetAmount(game.gamePubkey);
                const offChainTotal = BigInt(game.betAmount) + BigInt(game.splitBetAmount || 0);
                if (onChainBet !== offChainTotal) {
                    console.error(`❌ Blackjack escrow mismatch — on-chain=${onChainBet}, off-chain=${offChainTotal}`);
                    return res.status(400).json({ error: "Escrow vs accounting mismatch; refusing payout." });
                }
            } catch (e) {
                console.error("❌ Blackjack escrow verification failed:", e.message);
                return res.status(500).json({ error: "Could not verify escrow before payout." });
            }

            // Settle On-Chain
            await resolveBlackjackOnChain(playerPubkey, game.serverSeed, game.payout);
            activeBlackjackGames.delete(playerPubkey);
            
            return res.json({ success: true, state: _sanitizeState(game, true), serverSeed: game.serverSeed });
        }

        res.json({ success: true, state: _sanitizeState(game) });

    } catch (error) {
        console.error("❌ Blackjack Action Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function _sanitizeState(game, showDealerCards = false) {
    return {
        playerHands: game.playerHands,
        currentHandIndex: game.currentHandIndex,
        dealerCards: showDealerCards ? game.dealerCards : [game.dealerCards[0]],
        status: game.status,
        payout: game.payout
    };
}

async function resolveBlackjackOnChain(playerPubkeyStr, unhashedServerSeed, payoutAmount) {
    try {
        console.log(`[HOUSE] Resolving Blackjack for ${playerPubkeyStr}. Payout: ${payoutAmount} lamports`);
        
        const gamePubkey = activeBlackjackGames.get(playerPubkeyStr)?.gamePubkey;
        if (!gamePubkey) return;

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

        const sighash = crypto.createHash('sha256').update("global:resolve_blackjack").digest().slice(0, 8);
        
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        
        const payoutBuffer = Buffer.alloc(8);
        payoutBuffer.writeBigUInt64LE(BigInt(payoutAmount));
        
        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer, payoutBuffer]);

        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: new anchor.web3.PublicKey(gamePubkey), isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: playerPubkey, isSigner: false, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        const tx = new anchor.web3.Transaction().add(resolveIx);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = houseKeypair.publicKey;
        tx.sign(houseKeypair);

        const txSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");

        console.log(`✅ [HOUSE] Blackjack Resolved! TX: ${txSig}`);
    } catch (err) {
        console.error("❌ [HOUSE] Failed to resolve Blackjack on-chain:", err.message);
    }
}

// ==========================================
// MCPEPE'S PATRIOTS (SLOTS) ENDPOINTS
// ==========================================
const activePatriotsGames = new Map();

app.post('/api/patriots/seed', (req, res) => {
    try {
        const { playerPubkey } = req.body;
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

        activePatriotsGames.set(playerPubkey, { serverSeed, serverSeedHash, status: "waiting_for_tx" });
        res.json({ success: true, serverSeedHash });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// MCPEPE'S PATRIOTS: GAME ENGINE MATH
// ==========================================

const PATRIOTS_SYMBOLS = {
    GOLDEN_MCPEPE: 0, PEPE_HEART: 1, PURPLE_DIAMOND: 2, BLUE_OVAL: 3, 
    GREEN_GEM: 4, APPLE: 5, MELON: 6, SCATTER: 7, BOMB: 8, 
    GRAPE: 9, BANANA: 10 
};

// V4 Buffed Paytable - Increased base values by ~50% to bring RTP to 96%
const PAYTABLE = {
    [PATRIOTS_SYMBOLS.GOLDEN_MCPEPE]: { 8: 15, 10: 40, 12: 75 },
    [PATRIOTS_SYMBOLS.PEPE_HEART]: { 8: 4, 10: 15, 12: 35 },
    [PATRIOTS_SYMBOLS.PURPLE_DIAMOND]: { 8: 3, 10: 7.5, 12: 20 },
    [PATRIOTS_SYMBOLS.BLUE_OVAL]: { 8: 2, 10: 4, 12: 15 },
    [PATRIOTS_SYMBOLS.GREEN_GEM]: { 8: 1.5, 10: 2.5, 12: 12 },
    [PATRIOTS_SYMBOLS.APPLE]: { 8: 1.2, 10: 2, 12: 10 },
    [PATRIOTS_SYMBOLS.MELON]: { 8: 0.8, 10: 1.5, 12: 7.5 },
    [PATRIOTS_SYMBOLS.GRAPE]: { 8: 0.6, 10: 1.2, 12: 5 },
    [PATRIOTS_SYMBOLS.BANANA]: { 8: 0.4, 10: 1, 12: 3 }
};

// Provably Fair RNG for individual symbols
function getDeterministicFloat(serverSeed, clientSeed, nonce, counter) {
    const hash = crypto.createHmac('sha256', serverSeed)
                       .update(`${clientSeed}:${nonce}:${counter}`)
                       .digest('hex');
    return parseInt(hash.substring(0, 8), 16) / 0xffffffff; 
}

function generateSymbol(randomFloat, isFreeSpins) {
    // V3 Weights: "Goldilocks" balance between V1 (Too tight) and V2 (Too loose)
    const weights = [
        { symbol: PATRIOTS_SYMBOLS.BANANA, weight: 190 },       
        { symbol: PATRIOTS_SYMBOLS.GRAPE, weight: 165 },        
        { symbol: PATRIOTS_SYMBOLS.MELON, weight: 145 },        
        { symbol: PATRIOTS_SYMBOLS.APPLE, weight: 130 },        
        { symbol: PATRIOTS_SYMBOLS.GREEN_GEM, weight: 115 },    
        { symbol: PATRIOTS_SYMBOLS.BLUE_OVAL, weight: 95 },    
        { symbol: PATRIOTS_SYMBOLS.PURPLE_DIAMOND, weight: 75 },
        { symbol: PATRIOTS_SYMBOLS.PEPE_HEART, weight: 50 },    
        { symbol: PATRIOTS_SYMBOLS.GOLDEN_MCPEPE, weight: 20 }, 
        { symbol: PATRIOTS_SYMBOLS.SCATTER, weight: 15 }        
    ];

    if (isFreeSpins) {
        // V3 Bomb Spawn: Reduced from 75 to 55 to prevent infinite multiplier stacking
        weights.push({ symbol: PATRIOTS_SYMBOLS.BOMB, weight: 55 }); 
    }

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let rand = randomFloat * totalWeight;

    for (let w of weights) {
        if (rand < w.weight) return w.symbol;
        rand -= w.weight;
    }
    return PATRIOTS_SYMBOLS.BANANA; 
}

function getBombMultiplier(randomFloat) {
    // V3 Bomb Weights: Keeping the top-end high, but adding slightly more 2x/3x "dud" bombs 
    const bombWeights = [
        { mult: 2, weight: 220 },   
        { mult: 3, weight: 180 },   
        { mult: 5, weight: 150 },   
        { mult: 8, weight: 110 },   
        { mult: 10, weight: 100 },  
        { mult: 15, weight: 70 },   
        { mult: 20, weight: 60 },   
        { mult: 25, weight: 50 },   
        { mult: 50, weight: 40 },   
        { mult: 100, weight: 20 }   
    ];
    
    let totalWeight = bombWeights.reduce((sum, w) => sum + w.weight, 0);
    let rand = randomFloat * totalWeight;
    
    for (let bw of bombWeights) {
        if (rand < bw.weight) return bw.mult;
        rand -= bw.weight;
    }
    return 2; 
}


function generateGrid(serverSeed, clientSeed, nonce, counterRef, isFreeSpins, forceScatters = false) {
    let grid = [];
    let scatterPositions = [];

    // If Buy Bonus is triggered, guarantee exactly 4 Scatters randomly placed
    if (forceScatters) {
        while (scatterPositions.length < 4) {
            let posFloat = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
            let pos = Math.floor(posFloat * 30);
            if (!scatterPositions.includes(pos)) scatterPositions.push(pos);
        }
    }

    for (let col = 0; col < 6; col++) {
        let column = [];
        for (let row = 0; row < 5; row++) {
            let tileIndex = col * 5 + row;
            // Place the guaranteed scatters
            if (forceScatters && scatterPositions.includes(tileIndex)) {
                column.push(PATRIOTS_SYMBOLS.SCATTER);
            } else {
                const floatStr = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                column.push(generateSymbol(floatStr, isFreeSpins));
            }
        }
        grid.push(column);
    }
    return grid;
}


function evaluateGrid(grid) {
    let counts = {};
    let winningSymbols = [];
    let scatterCount = 0;

    for (let c = 0; c < 6; c++) {
        for (let r = 0; r < 5; r++) {
            let sym = grid[c][r];
            if (sym === PATRIOTS_SYMBOLS.SCATTER) scatterCount++;
            else {
                counts[sym] = (counts[sym] || 0) + 1;
            }
        }
    }

    for (const [sym, count] of Object.entries(counts)) {
        if (count >= 8 && parseInt(sym) !== PATRIOTS_SYMBOLS.BOMB) {
            winningSymbols.push(parseInt(sym));
        }
    }

    return { winningSymbols, scatterCount, counts };
}

function calculatePayout(winningSymbols, counts, betAmount) {
    let payout = 0;
    for (let sym of winningSymbols) {
        let count = counts[sym];
        let tier = count >= 12 ? 12 : (count >= 10 ? 10 : 8);
        let mult = PAYTABLE[sym][tier];
        payout += Math.floor(betAmount * mult);
    }
    return payout;
}

function processTumble(grid, winningSymbols, serverSeed, clientSeed, nonce, counterRef, isFreeSpins) {
    let newBombs = [];
    
    for (let c = 0; c < 6; c++) {
        grid[c] = grid[c].filter(sym => !winningSymbols.includes(sym));
        
        while (grid[c].length < 5) {
            const floatStr = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
            const sym = generateSymbol(floatStr, isFreeSpins);
            
            // Generate multiplier perfectly synced with the bomb's spawn
            if (isFreeSpins && sym === PATRIOTS_SYMBOLS.BOMB) {
                const bFloat = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                newBombs.push(getBombMultiplier(bFloat));
            }
            grid[c].unshift(sym); 
        }
    }
    return { grid, newBombs };
}

function generateGrid(serverSeed, clientSeed, nonce, counterRef, isFreeSpins, forceScatters = false) {
    let grid = [];
    let scatterPositions = [];

    // If Buy Bonus is triggered, guarantee exactly 4 Scatters randomly placed
    if (forceScatters) {
        while (scatterPositions.length < 4) {
            let posFloat = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
            let pos = Math.floor(posFloat * 30);
            if (!scatterPositions.includes(pos)) scatterPositions.push(pos);
        }
    }

    for (let col = 0; col < 6; col++) {
        let column = [];
        for (let row = 0; row < 5; row++) {
            let tileIndex = col * 5 + row;
            // Place the guaranteed scatters
            if (forceScatters && scatterPositions.includes(tileIndex)) {
                column.push(PATRIOTS_SYMBOLS.SCATTER);
            } else {
                const floatStr = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                column.push(generateSymbol(floatStr, isFreeSpins));
            }
        }
        grid.push(column);
    }
    return grid;
}

function runSpinCycle(betAmount, serverSeed, clientSeed, nonce, startCounter, isFreeSpins, forceScatters = false) {
    let counterRef = { val: startCounter };
    let grid = generateGrid(serverSeed, clientSeed, nonce, counterRef, isFreeSpins, forceScatters);
    
    let frames = [];
    let totalSpinPayout = 0;
    let activeTumble = true;
    let bombMultipliers = [];

    // Capture multipliers for bombs generated in the initial grid
    if (isFreeSpins) {
        for (let c = 0; c < 6; c++) {
            for (let r = 0; r < 5; r++) {
                if (grid[c][r] === PATRIOTS_SYMBOLS.BOMB) {
                    const bFloat = getDeterministicFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                    bombMultipliers.push(getBombMultiplier(bFloat));
                }
            }
        }
    }

    while (activeTumble) {
        let { winningSymbols, scatterCount, counts } = evaluateGrid(grid);
        
        if (winningSymbols.length > 0) {
            let tumblePayout = calculatePayout(winningSymbols, counts, betAmount);
            totalSpinPayout += tumblePayout;

            frames.push({
                grid: JSON.parse(JSON.stringify(grid)),
                winningSymbols,
                tumblePayout
            });

            // Tumble the board and grab any newly dropped bomb multipliers
            let tumbleResult = processTumble(grid, winningSymbols, serverSeed, clientSeed, nonce, counterRef, isFreeSpins);
            grid = tumbleResult.grid;
            
            if (isFreeSpins && tumbleResult.newBombs.length > 0) {
                bombMultipliers.push(...tumbleResult.newBombs);
            }
            
        } else {
            frames.push({
                grid: JSON.parse(JSON.stringify(grid)),
                winningSymbols: [],
                tumblePayout: 0
            });
            activeTumble = false;
        }
    }

    let finalSpinMultiplier = 1;
    if (bombMultipliers.length > 0 && totalSpinPayout > 0) {
        finalSpinMultiplier = bombMultipliers.reduce((a, b) => a + b, 0);
        totalSpinPayout = totalSpinPayout * finalSpinMultiplier;
    }

    return { 
        totalSpinPayout, 
        frames, 
        finalCounter: counterRef.val,
        triggeredBonus: !isFreeSpins && evaluateGrid(grid).scatterCount >= 4,
        bombMultipliers,
        finalSpinMultiplier
    };
}

// THE NEW PLAY ENDPOINT
app.post('/api/patriots/play', async (req, res) => {
    try {
        // ADDED isBonusBuy to the request
        const { playerPubkey, gamePubkey, clientSeed, nonce, betAmount, isBonusBuy } = req.body;

        const game = activePatriotsGames.get(playerPubkey);
        if (!game || game.status !== "waiting_for_tx") {
            return res.status(400).json({ error: "No active session. Fetch seed first." });
        }

        // 🔒 B-C3 FIX: betAmount drives every payout multiplier, so it MUST match
        // the lamports actually escrowed on-chain. Otherwise a player can claim a
        // 10 SOL bet while only escrowing 0.01 SOL.
        try {
            const onChainBet = await readOnChainBetAmount(gamePubkey);
            if (onChainBet !== BigInt(betAmount)) {
                return res.status(400).json({
                    error: `Bet mismatch: body=${betAmount} on-chain=${onChainBet.toString()}`
                });
            }
        } catch (e) {
            return res.status(400).json({ error: `Could not verify on-chain bet: ${e.message}` });
        }

        // If Bonus Buy, the mathematical base bet is 100x smaller than the escrowed wager
        const actualBaseBet = isBonusBuy ? Number(betAmount) / 100 : Number(betAmount);

        let currentCounter = 0;
        // Pass 'isBonusBuy' as the forceScatters parameter to guarantee the drop
        const baseSpin = runSpinCycle(actualBaseBet, game.serverSeed, clientSeed, nonce, currentCounter, false, isBonusBuy);
        currentCounter = baseSpin.finalCounter;

        let totalGamePayout = baseSpin.totalSpinPayout;
        let freeSpinsData = [];
        
        if (baseSpin.triggeredBonus) {
            let totalSpins = 10; // Start with the base 10 spins
            
            for (let i = 0; i < totalSpins; i++) {
                const fsSpin = runSpinCycle(actualBaseBet, game.serverSeed, clientSeed, nonce, currentCounter, true, false);
                currentCounter = fsSpin.finalCounter;
                totalGamePayout += fsSpin.totalSpinPayout;
                
                freeSpinsData.push(fsSpin);

                // RETRIGGER: If 3 or more scatters land during a free spin, add +3 spins to the total limit
                // We check frames[0] so we only count them once before they potentially tumble
                if (evaluateGrid(fsSpin.frames[0].grid).scatterCount >= 3) {
                    totalSpins += 3; 
                }
            }
        }

        // Enforce the 21,100x Maximum Win Cap
        const MAX_WIN_MULTIPLIER = 21100;
        const hardCapLamports = actualBaseBet * MAX_WIN_MULTIPLIER;
        
        if (totalGamePayout > hardCapLamports) {
            totalGamePayout = hardCapLamports;
            console.log(`🏆 MAX WIN HIT by ${playerPubkey}! Capped at 21,100x.`);
        }

        await resolvePatriotsOnChain(playerPubkey, gamePubkey, game.serverSeed, totalGamePayout);
        activePatriotsGames.delete(playerPubkey);

        res.json({ 
            success: true, 
            payout: totalGamePayout, 
            serverSeed: game.serverSeed, 
            baseSpinFrames: baseSpin.frames,
            triggeredBonus: baseSpin.triggeredBonus,
            freeSpinsData: freeSpinsData 
        });

    } catch (error) {
        console.error("❌ Patriots Play Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function resolvePatriotsOnChain(playerPubkeyStr, gamePubkeyStr, unhashedServerSeed, payoutAmount) {
    try {
        console.log(`[HOUSE] Resolving Patriots for ${playerPubkeyStr}. Payout: ${payoutAmount}`);

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const gamePubkey = new anchor.web3.PublicKey(gamePubkeyStr);
        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

        const sighash = crypto.createHash('sha256').update("global:resolve_patriots").digest().slice(0, 8);
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        
        const payoutBuffer = Buffer.alloc(8);
        // 🔥 CRITICAL FIX 1: Math.round() physically prevents floating-point BigInt crashes
        payoutBuffer.writeBigUInt64LE(BigInt(Math.round(payoutAmount)));

        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer, payoutBuffer]);
        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gamePubkey, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: playerPubkey, isSigner: false, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        let txSig;
        let retries = 5; 
        
        while (retries > 0) {
            try {
                const tx = new anchor.web3.Transaction().add(resolveIx);
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
                tx.recentBlockhash = blockhash;
                tx.feePayer = houseKeypair.publicKey;
                tx.sign(houseKeypair);

                txSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
                const confirmation = await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
                
                // 🔥 CRITICAL FIX 2: Ensure the Solana smart contract actually approved the payout!
                if (confirmation.value.err) {
                    throw new Error(`On-chain rejection: ${JSON.stringify(confirmation.value.err)}`);
                }
                
                console.log(`✅ [HOUSE] Patriots Resolved! TX: ${txSig}`);
                return; // Success, exit function gracefully
            } catch (err) {
                console.log(`⚠️ Network retry for Patriots Payout... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("CRITICAL: Failed to pay user after 5 attempts.");
            }
        }
    } catch (err) {
        console.error("❌ [HOUSE] Failed to resolve Patriots:", err.message);
        // 🔥 CRITICAL FIX 3: We MUST throw the error back to the API route!
        // This causes the API to return a 500 Error, which tells the frontend to abort the fake win animation.
        throw err; 
    }
}

// ==========================================
// MCPEPE'S VACATION (SLOTS) ENDPOINTS
// ==========================================
const activeVacationGames = new Map();

app.post('/api/vacation/seed', (req, res) => {
    try {
        const { playerPubkey } = req.body;
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

        activeVacationGames.set(playerPubkey, { serverSeed, serverSeedHash, status: "waiting_for_tx" });
        res.json({ success: true, serverSeedHash });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// MCPEPE'S VACATION: GAME ENGINE MATH (10-LINE BIG BASS SPLASH CLONE)
// ==========================================
const VACATION_SYMBOLS = {
    TEN: 0, J: 1, Q: 2, K: 3, A: 4, 
    SUNSCREEN: 5, LUGGAGE: 6, COCKTAIL: 7, JETSKI: 8, YACHT: 9, 
    MCPEPE: 10, PASSPORT_SCATTER: 11 
};

// Payout Multipliers (Based on $0.10 line bet equivalent now that we have 10 lines)
const VAC_PAYTABLE = {
    [VACATION_SYMBOLS.TEN]: { 3: 5, 4: 25, 5: 100 },
    [VACATION_SYMBOLS.J]: { 3: 5, 4: 25, 5: 100 },
    [VACATION_SYMBOLS.Q]: { 3: 5, 4: 25, 5: 100 },
    [VACATION_SYMBOLS.K]: { 3: 10, 4: 50, 5: 150 },
    [VACATION_SYMBOLS.A]: { 3: 10, 4: 50, 5: 150 },
    [VACATION_SYMBOLS.SUNSCREEN]: { 2: 5, 3: 30, 4: 100, 5: 500 },
    // NEW: Luggage (Money) now pays standard line wins in the base game (Up to 20x Total Bet / 200x Line Bet)
    [VACATION_SYMBOLS.LUGGAGE]: { 3: 10, 4: 50, 5: 200 }, 
    [VACATION_SYMBOLS.COCKTAIL]: { 2: 10, 3: 40, 4: 400, 5: 1000 },
    [VACATION_SYMBOLS.JETSKI]: { 2: 10, 3: 40, 4: 400, 5: 1000 },
    [VACATION_SYMBOLS.YACHT]: { 2: 20, 3: 100, 4: 1000, 5: 2000 },
};

// 10 Fixed Paylines (Classic setup)
const VAC_LINES = [
    [1,1,1,1,1], // Line 1: Middle
    [0,0,0,0,0], // Line 2: Top
    [2,2,2,2,2], // Line 3: Bottom
    [0,1,2,1,0], // Line 4: V
    [2,1,0,1,2], // Line 5: Inverted V
    [1,0,0,0,1], // Line 6: Chevron Up
    [1,2,2,2,1], // Line 7: Chevron Down
    [0,0,1,2,2], // Line 8: Zig Zag Down
    [2,2,1,0,0], // Line 9: Zig Zag Up
    [1,0,1,2,1]  // Line 10: W
];

// Base Game Strips (Symbol 10 / McPepe is completely REMOVED)
const BASE_VAC_REEL_STRIPS = [
    [0,6,2,3,11,4,0,5,6,1,2,0,3,1,7,0,4,6,2,1,1,3,0,8,0,2,4,6,1,3,9,0,6,2,11,4,1,5,0,0,2,3,6,1,7,4,0,0,2,8,1,6,3,4,11,0,6,2,1,5,0,3,4,0,0,6,2,1,7,0,3,4,8,0,1,2,1,3,4,6],
    [1,0,6,4,3,11,1,6,0,5,2,0,1,3,6,7,4,0,0,1,2,1,6,8,3,4,0,0,2,9,1,6,4,3,11,0,0,5,2,1,6,4,3,7,0,6,2,1,8,4,0,3,0,11,1,6,2,5,4,0,3,0,9,1,6,2,4,7,3,0,0,1,8,4,6,2,3,0,1,6],
    [2,1,6,0,4,11,2,6,1,5,0,0,2,4,6,7,3,1,0,1,0,2,6,8,4,3,0,1,0,9,2,6,3,4,11,1,0,5,0,2,6,3,4,7,1,0,0,2,8,3,6,4,1,11,2,6,0,5,3,0,4,1,9,2,6,0,3,7,4,0,1,2,8,3,6,0,4,1,2,6],
    [3,2,6,1,0,11,3,6,2,5,1,0,3,0,6,7,4,2,0,1,1,3,6,8,0,4,0,2,1,9,3,6,4,0,11,2,0,5,1,3,6,4,0,7,2,0,1,3,8,4,6,0,2,11,3,6,1,5,4,0,0,2,9,3,6,1,4,7,0,0,2,3,8,4,6,1,0,2,3,6],
    [4,3,6,2,1,11,4,6,3,5,2,0,4,1,6,7,0,3,0,1,2,4,6,8,1,0,0,3,2,9,4,6,0,1,11,3,0,5,2,4,6,0,1,7,3,0,2,4,8,0,6,1,3,11,4,6,2,5,0,0,1,3,9,4,6,2,0,7,1,0,3,4,8,0,6,2,1,3,4,6]
];

// Free Spins Strips - Filler symbols thoroughly shuffled to prevent excessive line wins
const FS_VAC_REEL_STRIPS = [
    [0,6,1,6,2,3,4,0,6,5,10,1,6,2,3,4,0,1,7,1,2,2,3,4,0,6,8,1,0,2,3,4,0,6,9,1,1,2,3,4,0,2,1,6,3,4,0,6,1,2,3,4,0,1,2,3,4,0,1,2,3,4,6],
    [1,0,2,3,6,4,0,10,1,5,1,2,3,7,6,4,0,1,2,2,3,8,0,4,0,1,6,2,3,9,1,4,0,1,6,2,3,4,0,6,1,2,3,4,1,0,1,2,3,6,4,0,1,2,6,3,4,0,1,2,3,4,2,6],
    [2,0,3,4,6,0,1,10,2,5,1,3,4,7,6,0,1,2,0,3,4,8,1,0,1,2,6,3,4,9,2,0,1,6,2,3,4,0,6,1,2,3,4,0,1,1,2,3,4,6,0,1,2,3,6,4,0,1,2,3,4,2,6],
    [3,1,4,0,6,1,2,10,3,5,0,4,0,7,6,1,2,3,1,4,0,8,2,1,2,3,6,4,0,9,0,1,2,6,3,4,0,6,1,2,3,4,0,1,1,2,3,4,6,0,1,2,3,4,6,0,1,2,3,4,2,6],
    [4,2,0,1,6,2,3,10,4,5,1,0,1,7,6,2,3,4,0,0,1,8,1,2,3,4,6,0,1,9,2,2,3,6,4,0,6,1,2,3,4,0,2,1,2,3,4,6,0,1,2,3,4,6,0,1,2,3,4,1,6]
];

const LUGGAGE_PRIZES = [2, 5, 10, 25, 50, 100];

function getVacationFloat(serverSeed, clientSeed, nonce, counter) {
    const hash = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${counter}`).digest('hex');
    return parseInt(hash.substring(0, 8), 16) / 0xffffffff; 
}

function spinVacationReels(serverSeed, clientSeed, nonce, counterRef, isFreeSpin = false, forceScatters = false) {
    let grid = [];
    let stops = [];
    let scatterCols = [];
    
    // Select the correct reel strips!
    const activeStrips = isFreeSpin ? FS_VAC_REEL_STRIPS : BASE_VAC_REEL_STRIPS;
    
    if (forceScatters) {
        while(scatterCols.length < 3) {
            let col = Math.floor(getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++) * 5);
            if(!scatterCols.includes(col)) scatterCols.push(col);
        }
    }

    for (let col = 0; col < 5; col++) {
        let strip = activeStrips[col];
        let stopFloat = getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++);
        let stop = Math.floor(stopFloat * strip.length);
        
        stops.push(stop);
        let columnSymbols = [strip[stop], strip[(stop+1)%strip.length], strip[(stop+2)%strip.length]];
        
        if (forceScatters && scatterCols.includes(col)) {
            let row = Math.floor(getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++) * 3);
            columnSymbols[row] = VACATION_SYMBOLS.PASSPORT_SCATTER;
        }
        
        grid.push(columnSymbols);
    }
    return { grid, stops };
}

function evaluateVacationGrid(grid, lineBet, serverSeed = "", clientSeed = "", nonce = 0, counterRef = {val: 0}) {
    let payout = 0;
    let winningLines = [];
    let scatterCount = 0;
    
    // Big Bass Data Trackers
    let mcpepeCount = 0;
    let totalLuggageMult = 0;
    let luggageValues = [];
    
    // 1. Scan Grid for Scatters, McPepes, and Luggage Values
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 3; r++) {
            const sym = grid[c][r];
            
            if (sym === VACATION_SYMBOLS.PASSPORT_SCATTER) scatterCount++;
            if (sym === VACATION_SYMBOLS.MCPEPE) mcpepeCount++;
            
            if (sym === VACATION_SYMBOLS.LUGGAGE) {
                let prizeFloat = getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                
                // FAT LUGGAGE DISTRIBUTION (EV: ~11.5x)
                let prizeMult;
                if (prizeFloat < 0.55) prizeMult = 5;        // 55% chance (Solid catch)
                else if (prizeFloat < 0.80) prizeMult = 10;  // 25% chance (Good catch)
                else if (prizeFloat < 0.94) prizeMult = 20;  // 14% chance (Great catch)
                else if (prizeFloat < 0.99) prizeMult = 50;  // 5% chance (Epic catch)
                else prizeMult = 100;                        // 1% chance (Jackpot)

                luggageValues.push({ col: c, row: r, val: prizeMult });
                totalLuggageMult += prizeMult;
            }
        }
    }

    // 🛑 CRITICAL FIX: Hard Cap Scatters to 5 so we don't break the UI or award 30+ starting spins accidentally.
    scatterCount = Math.min(scatterCount, 5); 

    // 🛑 CRITICAL FIX: Scatters DO NOT PAY CASH. They only trigger the bonus.
    // (The `if (VAC_PAYTABLE[VACATION_SYMBOLS.PASSPORT_SCATTER])` block has been permanently deleted).

    // 2. Evaluate 10 Standard Lines
    for (let i = 0; i < VAC_LINES.length; i++) {
        let line = VAC_LINES[i];
        let firstSym = -1;
        let count = 0;
        
        for (let col = 0; col < 5; col++) {
            let sym = grid[col][line[col]];
            
            // If the symbol is a scatter, it immediately breaks the payline
            if (sym === VACATION_SYMBOLS.PASSPORT_SCATTER) break;
            
            if (firstSym === -1) {
                firstSym = sym;
                count++;
            } else if (sym === firstSym) {
                count++;
            } else {
                break;
            }
        }
        
        if (firstSym !== -1 && VAC_PAYTABLE[firstSym] && VAC_PAYTABLE[firstSym][count]) {
            let win = lineBet * VAC_PAYTABLE[firstSym][count];
            payout += win;
            winningLines.push({ lineIndex: i, symbol: firstSym, count, win });
        }
    }

    return { payout, winningLines, scatterCount, mcpepeCount, totalLuggageMult, luggageValues };
}

function processNearMiss(initialGrid, initialStops, serverSeed, clientSeed, nonce, counterRef) {
    let scatters = [];
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 3; r++) {
            if (initialGrid[c][r] === VACATION_SYMBOLS.PASSPORT_SCATTER) {
                scatters.push({ col: c, row: r });
            }
        }
    }

    let result = {
        grid: initialGrid, 
        nudgeTriggered: false,
        hookTriggered: false,
        hookCol: -1
    };

    if (scatters.length === 2) {
        let canNudge = scatters.every(s => s.row < 2);

        if (canNudge) {
            let newGrid = [];
            let scatterCols = scatters.map(s => s.col);

            for (let c = 0; c < 5; c++) {
                // FIXED: Now correctly pulls from BASE_VAC_REEL_STRIPS
                let strip = BASE_VAC_REEL_STRIPS[c]; 
                if (scatterCols.includes(c)) {
                    let newStop = (initialStops[c] - 1 + strip.length) % strip.length;
                    newGrid.push([strip[newStop], strip[(newStop+1)%strip.length], strip[(newStop+2)%strip.length]]);
                } else {
                    let stopFloat = getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                    let newStop = Math.floor(stopFloat * strip.length);
                    newGrid.push([strip[newStop], strip[(newStop+1)%strip.length], strip[(newStop+2)%strip.length]]);
                }
            }
            result.grid = newGrid;
            result.nudgeTriggered = true;

        } else {
            let hookFloat = getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++);
            if (hookFloat < 0.25) {
                let scatterCols = scatters.map(s => s.col);
                let availableCols = [0, 1, 2, 3, 4].filter(c => !scatterCols.includes(c));
                
                let colTargetFloat = getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                let targetCol = availableCols[Math.floor(colTargetFloat * availableCols.length)];
                
                let newGrid = initialGrid.map(colArr => [...colArr]);
                
                let rowTargetFloat = getVacationFloat(serverSeed, clientSeed, nonce, counterRef.val++);
                let targetRow = rowTargetFloat < 0.5 ? 1 : 2; 

                newGrid[targetCol][targetRow] = VACATION_SYMBOLS.PASSPORT_SCATTER;

                result.grid = newGrid;
                result.hookTriggered = true;
                result.hookCol = targetCol;
            }
        }
    }
    return result;
}

// THE PLAY ENDPOINT (Final Big Bass Integration)
app.post('/api/vacation/play', async (req, res) => {
    try {
        const { playerPubkey, gamePubkey, clientSeed, nonce, betAmount, isBonusBuy } = req.body;

        const game = activeVacationGames.get(playerPubkey);
        if (!game || game.status !== "waiting_for_tx") {
            return res.status(400).json({ error: "No active session. Fetch seed first." });
        }
        
        const actualBetLamports = Number(betAmount);

        const totalWager = Number(actualBetLamports);
        const actualBaseBet = isBonusBuy ? totalWager / 100 : totalWager;
        const lineBet = actualBaseBet / 10; 

        let currentCounter = { val: 0 };
        
        // --- 1. BASE SPIN ---
        const { grid: initialGrid, stops: initialStops } = spinVacationReels(game.serverSeed, clientSeed, nonce, currentCounter, false, isBonusBuy);
        
        // --- 2. NEAR MISS EVALUATION ---
        let finalBaseGrid = initialGrid;
        let nearMissData = { nudgeTriggered: false, hookTriggered: false };

        if (!isBonusBuy) {
            nearMissData = processNearMiss(initialGrid, initialStops, game.serverSeed, clientSeed, nonce, currentCounter);
            if (nearMissData.nudgeTriggered || nearMissData.hookTriggered) {
                finalBaseGrid = nearMissData.grid;
            }
        }

        // --- 3. FINAL BASE EVALUATION ---
        const baseEval = evaluateVacationGrid(finalBaseGrid, lineBet, game.serverSeed, clientSeed, nonce, currentCounter);
        let totalPayout = baseEval.payout;
        
        let triggeredBonus = baseEval.scatterCount >= 3 || isBonusBuy;
        let freeSpinsData = null;

        // --- 4. THE BIG BASS BONUS ENGINE ---
        if (triggeredBonus) {
            let spinsData = [];
            let mcpepesCollected = 0;
            
            // DYNAMIC INITIAL SPINS: 3 Scatters = 10, 4 Scatters = 15, 5 Scatters = 20
            let initialSpins = 10;
            if (baseEval.scatterCount === 4) initialSpins = 15;
            if (baseEval.scatterCount === 5) initialSpins = 20;

            let totalSpinsAwarded = initialSpins;
            let currentSpinNum = 0;
            let retriggerLevel = 0; // Explicit tracking to prevent 30-spin desyncs

            const totalBet = lineBet * 10;

            while (currentSpinNum < totalSpinsAwarded) {
                // Multipliers are tied to the BATCH of spins, anchoring off the initial spins granted
                let activeMultiplier = 1;
                if (currentSpinNum >= initialSpins + 20) activeMultiplier = 10;
                else if (currentSpinNum >= initialSpins + 10) activeMultiplier = 3;
                else if (currentSpinNum >= initialSpins) activeMultiplier = 2;

                const { grid: fsGrid } = spinVacationReels(game.serverSeed, clientSeed, nonce, currentCounter, true, false);
                const fsEval = evaluateVacationGrid(fsGrid, lineBet, game.serverSeed, clientSeed, nonce, currentCounter);
                
                let spinPayout = fsEval.payout;
                let collectionWin = 0;

                // Execute the Collection Mechanic
                if (fsEval.mcpepeCount > 0 && fsEval.totalLuggageMult > 0) {
                    collectionWin = (totalBet * fsEval.totalLuggageMult) * fsEval.mcpepeCount * activeMultiplier;
                    spinPayout += collectionWin;
                }

                totalPayout += spinPayout;
                mcpepesCollected += fsEval.mcpepeCount;

                // Explicit Retrigger Logic (Independent of totalSpinsAwarded)
                if (mcpepesCollected >= 4 && retriggerLevel === 0) {
                    retriggerLevel = 1;
                    totalSpinsAwarded += 10;
                }
                if (mcpepesCollected >= 8 && retriggerLevel === 1) {
                    retriggerLevel = 2;
                    totalSpinsAwarded += 10;
                }
                if (mcpepesCollected >= 12 && retriggerLevel === 2) {
                    retriggerLevel = 3;
                    totalSpinsAwarded += 10;
                }

                spinsData.push({
                    grid: fsGrid,
                    payout: spinPayout,
                    winningLines: fsEval.winningLines,
                    collectionWin: collectionWin,
                    mcpepeCount: fsEval.mcpepeCount,
                    luggageValues: fsEval.luggageValues,
                    activeMultiplier: activeMultiplier,
                    totalCollectedSoFar: mcpepesCollected
                });

                currentSpinNum++;
            }

            freeSpinsData = { 
                spins: spinsData, 
                totalSpinsPlayed: currentSpinNum,
                finalMcpepesCollected: mcpepesCollected,
                initialSpins: initialSpins // Pass the starting spins to the frontend
            };
        }

        // Cap Maximum Win at 5,000x the Total Base Bet
        const MAX_WIN = actualBaseBet * 5000;
        if (totalPayout > MAX_WIN) {
            totalPayout = MAX_WIN;
            console.log(`🏆 VACATION MAX WIN HIT by ${playerPubkey}! Capped at 5,000x.`);
        }

        // Resolve on chain
        await resolveVacationOnChain(playerPubkey, gamePubkey, game.serverSeed, totalPayout);
        activeVacationGames.delete(playerPubkey);

        res.json({ 
            success: true, 
            payout: totalPayout, 
            serverSeed: game.serverSeed, 
            initialGrid: initialGrid,
            baseGrid: finalBaseGrid,
            nearMissData: nearMissData,
            baseWinningLines: baseEval.winningLines,
            triggeredBonus,
            freeSpinsData
        });

    } catch (error) {
        console.error("❌ Vacation Play Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function resolveVacationOnChain(playerPubkeyStr, gamePubkeyStr, unhashedServerSeed, payoutAmount) {
    try {
        console.log(`[HOUSE] Resolving Vacation for ${playerPubkeyStr}. Payout: ${payoutAmount}`);

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const gamePubkey = new anchor.web3.PublicKey(gamePubkeyStr);
        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

        const sighash = crypto.createHash('sha256').update("global:resolve_vacation").digest().slice(0, 8);
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        
        const payoutBuffer = Buffer.alloc(8);
        payoutBuffer.writeBigUInt64LE(BigInt(Math.round(payoutAmount)));

        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer, payoutBuffer]);
        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gamePubkey, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: playerPubkey, isSigner: false, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        let txSig;
        let retries = 5; 
        
        while (retries > 0) {
            try {
                const tx = new anchor.web3.Transaction().add(resolveIx);
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
                tx.recentBlockhash = blockhash;
                tx.feePayer = houseKeypair.publicKey;
                tx.sign(houseKeypair);

                txSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
                const confirmation = await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
                
                if (confirmation.value.err) {
                    throw new Error(`On-chain rejection: ${JSON.stringify(confirmation.value.err)}`);
                }
                
                console.log(`✅ [HOUSE] Vacation Resolved! TX: ${txSig}`);
                return;
            } catch (err) {
                console.log(`⚠️ Network retry for Vacation Payout... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("CRITICAL: Failed to pay user after 5 attempts.");
            }
        }
    } catch (err) {
        console.error("❌ [HOUSE] Failed to resolve Vacation:", err.message);
        throw err; 
    }
}

// ==========================================
// ❄️ MCPEPE SNOWSTORM SLOT LOGIC (V19 FINAL) ❄️
// ==========================================

const SNOWSTORM_PAYTABLE = {
    0: 80, // Wild
    1: 25, // Snowman
    2: 15, // Polar
    3: 10, // Snowmobile
    4: 7,  // Ski
    5: 5,  // Boots
    6: 4,  // Gloves
    7: 3,  // Cocoa
    8: 2   // Snowflake
};

const PAYLINES = [
    [[1,0], [1,1], [1,2]], // Line 1: Middle Horizontal
    [[0,0], [0,1], [0,2]], // Line 2: Top Horizontal
    [[2,0], [2,1], [2,2]], // Line 3: Bottom Horizontal
    [[0,0], [1,1], [2,2]], // Line 4: Diagonal Down
    [[2,0], [1,1], [0,2]]  // Line 5: Diagonal Up
];

function evaluateGrid(matrix) {
    let totalWinFactor = 0;
    let winningLines = [];
    for (let i = 0; i < PAYLINES.length; i++) {
        const line = PAYLINES[i];
        const s1 = matrix[line[0][0]][line[0][1]];
        const s2 = matrix[line[1][0]][line[1][1]];
        const s3 = matrix[line[2][0]][line[2][1]];

        let matchSymbol = s1 === 0 ? (s2 === 0 ? s3 : s2) : s1;
        if ((s1 === matchSymbol || s1 === 0) && 
            (s2 === matchSymbol || s2 === 0) && 
            (s3 === matchSymbol || s3 === 0)) {
            
            totalWinFactor += SNOWSTORM_PAYTABLE[matchSymbol];
            winningLines.push({ lineIndex: i, symbol: matchSymbol });
        }
    }
    return { totalWinFactor, winningLines };
}

app.post('/api/snowstorm/play', async (req, res) => {
    try {
        const { playerPublicKey, betAmount } = req.body;
        if (!playerPublicKey || !betAmount) return res.status(400).json({ error: "Missing parameters" });

        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

        res.json({ serverSeedHash, unhashedServerSeed: serverSeed });
    } catch (err) {
        console.error("Snowstorm Start Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/api/snowstorm/resolve', async (req, res) => {
    try {
        const { playerPublicKey, serverSeed, clientSeed, nonce, betAmount } = req.body;

        // 1. Provably Fair V19 Final Engine
        const pfHash = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');

        // 🔥 The Flawless Base Math
        const getTile = (val) => {
            if (val < 1) return 0;   if (val < 4) return 1;  
            if (val < 12) return 2;  if (val < 26) return 3;  
            if (val < 48) return 4;  if (val < 80) return 5; 
            if (val < 124) return 6; if (val < 182) return 7; 
            return 8;                
        };

        // Independent 3x3 Setup (Uses hash bytes 0-8)
        let matrix = [
            [getTile(parseInt(pfHash.substr(0, 2), 16)), getTile(parseInt(pfHash.substr(2, 2), 16)), getTile(parseInt(pfHash.substr(4, 2), 16))],
            [getTile(parseInt(pfHash.substr(6, 2), 16)), getTile(parseInt(pfHash.substr(8, 2), 16)), getTile(parseInt(pfHash.substr(10, 2), 16))],
            [getTile(parseInt(pfHash.substr(12, 2), 16)), getTile(parseInt(pfHash.substr(14, 2), 16)), getTile(parseInt(pfHash.substr(16, 2), 16))]
        ];

        // 2. Blueprint Feature Injection (Uses bytes 18-21 mapped to 10,000)
        const featureRoll = parseInt(pfHash.substr(18, 4), 16) % 10000;
        
        if (featureRoll < 25) { 
            // 0.25% Natural Wheel Teaser
            const symArr = [8, 8, 8, 7, 7, 6, 5];
            const sym = symArr[parseInt(pfHash.substr(22, 2), 16) % symArr.length];
            matrix = [[sym,sym,sym], [sym,sym,sym], [sym,sym,sym]];
        } else if (featureRoll < 775) { 
            // 7.5% Protected Near-Miss Respin
            const symArr = [8, 7, 6, 5];
            const sym = symArr[parseInt(pfHash.substr(22, 2), 16) % symArr.length];
            
            const safe1 = (sym + 2) % 8 + 1; 
            const safe2 = (sym + 3) % 8 + 1;
            const safe3 = (sym + 4) % 8 + 1;
            matrix = [
                [sym, sym, safe1],
                [sym, sym, safe2],
                [sym, sym, safe3]
            ];
        }

        let { totalWinFactor, winningLines } = evaluateGrid(matrix);

        // 🔥 SNAPSHOT THE INITIAL GRID BEFORE THE RESPIN
        const initialMatrix = [
            [...matrix[0]],
            [...matrix[1]],
            [...matrix[2]]
        ];

        // 3. Snowstorm Respin Reroll Execution
        let respinData = null;
        if (totalWinFactor === 0) {
            const col0 = [matrix[0][0], matrix[1][0], matrix[2][0]];
            const col1 = [matrix[0][1], matrix[1][1], matrix[2][1]];
            const col2 = [matrix[0][2], matrix[1][2], matrix[2][2]];

            const isMatch = (c1, c2) => {
                const sym1 = c1.find(v => v !== 0) || 0; 
                const sym2 = c2.find(v => v !== 0) || 0;
                if (sym1 !== sym2 && sym1 !== 0 && sym2 !== 0) return false;
                const target = sym1 || sym2;
                return c1.every(v => v === target || v === 0) && c2.every(v => v === target || v === 0);
            };

            if (isMatch(col0, col1)) respinData = { held: [0, 1], spin: 2 };
            else if (isMatch(col1, col2)) respinData = { held: [1, 2], spin: 0 };
            else if (isMatch(col0, col2)) respinData = { held: [0, 2], spin: 1 };

            if (respinData) {
                const spinCol = respinData.spin;
                // Organic Reroll of the 3rd Column (Uses hash bytes 24-28)
                matrix[0][spinCol] = getTile(parseInt(pfHash.substr(24, 2), 16));
                matrix[1][spinCol] = getTile(parseInt(pfHash.substr(26, 2), 16));
                matrix[2][spinCol] = getTile(parseInt(pfHash.substr(28, 2), 16));
                
                const respinEval = evaluateGrid(matrix);
                totalWinFactor = respinEval.totalWinFactor;
                winningLines = respinEval.winningLines;
            }
        }

        // 4. Blizzard Multiplier Wheel
        let multiplier = 1;
        const targetSym = matrix.flat().find(v => v !== 0) || 0;
        let isFullGrid = matrix.flat().every(val => val === targetSym || val === 0);
        
        if (isFullGrid) {
            const multiRoll = parseInt(pfHash.substr(30, 2), 16) % 100;
            multiplier = multiRoll >= 99 ? 10 : multiRoll >= 94 ? 5 : multiRoll >= 80 ? 4 : multiRoll >= 50 ? 3 : 2;
            totalWinFactor *= multiplier;
        }

        if (totalWinFactor > 800) totalWinFactor = 800; // Hard Win Cap
        
        const totalPayout = Math.floor(betAmount * totalWinFactor);

        // ==========================================
        // 5. BLOCKCHAIN CPI WITH RETRY ARMOR
        // ==========================================
        const [gameStatePDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("snowstorm"), new anchor.web3.PublicKey(playerPublicKey).toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, 'le', 8)], 
            PROGRAM_ID
        );
        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

        const sighash = crypto.createHash('sha256').update("global:resolve_snowstorm").digest().slice(0, 8);
        const seedBuffer = Buffer.from(serverSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        
        const payoutBuffer = Buffer.alloc(8);
        payoutBuffer.writeBigUInt64LE(BigInt(totalPayout));

        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer, payoutBuffer]);
        
        const resolveIx = new anchor.web3.TransactionInstruction({
            programId: PROGRAM_ID,
            keys: [
                { pubkey: gameStatePDA, isSigner: false, isWritable: true },
                { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: vaultPDA, isSigner: false, isWritable: true },
                { pubkey: new anchor.web3.PublicKey(playerPublicKey), isSigner: false, isWritable: true },
                { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: ixData
        });

        let txSig;
        let retries = 5;
        while (retries > 0) {
            try {
                const tx = new anchor.web3.Transaction().add(resolveIx);
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
                tx.recentBlockhash = blockhash;
                tx.feePayer = houseKeypair.publicKey;
                tx.sign(houseKeypair);

                txSig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
                const confirmation = await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
                
                if (confirmation.value.err) {
                    throw new Error(`On-chain rejection: ${JSON.stringify(confirmation.value.err)}`);
                }
                break; 
            } catch (err) {
                console.log(`⚠️ Network retry for Snowstorm Payout... (${retries} left). Error: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
                if (retries === 0) throw new Error("CRITICAL: Failed to resolve after 5 attempts.");
            }
        }

        res.json({
            success: true,
            txSig,
            initialMatrix,  // <--- ADDED: Tells frontend what to show first
            matrix,         // This is now the final matrix
            winningLines,
            payout: totalPayout,
            respinData,
            multiplier,
            serverSeed
        });

    } catch (err) {
        console.error("Snowstorm Resolve Error:", err);
        res.status(500).json({ error: err.message || "Failed to resolve on-chain." });
    }
});

// ==========================================
// PUMP IT! ENDPOINTS  (post-C-4 architecture: house signs process + cashout)
// ==========================================
// 🔒 C-4 + B-C2 PARITY: backend holds the unhashed pumpit seed and signs every
// reveal (process_pump / cash_out). Players can no longer self-sign these or
// pre-pick winning seeds. Multipliers are also recomputed server-side and
// validated against the on-chain `compute_pump_multiplier_bps` upper bound.
const activePumpitGames = new Map();

function buildHouseSendIx(programId, ixData, keys) {
    return new anchor.web3.TransactionInstruction({ programId, data: ixData, keys });
}

async function houseSignAndSend(ix, label) {
    const tx = new anchor.web3.Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = houseKeypair.publicKey;
    tx.sign(houseKeypair);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    console.log(`✅ [HOUSE] ${label} TX: ${sig}`);
    return sig;
}

app.post('/api/pumpit/seed', (req, res) => {
    try {
        const { playerPubkey } = req.body || {};
        if (!playerPubkey) return res.status(400).json({ success: false, error: "Missing playerPubkey." });

        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

        activePumpitGames.set(playerPubkey, { serverSeed, serverSeedHash, status: "waiting_for_tx" });
        res.json({ success: true, serverSeedHash });
    } catch (error) {
        console.error("❌ Pumpit Seed Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/pumpit/process', async (req, res) => {
    try {
        const { playerPubkey, gamePubkey } = req.body || {};
        if (!playerPubkey || !gamePubkey) {
            return res.status(400).json({ success: false, error: "Missing playerPubkey or gamePubkey." });
        }

        const session = activePumpitGames.get(playerPubkey);
        if (!session || !session.serverSeed) {
            return res.status(400).json({ success: false, error: "No active pumpit session. Call /api/pumpit/seed first." });
        }
        const unhashedServerSeed = session.serverSeed;

        const sighash = crypto.createHash('sha256').update("global:process_pump").digest().slice(0, 8);
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer]);

        const ix = buildHouseSendIx(PROGRAM_ID, ixData, [
            { pubkey: new anchor.web3.PublicKey(gamePubkey), isSigner: false, isWritable: true },
            { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: false },
        ]);

        const sig = await houseSignAndSend(ix, "Pumpit process");

        // Read post-state to tell the client whether the player advanced or rugged.
        const acc = await connection.getAccountInfo(new anchor.web3.PublicKey(gamePubkey), "confirmed");
        // PumpGameState layout offsets (Anchor borsh):
        // [0..8] disc, [8..40] player, [40..72] authority, [72..80] bet_amount,
        // [80] difficulty, [81] current_step, [82..114] server_seed_hash,
        // [114..118] client_seed length prefix + bytes ... (length-prefixed)
        // We only need current_step + is_active. is_active is after the seed_hash + client_seed + nonce.
        // Easiest: read difficulty (offset 80) and current_step (81). is_active is the next-to-last bool.
        const data = acc?.data;
        let currentStep = 0;
        let isActive = true;
        if (data && data.length > 81) {
            currentStep = data.readUInt8(81);
            // is_active is 2nd to last byte (cashed_out is last). Both are bool (1 byte).
            if (data.length >= 2) {
                isActive = data.readUInt8(data.length - 2) !== 0;
            }
        }

        res.json({ success: true, txSignature: sig, currentStep, isActive });
    } catch (error) {
        console.error("❌ Pumpit Process Error:", error);
        res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

app.post('/api/pumpit/cashout', async (req, res) => {
    try {
        const { playerPubkey, gamePubkey, finalMultiplierBps } = req.body || {};
        if (!playerPubkey || !gamePubkey || finalMultiplierBps === undefined) {
            return res.status(400).json({ success: false, error: "Missing playerPubkey, gamePubkey or finalMultiplierBps." });
        }

        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

        const sighash = crypto.createHash('sha256').update("global:cash_out_pump").digest().slice(0, 8);
        const multBuf = Buffer.alloc(8);
        multBuf.writeBigUInt64LE(BigInt(finalMultiplierBps));
        const ixData = Buffer.concat([sighash, multBuf]);

        const ix = buildHouseSendIx(PROGRAM_ID, ixData, [
            { pubkey: new anchor.web3.PublicKey(gamePubkey), isSigner: false, isWritable: true },
            { pubkey: new anchor.web3.PublicKey(playerPubkey), isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: true },
            { pubkey: houseKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
        ]);

        const sig = await houseSignAndSend(ix, "Pumpit cashout");
        activePumpitGames.delete(playerPubkey);

        res.json({ success: true, txSignature: sig });
    } catch (error) {
        console.error("❌ Pumpit Cashout Error:", error);
        res.status(500).json({ success: false, error: error.message || String(error) });
    }
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================

const PORT = process.env.PORT || 3005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 McPepe House Backend ARMORED and running on port ${PORT}. Waiting for wagers...`);
}).on('error', (err) => {
    console.error("❌ SERVER BIND ERROR:", err);
});