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

  const renderCard = (val: number, hidden = false) => {
    const cardStyles = "w-16 h-24 sm:w-20 sm:h-28 rounded-md shadow-md object-contain";
    
    // Updated to pull from the /cards/ directory
    if (hidden) return (
      <img src="/cards/card_back.png" alt="Hidden Card" className={cardStyles} />
    );
    
    const suitMap = ['s', 'h', 'd', 'c']; 
    const rankMap = ['2','3','4','5','6','7','8','9','10','j','q','k','a'];
    
    const rank = rankMap[val % 13];
    const suit = suitMap[Math.floor(val / 13) % 4];
    
    // Updated to pull from the /cards/ directory
    return (
      <img src={`/cards/${rank}-${suit}.png`} alt={`${rank} of ${suit}`} className={cardStyles} />
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
    } catch (err: any) {
      setError("Failed to clear. You either need to deploy the cancel_blackjack route to Anchor, or switch to Account 2.");
    }
    setLoading(false);
  };

  // Evaluate if player busted all hands to hide dealer's hole card
  const allBust = gameState?.playerHands?.every((hand: number[]) => calculateHandTotal(hand) > 21) ?? false;
  const showDealerHoleCard = gameState?.status === "resolved" && !allBust;

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-4xl mx-auto p-4 animate-fade-in">
      <div className="w-full bg-[#0a0f0c] border border-[#339933] rounded-2xl p-6 shadow-[0_0_30px_rgba(51,153,51,0.2)]">
        
        <div className="flex justify-between items-center mb-8 border-b border-green-900/50 pb-4">
          <h2 className="text-3xl font-black uppercase tracking-widest text-[#FFC72C]">
            🃏 McPepe <span className="text-[#339933]">Blackjack</span>
          </h2>
          <button onClick={() => setShowProvablyFair(true)} className="text-xs text-gray-500 hover:text-[#339933] flex items-center gap-1 transition-colors">
            🛡️ Provably Fair
          </button>
        </div>

        {error && <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded-lg mb-6 text-center text-sm">{error}</div>}

        <div className="relative w-full min-h-[300px] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-900/40 via-[#0a0f0c] to-[#050806] rounded-xl border border-green-900/30 p-6 flex flex-col justify-between mb-6">
          
          {/* DEALER AREA */}
          <div className="flex flex-col items-center mb-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Dealer</div>
              {gameState && (
                <div className="bg-black/80 border border-gray-700 text-white font-black text-xs px-2 py-1 rounded shadow-inner">
                  {calculateHandTotal(showDealerHoleCard ? gameState.dealerCards : [gameState.dealerCards[0]])}
                </div>
              )}
            </div>
            
            <div className="flex gap-[-20px]">
              {gameState ? (
                gameState.dealerCards.map((c: number, i: number) => {
                  const isHidden = !showDealerHoleCard && i >= 1;
                  return (
                    <div key={i} className={`${i > 0 ? '-ml-8' : ''} transition-transform hover:-translate-y-2`}>
                      {renderCard(c, isHidden)}
                    </div>
                  );
                })
              ) : (
                <div className="flex gap-[-20px]">
                  <div className="transition-transform hover:-translate-y-2">{renderCard(0, true)}</div>
                  <div className="-ml-8 transition-transform hover:-translate-y-2">{renderCard(0, true)}</div>
                </div>
              )}
            </div>
          </div>

          {/* PLAYER AREA */}
          <div className="flex flex-col items-center">
            <div className="text-xs font-bold text-[#FFC72C] mb-2 uppercase tracking-widest">Player</div>
            <div className="flex gap-8">
              {gameState ? (
                gameState.playerHands.map((hand: number[], handIdx: number) => (
                  <div key={handIdx} className="flex flex-col items-center">
                    
                    <div className="bg-black/80 border border-[#339933] text-[#FFC72C] font-black text-xs px-3 py-1 rounded shadow-inner mb-3">
                      {calculateHandTotal(hand)}
                    </div>

                    <div className={`flex ${gameState.currentHandIndex === handIdx && gameState.status === 'playing' ? 'ring-2 ring-[#FFC72C] rounded-xl p-2' : ''}`}>
                      {hand.map((c: number, i: number) => (
                        <div key={i} className={`${i > 0 ? '-ml-8' : ''} transition-transform hover:-translate-y-2`}>
                          {renderCard(c)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex gap-[-20px]">
                  <div className="transition-transform hover:-translate-y-2">{renderCard(0, true)}</div>
                  <div className="-ml-8 transition-transform hover:-translate-y-2">{renderCard(0, true)}</div>
                </div>
              )}
            </div>
            {gameState?.status === "resolved" && (
              <div className={`mt-6 text-2xl font-black uppercase tracking-widest ${gameState.payout > 0 ? 'text-[#339933] drop-shadow-[0_0_10px_rgba(51,153,51,0.8)]' : 'text-red-500'}`}>
                {gameState.payout > 0 ? `+${(gameState.payout / anchor.web3.LAMPORTS_PER_SOL).toFixed(2)} SOL` : 'BUSTED'}
              </div>
            )}
          </div>
        </div>

        {/* CONTROLS */}
        <div className="bg-black/50 rounded-xl p-4 border border-gray-800">
          {!gameState || gameState.status === "resolved" ? (
            <div className="flex flex-col items-center">
              <div className="flex flex-col sm:flex-row gap-4 items-center justify-center w-full">
                <div className="bg-black border border-gray-700 rounded-lg flex items-center px-4 py-3 w-full sm:w-auto">
                  <span className="text-gray-400 font-bold mr-2">SOL</span>
                  <input 
                    type="number" value={betAmount} onChange={(e) => setBetAmount(Number(e.target.value))}
                    className="bg-transparent text-white font-black text-xl outline-none w-24 text-right"
                    step="0.05" min="0.05"
                  />
                </div>
                <button 
                  onClick={startGame} disabled={loading}
                  className="w-full sm:w-auto bg-[#339933] hover:bg-[#297a29] text-white px-10 py-3 rounded-lg font-black text-lg uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(51,153,51,0.4)] disabled:opacity-50"
                >
                  {loading ? 'Dealing...' : 'Deal Hand'}
                </button>
              </div>
              
              <button onClick={handleClearStuck} disabled={loading} className="mt-4 text-xs text-red-500/50 hover:text-red-500 transition-colors uppercase tracking-widest">
                Clear Stuck Game
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 justify-center">
              {gameState.insuranceOffered && (
                <button onClick={() => handleAction('insurance')} disabled={loading} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-lg font-black uppercase tracking-wider transition-all w-full sm:w-auto">
                  Insurance (0.5x)
                </button>
              )}
              <button onClick={() => handleAction('hit')} disabled={loading} className="bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white px-8 py-3 rounded-lg font-black uppercase tracking-wider transition-all">
                Hit
              </button>
              <button onClick={() => handleAction('stand')} disabled={loading} className="bg-red-600 hover:bg-red-500 text-white px-8 py-3 rounded-lg font-black uppercase tracking-wider transition-all">
                Stand
              </button>
              {gameState.playerHands[gameState.currentHandIndex]?.length === 2 && (
                <button onClick={() => handleAction('double')} disabled={loading} className="bg-[#FFC72C] hover:bg-yellow-400 text-black px-8 py-3 rounded-lg font-black uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(255,199,44,0.3)]">
                  Double
                </button>
              )}
              {gameState.playerHands.length === 1 && gameState.playerHands[0].length === 2 && 
               (gameState.playerHands[0][0] % 13) === (gameState.playerHands[0][1] % 13) && (
                <button onClick={() => handleAction('split')} disabled={loading} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-black uppercase tracking-wider transition-all">
                  Split
                </button>
              )}
            </div>
          )}
        </div>
        
      </div>
    </div>
  );
}