require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, Transaction } = require('@solana/web3.js');
const crypto = require('crypto');
const anchor = require('@coral-xyz/anchor');

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

        const houseMove = Math.floor(Math.random() * 3) + 1; 
        const secretSalt = crypto.randomBytes(16);
        
        const preimage = Buffer.concat([Buffer.from([houseMove]), secretSalt]);
        const hashedCommitment = crypto.createHash('sha256').update(preimage).digest();

        const sighash = crypto.createHash('sha256').update("global:rps_resolve_hand").digest().slice(0, 8);
        
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

        // 🔥 THE FIX: Added RPS provably fair properties back here
        res.json({ 
            success: true, 
            resolveSignature, 
            houseMove,
            serverSeedHash: hashedCommitment.toString('hex'),
            serverSalt: secretSalt.toString('hex') 
        });

    } catch (error) {
        console.error("❌ RPS Resolve Error:", error);
        res.status(500).json({ success: false, error: error.message || JSON.stringify(error) });
    }
});

// ==========================================
// ROULETTE ENDPOINTS
// ==========================================
app.post('/api/roulette/seed', (req, res) => {
    try {
        const serverSeed = crypto.randomBytes(32).toString('hex');
        const serverSeedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
        
        // For Devnet testing we return the unhashed seed to the client so it can be verified.
        // In Mainnet, store serverSeed in a DB and ONLY return the Hash!
        res.json({ 
            success: true,
            serverSeedHash, 
            serverSeed 
        });
    } catch (error) {
        console.error("❌ Roulette Seed Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/roulette/resolve', async (req, res) => {
    try {
        const { playerPublicKey, serverSeed, gamePda } = req.body;
        
        if (!playerPublicKey || !serverSeed || !gamePda) {
            return res.status(400).json({ success: false, error: "Missing required parameters" });
        }

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
        res.json({ success: true, txSignature: resolveSignature });

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

app.post('/api/blackjack/init', (req, res) => {
    try {
        const { playerPubkey, gamePubkey, clientSeed, betAmount } = req.body;
        if (!playerPubkey || !gamePubkey) return res.status(400).json({ error: "Missing keys" });

        const game = activeBlackjackGames.get(playerPubkey);
        if (!game || game.status !== "waiting_for_tx") {
            return res.status(400).json({ error: "Game session not initialized. Fetch seed first." });
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
// Paytable Multipliers (Base: 1 Unit)
const PAYTABLE = {
    [PATRIOTS_SYMBOLS.GOLDEN_MCPEPE]: { 8: 10, 10: 25, 12: 50 },
    [PATRIOTS_SYMBOLS.PEPE_HEART]: { 8: 2.5, 10: 10, 12: 25 },
    [PATRIOTS_SYMBOLS.PURPLE_DIAMOND]: { 8: 2, 10: 5, 12: 15 },
    [PATRIOTS_SYMBOLS.BLUE_OVAL]: { 8: 1.5, 10: 2.5, 12: 12 },
    [PATRIOTS_SYMBOLS.GREEN_GEM]: { 8: 1, 10: 1.5, 12: 10 },
    [PATRIOTS_SYMBOLS.APPLE]: { 8: 0.8, 10: 1.2, 12: 8 },
    [PATRIOTS_SYMBOLS.MELON]: { 8: 0.5, 10: 1, 12: 5 },
    [PATRIOTS_SYMBOLS.GRAPE]: { 8: 0.4, 10: 0.9, 12: 4 },
    [PATRIOTS_SYMBOLS.BANANA]: { 8: 0.25, 10: 0.75, 12: 2 }
};

// Provably Fair RNG for individual symbols
function getDeterministicFloat(serverSeed, clientSeed, nonce, counter) {
    const hash = crypto.createHmac('sha256', serverSeed)
                       .update(`${clientSeed}:${nonce}:${counter}`)
                       .digest('hex');
    return parseInt(hash.substring(0, 8), 16) / 0xffffffff; 
}

function generateSymbol(randomFloat, isFreeSpins) {
    // Sweet Bonanza High-Volatility Math Profile (Sum = 1000 base)
    // Hit Frequency ~33%, Bonus Trigger ~1 in 180 spins
    const weights = [
        { symbol: PATRIOTS_SYMBOLS.BANANA, weight: 180 },       // 18% (P >= 8 is ~14%)
        { symbol: PATRIOTS_SYMBOLS.GRAPE, weight: 160 },        // 16% (P >= 8 is ~8.4%)
        { symbol: PATRIOTS_SYMBOLS.MELON, weight: 140 },        // 14% 
        { symbol: PATRIOTS_SYMBOLS.APPLE, weight: 130 },        // 13%
        { symbol: PATRIOTS_SYMBOLS.GREEN_GEM, weight: 120 },    // 12%
        { symbol: PATRIOTS_SYMBOLS.BLUE_OVAL, weight: 100 },    // 10%
        { symbol: PATRIOTS_SYMBOLS.PURPLE_DIAMOND, weight: 80 },// 8%
        { symbol: PATRIOTS_SYMBOLS.PEPE_HEART, weight: 55 },    // 5.5%
        { symbol: PATRIOTS_SYMBOLS.GOLDEN_MCPEPE, weight: 20 }, // 2% (Very Rare)
        { symbol: PATRIOTS_SYMBOLS.SCATTER, weight: 15 }        // 1.5% 
    ];

    if (isFreeSpins) {
        // Add a 3.5% chance for a multiplier bomb to drop during bonus rounds
        weights.push({ symbol: PATRIOTS_SYMBOLS.BOMB, weight: 35 });
    }

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let rand = randomFloat * totalWeight;

    for (let w of weights) {
        if (rand < w.weight) return w.symbol;
        rand -= w.weight;
    }
    return PATRIOTS_SYMBOLS.BANANA; // Fallback
}

function getBombMultiplier(randomFloat) {
    // True High-Volatility Distribution (Sum = 1000)
    const bombWeights = [
        { mult: 2, weight: 250 },   // 25% chance
        { mult: 3, weight: 200 },   // 20% chance
        { mult: 5, weight: 150 },   // 15% chance
        { mult: 8, weight: 120 },   // 12% chance
        { mult: 10, weight: 100 },  // 10% chance
        { mult: 15, weight: 60 },   // 6% chance
        { mult: 20, weight: 45 },   // 4.5% chance
        { mult: 25, weight: 45 },   // 4.5% chance
        { mult: 50, weight: 20 },   // 2% chance
        { mult: 100, weight: 10 }   // 1% chance (Rare Jackpot)
    ];
    
    let totalWeight = bombWeights.reduce((sum, w) => sum + w.weight, 0);
    let rand = randomFloat * totalWeight;
    
    for (let bw of bombWeights) {
        if (rand < bw.weight) return bw.mult;
        rand -= bw.weight;
    }
    return 2; // Fallback
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
    // Note: MCPEPE (Collector) is removed from the paytable because he will NOT drop in the base game anymore.
    [VACATION_SYMBOLS.PASSPORT_SCATTER]: { 3: 20, 4: 150, 5: 2000 } // Scatter pays directly as a multiplier of TOTAL bet
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
    [0,1,2,3,4,0,5,1,2,11,3,0,1,6,2,0,1,7,3,0,2,1,4,0,8,1,2,0,3,1,4,0,2,1,5,0,3,2,1,4,0,9,1,2,0,3,1,4,0,2,1,5,0,3,1,2,4,11],
    [1,0,2,4,3,1,0,5,1,2,0,3,1,0,6,2,1,0,7,3,1,2,0,4,1,8,0,2,1,3,0,4,1,2,0,5,1,3,2,0,4,1,9,0,2,1,3,0,4,1,2,0,11,1,3,0,2,4,6,11],
    [2,1,0,3,4,2,1,5,2,0,1,4,2,1,6,0,2,1,7,4,2,0,1,3,2,8,1,0,2,4,1,3,2,0,1,5,2,4,0,1,3,2,9,1,0,2,4,1,3,2,0,1,11,2,4,1,0,3,7,11],
    [3,2,1,0,4,3,2,5,3,1,0,4,3,2,0,1,3,2,6,4,3,1,0,2,3,7,2,1,3,4,0,2,3,1,0,8,3,4,1,0,2,3,9,0,1,3,4,0,2,3,1,0,11,3,4,0,1,2,8,11],
    [4,3,2,1,0,4,3,5,4,2,1,0,4,3,1,2,4,3,6,0,4,2,1,3,4,7,3,2,4,0,1,3,4,2,1,8,4,0,2,1,3,4,9,1,2,4,0,1,3,4,2,1,11,4,0,1,2,3,9,11]
];

// Free Spins Strips (Symbol 10 / McPepe is heavily injected to trigger collections)
const FS_VAC_REEL_STRIPS = [
    [0,1,2,3,4,10,5,1,2,11,3,10,1,6,2,10,1,7,3,0,2,1,4,10,8,1,2,0,3,1,4,10,2,1,5,0,3,2,1,4,10,9,1,2,0,3,1,4,10,2,1,10,0,3,1,2,4,11],
    [1,0,2,4,3,10,0,5,1,2,10,3,1,0,6,2,10,0,7,3,1,2,10,4,1,8,0,2,1,3,10,4,1,2,0,5,1,3,2,10,4,1,9,0,2,1,3,10,4,1,2,0,11,1,3,0,2,4,10,11],
    [2,1,0,3,4,10,1,5,2,0,10,4,2,1,6,0,10,1,7,4,2,0,10,3,2,8,1,0,2,4,10,3,2,0,1,5,2,4,10,1,3,2,9,1,0,2,4,10,3,2,0,1,11,2,4,1,0,3,10,11],
    [3,2,1,0,4,10,2,5,3,1,10,4,3,2,0,1,10,2,6,4,3,1,10,2,3,7,2,1,3,4,10,2,3,1,0,8,3,4,10,0,2,3,9,0,1,3,4,10,2,3,1,0,11,3,4,0,1,2,10,11],
    [4,3,2,1,0,10,3,5,4,2,10,0,4,3,1,2,10,3,6,0,4,2,10,3,4,7,3,2,4,0,10,3,4,2,1,8,4,0,10,1,3,4,9,1,2,4,10,1,3,4,2,1,11,4,0,1,2,3,10,11]
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
                let prizeMult = LUGGAGE_PRIZES[Math.floor(prizeFloat * LUGGAGE_PRIZES.length)];
                luggageValues.push({ col: c, row: r, val: prizeMult });
                totalLuggageMult += prizeMult;
            }
        }
    }

    // Scatter pays on TOTAL bet (lineBet * 10 lines)
    if (VAC_PAYTABLE[VACATION_SYMBOLS.PASSPORT_SCATTER][scatterCount]) {
        payout += (lineBet * 10) * VAC_PAYTABLE[VACATION_SYMBOLS.PASSPORT_SCATTER][scatterCount];
    }

    // 2. Evaluate 10 Standard Lines
    for (let i = 0; i < VAC_LINES.length; i++) {
        let line = VAC_LINES[i];
        let firstSym = -1;
        let count = 0;
        
        for (let col = 0; col < 5; col++) {
            let sym = grid[col][line[col]];
            if (sym === VACATION_SYMBOLS.PASSPORT_SCATTER) break; // Scatters break lines
            
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

        const totalWager = Number(betAmount);
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
            
            let totalSpinsAwarded = 10; 
            let currentSpinNum = 0;

            const totalBet = lineBet * 10;

            while (currentSpinNum < totalSpinsAwarded) {
                // Determine current multiplier tier
                let currentMultiplier = 1;
                if (currentSpinNum >= 30) currentMultiplier = 10;      // Level 4 
                else if (currentSpinNum >= 20) currentMultiplier = 3;  // Level 3 
                else if (currentSpinNum >= 10) currentMultiplier = 2;  // Level 2 

                // Spin using FS strips
                const { grid: fsGrid } = spinVacationReels(game.serverSeed, clientSeed, nonce, currentCounter, true, false);
                const fsEval = evaluateVacationGrid(fsGrid, lineBet, game.serverSeed, clientSeed, nonce, currentCounter);
                
                let spinPayout = fsEval.payout;
                let collectionWin = 0;

                // Execute the Collection Mechanic
                if (fsEval.mcpepeCount > 0 && fsEval.totalLuggageMult > 0) {
                    collectionWin = (totalBet * fsEval.totalLuggageMult) * fsEval.mcpepeCount * currentMultiplier;
                    spinPayout += collectionWin;
                }

                totalPayout += spinPayout;

                // Track Progress
                mcpepesCollected += fsEval.mcpepeCount;

                // Retrigger Logic
                if (mcpepesCollected >= 4 && totalSpinsAwarded === 10) totalSpinsAwarded = 20; 
                if (mcpepesCollected >= 8 && totalSpinsAwarded === 20) totalSpinsAwarded = 30; 
                if (mcpepesCollected >= 12 && totalSpinsAwarded === 30) totalSpinsAwarded = 40; 

                spinsData.push({
                    grid: fsGrid,
                    payout: spinPayout,
                    winningLines: fsEval.winningLines,
                    collectionWin: collectionWin,
                    mcpepeCount: fsEval.mcpepeCount,
                    luggageValues: fsEval.luggageValues,
                    activeMultiplier: currentMultiplier,
                    totalCollectedSoFar: mcpepesCollected
                });

                currentSpinNum++;
            }

            freeSpinsData = { 
                spins: spinsData, 
                totalSpinsPlayed: currentSpinNum,
                finalMcpepesCollected: mcpepesCollected 
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

setInterval(() => {}, 1000 * 60 * 60);

const PORT = process.env.PORT || 3005;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🟢 McPepe House Backend ARMORED and running on port ${PORT}. Waiting for wagers...`);
}).on('error', (err) => {
    console.error("❌ SERVER BIND ERROR:", err);
});