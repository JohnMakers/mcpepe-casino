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
      // 🚨 FIX: Destructure BOTH the hash and the unhashed seed
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

      const provider = new anchor.AnchorProvider(connection, { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => txs } as any, {});      const program = new anchor.Program(idl as any, PROGRAM_ID, provider);

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
          serverSeed: unhashedServerSeed, // 🚨 FIX: Send the unhashed seed!
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
    <div className="flex flex-col items-center bg-blue-950 min-h-screen py-10">
      <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 drop-shadow-lg mb-8 uppercase tracking-widest">
        McPepe Snowstorm
      </h1>
      
      <div className="mb-6">
        <PixiGrid 
          playData={playData} 
          onAnimationComplete={() => setIsSpinning(false)} 
        />
      </div>

      {playData && playData.payout > 0 && !isSpinning && (
        <div className="text-3xl text-green-400 font-bold mb-4 animate-pulse">
          YOU WON {(playData.payout / 1e9).toFixed(4)} SOL!
        </div>
      )}

      <div className="flex gap-4 items-center bg-blue-900/50 p-4 rounded-xl border-2 border-blue-500">
        <span className="text-white font-bold text-xl">BET:</span>
        <input 
          type="number" 
          value={betAmount}
          onChange={(e) => setBetAmount(Number(e.target.value))}
          className="w-24 bg-blue-950 text-white rounded p-2 text-center font-bold"
          disabled={isSpinning}
          step="0.05"
        />
        <span className="text-white font-bold">SOL</span>

        <button 
          onClick={handleSpin}
          disabled={isSpinning}
          className={`ml-4 px-10 py-3 rounded-lg font-black uppercase tracking-widest transition-all ${
            isSpinning 
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-blue-400 to-cyan-300 hover:from-blue-300 hover:to-cyan-200 text-blue-900 shadow-[0_0_20px_rgba(103,232,249,0.5)]'
          }`}
        >
          {isSpinning ? 'BLIZZARD INCOMING...' : 'SPIN'}
        </button>
      </div>
    </div>
  );
}