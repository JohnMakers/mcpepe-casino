import React, { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
// @ts-ignore
import idl from "../../../idl.json";

const BACKEND_URL = "http://localhost:3005";
const PROGRAM_ID = new anchor.web3.PublicKey("9ea7HNWLSgeNfbo9bYN3EcnstJEmjZF7FPECz58RMx57");
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
    if (wager > balance) return alert("Insufficient funds.");

    setWhackdState("signing");

    try {
        const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
        const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
        
        const whackdGameKeypair = anchor.web3.Keypair.generate();
        const clientSeed = "degen_" + Math.random().toString(36).substring(7);

        const initRes = await fetch(`${BACKEND_URL}/api/whackd/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playerPubkey: publicKey.toBase58(),
                gamePubkey: whackdGameKeypair.publicKey.toBase58(),
                clientSeed,
                mineCount,
                betAmount: wager
            })
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
            .accounts({
                whackdGame: whackdGameKeypair.publicKey,
                player: publicKey,
                authority: HOUSE_PUBKEY,
                vault: vaultPDA,
                systemProgram: anchor.web3.SystemProgram.programId,
            }).instruction();

        const tx = new anchor.web3.Transaction().add(startIx);
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = publicKey;

        const signedTx = await wallet.signTransaction(tx);
        signedTx.partialSign(whackdGameKeypair);

        const signature = await connection.sendRawTransaction(signedTx.serialize());
        await connection.confirmTransaction(signature, "processed");

        setGameSignature(signature);
        setBalance(prev => prev - wager); 
        setRevealedMask(0);
        setBombMask(0);
        setCurrentMultiplier(1.0);
        setWhackdState("playing");

    } catch (e) {
        console.error("Wager failed or rejected:", e);
        setWhackdState("idle");
    }
  };

  const handleTileClick = async (index: number) => {
    if (whackdState !== "playing") return;
    if ((revealedMask & (1 << index)) !== 0) return;

    try {
        const res = await fetch(`${BACKEND_URL}/api/whackd/click`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerPubkey: publicKey?.toBase58(), tileIndex: index })
        });
        const data = await res.json();

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
            
            if (clicks === (25 - mineCount)) {
                handleCashout(nextMult, data.revealedMask);
            }
        }
    } catch (e) { console.error("Failed to process click:", e); }
  };

  const handleCashout = async (overrideMult?: number, overrideMask?: number) => {
    if (whackdState !== "playing") return;
    try {
        const res = await fetch(`${BACKEND_URL}/api/whackd/cashout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerPubkey: publicKey?.toBase58() })
        });
        const data = await res.json();

        const maskToUse = overrideMask ?? revealedMask;
        const finalMult = overrideMult ?? currentMultiplier;
        const wager = parseFloat(betAmount);
        const payout = wager * finalMult;

        setBalance(prev => prev + payout);
        setWhackdState("cashed_out");
        logWager("Whackd!", wager, true, payout, gameSignature, data.serverSeed);
    } catch (e) { console.error("Failed to cashout:", e); }
  };

  return (
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
              <button key={i} disabled={whackdState !== "playing" || isRevealed} onClick={() => handleTileClick(i)} className={`relative rounded-md overflow-hidden transition-all duration-200 shadow-inner ${isRevealed || forceShow ? 'bg-[#111a14] border-gray-900 scale-95' : 'bg-gray-800 hover:bg-gray-700 border-b-4 border-gray-900 hover:-translate-y-1'}`}>
                {(isRevealed || forceShow) && (
                  <div className="absolute inset-0 flex items-center justify-center p-2 animate-fade-in">
                    {isBomb ? <img src="/wh_whackd.png" alt="Bomb" className="w-full h-full object-contain drop-shadow-[0_0_5px_red]" /> : <img src="/wh_island.png" alt="Safe" className="w-full h-full object-contain drop-shadow-[0_0_5px_#39ff14]" />}
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
            <select disabled={whackdState === "playing" || whackdState === "signing"} value={mineCount} onChange={(e) => setMineCount(parseInt(e.target.value))} className="w-full bg-black border border-gray-800 rounded p-3 text-white outline-none focus:border-green-500 disabled:opacity-50">
              {[...Array(24)].map((_, i) => ( <option key={i+1} value={i+1}>{i+1} {i === 0 ? 'Mine' : 'Mines'}</option> ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-2 block">Bet Amount</label>
            <div className="bg-black border border-gray-800 rounded flex focus-within:border-green-500">
              <input type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} disabled={whackdState === "playing" || whackdState === "signing"} className="w-full bg-transparent p-3 font-mono text-white outline-none pl-4 disabled:opacity-50" />
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
            <button onClick={() => handleCashout()} className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xl uppercase tracking-widest rounded shadow-lg animate-pulse">
              Cash Out ({(parseFloat(betAmount) * currentMultiplier).toFixed(2)})
            </button>
          ) : (
            <button onClick={handleStartWhackd} disabled={whackdState === "signing" || !publicKey} className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black text-xl uppercase tracking-widest rounded shadow-[0_0_15px_rgba(34,197,94,0.2)] disabled:opacity-50 disabled:bg-gray-500 disabled:shadow-none">
              {whackdState === "signing" ? "Awaiting Signature..." : "Start Game"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}