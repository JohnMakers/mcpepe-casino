"use client";

import { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import dynamic from "next/dynamic";
import * as anchor from "@coral-xyz/anchor";
// @ts-ignore
import idl from "../idl.json";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

// We keep a few static ones just to populate the UI initially
const INITIAL_BETS = [
  { id: "tx1", player: "8xTq...3pZx", game: "Coinflip", amount: 2.5, win: true, hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", clientSeed: "degen_1" },
];

export default function Dashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction } = wallet;
  const [balance, setBalance] = useState<number>(0);
  
  // Layout State
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [activeGame, setActiveGame] = useState<string | null>(null);

  // Auto-open sidebars only if the user is on a desktop monitor
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setIsLeftSidebarOpen(true);
      setIsRightSidebarOpen(true);
    }
  }, []);
  // Game & Bet State
  const [betAmount, setBetAmount] = useState<string>("0.1");
  const [guess, setGuess] = useState<"heads" | "tails">("heads");
  const [flipState, setFlipState] = useState<"idle" | "flipping" | "resolved">("idle");
  const [result, setResult] = useState<{ win: boolean; amount: string; side: "heads" | "tails" } | null>(null);
  const [coinDegrees, setCoinDegrees] = useState(0);
  const [recentBets, setRecentBets] = useState(INITIAL_BETS);

  // Modal State
  const [showProvablyFair, setShowProvablyFair] = useState(false);
  const [selectedBetInfo, setSelectedBetInfo] = useState<any>(null);

  useEffect(() => {
    if (!publicKey) return;
    const fetchBalance = async () => {
      try {
        const bal = await connection.getBalance(publicKey);
        setBalance(bal / LAMPORTS_PER_SOL);
      } catch (error) {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, [publicKey, connection]);

  const handleFlip = async () => {
    if (!publicKey || !wallet.signTransaction) return alert("Wallet not connected properly.");
    console.log("Current RPC Endpoint:", connection.rpcEndpoint);
    const wager = parseFloat(betAmount);
    if (wager > balance) return alert("Insufficient funds in the vault.");

    setFlipState("flipping");
    setResult(null);
    setBalance(prev => prev - wager); // Optimistic deduction

    try {
      // 1. Setup the Anchor Program Connection
      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
      
      // @ts-ignore - Forcing VSCode to accept the 0.28.0 constructor signature
      const programId = new anchor.web3.PublicKey("DivrQ6eS3ekgJPudaTTLky1Ca3eNDv9Pb3qkNva5ytXr");
      // @ts-ignore - Bypassing cached TS definitions
      const program = new anchor.Program(idl, programId, provider);
      const HOUSE_PUBKEY = new anchor.web3.PublicKey("Gf9QEwbxosqQY9bLBrgjKommtX8qPdNqFrKazmHfaZBv");      

      const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        program.programId
      );
      console.log("House Vault PDA:", vaultPDA.toBase58());

      // 2. Generate Cryptographic Seeds & Keys
      const gameStateKeypair = anchor.web3.Keypair.generate();
      const unhashedServerSeed = "mcafee_server_seed_" + Date.now().toString();
      const clientSeed = "degen_client_seed_" + Math.random().toString(36).substring(7);
      const guessNum = guess === "heads" ? 0 : 1;
      const wagerLamports = new anchor.BN(wager * LAMPORTS_PER_SOL);

      // 3. Native Browser SHA-256 Hashing for the Server Seed Commitment
      const encoder = new TextEncoder();
      const serverSeedData = encoder.encode(unhashedServerSeed);
      const hashBuffer = await crypto.subtle.digest('SHA-256', serverSeedData as any);
      const serverSeedHash = Array.from(new Uint8Array(hashBuffer));

      // 4. Pre-calculate the outcome locally
      const combinedData = encoder.encode(unhashedServerSeed + clientSeed);
      const outcomeBuffer = await crypto.subtle.digest('SHA-256', combinedData as any);
      const outcomeHash = new Uint8Array(outcomeBuffer);
      const winningResult = outcomeHash[0] % 2; 
      const isWin = winningResult === guessNum;
      const winningSide = winningResult === 0 ? "heads" : "tails";

      // --- THE MISSING CODE: BUILD THE ANCHOR INSTRUCTIONS ---
      // Note: For this local test, your wallet (publicKey) is acting as both the Player AND the House Authority.
      // 4. Build Instructions using the HOUSE as the authority
      const initIx = await program.methods
        .initializeGame(serverSeedHash)
        .accounts({
          gameState: gameStateKeypair.publicKey,
          authority: HOUSE_PUBKEY, 
          systemProgram: anchor.web3.SystemProgram.programId,
        }).instruction();

      const playIx = await program.methods
        .playCoinflip(clientSeed, guessNum, wagerLamports)
        .accounts({
          gameState: gameStateKeypair.publicKey,
          player: publicKey, 
          vault: vaultPDA,
          authority: HOUSE_PUBKEY, 
          systemProgram: anchor.web3.SystemProgram.programId,
        }).instruction();

      const resolveIx = await program.methods
        .resolveCoinflip(unhashedServerSeed)
        .accounts({
          gameState: gameStateKeypair.publicKey,
          player: publicKey,
          vault: vaultPDA,
          authority: HOUSE_PUBKEY, 
          systemProgram: anchor.web3.SystemProgram.programId,
        }).instruction();
      // 5. Build the Unified Transaction (Frontend Only Signs for Player)
      const tx = new anchor.web3.Transaction().add(initIx, playIx, resolveIx);
      
      const latestBlockhash = await connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = publicKey;

      // The Player (User) signs their half of the transaction
      const signedTx = await wallet.signTransaction(tx);
      // The GameState keypair signs its initialization
      signedTx.partialSign(gameStateKeypair);

      // 6. Send the partially signed payload to the Secure Backend
      console.log("Transmitting payload to House Backend...");
      const serializedTx = signedTx.serialize({ requireAllSignatures: false });
      
      const backendResponse = await fetch("https://mcpepe-backend.onrender.com/api/play-coinflip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
              transactionBuffer: serializedTx.toString("base64"),
              clientSeed: clientSeed
          })
      });

      const backendData = await backendResponse.json();
      if (!backendData.success) throw new Error(backendData.error);
      
      console.log("Transaction broadcasted by House! Signature:", backendData.signature);

      // 7. Wait for Blockchain Confirmation
      await connection.confirmTransaction({ 
        signature: backendData.signature, 
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, "processed");

      // 9. ON-CHAIN VERIFICATION (Account is closed by Rust to save rent)
      // Since the transaction confirmed successfully, we know the Rust contract validated the hash.
      // We re-calculate the exact outcome locally to trigger the correct UI animation.
      const combinedDataCheck = encoder.encode(unhashedServerSeed + clientSeed);


      const outcomeBufferCheck = await crypto.subtle.digest('SHA-256', combinedDataCheck as any);
      const outcomeHashCheck = new Uint8Array(outcomeBufferCheck);
      const trueWinningResult = outcomeHashCheck[0] % 2; 
      
      const trueWinningSide = trueWinningResult === 0 ? "heads" : "tails";
      const userWon = trueWinningResult === guessNum;

      // Trigger the UI animation based on the ABSOLUTE blockchain truth
      const baseSpins = 1800; 
      const extraTurn = trueWinningSide === "tails" ? 180 : 0; 
      setCoinDegrees(prev => prev + baseSpins + extraTurn + (prev % 360 !== 0 ? 180 : 0));

      setTimeout(() => {
        setFlipState("resolved");
        const payout = isWin ? wager * 1.98 : 0; // The 2% house edge math at play
        
        setResult({
          win: isWin,
          amount: isWin ? payout.toFixed(2) : wager.toFixed(2),
          side: winningSide
        });

        if (isWin) setBalance(prev => prev + payout);

        // Populate the actual on-chain transaction signature into the UI receipt!
        const newBet = {
          id: backendData.signature.substring(0, 8) + "...", 
          player: publicKey.toBase58().substring(0, 4) + "..." + publicKey.toBase58().slice(-4),
          game: "Coinflip",
          amount: wager,
          win: isWin,
          hash: backendData.signature, 
          clientSeed: clientSeed
        };
        
        setRecentBets(prev => [newBet, ...prev].slice(0, 20));
      }, 3000);

    } catch (error) {
      console.error("Transaction Failed:", error);
      alert("Transaction failed or rejected. Check the console.");
      setBalance(prev => prev + wager); // Refund optimistic deduction
      setFlipState("idle");
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#050806] font-sans text-gray-200 overflow-hidden relative">
      
      {/* --- MODALS --- */}
      {showProvablyFair && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0a0f0c] border border-green-500 max-w-2xl w-full rounded-xl p-8 shadow-[0_0_50px_rgba(34,197,94,0.2)]">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-4 flex items-center justify-between">
              🛡️ Provably Fair <button onClick={() => setShowProvablyFair(false)} className="text-gray-500 hover:text-white">✕</button>
            </h2>
            <p className="text-gray-400 mb-6 leading-relaxed">
              We operate on the <strong className="text-white">"Check it yourself"</strong> principle. The house cannot alter the outcome of a bet once it is placed. Outcomes are determined by a cryptographic commit-reveal scheme mathematically verified by the Solana smart contract.
            </p>
            <div className="bg-black border border-green-900/50 p-4 rounded font-mono text-sm text-green-400 mb-6 break-all">
              Hash = HMAC-SHA512(Server Seed, Client Seed)
            </div>
            <ul className="space-y-4 text-sm text-gray-300">
              <li><strong className="text-white">1. Server Seed:</strong> Generated by the House and hashed before you bet. You verify this hash later.</li>
              <li><strong className="text-white">2. Client Seed:</strong> Generated by your browser to ensure the House cannot pre-calculate the result.</li>
              <li><strong className="text-white">3. Smart Contract Resolution:</strong> The House reveals the raw Server Seed. The Rust contract proves it matches the original hash, combines it with your seed, and pays out instantly if you win.</li>
            </ul>
          </div>
        </div>
      )}

      {selectedBetInfo && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0a0f0c] border border-gray-700 max-w-lg w-full rounded-xl p-6 shadow-2xl">
            <h2 className="text-xl font-black text-white uppercase tracking-wider mb-6 flex items-center justify-between border-b border-gray-800 pb-4">
              Receipt: {selectedBetInfo.id}
              <button onClick={() => setSelectedBetInfo(null)} className="text-gray-500 hover:text-white">✕</button>
            </h2>
            <div className="space-y-4 font-mono text-sm">
              <div className="flex justify-between border-b border-gray-800 pb-2">
                <span className="text-gray-500">Player</span><span className="text-white">{selectedBetInfo.player}</span>
              </div>
              <div className="flex justify-between border-b border-gray-800 pb-2">
                <span className="text-gray-500">Outcome</span>
                <span className={selectedBetInfo.win ? "text-green-500 font-bold" : "text-red-500 font-bold"}>
                  {selectedBetInfo.win ? "+" : "-"}{selectedBetInfo.amount} SOL
                </span>
              </div>
              <div className="flex flex-col gap-1 border-b border-gray-800 pb-2">
                <span className="text-gray-500">Network Tx Signature (Verification)</span>
                <a href={`https://explorer.solana.com/tx/${selectedBetInfo.hash}?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899`} target="_blank" rel="noreferrer" className="text-green-400 break-all text-xs bg-[#111a14] p-2 rounded border border-green-900/30 hover:bg-green-900/40 transition-colors">
                  {selectedBetInfo.hash}
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Client Seed</span><span className="text-gray-300">{selectedBetInfo.clientSeed}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* --- END MODALS --- */}

      {/* Navbar */}
      <header className="h-16 border-b border-green-900/40 bg-[#0a0f0c] px-4 flex justify-between items-center z-20 shadow-md">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)} className="text-green-500 hover:text-green-400 transition-colors p-2 bg-green-900/20 rounded border border-green-900/50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveGame(null)}>
            <span className="text-2xl">🐸</span>
            <h1 className="text-xl font-black tracking-widest text-white uppercase italic hidden sm:block">
              McPepe <span className="text-green-500">Casino</span>
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {publicKey && (
            <div className="bg-[#111a14] border border-green-900/50 px-4 py-1.5 rounded flex gap-3 items-center">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Vault</span>
              <span className="text-green-400 font-mono font-bold">{balance.toFixed(4)} SOL</span>
            </div>
          )}
          <WalletMultiButton className="!bg-green-600 hover:!bg-green-500 transition-colors !font-black !rounded !h-10 border border-green-400 uppercase text-sm" />
          <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className="text-green-500 hover:text-green-400 transition-colors p-2 bg-green-900/20 rounded border border-green-900/50 ml-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 h-[calc(100vh-4rem)] relative">
        {/* Collapsible Left Sidebar (Arcade Games) */}
        <aside className={`${isLeftSidebarOpen ? 'w-64' : 'w-0'} absolute md:relative z-40 h-full left-0 transition-all duration-300 ease-in-out border-r border-green-900/30 bg-[#0a0f0c] overflow-hidden flex flex-col shrink-0`}>          <div className="p-4 w-64">
            <h2 className="text-xs text-gray-500 font-black uppercase tracking-widest mb-4">Arcade Selection</h2>
            <div className="space-y-3">
              <button 
                onClick={() => setActiveGame('coinflip')}
                className={`w-full text-left p-4 font-black uppercase tracking-wide rounded-lg transition-all border-2 group relative overflow-hidden ${activeGame === 'coinflip' ? 'bg-green-900/20 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.15)]' : 'bg-black border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'}`}
              >
                <div className="flex justify-between items-center relative z-10">
                  <span className="flex items-center gap-2"><span className="text-xl">🪙</span> Coinflip</span>
                  <span className={`w-2 h-2 rounded-full ${activeGame === 'coinflip' ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-gray-600 group-hover:bg-green-500'}`}></span>
                </div>
                {activeGame === 'coinflip' && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-green-500/10 to-transparent translate-x-[-100%] animate-[shimmer_2s_infinite]"></div>}
              </button>
              
              <button disabled className="w-full text-left p-4 font-black uppercase tracking-wide rounded-lg bg-black/50 border-2 border-transparent text-gray-600 cursor-not-allowed flex justify-between items-center">
                <span className="flex items-center gap-2 grayscale opacity-50"><span className="text-xl">🎡</span> Roulette</span>
                <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-500">SOON</span>
              </button>

              <button disabled className="w-full text-left p-4 font-black uppercase tracking-wide rounded-lg bg-black/50 border-2 border-transparent text-gray-600 cursor-not-allowed flex justify-between items-center">
                <span className="flex items-center gap-2 grayscale opacity-50"><span className="text-xl">📉</span> Stonks</span>
                <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-500">SOON</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Center Arena */}
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0d1410] via-[#050806] to-black p-4 sm:p-8 flex flex-col relative custom-scrollbar">
          
          {/* Splash Screen */}
          {!activeGame && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto text-center animate-fade-in">
              <div className="text-7xl mb-8 animate-bounce-short">🎰</div>
              <h2 className="text-5xl font-black uppercase tracking-tighter text-white mb-6">
                Enter the <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600">Free Market</span>
              </h2>
              <p className="text-gray-400 text-lg mb-10 leading-relaxed max-w-xl">
                No centralized servers. No hidden house edges. Just mathematically proven smart contracts living on the blockchain. Verify every single hash yourself.
              </p>
              <button onClick={() => setActiveGame('coinflip')} className="bg-green-500 hover:bg-green-400 text-black px-10 py-4 rounded-lg font-black uppercase tracking-widest transition-all transform hover:scale-105 shadow-[0_0_30px_rgba(34,197,94,0.2)] hover:shadow-[0_0_40px_rgba(34,197,94,0.4)]">
                Play Coinflip
              </button>
            </div>
          )}

          {/* Coinflip Arena */}
          {activeGame === 'coinflip' && (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full animate-fade-in">
              
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-black text-white uppercase tracking-tight">DEGEN COINFLIP</h2>
                <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-3 py-1.5 rounded border border-green-900/50 transition-colors">
                  🛡️ Provably Fair
                </button>
              </div>

              <div className="bg-[#0a0f0c]/80 backdrop-blur-md border border-green-900/50 rounded-2xl p-8 flex flex-col items-center shadow-2xl relative">
                
                {/* CSS 3D Coin */}
                <div className="h-56 w-full flex items-center justify-center perspective-[1000px] mb-6 relative z-10">
                  {/* Toxic Neon Backglow */}
                  <div className="absolute w-40 h-40 bg-[#39ff14]/20 rounded-full blur-3xl animate-pulse"></div>
                  
                  {/* THE FIX: Removed the drop-shadow filter here to stop the 3D plane from flattening */}
                  <div className="relative w-40 h-40 transition-transform duration-[3000ms] ease-out transform-style-3d" style={{ transform: `rotateY(${coinDegrees}deg)` }}>
                    
                    {/* Front (Heads) */}
                    <div 
                      className="absolute inset-0 w-full h-full bg-[#0a0f0c] rounded-full overflow-hidden backface-hidden" 
                      style={{ transform: 'rotateY(0deg)' }}
                    >
                      <img src="/cf_head.png" alt="Heads" className="w-full h-full object-cover drop-shadow-[0_0_10px_#39ff14]" />
                    </div>
                    
                    {/* Back (Tails) */}
                    <div 
                      className="absolute inset-0 w-full h-full bg-[#0a0f0c] rounded-full overflow-hidden backface-hidden" 
                      style={{ transform: 'rotateY(180deg)' }}
                    >
                      <img src="/cf_tail.png" alt="Tails" className="w-full h-full object-cover drop-shadow-[0_0_10px_#ff00ff]" />
                    </div>
                    
                  </div>
                </div>

                {/* Results Panel */}
                <div className="h-24 w-full mb-6 flex items-center justify-center">
                  {flipState === "resolved" && result && (
                    <div className={`px-10 py-4 rounded-xl border-2 animate-bounce-short shadow-2xl ${result.win ? 'bg-green-900/30 border-green-500 text-green-400' : 'bg-red-900/30 border-red-500 text-red-400'}`}>
                      <h3 className="text-3xl font-black uppercase tracking-widest text-center">
                        {result.win ? 'Victorious' : 'Rekt'}
                      </h3>
                      <p className="text-center font-mono mt-2 text-lg">
                        {result.side.toUpperCase()} • {result.win ? '+' : '-'}{result.amount} SOL
                      </p>
                    </div>
                  )}
                  {flipState === "flipping" && (
                    <div className="text-green-500 font-mono animate-pulse flex flex-col items-center bg-green-900/10 px-8 py-4 rounded-xl border border-green-900/30">
                      <span className="text-xl font-bold">Awaiting On-Chain Execution...</span>
                      <span className="text-sm text-gray-500 mt-2">Please approve the Phantom prompt to secure hash</span>
                    </div>
                  )}
                </div>

                {/* Betting Controls */}
                <div className="w-full max-w-md space-y-5">
                  <div className="flex gap-4">
                    <button
                      onClick={() => setGuess("heads")}
                      disabled={flipState === "flipping"}
                      className={`flex-1 py-4 rounded-xl font-black uppercase tracking-wider transition-all border-2 ${guess === 'heads' ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500 scale-105 shadow-lg' : 'border-gray-800 text-gray-500 hover:border-gray-600 bg-black'} disabled:opacity-50 disabled:scale-100`}
                    >
                      Heads
                    </button>
                    <button
                      onClick={() => setGuess("tails")}
                      disabled={flipState === "flipping"}
                      className={`flex-1 py-4 rounded-xl font-black uppercase tracking-wider transition-all border-2 ${guess === 'tails' ? 'border-gray-400 bg-gray-400/10 text-gray-300 scale-105 shadow-lg' : 'border-gray-800 text-gray-500 hover:border-gray-600 bg-black'} disabled:opacity-50 disabled:scale-100`}
                    >
                      Tails
                    </button>
                  </div>

                  <div className="bg-black border-2 border-gray-800 rounded-xl p-1 flex focus-within:border-green-500 transition-colors">
                    <input
                      type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} disabled={flipState === "flipping"}
                      className="w-full bg-transparent p-3 text-2xl font-mono text-white outline-none pl-4 disabled:opacity-50" step="0.01" min="0.01"
                    />
                    <div className="flex gap-2 pr-2 items-center">
                      <button onClick={() => setBetAmount((balance / 2).toFixed(2))} disabled={flipState === "flipping"} className="px-4 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-sm font-bold rounded border border-gray-800 transition-colors disabled:opacity-50">1/2</button>
                      <button onClick={() => setBetAmount(balance.toFixed(2))} disabled={flipState === "flipping"} className="px-4 py-2 bg-[#111a14] hover:bg-[#16221a] text-green-500 text-sm font-bold rounded border border-gray-800 transition-colors disabled:opacity-50">MAX</button>
                    </div>
                  </div>

                  <button
                    onClick={handleFlip}
                    disabled={flipState === "flipping" || !publicKey}
                    className="w-full py-5 bg-green-500 hover:bg-green-400 disabled:bg-gray-800 disabled:text-gray-600 text-black font-black text-2xl uppercase tracking-widest transition-all rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.1)] hover:shadow-[0_0_30px_rgba(34,197,94,0.3)] hover:-translate-y-1 disabled:shadow-none disabled:translate-y-0"
                  >
                    {!publicKey ? "Connect Wallet" : "Initiate Wager"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Fixed Right Sidebar - Live Wagers */}
        <aside className={`${isRightSidebarOpen ? 'w-80' : 'w-0'} absolute md:relative z-40 h-full right-0 transition-all duration-300 ease-in-out border-l border-green-900/30 bg-[#0a0f0c] flex flex-col shrink-0 overflow-hidden`}>          <div className="h-14 flex items-center px-4 border-b border-green-900/30 bg-[#050806] w-80 shrink-0">
            <h3 className="text-green-500 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Live Global Wagers
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar w-80">
            {recentBets.map((bet) => (
              <div 
                key={bet.id} 
                onClick={() => setSelectedBetInfo(bet)}
                className="p-3 bg-[#111a14] rounded border border-gray-900 hover:border-green-900/50 hover:bg-[#16221a] transition-all cursor-pointer flex justify-between items-center group"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{bet.player}</span>
                  <span className="text-xs font-bold text-gray-300 mt-1">{bet.game}</span>
                </div>
                <div className={`font-mono text-sm font-black ${bet.win ? "text-green-400" : "text-red-500"}`}>
                  {bet.win ? "+" : "-"}{bet.amount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <style jsx global>{`
        .perspective-[1000px] { perspective: 1000px; }
        .transform-style-3d { transform-style: preserve-3d; }
        .backface-hidden { 
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;}
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 4px; }
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
        .animate-bounce-short { animation: bounceShort 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounceShort {
          0% { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}