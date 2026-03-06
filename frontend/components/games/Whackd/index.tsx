import React, { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
// @ts-ignore
import idl from "../../../idl.json";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
const PROGRAM_ID = new anchor.web3.PublicKey("BNpcicNi55iYT6yfe2isgHnqqSWBtAr8qfiGwpKbxyuz");
const HOUSE_PUBKEY = new anchor.web3.PublicKey("Gf9QEwbxosqQY9bLBrgjKommtX8qPdNqFrKazmHfaZBv");

interface Props {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  logWager: (game: string, wager: number, win: boolean, payout: number, hash: string, seed: string) => void;
  setShowProvablyFair: (val: boolean) => void;
}

export default function WhackdGame({ balance, setBalance, logWager, setShowProvablyFair }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;

  const [betAmount, setBetAmount] = useState<string>("0.1");
  const [mineCount, setMineCount] = useState<number>(3);
  const [whackdState, setWhackdState] = useState<"idle" | "signing" | "playing" | "busted" | "cashed_out">("idle");
  const [revealedMask, setRevealedMask] = useState<number>(0);
  const [bombMask, setBombMask] = useState<number>(0);
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1.00);
  const [gameSignature, setGameSignature] = useState<string>("");
  
  const [clientSeedState, setClientSeedState] = useState<string>("");
  const [winAmount, setWinAmount] = useState<number>(0);

  // New UI states to prevent race conditions and improve feedback
  const [loadingTile, setLoadingTile] = useState<number | null>(null);
  const [isCashingOut, setIsCashingOut] = useState<boolean>(false);

  const multiplyBet = (factor: number) => {
    const current = parseFloat(betAmount) || 0;
    setBetAmount((current * factor).toFixed(2));
  };

  const getMultiplier = (clicks: number, mines: number) => {
    if (clicks === 0) return 1.0;
    let num = 1; let den = 1;
    for (let i = 0; i < clicks; i++) { num *= (25 - i); den *= (25 - mines - i); }
    return (num / den) * 0.98; 
  };

  const handleStartWhackd = async () => {
    if (!publicKey || !wallet.signTransaction) return alert("Wallet not connected.");
    const wager = parseFloat(betAmount);
    
    // Add a slight buffer for the refundable rent exemption cost during balance checks
    if (wager + 0.0025 > balance) return alert("Insufficient funds (Need wager + ~0.002 SOL for rent).");

    setWhackdState("signing");

    try {
        const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
        const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
        
        const clientSeed = "degen_" + Math.random().toString(36).substring(7);
        const whackdGameKeypair = anchor.web3.Keypair.generate();

        const initRes = await fetch(`${BACKEND_URL}/api/whackd/init`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerPubkey: publicKey.toBase58(), gamePubkey: whackdGameKeypair.publicKey.toBase58(), clientSeed, mineCount, betAmount: wager })
        });
        
        const initData = await initRes.json();
        if (!initData.success) throw new Error("Failed to get commitment from House");

        const serverSeedHashArray = [];
        for (let i = 0; i < initData.serverSeedHash.length; i += 2) {
            serverSeedHashArray.push(parseInt(initData.serverSeedHash.substr(i, 2), 16));
        }

        const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
        const wagerLamports = new anchor.BN(wager * LAMPORTS_PER_SOL);

        const startIx = await program.methods
            .startWhackd(wagerLamports, mineCount, serverSeedHashArray, clientSeed)
            .accounts({ whackdGame: whackdGameKeypair.publicKey, player: publicKey, authority: HOUSE_PUBKEY, vault: vaultPDA, systemProgram: anchor.web3.SystemProgram.programId })
            .instruction();

        const tx = new anchor.web3.Transaction().add(startIx);
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.feePayer = publicKey;

        const signedTx = await wallet.signTransaction(tx);
        signedTx.partialSign(whackdGameKeypair);

        const signature = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(signature, "processed");

        setGameSignature(signature);
        setClientSeedState(clientSeed);
        setBalance(prev => prev - wager); 
        setRevealedMask(0);
        setBombMask(0);
        setWinAmount(0);
        setCurrentMultiplier(1.0);
        setWhackdState("playing");

    } catch (e) {
        console.error("Wager failed or rejected:", e);
        setWhackdState("idle");
    }
  };

  const handleTileClick = async (index: number) => {
    // Drop the click if another action is processing to prevent race conditions
    if (whackdState !== "playing" || loadingTile !== null || isCashingOut) return;
    if ((revealedMask & (1 << index)) !== 0) return;

    setLoadingTile(index);

    try {
        const res = await fetch(`${BACKEND_URL}/api/whackd/click`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerPubkey: publicKey?.toBase58(), tileIndex: index })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Backend failed to process click");

        const newRevealedMask = revealedMask | (1 << index);

        if (data.status === "busted") {
            setBombMask(data.bombMask);
            setRevealedMask(newRevealedMask);
            setWhackdState("busted");
            logWager("Whackd!", parseFloat(betAmount), false, 0, gameSignature, data.serverSeed);
        } else {
            setRevealedMask(data.revealedMask);
            const clicks = data.revealedMask.toString(2).split('1').length - 1;
            const nextMult = getMultiplier(clicks, mineCount);
            setCurrentMultiplier(nextMult);
            
            if (clicks === (25 - mineCount)) handleCashout(nextMult, data.revealedMask);
        }
    } catch (e) { 
        console.error("Failed to process click:", e); 
    } finally {
        setLoadingTile(null);
    }
  };

  const handleCashout = async (overrideMult?: number, overrideMask?: number) => {
    if (whackdState !== "playing" || loadingTile !== null || isCashingOut) return;
    
    setIsCashingOut(true);

    try {
        const res = await fetch(`${BACKEND_URL}/api/whackd/cashout`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerPubkey: publicKey?.toBase58() })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Backend failed to process cashout");

        const finalMult = overrideMult ?? currentMultiplier;
        const wager = parseFloat(betAmount);
        const payout = wager * finalMult;
        const profit = payout - wager;

        const encoder = new TextEncoder();
        const combinedData = encoder.encode(data.serverSeed + clientSeedState);
        const hashBuffer = await crypto.subtle.digest('SHA-256', combinedData as unknown as ArrayBuffer);
        const hashArray = new Uint8Array(hashBuffer);
        let board = Array.from({length: 25}, (_, i) => i);
        for (let i = 24; i > 0; i--) {
            const randByte = hashArray[i % 32];
            const j = randByte % (i + 1);
            [board[i], board[j]] = [board[j], board[i]];
        }
        let actualBombMask = 0;
        for (let i = 0; i < mineCount; i++) actualBombMask |= (1 << board[i]);
        
        setBombMask(actualBombMask);
        setWinAmount(profit); 

        try {
            if (!publicKey) throw new Error("Wallet disconnected");
            const exactBalance = await connection.getBalance(publicKey);
            setBalance(exactBalance / LAMPORTS_PER_SOL);
        } catch (err) {
            setBalance(prev => prev + payout);
        }        
        
        setWhackdState("cashed_out");
        logWager("Whackd!", wager, true, payout, gameSignature, data.serverSeed);
    } catch (e) { 
        console.error("Failed to cashout:", e); 
    } finally {
        setIsCashingOut(false);
    }
  };

