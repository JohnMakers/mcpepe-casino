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

const INITIAL_BETS = [
  { id: "tx1", player: "8xTq...3pZx", game: "Coinflip", amount: 2.5, win: true, hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", clientSeed: "degen_1" },
];

export default function Dashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;
  const [balance, setBalance] = useState<number>(0);
  
  // Layout State
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [activeGame, setActiveGame] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setIsLeftSidebarOpen(true);
      setIsRightSidebarOpen(true);
    }
  }, []);

  // Shared Betting State
  const [betAmount, setBetAmount] = useState<string>("0.1");
  const [recentBets, setRecentBets] = useState(INITIAL_BETS);

  // Modal State
  const [showProvablyFair, setShowProvablyFair] = useState(false);
  const [selectedBetInfo, setSelectedBetInfo] = useState<any>(null);

  // --- COINFLIP STATE ---
  const [guess, setGuess] = useState<"heads" | "tails">("heads");
  const [flipState, setFlipState] = useState<"idle" | "flipping" | "resolved">("idle");
  const [result, setResult] = useState<{ win: boolean; amount: string; side: "heads" | "tails" } | null>(null);
  const [coinDegrees, setCoinDegrees] = useState(0);

  // --- WHACKD STATE ---
  const [mineCount, setMineCount] = useState<number>(3);
  const [whackdState, setWhackdState] = useState<"idle" | "playing" | "busted" | "cashed_out" | "signing">("idle");
  const [revealedMask, setRevealedMask] = useState<number>(0);
  const [bombMask, setBombMask] = useState<number>(0);
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1.00);

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

  // ==========================================
  // SHARED HELPERS
  // ==========================================
  const multiplyBet = (factor: number) => {
    const current = parseFloat(betAmount) || 0;
    setBetAmount((current * factor).toFixed(2));
  };

  const logWager = (game: string, wager: number, win: boolean, payout: number) => {
    const newBet = {
      id: Math.random().toString(36).substring(2, 10), 
      player: publicKey ? publicKey.toBase58().substring(0, 4) + "..." + publicKey.toBase58().slice(-4) : "Anon",
      game,
      amount: win ? payout : wager,
      win,
      hash: "Simulated_Tx_Hash_" + Math.random().toString(36).substring(2, 15), 
      clientSeed: "degen_seed_" + Math.random().toString(36).substring(7)
    };
    setRecentBets(prev => [newBet, ...prev].slice(0, 20));
  };

  // ==========================================
  // COINFLIP LOGIC
  // ==========================================
  const handleFlip = async () => {
    if (!publicKey || !wallet.signTransaction) return alert("Wallet not connected.");
    const wager = parseFloat(betAmount);
    if (wager > balance) return alert("Insufficient funds.");

    setFlipState("flipping");
    setResult(null);
    
    try {
        // Trigger Wallet Signature for Coinflip
        const tx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: publicKey, // Dummy self-transfer for frontend testing
                lamports: 1000, 
            })
        );
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = publicKey;
        await wallet.signTransaction(tx);

        setBalance(prev => prev - wager); 

        setTimeout(() => {
            const isWin = Math.random() > 0.5;
            const winningSide = isWin ? guess : (guess === "heads" ? "tails" : "heads");
            
            const baseSpins = 1800; 
            const extraTurn = winningSide === "tails" ? 180 : 0; 
            setCoinDegrees(prev => prev + baseSpins + extraTurn + (prev % 360 !== 0 ? 180 : 0));

            setTimeout(() => {
                setFlipState("resolved");
                const payout = isWin ? wager * 1.98 : 0; 
                setResult({ win: isWin, amount: isWin ? payout.toFixed(2) : wager.toFixed(2), side: winningSide });
                if (isWin) setBalance(prev => prev + payout);
                logWager("Coinflip", wager, isWin, payout);
            }, 3000);
        }, 1000);
    } catch (e) {
        console.error("User rejected transaction");
        setFlipState("idle");
    }
  };

  // ==========================================
  // WHACKD LOGIC (Mines)
  // ==========================================
  const getMultiplier = (clicks: number, mines: number) => {
    if (clicks === 0) return 1.0;
    let num = 1;
    let den = 1;
    for (let i = 0; i < clicks; i++) {
        num *= (25 - i);
        den *= (25 - mines - i);
    }
    return (num / den) * 0.98; // 2% House Edge
  };

  const handleStartWhackd = async () => {
    if (!publicKey || !wallet.signTransaction) return alert("Wallet not connected.");
    const wager = parseFloat(betAmount);
    if (wager > balance) return alert("Insufficient funds.");

    setWhackdState("signing");

    try {
        // TRIGGER PHANTOM WALLET TO LOCK BET
        const tx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: publicKey, // Dummy self-transfer until backend is wired
                lamports: 1000, 
            })
        );
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = publicKey;
        
        await wallet.signTransaction(tx);
        
        // Transaction successful, lock funds and build the board
        setBalance(prev => prev - wager); 
        setRevealedMask(0);
        setCurrentMultiplier(1.0);
        setWhackdState("playing");

        // Securely generate board in background
        let newBombMask = 0;
        let placed = 0;
        while(placed < mineCount) {
            const randTile = Math.floor(Math.random() * 25);
            if ((newBombMask & (1 << randTile)) === 0) {
                newBombMask |= (1 << randTile);
                placed++;
            }
        }
        setBombMask(newBombMask);

    } catch (e) {
        console.error("User rejected the wager:", e);
        setWhackdState("idle");
    }
  };

  const handleTileClick = (index: number) => {
    if (whackdState !== "playing") return;
    if ((revealedMask & (1 << index)) !== 0) return;

    const newRevealedMask = revealedMask | (1 << index);
    setRevealedMask(newRevealedMask);

    if ((bombMask & (1 << index)) !== 0) {
      setWhackdState("busted");
      logWager("Whackd!", parseFloat(betAmount), false, 0);
    } else {
      const clicks = newRevealedMask.toString(2).split('1').length - 1;
      const nextMult = getMultiplier(clicks, mineCount);
      setCurrentMultiplier(nextMult);
      
      if (clicks === (25 - mineCount)) {
          handleCashout(nextMult, newRevealedMask);
      }
    }
  };

  const handleCashout = (overrideMult?: number, overrideMask?: number) => {
    if (whackdState !== "playing") return;
    
    const maskToUse = overrideMask ?? revealedMask;
    const clicks = maskToUse.toString(2).split('1').length - 1;
    if (clicks === 0) return; 

    const finalMult = overrideMult ?? currentMultiplier;
    const wager = parseFloat(betAmount);
    const payout = wager * finalMult;

    setBalance(prev => prev + payout);
    setWhackdState("cashed_out");
    logWager("Whackd!", wager, true, payout);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#050806] font-sans text-gray-200 overflow-hidden relative">
      
      {/* ========================================== */}
      {/* MODALS RESTORED */}
      {/* ========================================== */}
      {showProvablyFair && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0a0f0c] border border-green-500 max-w-2xl w-full rounded-xl p-8 shadow-[0_0_50px_rgba(34,197,94,0.2)]">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-4 flex items-center justify-between">
              🛡️ Provably Fair <button onClick={() => setShowProvablyFair(false)} className="text-gray-500 hover:text-white">✕</button>
            </h2>
            <p className="text-gray-400 mb-6 leading-relaxed">
              We operate on the <strong className="text-white">"Check it yourself"</strong> principle. Outcomes are determined by a cryptographic commit-reveal scheme mathematically verified by the Solana smart contract.
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
                  {selectedBetInfo.win ? "+" : "-"}{selectedBetInfo.amount.toFixed(2)} SOL
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

      {/* Navbar */}
      <header className="h-16 border-b border-green-900/40 bg-[#0a0f0c] px-4 flex justify-between items-center z-20 shadow-md">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)} className="text-green-500 hover:text-green-400 p-2 bg-green-900/20 rounded border border-green-900/50">
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
          <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className="text-green-500 hover:text-green-400 p-2 bg-green-900/20 rounded border border-green-900/50 ml-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 h-[calc(100vh-4rem)] relative">
        {/* Left Sidebar */}
        <aside className={`${isLeftSidebarOpen ? 'w-64' : 'w-0'} absolute md:relative z-40 h-full left-0 transition-all duration-300 border-r border-green-900/30 bg-[#0a0f0c] overflow-hidden flex flex-col shrink-0`}>          
          <div className="p-4 w-64">
            <h2 className="text-xs text-gray-500 font-black uppercase tracking-widest mb-4">Arcade Selection</h2>
            <div className="space-y-3">
              <button onClick={() => setActiveGame('coinflip')} className={`w-full text-left p-4 font-black uppercase tracking-wide rounded-lg transition-all border-2 group ${activeGame === 'coinflip' ? 'bg-green-900/20 border-green-500 text-green-400' : 'bg-black border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
                <span className="flex items-center gap-2"><span className="text-xl">🪙</span> Coinflip</span>
              </button>
              
              <button onClick={() => setActiveGame('whackd')} className={`w-full text-left p-4 font-black uppercase tracking-wide rounded-lg transition-all border-2 group ${activeGame === 'whackd' ? 'bg-green-900/20 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.15)]' : 'bg-black border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
                <span className="flex items-center gap-2"><span className="text-xl">💣</span> Whackd!</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Center Arena */}
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0d1410] via-[#050806] to-black p-4 sm:p-8 flex flex-col relative custom-scrollbar">
          
          {!activeGame && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto text-center animate-fade-in">
              <div className="text-7xl mb-8 animate-bounce-short">🎰</div>
              <h2 className="text-5xl font-black uppercase tracking-tighter text-white mb-6">Enter the <span className="text-green-500">Free Market</span></h2>
              <button onClick={() => setActiveGame('whackd')} className="bg-green-500 hover:bg-green-400 text-black px-10 py-4 rounded-lg font-black uppercase tracking-widest mt-4">Play Whackd!</button>
            </div>
          )}

          {/* ========================================== */}
          {/* COINFLIP ARENA */}
          {/* ========================================== */}
          {activeGame === 'coinflip' && (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full animate-fade-in">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-black text-white uppercase tracking-tight">DEGEN COINFLIP</h2>
                <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-3 py-1.5 rounded border border-green-900/50 transition-colors">
                  🛡️ Provably Fair
                </button>
              </div>

              <div className="bg-[#0a0f0c]/80 backdrop-blur-md border border-green-900/50 rounded-2xl p-8 flex flex-col items-center shadow-2xl">
                 <div className="h-56 w-full flex items-center justify-center perspective-[1000px] mb-6 relative z-10">
                  <div className="relative w-40 h-40 transition-transform duration-[3000ms] ease-out transform-style-3d" style={{ transform: `rotateY(${coinDegrees}deg)` }}>
                    <div className="absolute inset-0 w-full h-full bg-[#0a0f0c] rounded-full overflow-hidden backface-hidden" style={{ transform: 'rotateY(0deg)' }}>
                      <img src="/cf_head.png" alt="Heads" className="w-full h-full object-cover" />
                    </div>
                    <div className="absolute inset-0 w-full h-full bg-[#0a0f0c] rounded-full overflow-hidden backface-hidden" style={{ transform: 'rotateY(180deg)' }}>
                      <img src="/cf_tail.png" alt="Tails" className="w-full h-full object-cover" />
                    </div>
                  </div>
                </div>

                <div className="w-full max-w-md space-y-5">
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
                  <button onClick={handleFlip} disabled={flipState === "flipping"} className="w-full py-5 bg-green-500 hover:bg-green-400 text-black font-black text-2xl uppercase tracking-widest rounded-xl">Flip</button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* WHACKD! (MINES) ARENA */}
          {/* ========================================== */}
          {activeGame === 'whackd' && (
            <div className="flex-1 flex flex-col lg:flex-row max-w-5xl mx-auto w-full gap-8 animate-fade-in">
              
              <div className="flex-1 bg-[#0a0f0c]/80 backdrop-blur-md border border-green-900/50 rounded-2xl p-6 shadow-2xl flex flex-col items-center justify-center relative">
                
                <div className="w-full flex justify-between items-center mb-6 absolute top-6 left-6 right-6">
                    <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-2 py-1 rounded border border-green-900/50 transition-colors">
                        🛡️ Provably Fair
                    </button>
                </div>

                <div className="w-full max-w-[400px] flex justify-between items-center mb-6 mt-10">
                  <div className="bg-black border border-gray-800 px-4 py-2 rounded text-green-400 font-mono text-xl">
                    {currentMultiplier.toFixed(2)}x
                  </div>
                  {whackdState === "busted" && <span className="text-red-500 font-black animate-pulse uppercase tracking-widest">WHACKD!</span>}
                  {whackdState === "cashed_out" && <span className="text-green-500 font-black uppercase tracking-widest">Secured</span>}
                </div>

                <div className="grid grid-cols-5 gap-2 w-full max-w-[400px] aspect-square">
                  {Array.from({ length: 25 }).map((_, i) => {
                    const isRevealed = (revealedMask & (1 << i)) !== 0;
                    const isBomb = (bombMask & (1 << i)) !== 0;
                    const forceShow = (whackdState === "busted" || whackdState === "cashed_out") && isBomb;

                    return (
                      <button
                        key={i}
                        disabled={whackdState !== "playing" || isRevealed}
                        onClick={() => handleTileClick(i)}
                        className={`relative rounded-md overflow-hidden transition-all duration-200 shadow-inner
                          ${isRevealed || forceShow ? 'bg-[#111a14] border-gray-900 scale-95' : 'bg-gray-800 hover:bg-gray-700 border-b-4 border-gray-900 hover:-translate-y-1'}
                        `}
                      >
                        {(isRevealed || forceShow) && (
                          <div className="absolute inset-0 flex items-center justify-center p-2 animate-fade-in">
                            {isBomb ? (
                              <img src="/whackd.png" alt="Bomb" className="w-full h-full object-contain drop-shadow-[0_0_5px_red]" />
                            ) : (
                              <img src="/island.png" alt="Safe" className="w-full h-full object-contain drop-shadow-[0_0_5px_#39ff14]" />
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="w-full lg:w-80 bg-[#0a0f0c]/80 backdrop-blur-md border border-green-900/50 rounded-2xl p-6 flex flex-col shadow-2xl">
                <h2 className="text-3xl font-black text-white uppercase tracking-tight mb-6">WHACKD!</h2>
                
                <div className="space-y-6 flex-1">
                  <div>
                    <label className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-2 block">Number of Mines</label>
                    <select 
                      disabled={whackdState === "playing" || whackdState === "signing"}
                      value={mineCount}
                      onChange={(e) => setMineCount(parseInt(e.target.value))}
                      className="w-full bg-black border border-gray-800 rounded p-3 text-white outline-none focus:border-green-500 disabled:opacity-50"
                    >
                      {[...Array(24)].map((_, i) => (
                        <option key={i+1} value={i+1}>{i+1} {i === 0 ? 'Mine' : 'Mines'}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-2 block">Bet Amount</label>
                    <div className="bg-black border border-gray-800 rounded flex focus-within:border-green-500">
                      <input 
                        type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} disabled={whackdState === "playing" || whackdState === "signing"}
                        className="w-full bg-transparent p-3 font-mono text-white outline-none pl-4 disabled:opacity-50" 
                      />
                      <div className="flex gap-1 pr-1 items-center">
                        <button onClick={() => multiplyBet(0.5)} disabled={whackdState === "playing" || whackdState === "signing"} className="px-2 py-1 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-[10px] font-bold rounded">1/2</button>
                        <button onClick={() => multiplyBet(2)} disabled={whackdState === "playing" || whackdState === "signing"} className="px-2 py-1 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-[10px] font-bold rounded">2x</button>
                        <button onClick={() => setBetAmount(balance.toFixed(2))} disabled={whackdState === "playing" || whackdState === "signing"} className="px-2 py-1 bg-[#111a14] hover:bg-[#16221a] text-green-500 text-[10px] font-bold rounded">MAX</button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {whackdState === "playing" ? (
                    <button 
                      onClick={() => handleCashout()} 
                      className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xl uppercase tracking-widest rounded shadow-lg animate-pulse"
                    >
                      Cash Out ({(parseFloat(betAmount) * currentMultiplier).toFixed(2)})
                    </button>
                  ) : (
                    <button 
                      onClick={handleStartWhackd}
                      disabled={whackdState === "signing"} 
                      className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black text-xl uppercase tracking-widest rounded shadow-[0_0_15px_rgba(34,197,94,0.2)] disabled:opacity-50 disabled:bg-gray-500 disabled:shadow-none"
                    >
                      {whackdState === "signing" ? "Awaiting Signature..." : "Start Game"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar - Live Wagers RESTORED CLICK HANDLERS */}
        <aside className={`${isRightSidebarOpen ? 'w-80' : 'w-0'} absolute md:relative z-40 h-full right-0 transition-all duration-300 border-l border-green-900/30 bg-[#0a0f0c] flex flex-col shrink-0 overflow-hidden`}>          
          <div className="h-14 flex items-center px-4 border-b border-green-900/30 bg-[#050806] w-80 shrink-0">
            <h3 className="text-green-500 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Live Global Wagers
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar w-80">
            {recentBets.map((bet) => (
              <div 
                key={bet.id} 
                onClick={() => setSelectedBetInfo(bet)} // MODAL TRIGGER RESTORED
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
        .backface-hidden { backface-visibility: hidden; -webkit-backface-visibility: hidden;}
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 4px; }
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
        .animate-bounce-short { animation: bounceShort 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes bounceShort { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}