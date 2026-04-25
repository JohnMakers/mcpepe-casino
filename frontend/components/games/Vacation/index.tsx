import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json'; 
import PixiReels from './PixiReels';

const PROGRAM_ID = new PublicKey(idl.metadata.address);
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

export default function Vacation() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  
  const [betInput, setBetInput] = useState<string>("0.1000"); 
  const betAmount = Number(betInput) || 0; 
  
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [gameResult, setGameResult] = useState<any>(null);

  // RESTORED: State to control our React overlay Modal
  const [bonusModal, setBonusModal] = useState<{ show: boolean, spins: number, resume: (() => void) | null }>({
    show: false, spins: 0, resume: null
  });

  const handleSpin = async (isBonusBuy: boolean = false) => {
    if (!publicKey || !signTransaction || !sendTransaction) {
      alert("Please connect your wallet first.");
      return;
    }
    
    if (betAmount < 0.0001) {
      alert("Minimum bet is 0.0001 SOL");
      return;
    }

    try {
      setIsSpinning(true);
      setGameResult(null);
      setIsAnimating(false);

      const seedRes = await fetch(`${BACKEND_URL}/api/vacation/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerPubkey: publicKey.toBase58() })
      });
      const seedData = await seedRes.json();
      if (!seedData.success) throw new Error(seedData.error || "Failed to fetch seed");

      const clientSeed = Math.random().toString(36).substring(2, 15);
      const nonce = Math.floor(Math.random() * 1000000);
      
      const totalWager = isBonusBuy ? betAmount * 100 : betAmount;
      const betLamports = Math.floor(totalWager * anchor.web3.LAMPORTS_PER_SOL);

      const serverSeedHashBuffer = Buffer.from(seedData.serverSeedHash, 'hex');
      const hashArray = Array.from(serverSeedHashBuffer);

      const [gameStatePDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("vacation"),
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
        await program.methods.startVacation(
          new anchor.BN(betLamports),
          hashArray,
          clientSeed,
          new anchor.BN(nonce),
          isBonusBuy 
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

      const playRes = await fetch(`${BACKEND_URL}/api/vacation/play`, {
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
    <div className="flex flex-col items-center justify-start min-h-screen w-full bg-[#0a0f0c] p-6 pb-20 relative overflow-y-auto">
      
      <div className="w-[960px] flex justify-between items-end mb-6 mt-4 shrink-0">
        <div className="flex flex-col text-left">
          <h1 className="text-4xl font-black text-cyan-500 uppercase tracking-widest drop-shadow-[0_0_15px_rgba(6,182,212,0.6)]">
            McPepe's Vacation
          </h1>
          <p className="text-gray-400 text-sm font-bold tracking-widest mt-2 uppercase">
            5x3 Reels • High Volatility • Pepe Collection
          </p>
        </div>
      </div>

      {/* PIXI CANVAS CONTAINER */}
      <div className="box-content w-[960px] h-[600px] border-4 border-cyan-800/60 rounded-xl mb-8 relative overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.2)] bg-[#050806] shrink-0">
        
        <div className="absolute inset-0 z-10">
          <PixiReels 
            playData={gameResult} 
            onAnimationComplete={() => setIsAnimating(false)} 
            // RESTORED: Pass the state setter into PixiReels
            onShowBonusModal={(spins, resume) => setBonusModal({ show: true, spins, resume })}
          />
        </div>

        {!isSpinning && !gameResult && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none bg-black/50">
            <span className="text-cyan-400 font-black text-2xl uppercase tracking-widest opacity-90 drop-shadow-lg">
              Waiting for Spin
            </span>
          </div>
        )}
        
        {isSpinning && !gameResult && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none bg-black/60">
            <span className="text-purple-400 font-black text-2xl uppercase tracking-widest animate-pulse drop-shadow-lg">
              Escrowing Wager...
            </span>
          </div>
        )}

        {/* RESTORED & STYLED: START BONUS MODAL */}
        {bonusModal.show && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300">
            <div className="relative flex flex-col items-center bg-[#0a0f0c] border-2 border-purple-500/60 p-6 rounded-3xl shadow-[0_0_80px_rgba(168,85,247,0.3)] animate-in zoom-in-95 duration-300">
              
              <div className="relative flex-shrink-0 mb-6">
                 {/* Image constrained cleanly inside the premium card */}
                 <img 
                    src="/vacations/vacation_freespin.png" 
                    alt="Free Spins Awarded" 
                    className="h-[280px] w-auto object-contain rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] border border-white/10" 
                 />
                 
                 {/* Dynamic text injected onto the PNG */}
                 <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center w-full">
                    <span 
                      className="text-white font-black text-6xl drop-shadow-[0_4px_4px_rgba(0,0,0,1)] tracking-tighter" 
                      style={{ WebkitTextStroke: '2px black' }}
                    >
                      {bonusModal.spins}
                    </span>
                    <span 
                      className="text-yellow-400 font-black text-xl uppercase tracking-widest drop-shadow-[0_2px_2px_rgba(0,0,0,1)]" 
                      style={{ WebkitTextStroke: '1px black' }}
                    >
                      Free Spins
                    </span>
                 </div>
              </div>

              {/* Continue Button */}
              <button
                onClick={() => {
                  if (bonusModal.resume) bonusModal.resume(); // Tells PIXI to unpause
                  setBonusModal({ show: false, spins: 0, resume: null });
                }}
                className="px-16 py-3 w-full bg-gradient-to-b from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 text-white font-black text-xl rounded-xl uppercase tracking-widest shadow-[0_0_30px_rgba(168,85,247,0.5)] border border-purple-400/50 transition-all transform hover:-translate-y-1 active:translate-y-1"
              >
                Start Bonus
              </button>
            </div>
          </div>
        )}

        {/* STYLED: END GAME SUMMARY MODAL */}
        {gameResult && !isAnimating && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-300">
            <div className="relative flex flex-col items-center bg-[#0a0f0c] border-2 border-purple-500/60 p-8 rounded-3xl shadow-[0_0_80px_rgba(168,85,247,0.3)] animate-in zoom-in-95 duration-300">
              
              <h2 className="text-3xl font-black text-purple-400 uppercase tracking-widest drop-shadow-[0_0_15px_rgba(192,132,252,0.6)] mb-6">
                 GAME FINISHED
              </h2>

              <div className="bg-[#050806] border-2 border-cyan-800/60 p-6 rounded-xl flex flex-col items-center gap-2 mb-8 shadow-[0_0_30px_rgba(6,182,212,0.2)] min-w-[250px]">
                <span className="text-gray-400 font-bold uppercase tracking-widest text-sm">Total Win</span>
                <span className="text-white font-black text-5xl tracking-tighter drop-shadow-[0_1px_5px_rgba(0,0,0,1)]">
                   {(gameResult.payout / anchor.web3.LAMPORTS_PER_SOL).toFixed(4)} SOL
                </span>
              </div>

              <button
                onClick={() => setGameResult(null)}
                className="px-16 py-3 w-full bg-gradient-to-b from-cyan-600 to-cyan-800 hover:from-cyan-500 hover:to-cyan-700 text-white font-black text-xl rounded-xl uppercase tracking-widest shadow-[0_0_20px_rgba(6,182,212,0.6)] border border-cyan-400/50 transition-all transform hover:-translate-y-1 active:translate-y-1"
              >
                Continue
              </button>

            </div>
          </div>
        )}
      </div>

      {/* CONTROL PANEL */}
      <div className="flex gap-6 items-center bg-black border border-cyan-900/40 p-4 rounded-xl shrink-0">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-1">Total Bet</label>
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm">◎</span>
              <input 
                type="number" 
                step="0.0001"
                min="0.0001"
                value={betInput}
                onChange={(e) => setBetInput(e.target.value.replace(/-/g, ''))}
                onBlur={() => {
                  let val = Number(betInput);
                  if (isNaN(val) || val < 0.0001) val = 0.0001;
                  setBetInput(val.toFixed(4));
                }}
                className="bg-[#0a0f0c] border-2 border-cyan-900/50 rounded-lg py-2 pl-7 pr-2 text-white font-black w-36 focus:border-cyan-500 focus:outline-none transition-all"
                disabled={isSpinning || isAnimating}
              />
            </div>
            <button 
              onClick={() => setBetInput(prev => Math.max(0.0001, Number((Number(prev) / 2).toFixed(4))).toString())}
              disabled={isSpinning || isAnimating}
              className="bg-cyan-900/30 hover:bg-cyan-800/50 border border-cyan-800/50 text-cyan-300 font-bold py-2 px-3 rounded-lg text-sm"
            >
              1/2
            </button>
            <button 
              onClick={() => setBetInput(prev => (Number(prev) * 2).toFixed(4).toString())}
              disabled={isSpinning || isAnimating}
              className="bg-cyan-900/30 hover:bg-cyan-800/50 border border-cyan-800/50 text-cyan-300 font-bold py-2 px-3 rounded-lg text-sm"
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
              : 'bg-cyan-700 hover:bg-cyan-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)]'
          }`}
        >
          {isSpinning ? 'Escrowing...' : isAnimating ? 'Spinning...' : 'Spin'}
        </button>

        <button 
          onClick={() => handleSpin(true)}
          disabled={isSpinning || isAnimating}
          className={`px-8 py-2.5 rounded font-black uppercase tracking-widest transition-all flex flex-col items-center justify-center ${
            (isSpinning || isAnimating)
              ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
              : 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(147,51,234,0.6)] border-2 border-purple-400'
          }`}
        >
          <span className="text-lg">Buy Bonus ({(betAmount * 100).toFixed(4)} SOL)</span>
          <span className="text-xs font-bold opacity-90 mt-0.5">(10 SPINS)</span>
        </button>
      </div>

      {gameResult && !isAnimating && (
        <div className="mt-4 text-cyan-400 font-mono text-sm text-center shrink-0">
          <p>Total Payout: {(gameResult.payout / anchor.web3.LAMPORTS_PER_SOL).toFixed(4)} SOL</p>
          {gameResult.triggeredBonus && <p className="text-purple-400 font-bold">🎉 VACATION BONUS COMPLETE! 🎉</p>}
        </div>
      )}
    </div>
  );
}