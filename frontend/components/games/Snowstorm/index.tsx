import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json'; 
import PixiGrid from './PixiGrid';

const PROGRAM_ID = new PublicKey(idl.metadata.address);
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function McPepeSnowstorm() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  
  const [betAmount, setBetAmount] = useState<number>(0.1);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [playData, setPlayData] = useState<any>(null);

  const handleSpin = async () => {
    if (!publicKey || !signTransaction) return alert("Connect Wallet!");
    setIsSpinning(true);
    setPlayData(null); // Clear previous grid

    try {
      // 1. Get PF Seeds from Server
      const initRes = await fetch(`${BACKEND_URL}/api/snowstorm/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerPublicKey: publicKey.toBase58(), betAmount })
      });
      
      const { serverSeedHash, unhashedServerSeed } = await initRes.json();

      // 2. Generate Client Seed & Nonce
      const clientSeed = Math.random().toString(36).substring(2, 15);
      const nonce = Math.floor(Math.random() * 100000);

      // 3. Start Escrow Transaction
      const lamports = betAmount * anchor.web3.LAMPORTS_PER_SOL;
      const [gameStatePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("snowstorm"), publicKey.toBuffer(), new anchor.BN(nonce).toArrayLike(Buffer, 'le', 8)],
        PROGRAM_ID
      );
      const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => txs } as any, {});
      const program = new anchor.Program(idl as any, PROGRAM_ID, provider);

      const tx = await program.methods.startSnowstorm(new anchor.BN(lamports), Array.from(Buffer.from(serverSeedHash, 'hex')), clientSeed, new anchor.BN(nonce))
        .accounts({
          player: publicKey,
          gameState: gameStatePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      const txSig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(txSig, 'confirmed');

      // 4. Resolve on Server
      const resolveRes = await fetch(`${BACKEND_URL}/api/snowstorm/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerPublicKey: publicKey.toBase58(),
          serverSeed: unhashedServerSeed, 
          clientSeed,
          nonce,
          betAmount: lamports
        })
      });
      
      const result = await resolveRes.json();
      setPlayData(result);

    } catch (err) {
      console.error(err);
      alert("Spin failed.");
      setIsSpinning(false);
    }
  };

  return (
    // 🔥 FIX 1: Changed from py-10 to py-4, and used justify-between to manage vertical space gracefully
    <div className="flex flex-col items-center justify-between bg-blue-950 min-h-screen py-4 w-full overflow-hidden">
      
      {/* 🔥 FIX 2: Reduced the bottom margin (mb-2) on the title to pull the slot up */}
      <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 drop-shadow-lg mb-2 uppercase tracking-widest text-center">
        McPepe Snowstorm
      </h1>
      
      {/* Slot Wrapper */}
      <div className="w-full max-w-5xl flex flex-col justify-center items-center px-4 relative z-0 shrink">
        
        {/* Relative container wrapping the canvas to anchor the absolute Win Text */}
        <div className="relative flex justify-center">
          <PixiGrid 
            playData={playData} 
            onAnimationComplete={() => setIsSpinning(false)} 
          />

          {/* 🔥 FIX 3: THE WINNER OVERLAY. Absolute positioned over the bottom edge of the canvas. 
              It no longer takes up any layout height, meaning the controls underneath are permanently pulled up! */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-full pointer-events-none flex justify-center z-20">
            {playData && playData.payout > 0 && !isSpinning && (
              <div className="text-4xl md:text-5xl text-green-400 font-black animate-pulse drop-shadow-[0_0_25px_rgba(74,222,128,1)] bg-black/70 px-10 py-2 rounded-full border-2 border-green-500 backdrop-blur-md whitespace-nowrap">
                WINNER: {(playData.payout / 1e9).toFixed(4)} SOL!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 🔥 FIX 4: Controls. Tighter padding, and safely locked above the bottom of the screen */}
      <div className="flex gap-4 items-center bg-blue-900/90 p-3 md:p-4 rounded-xl border-2 border-blue-500 mt-8 mb-2 z-10 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <span className="text-white font-bold text-xl">BET:</span>
        <input 
          type="number" 
          value={betAmount}
          onChange={(e) => setBetAmount(Number(e.target.value))}
          className="w-24 bg-blue-950 text-white rounded p-2 text-center font-bold outline-none border border-blue-700 focus:border-cyan-400 transition-colors"
          disabled={isSpinning}
          step="0.05"
          min="0.05"
        />
        <span className="text-white font-bold">SOL</span>

        <button 
          onClick={handleSpin}
          disabled={isSpinning}
          className={`ml-2 md:ml-4 px-8 md:px-12 py-3 md:py-4 rounded-lg font-black text-xl uppercase tracking-widest transition-all ${
            isSpinning 
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-blue-400 to-cyan-300 hover:from-blue-300 hover:to-cyan-200 text-blue-900 shadow-[0_0_20px_rgba(103,232,249,0.5)] hover:scale-105 active:scale-95'
          }`}
        >
          {isSpinning ? 'SPINNING...' : 'SPIN'}
        </button>
      </div>
    </div>
  );
}