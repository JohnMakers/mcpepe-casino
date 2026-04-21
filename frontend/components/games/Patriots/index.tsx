import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json'; 
import PixiGrid from './PixiGrid';

const PROGRAM_ID = new PublicKey(idl.metadata.address);
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

export default function Patriots() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const [betAmount, setBetAmount] = useState<number>(0.1);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [gameResult, setGameResult] = useState<any>(null);

  const handleSpin = async (isBonusBuy: boolean = false) => {
    if (!publicKey || !signTransaction || !sendTransaction) {
      alert("Please connect your wallet first.");
      return;
    }

    try {
      setIsSpinning(true);
      setGameResult(null);
      setIsAnimating(false);

      // 1. Fetch VRF Seed from Backend
      const seedRes = await fetch(`${BACKEND_URL}/api/patriots/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerPubkey: publicKey.toBase58() })
      });
      const seedData = await seedRes.json();
      if (!seedData.success) throw new Error(seedData.error || "Failed to fetch seed");

      // 2. Generate Random Client Seed & Nonce
      const clientSeed = Math.random().toString(36).substring(2, 15);
      const nonce = Math.floor(Math.random() * 1000000);
      
      // Calculate 100x cost if buying the feature
      const totalWager = isBonusBuy ? betAmount * 100 : betAmount;
      const betLamports = totalWager * anchor.web3.LAMPORTS_PER_SOL;

      // 3. Prepare Smart Contract Transaction
      const serverSeedHashBuffer = Buffer.from(seedData.serverSeedHash, 'hex');
      const hashArray = Array.from(serverSeedHashBuffer);

      const [gameStatePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("patriots"),
          publicKey.toBuffer(),
          new anchor.BN(nonce).toArrayLike(Buffer, 'le', 8)
        ],
        PROGRAM_ID
      );

      const [vaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        PROGRAM_ID
      );

      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction } as any, { preflightCommitment: "confirmed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

      const tx = new Transaction().add(
        await program.methods.startPatriots(
          new anchor.BN(betLamports),
          hashArray,
          clientSeed,
          new anchor.BN(nonce)
        )
        .accounts({
          player: publicKey,
          gameState: gameStatePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
      );

      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = publicKey;

      // Native sendTransaction handles retries seamlessly
      const txId = await sendTransaction(tx, connection);

      await connection.confirmTransaction({
        signature: txId,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed');

      console.log("On-chain wager secured! Tx:", txId);

      // 4. Request the outcome and the math frames from the Backend Engine
      const playRes = await fetch(`${BACKEND_URL}/api/patriots/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerPubkey: publicKey.toBase58(),
          gamePubkey: gameStatePDA.toBase58(),
          clientSeed,
          nonce,
          betAmount: betLamports,
          isBonusBuy // Pass the flag to the backend
        })
      });

      const playData = await playRes.json();
      if (!playData.success) throw new Error(playData.error || "Backend engine failed");

      console.log("Received Math Frames:", playData);
      
      // 5. Trigger the Animation sequence
      setGameResult(playData);
      setIsAnimating(true);

    } catch (error: any) {
      console.error("Spin Error:", error);
      alert(error.message);
    } finally {
      setIsSpinning(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[#0a0f0c] p-6 relative">
      {/* Game Window Header */}
      <div className="absolute top-4 left-4">
        <h1 className="text-3xl font-black text-purple-400 uppercase tracking-widest drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]">
          McPepe's Patriots
        </h1>
        <p className="text-gray-500 text-sm font-bold tracking-widest">Pay Anywhere • Tumble Mechanism</p>
      </div>

      {/* The 6x5 Grid Area - NOW WITH TAILWIND BACKGROUND */}
      <div className="w-[800px] h-[600px] border-4 border-purple-900/50 bg-[url('/patriots/patriots_bg.png')] bg-cover bg-center bg-no-repeat rounded-xl mb-8 flex items-center justify-center relative overflow-hidden shadow-[0_0_30px_rgba(168,85,247,0.1)]">
        
        {/* Overlay to dim background while waiting for play so text is readable */}
        {!gameResult && (
          <div className="absolute inset-0 bg-black/60 z-0"></div>
        )}

        {!isSpinning && !gameResult && (
          <div className="text-purple-400 font-black text-2xl uppercase tracking-widest opacity-80 z-10">
            Waiting for Spin
          </div>
        )}
        
        {isSpinning && !gameResult && (
          <div className="text-purple-400 font-black text-2xl uppercase tracking-widest animate-pulse z-10">
            Escrowing Wager...
          </div>
        )}

        {gameResult && (
          <div className="absolute inset-0 z-10 w-full h-full">
            <PixiGrid 
              playData={gameResult} 
              onAnimationComplete={() => setIsAnimating(false)} 
            />
          </div>
        )}
      </div>

      {/* Control Panel */}
      <div className="flex gap-6 items-center bg-black border border-purple-900/30 p-4 rounded-xl">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-1">Base Bet (SOL)</label>
          <input 
            type="number" 
            step="0.05"
            value={betAmount}
            onChange={(e) => setBetAmount(Number(e.target.value))}
            className="bg-[#0a0f0c] border border-gray-800 rounded p-2 text-white font-bold w-32 focus:border-purple-500 focus:outline-none"
            disabled={isSpinning || isAnimating}
          />
        </div>

        {/* Normal Spin Button */}
        <button 
          onClick={() => handleSpin(false)}
          disabled={isSpinning || isAnimating}
          className={`px-12 py-4 rounded font-black text-xl uppercase tracking-widest transition-all ${
            (isSpinning || isAnimating)
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
              : 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)]'
          }`}
        >
          {isSpinning ? 'Escrowing...' : isAnimating ? 'Tumbling...' : 'Spin'}
        </button>

        {/* Buy Bonus Button */}
        <button 
          onClick={() => handleSpin(true)}
          disabled={isSpinning || isAnimating}
          className={`px-8 py-4 rounded font-black text-lg uppercase tracking-widest transition-all ${
            (isSpinning || isAnimating)
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
              : 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_20px_rgba(22,163,74,0.4)] hover:shadow-[0_0_30px_rgba(22,163,74,0.6)] border-2 border-green-400'
          }`}
        >
          Buy Feature ({Math.round(betAmount * 100 * 100) / 100} SOL)
        </button>
      </div>

      {/* Result Debugger */}
      {gameResult && !isAnimating && (
        <div className="mt-4 text-green-400 font-mono text-sm text-center">
          <p>Total Payout: {gameResult.payout / anchor.web3.LAMPORTS_PER_SOL} SOL</p>
          {gameResult.triggeredBonus && <p className="text-yellow-400 font-bold">🎉 FREE SPINS COMPLETED! 🎉</p>}
        </div>
      )}
    </div>
  );
}