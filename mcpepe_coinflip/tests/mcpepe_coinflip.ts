import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { McpepeCoinflip } from "../target/types/mcpepe_coinflip";
import { expect } from "chai";
import * as crypto from "crypto"; // Native Node.js library for hashing

describe("mcpepe_coinflip", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.McpepeCoinflip as Program<McpepeCoinflip>;

  const gameStateKeypair = anchor.web3.Keypair.generate();
  const playerKeypair = anchor.web3.Keypair.generate();

  // The House's secret seed for this specific round
  const unhashedServerSeed = "mcafee_server_seed_super_secret_123";
  
  // We use Node's native crypto to hash it exactly like the Rust contract expects (SHA-256)
  const serverSeedHash = Uint8Array.from(
    crypto.createHash("sha256").update(unhashedServerSeed).digest()
  );

  it("Full Casino Flow: Init, Bet, and Provably Fair Resolution", async () => {
    // 0. Airdrop the player 2 SOL so they can gamble
    const signature = await provider.connection.requestAirdrop(
        playerKeypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);
    
    // 1. House Initializes the Game (Commit Phase)
    await program.methods
      .initializeGame(Array.from(serverSeedHash))
      .accounts({
        gameState: gameStateKeypair.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([gameStateKeypair])
      .rpc();

    // 2. Player Places a Bet (Lock Phase)
    const betAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const clientSeed = "mcafee_did_nothing_wrong_123";
    const guess = 1; // Betting on Tails

    await program.methods
        .playCoinflip(clientSeed, guess, betAmount)
        .accounts({
            gameState: gameStateKeypair.publicKey,
            player: playerKeypair.publicKey,
            authority: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([playerKeypair])
        .rpc();

    // 3. House Resolves the Bet (Reveal Phase)
    await program.methods
      .resolveCoinflip(unhashedServerSeed)
      .accounts({
        gameState: gameStateKeypair.publicKey,
        player: playerKeypair.publicKey,
        authority: provider.wallet.publicKey, // House pays the winnings from their wallet
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // 4. Ultimate Verification: The vault should be completely destroyed
    try {
      await program.account.gameState.fetch(gameStateKeypair.publicKey);
      expect.fail("The account should have been destroyed!");
    } catch (e) {
      // If fetching the account throws an error, it means our `close = authority` macro worked!
      expect(e.message).to.include("Account does not exist");
      console.log("✅ Game resolved, funds distributed, and vault cleanly destroyed!");
    }
  });
});