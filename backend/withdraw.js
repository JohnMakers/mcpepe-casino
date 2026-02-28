require('dotenv').config();
const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const fs = require('fs');

async function withdrawProfits() {
    // 1. Setup Connection (Change to Devnet when you migrate)
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // 2. Load the House Authority (Casino Manager)
    const secretArray = process.env.HOUSE_PRIVATE_KEY.split(',').map(Number);
    const houseKeypair = Keypair.fromSecretKey(Uint8Array.from(secretArray));
    const wallet = new anchor.Wallet(houseKeypair);
    
    const provider = new anchor.AnchorProvider(connection, wallet, { preflightCommitment: "processed" });
    anchor.setProvider(provider);

    // 3. Load the Smart Contract
    const programId = new PublicKey("DivrQ6eS3ekgJPudaTTLky1Ca3eNDv9Pb3qkNva5ytXr");
    // Path to your IDL (adjust if your idl.json is in a different spot)
    const idl = JSON.parse(fs.readFileSync('../frontend/idl.json', 'utf8'));
    const program = new anchor.Program(idl, programId, provider);

    // 4. Find the Vault PDA
    const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);

    // 5. Amount to Withdraw (e.g., 1 SOL = 1,000,000,000 lamports)
    // Change this number to withdraw different amounts
    const withdrawAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL); 

    console.log(`🏦 Attempting to withdraw 1 SOL from Vault: ${vaultPDA.toBase58()}`);

    try {
        const tx = await program.methods
            .withdrawProfits(withdrawAmount)
            .accounts({
                vault: vaultPDA,
                authority: houseKeypair.publicKey,
            })
            .signers([houseKeypair])
            .rpc();

        console.log("✅ Withdrawal Successful! Transaction Signature:", tx);
        console.log(`💰 The SOL is now in your House Authority wallet: ${houseKeypair.publicKey.toBase58()}`);
        console.log(`To send it to Phantom, run: solana transfer <YOUR_PHANTOM_ADDRESS> 1 --from <PATH_TO_HOUSE_KEYPAIR.JSON> --url localhost`);
    } catch (error) {
        console.error("❌ Withdrawal Failed:", error);
    }
}

withdrawProfits();