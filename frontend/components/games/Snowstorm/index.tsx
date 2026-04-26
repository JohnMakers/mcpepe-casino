import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json'; 
import PixiGrid from './PixiGrid';
import ProvablyFairModal from '../../modals/ProvablyFairModal';
import InfoModal from './InfoModal';

const PROGRAM_ID = new PublicKey(idl.metadata.address);
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function McPepeSnowstorm() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false)
  
  // 🔥 FIX 1: Upgraded to string-based input to handle decimals beautifully
  const [betInput, setBetInput] = useState<string>("0.1000");
  const betAmount = Number(betInput) || 0; 

  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [playData, setPlayData] = useState<any>(null);

  // 🔥 FIX 2: Provably Fair State Logic
  const [isPFOpen, setIsPFOpen] = useState<boolean>(false);
  const [pfData, setPfData] = useState({ hash: '', seed: '' });

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
      
      // 🔥 FIX 3: Store the exact seeds so the player can verify them
      setPfData({ hash: serverSeedHash, seed: unhashedServerSeed });

    } catch (err) {
      console.error(err);
      alert("Spin failed.");
      setIsSpinning(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-between bg-blue-950 min-h-screen py-4 w-full overflow-hidden">
      <InfoModal isOpen={isInfoOpen} onClose={() => setIsInfoOpen(false)} />

        {/* Header with Verify and Info */}
      <div className="w-full max-w-5xl flex justify-between items-center px-6 mb-2">
        <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 drop-shadow-lg uppercase tracking-widest text-left">
          McPepe Snowstorm
        </h1>
        <div className="flex gap-3">
           <button 
             onClick={() => setIsPFOpen(true)}
             className="bg-blue-900/40 hover:bg-blue-800/60 border border-blue-500/30 text-blue-300 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
           >
             Fair
           </button>
           <button 
             onClick={() => setIsInfoOpen(true)}
             className="bg-blue-900/40 hover:bg-blue-800/60 border border-blue-500/30 text-blue-300 w-10 h-10 rounded-full font-black text-lg flex items-center justify-center"
           >
             ?
           </button>
        </div>
      </div>
      
      {/* Slot Wrapper */}
      <div className="w-full max-w-5xl flex flex-col justify-center items-center px-4 relative z-0 shrink">
        <div className="relative flex justify-center">
          <PixiGrid 
            playData={playData} 
            onAnimationComplete={() => setIsSpinning(false)} 
          />

          {/* THE WINNER OVERLAY */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-full pointer-events-none flex justify-center z-20">
            {playData && playData.payout > 0 && !isSpinning && (
              <div className="text-4xl md:text-5xl text-green-400 font-black animate-pulse drop-shadow-[0_0_25px_rgba(74,222,128,1)] bg-black/70 px-10 py-2 rounded-full border-2 border-green-500 backdrop-blur-md whitespace-nowrap">
                WINNER: {(playData.payout / 1e9).toFixed(4)} SOL!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 🔥 FIX 4: Upgraded Multi-Component Action Bar */}
      <div className="flex flex-wrap md:flex-nowrap gap-4 items-center bg-blue-900/90 p-3 md:p-4 rounded-xl border-2 border-blue-500 mt-8 mb-2 z-10 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md justify-center">
        
        {/* Patriots-Style Bet Input Component (Theme-Matched) */}
        <div className="flex gap-4 items-center bg-blue-950 border border-blue-400/40 p-3 rounded-xl shrink-0">
          <div className="flex flex-col">
            <label className="text-xs text-blue-300 font-bold uppercase tracking-widest mb-1">Bet</label>
            <div className="flex items-center gap-2">
              
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 font-bold text-sm">◎</span>
                <input 
                  type="number" 
                  step="0.0001"
                  min="0.0001"
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
                    if (isNaN(val) || val < 0.0001) val = 0.0001;
                    setBetInput(val.toFixed(4));
                  }}
                  className="bg-blue-900/50 border-2 border-blue-500/50 rounded-lg py-2 pl-7 pr-2 text-white font-black w-32 focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(34,211,238,0.3)] focus:outline-none transition-all"
                  disabled={isSpinning}
                />
              </div>

              <button 
                onClick={() => setBetInput(prev => Math.max(0.0001, Number((Number(prev) / 2).toFixed(4))).toString())}
                disabled={isSpinning}
                className="bg-blue-800/50 hover:bg-blue-700 border border-blue-600/50 text-cyan-300 font-bold py-2 px-3 rounded-lg text-sm transition-all disabled:opacity-50"
              >
                1/2
              </button>
              <button 
                onClick={() => setBetInput(prev => (Number(prev) * 2).toFixed(4).toString())}
                disabled={isSpinning}
                className="bg-blue-800/50 hover:bg-blue-700 border border-blue-600/50 text-cyan-300 font-bold py-2 px-3 rounded-lg text-sm transition-all disabled:opacity-50"
              >
                2x
              </button>
            </div>
          </div>
        </div>

        {/* The Spin Button */}
        <button 
          onClick={handleSpin}
          disabled={isSpinning}
          className={`px-8 md:px-12 py-5 rounded-xl font-black text-2xl uppercase tracking-widest transition-all ${
            isSpinning 
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-blue-400 to-cyan-300 hover:from-blue-300 hover:to-cyan-200 text-blue-950 shadow-[0_0_20px_rgba(103,232,249,0.5)] hover:scale-105 active:scale-95'
          }`}
        >
          {isSpinning ? 'SPINNING...' : 'SPIN'}
        </button>

        {/* Provably Fair Trigger Button */}
        <button 
          onClick={() => setIsPFOpen(true)}
          className="flex flex-col items-center justify-center gap-1 text-blue-300 hover:text-white transition-colors text-xs font-bold uppercase tracking-widest bg-blue-950/50 h-[72px] px-4 rounded-xl border border-blue-500/30 hover:border-blue-400"
        >
          <svg className="w-6 h-6 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="hidden md:inline">Verify</span>
        </button>

      </div>

      {/* Render the Modal outside the normal flow */}
      <ProvablyFairModal 
        isOpen={isPFOpen} 
        onClose={() => setIsPFOpen(false)} 
        serverSeedHash={pfData.hash} 
        serverSeed={pfData.seed} 
      />

    </div>
  );
}