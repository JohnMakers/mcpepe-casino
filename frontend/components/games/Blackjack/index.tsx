// Author: John McAfee
import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import idl from '../../../idl.json';

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
  const [showOutcome, setShowOutcome] = useState<boolean>(false);

  // Sync outcome banner delay with dealer's draw time
  useEffect(() => {
    if (gameState?.status === "resolved") {
      const dealerExtraCards = Math.max(0, gameState.dealerCards.length - 2);
      const delay = 1500 + (dealerExtraCards * 600);
      const timer = setTimeout(() => setShowOutcome(true), delay);
      return () => clearTimeout(timer);
    } else {
      setShowOutcome(false);
    }
  }, [gameState?.status, gameState?.dealerCards?.length]);

  const calculateHandTotal = (hand: number[]) => {
    if (!hand || hand.length === 0) return 0;
    let total = 0;
    let aces = 0;
    for (let card of hand) {
      if (card === -1) continue; 
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

  const renderCard = (val: number, hidden = false, isDealer = false, index = 0, handIdx = 0) => {
    const isInitialDeal = gameState?.playerHands?.length === 1 && gameState?.playerHands[0].length <= 2;
    
    let flyDelay = 0;
    let flipDelay = 50; 
    
    if (isInitialDeal) {
      if (!isDealer && index === 0) { flyDelay = 0; flipDelay = 300; }
      else if (isDealer && index === 0) { flyDelay = 300; flipDelay = 600; }
      else if (!isDealer && index === 1) { flyDelay = 600; flipDelay = 900; }
      else if (isDealer && index === 1) { flyDelay = 900; flipDelay = 0; } 
    } else {
      flyDelay = index * 200;
      flipDelay = flyDelay + 200;
    }

    const wrapperStyle = {
      animation: `flyIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards`,
      animationDelay: `${flyDelay}ms`,
      opacity: 0,
      transform: 'translateY(-200px) scale(0.6)'
    };

    const suitMap = ['s', 'h', 'd', 'c']; 
    const rankMap = ['2','3','4','5','6','7','8','9','10','j','q','k','a'];
    const rank = val !== -1 ? rankMap[val % 13] : '';
    const suit = val !== -1 ? suitMap[Math.floor(val / 13) % 4] : '';

    return (
      <div style={wrapperStyle} className="relative w-14 h-20 sm:w-20 sm:h-28 perspective-1000">
        <div 
          className="w-full h-full relative preserve-3d transition-transform duration-700 ease-out"
          style={{ 
            transform: hidden ? 'rotateY(0deg)' : 'rotateY(180deg)',
            transitionDelay: !hidden && isInitialDeal ? `${flipDelay}ms` : '0ms'
          }}
        >
          <img 
            src="/cards/card_back.png" 
            alt="Card Back" 
            // 🐛 FIX: Replaced rectangular box-shadow with alpha-hugging drop-shadow filter
            className="absolute w-full h-full backface-hidden drop-shadow-[2px_4px_6px_rgba(0,0,0,0.6)] object-contain" 
          />
          {val !== -1 && (
            <img 
              src={`/cards/${rank}-${suit}.png`} 
              alt="Card Face" 
              // 🐛 FIX: Replaced rectangular box-shadow with alpha-hugging drop-shadow filter
              className="absolute w-full h-full backface-hidden drop-shadow-[2px_4px_6px_rgba(0,0,0,0.6)] object-contain [transform:rotateY(180deg)]" 
            />
          )}
        </div>
      </div>
    );
  };

  const startGame = async () => {
    if (!publicKey) return setError("Connect wallet first!");
    if (betAmount > balance) return setError("Insufficient balance!");
    
    setLoading(true);
    setError(null);
    setGameState(null);
    setShowOutcome(false);

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

      setTimeout(() => {
        setGameState(data);
        if (data.status === "resolved") {
          setBalance(balance - betAmount + (data.payout / anchor.web3.LAMPORTS_PER_SOL));
          logWager("Blackjack", betAmount, data.payout > 0, data.payout / anchor.web3.LAMPORTS_PER_SOL, signature, clientSeed);
        } else {
          setBalance(balance - betAmount);
        }
      }, 50);

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

  const currentHandIdx = gameState?.currentHandIndex || 0;
  const allBust = gameState?.playerHands?.every((hand: number[]) => calculateHandTotal(hand) > 21) ?? false;
  const showDealerHoleCard = gameState?.status === "resolved" && !allBust;

  let displayDealerCards = gameState ? [...gameState.dealerCards] : [];
  if (gameState && gameState.status === "playing" && displayDealerCards.length === 1) {
    displayDealerCards.push(-1); 
  }

  let outcomeText = "";
  if (gameState?.status === "resolved") {
    const isNaturalBlackjack = gameState.playerHands?.length === 1 && gameState.playerHands[0].length === 2 && calculateHandTotal(gameState.playerHands[0]) === 21;
    
    if (allBust) {
      outcomeText = "BUSTED";
    } else if (isNaturalBlackjack && gameState.payout > betAmount) {
      outcomeText = "BLACKJACK!";
    } else if (gameState.payout > betAmount) {
      outcomeText = "YOU WIN!";
    } else if (gameState.payout === betAmount) {
      outcomeText = "PUSH";
    } else {
      outcomeText = "DEALER WINS";
    }
  }

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-5xl mx-auto p-4 animate-fade-in relative">
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes flyIn {
          0% { opacity: 0; transform: translateY(-200px) scale(0.6); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .perspective-1000 { perspective: 1000px; }
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
      `}} />

      <div className="w-full bg-[#0a0f0c] border border-[#339933] rounded-2xl p-6 shadow-[0_0_30px_rgba(51,153,51,0.2)]">
        
        <div className="flex justify-between items-center mb-6 border-b border-green-900/50 pb-4">
          <h2 className="text-3xl font-black uppercase tracking-widest text-[#FFC72C]">
            🃏 McPepe <span className="text-[#339933]">Blackjack</span>
          </h2>
          <button onClick={() => setShowProvablyFair(true)} className="text-xs text-gray-500 hover:text-[#339933] flex items-center gap-1 transition-colors">
            🛡️ Provably Fair
          </button>
        </div>

        {error && <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded-lg mb-6 text-center text-sm font-bold shadow-lg">{error}</div>}

        <div 
          className="relative w-full aspect-[4/3] sm:aspect-[16/9] rounded-2xl border-4 border-green-900/50 shadow-2xl overflow-hidden mb-6"
          style={{ 
            backgroundImage: "url('/cards/blackjack_bg.png')", 
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        >
          <div className="absolute inset-0 bg-black/20 pointer-events-none"></div>

          {/* DEALER AREA */}
          <div className="absolute top-[10%] sm:top-[15%] left-1/2 -translate-x-1/2 flex flex-col items-center z-10 w-full">
            <div className="flex items-center gap-3 mb-2">
              <div className="text-[10px] sm:text-xs font-bold text-gray-300/80 uppercase tracking-widest bg-black/60 px-3 py-1 rounded-full">Dealer</div>
              {gameState && (
                <div className="bg-black/90 border border-gray-700 text-white font-black text-sm px-3 py-1 rounded-md shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                  {calculateHandTotal(showDealerHoleCard ? gameState.dealerCards : [gameState.dealerCards[0]])}
                </div>
              )}
            </div>
            
            {/* 🐛 FIX: Reduced negative margin from -ml-12 to -ml-8 for better spreading */}
            <div className="flex relative h-24 sm:h-32">
              {gameState ? (
                displayDealerCards.map((c: number, i: number) => {
                  const isHidden = !showDealerHoleCard && i >= 1;
                  return (
                    <div key={`dealer-${i}`} className={`${i > 0 ? '-ml-5 sm:-ml-8' : ''}`} style={{ zIndex: i }}>
                      {renderCard(c, isHidden, true, i)}
                    </div>
                  );
                })
              ) : (
                // 🐛 FIX: Removed opacity-40 so cards sit completely solid on the table
                <div className="flex">
                  <div style={{ zIndex: 0 }}>{renderCard(-1, true, true, 0)}</div>
                  <div className="-ml-5 sm:-ml-8" style={{ zIndex: 1 }}>{renderCard(-1, true, true, 1)}</div>
                </div>
              )}
            </div>
          </div>

          {/* SLEEK OUTCOME PLAQUE */}
          {showOutcome && gameState?.status === "resolved" && (
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 animate-fade-in drop-shadow-[0_0_30px_rgba(0,0,0,1)] w-11/12 sm:w-auto">
                <div className={`px-6 sm:px-10 py-3 sm:py-4 rounded-xl border-4 flex flex-col items-center justify-center gap-2
                  ${gameState.payout > betAmount ? 'bg-green-900/95 border-[#339933] text-[#339933]' : 
                    gameState.payout === betAmount ? 'bg-gray-800/95 border-gray-400 text-white' : 
                    'bg-red-900/95 border-red-600 text-red-500'}`}
                >
                  <span className="text-3xl sm:text-4xl font-black uppercase tracking-widest drop-shadow-lg text-center">
                    {outcomeText}
                  </span>
                  {gameState.payout > 0 && (
                    <span className="text-xl sm:text-2xl font-black text-[#FFC72C] bg-black/80 px-4 py-1 rounded-lg">
                      +{Number(gameState.payout / anchor.web3.LAMPORTS_PER_SOL).toFixed(2)} SOL
                    </span>
                  )}
                </div>
             </div>
          )}

          {/* PLAYER AREA */}
          <div className="absolute bottom-[5%] sm:bottom-[10%] left-1/2 -translate-x-1/2 flex flex-col items-center z-10 w-full">
            <div className="flex gap-6 sm:gap-12">
              {gameState ? (
                gameState.playerHands.map((hand: number[], handIdx: number) => (
                  <div key={`player-hand-${handIdx}`} className="flex flex-col items-center">
                    
                    {/* 🐛 FIX: Reduced negative margin from -ml-12 to -ml-8 for better spreading */}
                    <div className={`flex relative h-24 sm:h-32 mb-3 ${currentHandIdx === handIdx && gameState.status === 'playing' ? 'ring-4 ring-[#FFC72C] ring-offset-4 ring-offset-black/50 rounded-xl p-1 bg-yellow-900/30' : ''}`}>
                      {hand.map((c: number, i: number) => (
                        <div key={`player-${handIdx}-${i}`} className={`${i > 0 ? '-ml-5 sm:-ml-8' : ''}`} style={{ zIndex: i }}>
                          {renderCard(c, false, false, i, handIdx)}
                        </div>
                      ))}
                    </div>

                    <div className="bg-black/90 border-2 border-[#339933] text-[#FFC72C] font-black text-sm px-4 py-1 rounded-md shadow-[0_4px_10px_rgba(0,0,0,0.8)] mt-2">
                      {calculateHandTotal(hand)}
                    </div>
                  </div>
                ))
              ) : (
                // 🐛 FIX: Removed opacity-40 so cards sit completely solid on the table
                <div className="flex flex-col items-center">
                  <div className="flex">
                    <div style={{ zIndex: 0 }}>{renderCard(-1, true, false, 0)}</div>
                    <div className="-ml-5 sm:-ml-8" style={{ zIndex: 1 }}>{renderCard(-1, true, false, 1)}</div>
                  </div>
                  <div className="text-[10px] sm:text-xs font-bold text-gray-300/80 uppercase tracking-widest bg-black/60 px-3 py-1 rounded-full mt-4">You</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CONTROLS */}
        <div className="bg-black/60 rounded-xl p-6 border-t border-[#339933]/30 shadow-[inset_0_4px_20px_rgba(0,0,0,0.5)] min-h-[100px] flex flex-col justify-center">
          {!gameState || gameState.status === "resolved" ? (
            <div className="flex flex-col items-center w-full">
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
                >
                  {loading ? 'Dealing...' : 'Deal Hand'}
                </button>

              </div>
              
              <button onClick={handleClearStuck} disabled={loading} className="mt-6 text-xs text-red-500/30 hover:text-red-500 font-bold transition-colors uppercase tracking-widest">
                Clear Stuck Game
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 justify-center w-full">
              
              <button 
                onClick={() => handleAction('hit')} disabled={loading} 
                className="bg-green-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                border-b-[6px] border-green-900 active:border-b-0 active:translate-y-[6px] hover:bg-green-500 hover:brightness-110 flex-1 sm:flex-none min-w-[120px]"
              >
                Hit
              </button>
              
              <button 
                onClick={() => handleAction('stand')} disabled={loading} 
                className="bg-red-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                border-b-[6px] border-red-900 active:border-b-0 active:translate-y-[6px] hover:bg-red-500 hover:brightness-110 flex-1 sm:flex-none min-w-[120px]"
              >
                Stand
              </button>
              
              {gameState.playerHands[currentHandIdx]?.length === 2 && (
                <button 
                  onClick={() => handleAction('double')} disabled={loading} 
                  className="bg-[#FFC72C] text-black px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                  border-b-[6px] border-yellow-700 active:border-b-0 active:translate-y-[6px] hover:bg-yellow-400 hover:brightness-110 flex-1 sm:flex-none min-w-[120px]"
                >
                  Double
                </button>
              )}
              
              {gameState.playerHands.length === 1 && gameState.playerHands[0].length === 2 && 
               (gameState.playerHands[0][0] % 13) === (gameState.playerHands[0][1] % 13) && (
                <button 
                  onClick={() => handleAction('split')} disabled={loading} 
                  className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black text-lg uppercase tracking-wider transition-all 
                  border-b-[6px] border-blue-900 active:border-b-0 active:translate-y-[6px] hover:bg-blue-500 hover:brightness-110 flex-1 sm:flex-none min-w-[120px]"
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