require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const crypto = require('crypto');
const anchor = require('@coral-xyz/anchor');

const idl = require('./idl.json'); 

// 🛡️ THE MASTER FIX: Forcefully inject missing properties into the IDL.
if (!idl.types) idl.types = [];

const PROGRAM_ID_STRING = "BNpcicNi55iYT6yfe2isgHnqqSWBtAr8qfiGwpKbxyuz";
const PROGRAM_ID = new anchor.web3.PublicKey(PROGRAM_ID_STRING);
idl.address = PROGRAM_ID_STRING;
if (!idl.metadata) idl.metadata = {};
idl.metadata.address = PROGRAM_ID_STRING;

// Catch the Silent Assassins
process.on('uncaughtException', (err) => console.error('FATAL CRASH (Exception):', err));
process.on('unhandledRejection', (err) => console.error('FATAL CRASH (Rejection):', err));

const app = express();

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

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
// COINFLIP ENDPOINT (NUCLEAR OPTION)
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

        // 1. Broadcast Wager
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

        // ☢️ THE NUCLEAR OPTION: Raw Binary Instruction Construction
        // We bypass Anchor entirely and manually build the instruction buffer
        
        // 1. Calculate the 8-byte discriminator for "global:resolve_coinflip"
        const sighash = crypto.createHash('sha256').update("global:resolve_coinflip").digest().slice(0, 8);
        
        // 2. Encode the unhashedServerSeed argument (String)
        const seedBuffer = Buffer.from(unhashedServerSeed, 'utf8');
        const seedLengthBuffer = Buffer.alloc(4);
        seedLengthBuffer.writeUInt32LE(seedBuffer.length, 0);
        
        // 3. Combine them into the instruction data
        const ixData = Buffer.concat([sighash, seedLengthBuffer, seedBuffer]);

        // 4. Construct the raw TransactionInstruction
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

        res.json({ success: true, playSignature, resolveSignature });
    } catch (error) {
        console.error("❌ Coinflip Error:", error);
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
            // Don't await the blockchain, let it process in the background
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
        // 🔥 FIRE AND FORGET: Instant UI feedback, blockchain resolves in the background!
        resolveWhackdOnChain(playerPubkey, game.serverSeed, game.revealedMask, true)
            .catch(err => console.error("On-chain cashout resolution failed:", err));
        
        res.json({ success: true, serverSeed: game.serverSeed });
    } catch (error) {
        console.error("❌ Cashout Error:", error);
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

// The House signs the transaction on Devnet
// The House signs the transaction on Devnet
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

        // ☢️ THE NUCLEAR OPTION: Raw Binary Instruction Construction
        // Bypassing Anchor's AccountResolver to prevent 500 crashes
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
// ROCK PAPER SCISSORS ENDPOINT
// ==========================================
app.post('/api/rps/resolve', async (req, res) => {
    try {
        const { playerPubkeyStr, gameStatePubkeyStr } = req.body;

        if (!playerPubkeyStr || !gameStatePubkeyStr) {
            return res.status(400).json({ success: false, error: "Missing keys." });
        }

        const playerPubkey = new anchor.web3.PublicKey(playerPubkeyStr);
        const gameStatePubkey = new anchor.web3.PublicKey(gameStatePubkeyStr);

        // 1. Generate House Cryptography
        // 1: Rock, 2: Paper, 3: Scissors
        const houseMove = Math.floor(Math.random() * 3) + 1; 
        const secretSalt = crypto.randomBytes(16);
        
        // Create Commitment Hash: sha256(house_move + salt)
        const preimage = Buffer.concat([Buffer.from([houseMove]), secretSalt]);
        const hashedCommitment = crypto.createHash('sha256').update(preimage).digest();

        // 2. Prepare Transaction using the Nuclear Option (Binary Bypass)
        const sighash = crypto.createHash('sha256').update("global:rps_resolve_hand").digest().slice(0, 8);
        
        // Encode arguments: house_move (u8), secret_salt ([u8; 16]), hashed_commitment ([u8; 32])
        const moveBuffer = Buffer.from([houseMove]);
        const ixData = Buffer.concat([sighash, moveBuffer, secretSalt, hashedCommitment]);

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

        res.json({ success: true, resolveSignature, houseMove });

    } catch (error) {
        console.error("❌ RPS Resolve Error:", error);
        res.status(500).json({ success: false, error: error.message || JSON.stringify(error) });
    }
});

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