return (
    <div className="flex-1 flex flex-col xl:flex-row max-w-6xl mx-auto w-full gap-6 sm:gap-8 animate-fade-in relative items-start">
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInUpDopamine {
          0% { opacity: 0; transform: translateY(30px) scale(0.8) rotate(-5deg); }
          60% { opacity: 1; transform: translateY(-10px) scale(1.1) rotate(-5deg); }
          100% { opacity: 1; transform: translateY(0) scale(1) rotate(-5deg); }
        }
        .animate-fade-in-up-dopamine { animation: fadeInUpDopamine 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        
        @keyframes pulseSlow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-pulse-slow { animation: pulseSlow 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}} />

      <div className="flex-1 bg-[#0a0f0c]/80 backdrop-blur-md border border-green-900/50 rounded-2xl p-4 sm:p-8 shadow-2xl flex flex-col items-center justify-center relative min-h-[400px] w-full overflow-hidden">
        
        <div className="w-full flex justify-end mb-4 sm:mb-8 relative z-20">
            <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-3 py-1.5 rounded border border-green-900/50 transition-colors">
                🛡️ Provably Fair
            </button>
        </div>

        <div className="w-full max-w-full sm:max-w-[500px] flex justify-between items-center mb-6 relative z-20">
          <div className={`bg-black border px-4 py-2 rounded font-mono text-lg sm:text-2xl font-black shadow-inner transition-colors duration-500 ${whackdState === 'cashed_out' ? 'border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.4)]' : 'border-gray-800 text-green-400'}`}>
            {currentMultiplier.toFixed(2)}x
          </div>
          {whackdState === "busted" && <span className="text-red-500 font-black text-xl sm:text-2xl animate-pulse uppercase tracking-widest drop-shadow-[0_0_10px_red]">WHACKD!</span>}
        </div>

        {whackdState === "cashed_out" && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center pointer-events-none animate-fade-in-up-dopamine">
               <h2 className="text-5xl sm:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-yellow-600 drop-shadow-[0_0_30px_rgba(234,179,8,0.5)] uppercase tracking-widest" style={{ WebkitTextStroke: '2px #854d0e' }}>
                 Winner
               </h2>
               <p className="text-3xl sm:text-4xl font-black text-green-400 drop-shadow-[0_0_20px_rgba(34,197,94,1)] mt-4 bg-black/80 px-8 py-3 rounded-full border-2 border-green-500 backdrop-blur-md">
                 +{winAmount.toFixed(4)} SOL 
               </p>
            </div>
        )}

        <div className="grid grid-cols-5 gap-2 sm:gap-3 w-full max-w-full sm:max-w-[500px] aspect-square mx-auto relative z-10">
          {Array.from({ length: 25 }).map((_, i) => {
            const isClicked = (revealedMask & (1 << i)) !== 0;
            const isBomb = (bombMask & (1 << i)) !== 0;
            const isGameOver = whackdState === "busted" || whackdState === "cashed_out";
            const isTileLoading = loadingTile === i;

            let showAsSafe = false;
            let showAsBomb = false;
            let tileClasses = "bg-gray-800 hover:bg-gray-700 border-b-[3px] sm:border-b-4 border-gray-900 hover:-translate-y-1";
            let imageClasses = "";
            
            if (isGameOver) {
                if (isBomb) {
                    showAsBomb = true;
                    if (whackdState === "busted" && isClicked) {
                        tileClasses = "bg-red-900/80 border-red-900 scale-95 shadow-[0_0_30px_rgba(220,38,38,0.8)] z-10 animate-pulse";
                        imageClasses = "drop-shadow-[0_0_15px_rgba(239,68,68,1)]";
                    } else {
                        tileClasses = "bg-[#111a14] border-gray-900 scale-95 opacity-70 grayscale-[30%]";
                        imageClasses = "drop-shadow-[0_0_5px_rgba(239,68,68,0.5)]";
                    }
                } else {
                    showAsSafe = true;
                    if (isClicked) {
                        if (whackdState === "cashed_out") {
                            tileClasses = "bg-green-900/40 border-green-500 scale-[0.98] shadow-[0_0_25px_rgba(34,197,94,0.5)] z-10";
                            imageClasses = "drop-shadow-[0_0_10px_rgba(57,255,20,0.8)]";
                        } else {
                            tileClasses = "bg-[#111a14] border-gray-900 scale-95 opacity-50";
                            imageClasses = "drop-shadow-[0_0_5px_rgba(57,255,20,0.6)]";
                        }
                    } else {
                        tileClasses = "bg-[#111a14] border-gray-900 scale-95 opacity-20";
                    }
                }
            } else {
                if (isClicked) {
                    showAsSafe = true;
                    tileClasses = "bg-[#111a14] border-gray-900 scale-95 shadow-inner";
                    imageClasses = "drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]";
                } else if (isTileLoading) {
                    tileClasses = "bg-gray-700 border-b-[3px] sm:border-b-4 border-gray-800 scale-95 animate-pulse-slow";
                }
            }

            return (
              <button 
                key={i} 
                disabled={whackdState !== "playing" || isClicked || loadingTile !== null || isCashingOut} 
                onClick={() => handleTileClick(i)} 
                className={`relative w-full h-full rounded-md sm:rounded-lg overflow-hidden transition-all duration-300 ${tileClasses}`}
              >
                {(showAsSafe || showAsBomb) ? (
                  <div className="absolute inset-0 flex items-center justify-center p-2 sm:p-3 animate-fade-in">
                    {showAsBomb ? (
                        <img src="/wh_whackd.png" alt="Bomb" className={`w-full h-full object-contain ${imageClasses}`} />
                    ) : (
                        <img src="/wh_island.png" alt="Safe" className={`w-full h-full object-contain ${imageClasses}`} />
                    )}
                  </div>
                ) : (
                  isTileLoading && !isGameOver && (
                    <div className="absolute inset-0 flex items-center justify-center">
                       <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full xl:w-96 shrink-0 bg-[#0a0f0c]/80 backdrop-blur-md border border-green-900/50 rounded-2xl p-6 sm:p-8 flex flex-col shadow-2xl h-fit">
        <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight mb-6 sm:mb-8">WHACKD!</h2>
        
        <div className="space-y-6 sm:space-y-8 flex-1">
          <div>
            <label className="text-xs sm:text-sm text-gray-500 font-bold uppercase tracking-widest mb-3 block">Number of Mines</label>
            <select disabled={whackdState === "playing" || whackdState === "signing"} value={mineCount} onChange={(e) => setMineCount(parseInt(e.target.value))} className="w-full bg-black border border-gray-800 rounded-lg p-3 sm:p-4 text-white text-lg outline-none focus:border-green-500 disabled:opacity-50 transition-colors">
              {[...Array(24)].map((_, i) => ( <option key={i+1} value={i+1}>{i+1} {i === 0 ? 'Mine' : 'Mines'}</option> ))}
            </select>
          </div>

          <div>
            <label className="text-xs sm:text-sm text-gray-500 font-bold uppercase tracking-widest mb-3 flex justify-between">
               <span>Bet Amount</span>
            </label>
            <div className="bg-black border border-gray-800 rounded-lg flex focus-within:border-green-500 transition-colors overflow-hidden relative">
              <input 
                type="number" 
                min="0"
                step="0.1"
                value={betAmount} 
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setBetAmount("");
                    return;
                  }
                  // Prevent negative numbers from being typed or stepped
                  const num = parseFloat(val);
                  if (num < 0) {
                    setBetAmount("0");
                  } else {
                    setBetAmount(val);
                  }
                }} 
                disabled={whackdState === "playing" || whackdState === "signing"} 
                className="w-full bg-transparent p-3 sm:p-4 font-mono text-white text-lg outline-none pl-4 disabled:opacity-50" 
              />
              <div className="flex gap-1 pr-2 items-center bg-black">
                <button onClick={() => multiplyBet(0.5)} disabled={whackdState === "playing" || whackdState === "signing"} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded">1/2</button>
                <button onClick={() => multiplyBet(2)} disabled={whackdState === "playing" || whackdState === "signing"} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded">2x</button>
                <button onClick={() => setBetAmount(balance.toFixed(2))} disabled={whackdState === "playing" || whackdState === "signing"} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-green-500 text-xs font-bold rounded">MAX</button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 sm:mt-10">
          {whackdState === "playing" ? (
            <button 
              onClick={() => handleCashout()} 
              disabled={isCashingOut || loadingTile !== null}
              className={`w-full py-4 sm:py-5 font-black text-xl sm:text-2xl uppercase tracking-widest rounded-xl transition-all ${isCashingOut || loadingTile !== null ? 'bg-yellow-600/50 text-gray-400 cursor-not-allowed' : 'bg-yellow-500 hover:bg-yellow-400 text-black shadow-[0_0_20px_rgba(234,179,8,0.4)] animate-pulse'}`}
            >
              {isCashingOut ? "Cashing out..." : `Cash Out (${(parseFloat(betAmount) * currentMultiplier).toFixed(2)})`}
            </button>
          ) : (
            <button onClick={handleStartWhackd} disabled={whackdState === "signing" || !publicKey} className="w-full py-4 sm:py-5 bg-green-500 hover:bg-green-400 text-black font-black text-xl sm:text-2xl uppercase tracking-widest rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.3)] disabled:opacity-50 disabled:bg-gray-500 disabled:shadow-none transition-all">
              {whackdState === "signing" ? "Awaiting..." : "Start Game"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}