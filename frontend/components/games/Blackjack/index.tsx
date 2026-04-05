import React, { useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json';

// Bypass TypeScript IDL strictness
const PROGRAM_ID_STRING = "7pKD7FV7Pebd8ZSYgzoTHE79aFnoPLGnudHH4fpvxgSw";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STRING);

interface BlackjackProps {
  balance: number;
  setBalance: (b: number) => void;
  logWager: (game: string, wager: number, win: boolean, payout: number, hash: string, seed: string) => void;
  setShowProvablyFair: (b: boolean) => void;
}

export default function BlackjackGame({ balance, setBalance, logWager, setShowProvablyFair }: BlackjackProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, sendTransaction } = wallet;

  const [betAmount, setBetAmount] = useState<number>(0.1);
  const [gameState, setGameState] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const calculateHandTotal = (hand: number[]) => {
    let total = 0;
    let aces = 0;
    for (let card of hand) {
      let rank = card % 13;
      if (rank < 9) total += rank + 2; 
      else if (rank < 12) total += 10; 
      else { total += 11; aces++; }    
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return total;
  };

  const renderCard = (val: number, hidden = false, index = 0) => {
    const cardStyles = "w-16 h-24 sm:w-20 sm:h-28 rounded-md shadow-[2px_4px_10px_rgba(0,0,0,0.5)] object-contain";
    
    // Inject animation delay based on index so cards "fly in" sequentially
    const animStyle = {
      animation: `dealCard 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`,
      animationDelay: `${index * 150}ms`,
      opacity: 0,
      transform: 'translateY(-100px) rotateX(60deg) scale(0.8)'
    };
    
    if (hidden) return (
      <div style={animStyle}>
        <img src="/cards/card_back.png" alt="Hidden Card" className={cardStyles} />
      </div>
    );
    
    const suitMap = ['s', 'h', 'd', 'c']; 
    const rankMap = ['2','3','4','5','6','7','8','9','10','j','q','k','a'];
    
    const rank = rankMap[val % 13];
    const suit = suitMap[Math.floor(val / 13) % 4];
    
    return (
      <div style={animStyle}>
        <img src={`/cards/${rank}-${suit}.png`} alt={`${rank} of ${suit}`} className={cardStyles} />
      </div>
    );
  };

  const startGame = async () => {
    if (!publicKey) return setError("Connect wallet first!");
    if (betAmount > balance) return setError("Insufficient balance!");
    
    setLoading(true);
    setError(null);

    try {
      const seedRes = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3005'}/api/blackjack/seed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerPubkey: publicKey.toBase58() })
      });
      const seedData = await seedRes.json();
      if (!seedData.success) throw new Error("Failed to generate provably fair seed.");

      const hashBytes = Array.from(Buffer.from(seedData.serverSeedHash, 'hex'));

      const clientSeed = "mcpepe_" + Math.random().toString(36).substring(2, 10);
      const [gamePda] = PublicKey.findProgramAddressSync([Buffer.from("blackjack"), publicKey.toBuffer()], PROGRAM_ID);
      const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);

      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "confirmed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

      const lamports = Math.floor(betAmount * anchor.web3.LAMPORTS_PER_SOL);
      
      const tx = await program.methods.startBlackjack(
        new anchor.BN(lamports),
        hashBytes, 
        clientSeed,
        new anchor.BN(1)
      ).accounts({
        game: gamePda,
        player: publicKey,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      }).transaction();

      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");

      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3005'}/api/blackjack/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerPubkey: publicKey.toBase58(),
          gamePubkey: gamePda.toBase58(),
          clientSeed,
          betAmount: lamports
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setGameState(data);
      if (data.status === "resolved") {
        setBalance(balance - betAmount + (data.payout / anchor.web3.LAMPORTS_PER_SOL));
        logWager("Blackjack", betAmount, data.payout > 0, data.payout / anchor.web3.LAMPORTS_PER_SOL, signature, clientSeed);
      } else {
        setBalance(balance - betAmount);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to start game.");
    }
    setLoading(false);
  };

  const handleAction = async (action: string) => {
    if (!publicKey || !gameState) return;
    setLoading(true);

    try {
      if (action === "double" || action === "split" || action === "insurance") {
        const [gamePda] = PublicKey.findProgramAddressSync([Buffer.from("blackjack"), publicKey.toBuffer()], PROGRAM_ID);
        const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
        
        const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "confirmed" });
        const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
        
        const extraLamports = action === "insurance" 
          ? Math.floor((betAmount / 2) * anchor.web3.LAMPORTS_PER_SOL) 
          : Math.floor(betAmount * anchor.web3.LAMPORTS_PER_SOL);

        const tx = await program.methods.increaseBlackjackBet(new anchor.BN(extraLamports))
          .accounts({
            game: gamePda,
            player: publicKey,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          }).transaction();

        const signature = await sendTransaction(tx, connection);
        await connection.confirmTransaction(signature, "confirmed");
        setBalance(balance - (extraLamports / anchor.web3.LAMPORTS_PER_SOL));
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3005'}/api/blackjack/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerPubkey: publicKey.toBase58(), action })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setGameState(data.state);
      
      if (data.state.status === "resolved") {
        const payoutInSol = data.state.payout / anchor.web3.LAMPORTS_PER_SOL;
        setBalance(balance + payoutInSol);
        logWager("Blackjack", betAmount, payoutInSol > 0, payoutInSol, data.serverSeed, "mcpepe_action");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || `Failed to ${action}.`);
    }
    setLoading(false);
  };

  const handleClearStuck = async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const [gamePda] = PublicKey.findProgramAddressSync([Buffer.from("blackjack"), publicKey.toBuffer()], PROGRAM_ID);
      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "confirmed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

      const tx = await program.methods.cancelBlackjack().accounts({
        game: gamePda,
        player: publicKey,
      }).transaction();

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setError("Stuck game cleared! You can play normally now.");
      setGameState(null);
    } catch (err: any) {
      setError("Failed to clear. You either need to deploy the cancel_blackjack route to Anchor, or switch to Account 2.");
    }
    setLoading(false);
  };

  const allBust = gameState?.playerHands?.every((hand: number[]) => calculateHandTotal(hand) > 21) ?? false;
  const showDealerHoleCard = gameState?.status === "resolved" && !allBust;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto p-4 animate-fade-in relative">
      
      {/* 🚀 Custom Casino Keyframes */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes dealCard {
          0% { opacity: 0; transform: translateY(-100px) rotateX(60deg) scale(0.8); }
          100% { opacity: 1; transform: translateY(0) rotateX(0deg) scale(1); }
        }
        @keyframes resultPop {
          0% { transform: scale(0.5) rotate(-5deg); opacity: 0; }
          60% { transform: scale(1.2) rotate(3deg); opacity: 1; filter: brightness(1.5); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; filter: brightness(1); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(51, 153, 51, 0.4); }
          50% { box-shadow: 0 0 40px rgba(51, 153, 51, 0.8); }
        }
      `}} />

      <div className="w-full bg-[#0a0f0c] border border-[#339933] rounded-2xl p-6 shadow-[0_0_30px_rgba(51,153,51,0.2)]">
        
        <div className="flex justify-between items-center mb-8 border-b border-green-900/50 pb-4">
          <h2 className="text-3xl font-black uppercase tracking-widest text-[#FFC72C]">
            🃏 McPepe <span className="text-[#339933]">Blackjack</span>
          </h2>
          <button onClick={() => setShowProvablyFair(true)} className="text-xs text-gray-500 hover:text-[#339933] flex items-center gap-1 transition-colors">
            🛡️ Provably Fair
          </button>
        </div>

        {error && <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded-lg mb-6 text-center text-sm font-bold shadow-lg">{error}</div>}

        <div className="relative w-full min-h-[350px] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-900/40 via-[#0a0f0c] to-[#050806] rounded-xl border border-green-900/30 p-6 flex flex-col justify-between mb-6 overflow-hidden">
          
          {/* DEALER AREA */}
          <div className="flex flex-col items-center mb-10 z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Dealer</div>
              {gameState && (
                <div className="bg-black/90 border border-gray-700 text-white font-black text-sm px-3 py-1 rounded-md shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  {calculateHandTotal(showDealerHoleCard ? gameState.dealerCards : [gameState.dealerCards[0]])}
                </div>
              )}
            </div>
            
            <div className="flex gap-[-20px] relative">
              {gameState ? (
                gameState.dealerCards.map((c: number, i: number) => {
                  const isHidden = !showDealerHoleCard && i >= 1;
                  return (
                    <div key={`dealer-${i}-${c}`} className={`${i > 0 ? '-ml-10' : ''} transition-transform hover:-translate-y-3 z-${i}`}>
                      {renderCard(c, isHidden, i)}
                    </div>
                  );
                })
              ) : (
                <div className="flex gap-[-20px] opacity-40">
                  <div className="transition-transform hover:-translate-y-2">{renderCard(0, true, 0)}</div>
                  <div className="-ml-10 transition-transform hover:-translate-y-2">{renderCard(0, true, 1)}</div>
                </div>
              )}
            </div>
          </div>

          {/* MASSIVE OUTCOME BANNER (Only shows when resolved) */}
          {gameState?.status === "resolved" && (
            <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none bg-black/60 backdrop-blur-sm" style={{ animation: 'resultPop 0.6s ease-out forwards' }}>
              <div className={`px-12 py-6 rounded-2xl border-4 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col items-center
                ${gameState.payout > betAmount ? 'bg-green-900/80 border-[#339933] text-[#339933]' : 
                  gameState.payout === betAmount ? 'bg-gray-800/90 border-gray-400 text-white' : 
                  'bg-red-900/90 border-red-500 text-red-500'}`}
              >
                <span className="text-5xl font-black uppercase tracking-widest drop-shadow-[0_4px_4px_rgba(0,0,0,1)]">
                  {gameState.payout > betAmount * 2 ? 'BLACKJACK!' : 
                   gameState.payout > betAmount ? 'YOU WIN!' : 
                   gameState.payout === betAmount ? 'PUSH' : 'BUSTED'}
                </span>
                {gameState.payout > 0 && (
                  <span className="text-2xl font-bold mt-2 text-[#FFC72C] bg-black/50 px-4 py-1 rounded-lg">
                    +{Number(gameState.payout / anchor.web3.LAMPORTS_PER_SOL).toFixed(2)} SOL
                  </span>
                )}
              </div>
            </div>
          )}

          {/* PLAYER AREA */}
          <div className="flex flex-col items-center z-10">
            <div className="text-xs font-bold text-[#FFC72C] mb-2 uppercase tracking-widest">Player</div>
            <div className="flex gap-12">
              {gameState ? (
                gameState.playerHands.map((hand: number[], handIdx: number) => (
                  <div key={`player-hand-${handIdx}`} className="flex flex-col items-center">
                    
                    <div className="bg-black/90 border-2 border-[#339933] text-[#FFC72C] font-black text-sm px-4 py-1 rounded-md shadow-[0_2px_8px_rgba(51,153,51,0.4)] mb-4">
                      {calculateHandTotal(hand)}
                    </div>

                    <div className={`flex relative ${gameState.currentHandIndex === handIdx && gameState.status === 'playing' ? 'ring-4 ring-[#FFC72C] ring-offset-4 ring-offset-[#0a0f0c] rounded-xl p-2 bg-yellow-900/10' : ''}`}>
                      {hand.map((c: number, i: number) => (
                        <div key={`player-${handIdx}-${i}-${c}`} className={`${i > 0 ? '-ml-10' : ''} transition-transform hover:-translate-y-3 z-${i}`}>
                          {renderCard(c, false, i)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex gap-[-20px] opacity-40">
                  <div className="transition-transform hover:-translate-y-2">{renderCard(0, true, 0)}</div>
                  <div className="-ml-10 transition-transform hover:-translate-y-2">{renderCard(0, true, 1)}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CONTROLS (Chunky 3D Buttons) */}
        <div className="bg-black/60 rounded-xl p-6 border-t border-[#339933]/30 shadow-[inset_0_4px_20px_rgba(0,0,0,0.5)]">
          {!gameState || gameState.status === "resolved" ? (
            <div className="flex flex-col items-center">
              <div className="flex flex-col sm:flex-row gap-6 items-center justify-center w-full">
                
                <div className="bg-[#050806] border-2 border-gray-700 rounded-xl flex items-center px-4 py-3 w-full sm:w-auto shadow-inner">
                  <span className="text-[#FFC72C] font-black mr-3 text-lg">SOL</span>
                  <input 
                    type="number" value={betAmount} onChange={(e) => setBetAmount(Number(e.target.value))}
                    className="bg-transparent text-white font-black text-2xl outline-none w-28 text-right"
                    step="0.05" min="0.05"
                  />
                </div>

                <button 
                  onClick={startGame} disabled={loading}
                  className="w-full sm:w-auto bg-[#339933] text-white px-12 py-4 rounded-xl font-black text-xl uppercase tracking-widest transition-all 
                  border-b-8 border-green-900 active:border-b-0 active:translate-y-[8px] hover:bg-[#297a29] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
                  style={{ animation: !loading ? 'pulseGlow 2s infinite' : 'none' }}
                >
                  {loading ? 'Dealing...' : 'Deal Hand'}
                </button>

              </div>
              
              <button onClick={handleClearStuck} disabled={loading} className="mt-6 text-xs text-red-500/30 hover:text-red-500 font-bold transition-colors uppercase tracking-widest">
                Clear Stuck Game
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 justify-center">
              
              <button 
                onClick={() => handleAction('hit')} disabled={loading} 
                className="bg-green-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                border-b-[6px] border-green-900 active:border-b-0 active:translate-y-[6px] hover:bg-green-500 hover:brightness-110"
              >
                Hit
              </button>
              
              <button 
                onClick={() => handleAction('stand')} disabled={loading} 
                className="bg-red-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                border-b-[6px] border-red-900 active:border-b-0 active:translate-y-[6px] hover:bg-red-500 hover:brightness-110"
              >
                Stand
              </button>
              
              {gameState.playerHands[gameState.currentHandIndex]?.length === 2 && (
                <button 
                  onClick={() => handleAction('double')} disabled={loading} 
                  className="bg-[#FFC72C] text-black px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                  border-b-[6px] border-yellow-700 active:border-b-0 active:translate-y-[6px] hover:bg-yellow-400 hover:brightness-110"
                >
                  Double
                </button>
              )}
              
              {gameState.playerHands.length === 1 && gameState.playerHands[0].length === 2 && 
               (gameState.playerHands[0][0] % 13) === (gameState.playerHands[0][1] % 13) && (
                <button 
                  onClick={() => handleAction('split')} disabled={loading} 
                  className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                  border-b-[6px] border-blue-900 active:border-b-0 active:translate-y-[6px] hover:bg-blue-500 hover:brightness-110"
                >
                  Split
                </button>
              )}

              {gameState.insuranceOffered && (
                <button 
                  onClick={() => handleAction('insurance')} disabled={loading} 
                  className="bg-purple-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                  border-b-[6px] border-purple-900 active:border-b-0 active:translate-y-[6px] hover:bg-purple-500 hover:brightness-110 w-full sm:w-auto"
                >
                  Insurance (0.5x)
                </button>
              )}

            </div>
          )}
        </div>
        
      </div>
    </div>
  );
}