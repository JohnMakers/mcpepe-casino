require('dotenv').config();
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Your program ID
const PROGRAM_ID = new PublicKey("9ea7HNWLSgeNfbo9bYN3EcnstJEmjZF7FPECz58RMx57");

async function main() {
    // 1. Establish connection and load House Keypair
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    
    if (!process.env.HOUSE_PRIVATE_KEY) throw new Error("Missing HOUSE_PRIVATE_KEY in .env");
    const secretArray = process.env.HOUSE_PRIVATE_KEY.split(',').map(Number);
    const houseKeypair = Keypair.fromSecretKey(Uint8Array.from(secretArray));

    // 2. Derive the Vault PDA
    const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
    console.log("🏦 House Pubkey:", houseKeypair.publicKey.toBase58());
    console.log("🏦 Vault PDA Address:", vaultPDA.toBase58());

    // 3. Transfer 5 SOL to the Vault (Ensure your House Wallet has Devnet SOL first!)
    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: houseKeypair.publicKey,
            toPubkey: vaultPDA,
            lamports: 5 * LAMPORTS_PER_SOL // 5 SOL
        })
    );

    console.log("Funding Vault PDA with 5 SOL...");
    try {
        const sig = await sendAndConfirmTransaction(connection, tx, [houseKeypair]);
        console.log("✅ Vault funded successfully! Signature:", sig);
    } catch (err) {
        console.error("❌ Funding failed. Make sure your House Wallet has enough Devnet SOL.", err);
    }
}

main();