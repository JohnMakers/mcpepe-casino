import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json'; 
import PixiGrid from './PixiGrid';
import ProvablyFairModal from '../../modals/ProvablyFairModal';
import InfoModal from './InfoModal';

const PROGRAM_ID = new PublicKey(idl.metadata.address);
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

export default function Patriots() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  
  const [betInput, setBetInput] = useState<string>("0.10");
  const betAmount = Number(betInput) || 0; 
  
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [gameResult, setGameResult] = useState<any>(null);

  // ✨ Modal States & Trackers
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isPFOpen, setIsPFOpen] = useState<boolean>(false);
  const [pfData, setPfData] = useState({ hash: '', seed: '' });

  const handleSpin = async (isBonusBuy: boolean = false) => {
    if (!publicKey || !signTransaction || !sendTransaction) {
      alert("Please connect your wallet first.");
      return;
    }
    
    if (betAmount < 0.01) {
      alert("Minimum bet is 0.01 SOL");
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

      setPfData(prev => ({ ...prev, hash: seedData.serverSeedHash, seed: '' }));

      // 2. Generate Random Client Seed & Nonce
      const clientSeed = Math.random().toString(36).substring(2, 15);
      const nonce = Math.floor(Math.random() * 1000000);
      
      const totalWager = isBonusBuy ? betAmount * 100 : betAmount;
      
      // 🔥 CRITICAL FIX 1: Math.floor prevents JS floating point math from crashing the Solana Transaction Builder
      const betLamports = Math.floor(totalWager * anchor.web3.LAMPORTS_PER_SOL);

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
          isBonusBuy 
        })
      });

      const playData = await playRes.json();
      if (!playData.success) throw new Error(playData.error || "Backend engine failed");

      console.log("Received Math Frames:", playData);
      
      setPfData(prev => ({ ...prev, seed: playData.serverSeed }));
      setGameResult(playData);
      setIsAnimating(true);

    } catch (error: any) {
      console.error("Spin Error:", error);
      
      // 🔥 CRITICAL FIX 2: Intercept the simulation error so the user knows what went wrong
      if (error.message?.includes("WalletSendTransactionError")) {
         alert(`Transaction Rejected! ⚠️ If you are buying a Bonus, it costs 100x your base bet. Ensure your wallet has enough SOL to cover it, or try lowering your base bet to 0.01 SOL.`);
      } else {
         alert(error.message);
      }
    } finally {
      setIsSpinning(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-screen w-full bg-[#0a0f0c] p-6 pb-20 relative overflow-y-auto">
      
      <ProvablyFairModal 
        isOpen={isPFOpen} 
        onClose={() => setIsPFOpen(false)} 
        serverSeed={pfData.seed} 
        serverSeedHash={pfData.hash} 
      />
      
      <InfoModal 
        isOpen={isInfoOpen} 
        onClose={() => setIsInfoOpen(false)} 
      />

      {/* ✨ HEADER FIX: Placed inline with title block */}
      <div className="w-[800px] flex justify-between items-end mb-6 mt-4 shrink-0">
        <div className="flex flex-col text-left">
          <h1 className="text-4xl font-black text-red-500 uppercase tracking-widest drop-shadow-[0_0_15px_rgba(239,68,68,0.6)]">
            McPepe's Patriots
          </h1>
          <p className="text-gray-400 text-sm font-bold tracking-widest mt-2 uppercase">
            Pay Anywhere • Liberty Mechanism (Tumble)
          </p>
        </div>
        
        {/* Buttons for Modals */}
        <div className="flex items-center gap-3 pb-1">
          <button 
            onClick={() => setIsPFOpen(true)} 
            className="flex items-center gap-2 bg-[#0d1310] hover:bg-green-900/30 border border-green-800/50 text-green-400 px-4 py-2 rounded-lg text-xs font-bold tracking-widest transition-all"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            FAIR
          </button>
          <button 
            onClick={() => setIsInfoOpen(true)} 
            className="flex items-center justify-center bg-[#0d1310] hover:bg-blue-900/30 border border-blue-800/50 text-blue-400 w-10 h-10 rounded-full font-black text-lg transition-all"
          >
            ?
          </button>
        </div>
      </div>

      <div className="box-content w-[800px] h-[600px] border-4 border-blue-800/60 rounded-xl mb-8 relative overflow-hidden shadow-[0_0_30px_rgba(220,38,38,0.2)] bg-[#0a0f0c] shrink-0">

        <div 
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: "url('/patriots/patriots_bg.png')",
            backgroundSize: "102% 102%",
            backgroundPosition: "top left",
            backgroundRepeat: "no-repeat"
          }}
        />

        {!gameResult && (
          <div className="absolute inset-0 bg-black/60 z-10 pointer-events-none"></div>
        )}

        {!isSpinning && !gameResult && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <span className="text-blue-400 font-black text-2xl uppercase tracking-widest opacity-80 drop-shadow-lg">
              Waiting for Spin
            </span>
          </div>
        )}
        
        {isSpinning && !gameResult && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <span className="text-red-400 font-black text-2xl uppercase tracking-widest animate-pulse drop-shadow-lg">
              Escrowing Wager...
            </span>
          </div>
        )}

        {gameResult && (
          <div className="absolute inset-0 z-30">
            <PixiGrid 
              playData={gameResult} 
              onAnimationComplete={() => setIsAnimating(false)} 
            />
          </div>
        )}
      </div>

      <div className="flex gap-6 items-center bg-black border border-blue-900/40 p-4 rounded-xl shrink-0">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-1">Bet</label>
          <div className="flex items-center gap-2">
            
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">◎</span>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={betInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/-/g, ''); 
                  setBetInput(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === '-' || e.key === 'e') {
                    e.preventDefault();
                  }
                }}
                onBlur={() => {
                  let val = Number(betInput);
                  if (isNaN(val) || val < 0.01) val = 0.01;
                  setBetInput(val.toFixed(2));
                }}
                className="bg-[#0a0f0c] border-2 border-blue-900/50 rounded-lg py-2 pl-7 pr-2 text-white font-black w-36 focus:border-blue-500 focus:shadow-[0_0_15px_rgba(59,130,246,0.3)] focus:outline-none transition-all"
                disabled={isSpinning || isAnimating}
              />
            </div>

            <button 
              onClick={() => setBetInput(prev => Math.max(0.01, Number((Number(prev) / 2).toFixed(2))).toString())}
              disabled={isSpinning || isAnimating}
              className="bg-blue-900/30 hover:bg-blue-800/50 border border-blue-800/50 text-blue-300 font-bold py-2 px-3 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              1/2
            </button>
            <button 
              onClick={() => setBetInput(prev => (Number(prev) * 2).toFixed(2).toString())}
              disabled={isSpinning || isAnimating}
              className="bg-blue-900/30 hover:bg-blue-800/50 border border-blue-800/50 text-blue-300 font-bold py-2 px-3 rounded-lg text-sm transition-all disabled:opacity-50"
            >
              2x
            </button>
          </div>
        </div>

        <button 
          onClick={() => handleSpin(false)}
          disabled={isSpinning || isAnimating}
          className={`px-12 py-4 rounded font-black text-xl uppercase tracking-widest transition-all ${
            (isSpinning || isAnimating)
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
              : 'bg-blue-700 hover:bg-blue-600 text-white shadow-[0_0_20px_rgba(29,78,216,0.4)] hover:shadow-[0_0_30px_rgba(29,78,216,0.6)]'
          }`}
        >
          {isSpinning ? 'Escrowing...' : isAnimating ? 'Tumbling...' : 'Single Spin'}
        </button>

        <button 
          onClick={() => handleSpin(true)}
          disabled={isSpinning || isAnimating}
          className={`px-8 py-2.5 rounded font-black uppercase tracking-widest transition-all flex flex-col items-center justify-center ${
            (isSpinning || isAnimating)
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
              : 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_20px_rgba(22,163,74,0.4)] hover:shadow-[0_0_30px_rgba(22,163,74,0.6)] border-2 border-green-400'
          }`}
        >
          <span className="text-lg">Buy Bonus ({Math.round(betAmount * 100 * 100) / 100} SOL)</span>
          <span className="text-xs font-bold opacity-90 mt-0.5">(10 SPINS)</span>
        </button>
      </div>

    </div>
  );
}