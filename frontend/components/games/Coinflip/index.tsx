import React, { useState } from 'react';
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
// @ts-ignore
import idl from "../../../idl.json";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
const PROGRAM_ID = new anchor.web3.PublicKey("9ea7HNWLSgeNfbo9bYN3EcnstJEmjZF7FPECz58RMx57");
const HOUSE_PUBKEY = new anchor.web3.PublicKey("Gf9QEwbxosqQY9bLBrgjKommtX8qPdNqFrKazmHfaZBv");

interface Props {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  logWager: (game: string, wager: number, win: boolean, payout: number, hash: string, seed: string) => void;
  setShowProvablyFair: (val: boolean) => void;
}

export default function CoinflipGame({ balance, setBalance, logWager, setShowProvablyFair }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;

  const [betAmount, setBetAmount] = useState<string>("0.1");
  const [guess, setGuess] = useState<"heads" | "tails">("heads");
  const [flipState, setFlipState] = useState<"idle" | "flipping" | "resolved">("idle");
  const [result, setResult] = useState<{ win: boolean; amount: string; side: "heads" | "tails" } | null>(null);
  const [coinDegrees, setCoinDegrees] = useState(0);

  const multiplyBet = (factor: number) => {
    const current = parseFloat(betAmount) || 0;
    setBetAmount((current * factor).toFixed(2));
  };

  const handleFlip = async () => {
    if (!publicKey || !wallet.signTransaction) return alert("Wallet not connected properly.");
    const wager = parseFloat(betAmount);
    if (wager > balance) return alert("Insufficient funds.");

    setFlipState("flipping");
    setResult(null);
    setBalance(prev => prev - wager); 

    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

      const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
      const gameStateKeypair = anchor.web3.Keypair.generate();
      
      const unhashedServerSeed = "mcafee_server_seed_" + Date.now().toString();
      const clientSeed = "degen_client_seed_" + Math.random().toString(36).substring(7);
      const guessNum = guess === "heads" ? 0 : 1;
      const wagerLamports = new anchor.BN(wager * LAMPORTS_PER_SOL);

      const encoder = new TextEncoder();
      const serverSeedData = encoder.encode(unhashedServerSeed);
      const hashBuffer = await crypto.subtle.digest('SHA-256', serverSeedData as any);
      const serverSeedHash = Array.from(new Uint8Array(hashBuffer));

      const combinedData = encoder.encode(unhashedServerSeed + clientSeed);
      const outcomeBuffer = await crypto.subtle.digest('SHA-256', combinedData as any);
      const outcomeHash = new Uint8Array(outcomeBuffer);
      const winningResult = outcomeHash[0] % 2; 
      const isWin = winningResult === guessNum;
      const winningSide = winningResult === 0 ? "heads" : "tails";

      // 🛡️ THE FIX: Build the instructions and properly sign the Wager
      const initIx = await program.methods.initializeGame(serverSeedHash).accounts({
          gameState: gameStateKeypair.publicKey,
          authority: HOUSE_PUBKEY, 
          systemProgram: anchor.web3.SystemProgram.programId,
      }).instruction();

      const playIx = await program.methods.playCoinflip(clientSeed, guessNum, wagerLamports).accounts({
          gameState: gameStateKeypair.publicKey,
          player: publicKey, 
          vault: vaultPDA,
          authority: HOUSE_PUBKEY, 
          systemProgram: anchor.web3.SystemProgram.programId,
      }).instruction();

      // Combine into a single transaction for the wager
      const tx = new anchor.web3.Transaction().add(initIx, playIx);
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = publicKey;
      
      // Request player signature via Phantom
      const signedTx = await wallet.signTransaction(tx);
      // Automatically sign with the ephemeral game state keypair
      signedTx.partialSign(gameStateKeypair);

      // Serialize and safely convert to Base64 string so it survives the HTTP trip
      const serializedTx = signedTx.serialize({ requireAllSignatures: false });
      const base64Tx = Buffer.from(serializedTx).toString('base64');
      
      // Blast it to the Armored Backend
      const backendResponse = await fetch(`${BACKEND_URL}/api/play-coinflip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              transactionBuffer: base64Tx,
              clientSeed: clientSeed,
              unhashedServerSeed: unhashedServerSeed,
              gameStatePubkey: gameStateKeypair.publicKey.toBase58(),
              playerPubkey: publicKey.toBase58()
          })
      });

      const backendData = await backendResponse.json();
      if (!backendData.success) throw new Error(backendData.error);
      
      const baseSpins = 1800; 
      const extraTurn = winningSide === "tails" ? 180 : 0; 
      setCoinDegrees(prev => prev + baseSpins + extraTurn + (prev % 360 !== 0 ? 180 : 0));

      setTimeout(() => {
        setFlipState("resolved");
        const payout = isWin ? wager * 1.98 : 0; 
        const profit = isWin ? payout - wager : wager; 
        
        setResult({ win: isWin, amount: profit.toFixed(4), side: winningSide });
        if (isWin) setBalance(prev => prev + payout);
        
        logWager("Coinflip", wager, isWin, payout, backendData.signature, clientSeed);
      }, 3000);

    } catch (error) {
      console.error("Transaction Failed:", error);
      alert("Transaction failed or rejected. Check the console.");
      setBalance(prev => prev + wager); 
      setFlipState("idle");
    }
  };

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full animate-fade-in">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-black text-white uppercase tracking-tight">DEGEN COINFLIP</h2>
        <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-2 py-1 rounded border border-green-900/50 transition-colors">
          🛡️ Provably Fair
        </button>
      </div>

        {/* 1. Flexbox Centering Container */}
        <div className="h-56 w-full flex items-center justify-center mb-6 relative z-10">
          
          {/* 2. 3D Perspective Isolation Wrapper */}
          <div className="relative w-40 h-40 shrink-0 [perspective:1000px]">
            
            {/* 3. The Rotating Coin */}
            <div 
              className="absolute inset-0 w-full h-full transition-transform duration-[3000ms] ease-out [transform-style:preserve-3d]" 
              style={{ transform: `rotateY(${coinDegrees}deg)` }}
            >
              
              {/* HEADS SIDE */}
              <div 
                className="absolute inset-0 w-full h-full bg-[#0a0f0c] rounded-full overflow-hidden [backface-visibility:hidden] [-webkit-backface-visibility:hidden]" 
                style={{ transform: 'rotateY(0deg)' }}
              >
                <img src="/cf_head.png" alt="Heads" className="w-full h-full object-cover" />
              </div>
              
              {/* TAILS SIDE */}
              <div 
                className="absolute inset-0 w-full h-full bg-[#0a0f0c] rounded-full overflow-hidden [backface-visibility:hidden] [-webkit-backface-visibility:hidden]" 
                style={{ transform: 'rotateY(180deg)' }}
              >
                <img src="/cf_tail.png" alt="Tails" className="w-full h-full object-cover" />
              </div>

            </div>
          </div>
        </div>

        <div className="h-24 w-full mb-6 flex items-center justify-center">
          {flipState === "resolved" && result && (
            <div className={`px-10 py-4 rounded-xl border-2 animate-bounce-short shadow-2xl ${result.win ? 'bg-green-900/30 border-green-500 text-green-400' : 'bg-red-900/30 border-red-500 text-red-400'}`}>
              <h3 className="text-3xl font-black uppercase tracking-widest text-center">{result.win ? 'Victorious' : 'Rekt'}</h3>
              <p className="text-center font-mono mt-2 text-lg">{result.side.toUpperCase()} • {result.win ? '+' : '-'}{result.amount} SOL</p>
            </div>
          )}
          {flipState === "flipping" && (
            <div className="text-green-500 font-mono animate-pulse flex flex-col items-center bg-green-900/10 px-8 py-4 rounded-xl border border-green-900/30">
              <span className="text-xl font-bold">Awaiting On-Chain Execution...</span>
            </div>
          )}
        </div>

        {/* ADDED mx-auto to center controls below the coin */}
        <div className="w-full max-w-md space-y-5 mx-auto">
           <div className="flex gap-4">
            <button onClick={() => setGuess("heads")} className={`flex-1 py-4 rounded-xl font-black uppercase transition-all border-2 ${guess === 'heads' ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500' : 'border-gray-800'}`}>Heads</button>
            <button onClick={() => setGuess("tails")} className={`flex-1 py-4 rounded-xl font-black uppercase transition-all border-2 ${guess === 'tails' ? 'border-gray-400 bg-gray-400/10 text-gray-300' : 'border-gray-800'}`}>Tails</button>
          </div>

          <div className="bg-black border-2 border-gray-800 rounded-xl p-1 flex focus-within:border-green-500">
            <input type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} className="w-full bg-transparent p-3 text-2xl font-mono text-white outline-none pl-4" />
            <div className="flex gap-1 pr-2 items-center">
              <button onClick={() => multiplyBet(0.5)} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded">1/2</button>
              <button onClick={() => multiplyBet(2)} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded">2x</button>
              <button onClick={() => setBetAmount(balance.toFixed(2))} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-green-500 text-xs font-bold rounded">MAX</button>
            </div>
          </div>
          <button onClick={handleFlip} disabled={flipState === "flipping" || !publicKey} className="w-full py-5 bg-green-500 hover:bg-green-400 text-black font-black text-2xl uppercase tracking-widest rounded-xl disabled:opacity-50">Flip</button>
        </div>
      </div>
  );
}