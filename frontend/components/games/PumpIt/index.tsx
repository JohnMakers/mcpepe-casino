import React, { useState, useEffect } from 'react';
import pumpData from '../../../config/pumpMultipliers.json';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import idl from '../../../idl.json';

// Types
type GameState = 'IDLE' | 'PLAYING' | 'CASHED_OUT' | 'RUGGED';
type Difficulty = 'easy' | 'medium' | 'hard';

interface ChartPoint {
  step: number;
  multiplier: number;
}

// Ensure this matches your actual program ID
const PROGRAM_ID = new PublicKey("BNpcicNi55iYT6yfe2isgHnqqSWBtAr8qfiGwpKbxyuz");

export default function PumpIt() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [gameState, setGameState] = useState<GameState>('IDLE');
  const [betAmount, setBetAmount] = useState<number>(0.1); 
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([{ step: 0, multiplier: 1.0 }]);
  const [clientSeed, setClientSeed] = useState<string>('');
  
  const [gameStateKeypair, setGameStateKeypair] = useState<Keypair | null>(null);
  const [unhashedServerSeed, setUnhashedServerSeed] = useState<string>('');
  const [isHoveringPump, setIsHoveringPump] = useState(false);

  // Forcefully cast the JSON type to bypass TypeScript's aggressive JSON caching
  const levels = pumpData.levels as Record<Difficulty, { marginalProbabilities: number[], multipliers: number[] }>;
  const currentLevelData = levels[difficulty];
  const maxSteps = 24;

  useEffect(() => {
    setClientSeed(Math.random().toString(36).substring(2, 15));
  }, []);

  const handleStartGame = async () => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      alert("Please connect your Phantom wallet first!");
      return;
    }

    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
      
      const newGameStateKeypair = Keypair.generate();
      setGameStateKeypair(newGameStateKeypair);
      
      const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
      
      const seed = "pumpit_server_" + Date.now().toString();
      setUnhashedServerSeed(seed);
      
      const encoder = new TextEncoder();
      const encodedSeed = encoder.encode(seed);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encodedSeed as any);
      const serverSeedHash = Array.from(new Uint8Array(hashBuffer));
      
      const betAmountLamports = new anchor.BN(betAmount * anchor.web3.LAMPORTS_PER_SOL);
      const diffIndex = difficulty === 'easy' ? 0 : difficulty === 'medium' ? 1 : 2;
      
      console.log("Triggering Phantom to Start Game...");
      const tx = await program.methods.startPump(
          betAmountLamports, 
          diffIndex, 
          serverSeedHash, 
          clientSeed, 
          new anchor.BN(0) 
      ).accounts({
          gameState: newGameStateKeypair.publicKey,
          player: wallet.publicKey,
          vault: vaultPDA,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
      }).signers([newGameStateKeypair]).rpc();
      
      console.log("Tx Confirmed:", tx);
      
      setGameState('PLAYING');
      setCurrentStep(0);
      setChartPoints([{ step: 0, multiplier: 1.0 }]);
    } catch (error) {
      console.error("Failed to start game", error);
      alert("Transaction failed or was rejected.");
    }
  };

  const handlePump = async () => {
    if (gameState !== 'PLAYING' || currentStep >= maxSteps || !gameStateKeypair || !wallet.publicKey) return;

    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
      
      console.log("Triggering Phantom to Keep Holding...");
      const tx = await program.methods.processPump(unhashedServerSeed).accounts({
          gameState: gameStateKeypair.publicKey,
          authority: wallet.publicKey, 
      }).rpc();
      
      console.log("Pump Tx Confirmed:", tx);

      const state = await program.account.pumpGameState.fetch(gameStateKeypair.publicKey);
      
      if (state.isActive) {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        setChartPoints(prev => [...prev, { 
          step: nextStep, 
          multiplier: currentLevelData.multipliers[nextStep - 1] 
        }]);
      } else {
        setGameState('RUGGED');
        setChartPoints(prev => [...prev, { step: currentStep + 1, multiplier: 0 }]); 
        broadcastWager('RUGGED', 0);
      }
    } catch (error) {
      console.error("Failed to pump", error);
    }
  };

  const handleCashOut = async () => {
    if (gameState !== 'PLAYING' || currentStep === 0 || !gameStateKeypair || !wallet.publicKey) return;

    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
      const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);
      const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);

      const finalMultiplier = currentLevelData.multipliers[currentStep - 1];
      const finalMultiplierBps = new anchor.BN(Math.floor(finalMultiplier * 10000));
      
      console.log("Triggering Phantom to Cash Out...");
      const tx = await program.methods.cashOutPump(finalMultiplierBps).accounts({
          gameState: gameStateKeypair.publicKey,
          player: wallet.publicKey,
          vault: vaultPDA,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
      }).rpc();
      
      console.log("Cash Out Tx Confirmed:", tx);

      setGameState('CASHED_OUT');
      broadcastWager('CASH_OUT', finalMultiplier);
    } catch (error) {
      console.error("Failed to cash out", error);
    }
  };

  const broadcastWager = (event: 'CASH_OUT' | 'RUGGED', finalMultiplier: number) => {
    console.log("WS Broadcast Placeholder:", { game: "Pump It", event, bet: betAmount, payout: event === 'CASH_OUT' ? betAmount * finalMultiplier : 0 });
  };

  const currentMultiplier = currentStep === 0 ? 1.0 : currentLevelData.multipliers[currentStep - 1];
  const nextMultiplier = currentStep < maxSteps ? currentLevelData.multipliers[currentStep] : null;

  // Use the safe probability for display to prevent index out of bounds
  const displayProbability = currentLevelData.marginalProbabilities[currentStep < maxSteps ? currentStep : maxSteps - 1];

  const renderChart = () => {
    const chartWidth = 600;
    const chartHeight = 300;
    const maxMultiplierRender = Math.max(2, ...chartPoints.map(p => p.multiplier)) * 1.2;
    
    const points = chartPoints.map((p, index) => {
      const x = (index / maxSteps) * chartWidth;
      const y = chartHeight - (p.multiplier / maxMultiplierRender) * chartHeight;
      return `${x},${y}`;
    }).join(' ');

    const isRugged = gameState === 'RUGGED';

    return (
      <div className="relative w-full h-64 bg-[#050806] border border-green-900/50 rounded-lg overflow-hidden flex items-center justify-center">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="absolute inset-0 w-full h-full p-4 overflow-visible">
          <polyline
            fill="none"
            stroke={isRugged ? "#ef4444" : "#22c55e"} 
            strokeWidth="4"
            points={points}
            className="transition-all duration-300 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]"
          />
          {chartPoints.map((p, i) => {
            const x = (i / maxSteps) * chartWidth;
            const y = chartHeight - (p.multiplier / maxMultiplierRender) * chartHeight;
            return (
              <circle key={i} cx={x} cy={y} r="6" fill={isRugged && i === chartPoints.length - 1 ? "#ef4444" : "#22c55e"} />
            );
          })}
        </svg>

        {gameState === 'RUGGED' && (
          <div className="absolute inset-0 bg-red-900/40 flex flex-col items-center justify-center backdrop-blur-sm z-10">
            <div className="text-6xl mb-4">📉🐸</div> 
            <h2 className="text-4xl font-black text-red-500 uppercase tracking-widest drop-shadow-md">Rugged!</h2>
            <p className="text-red-200 mt-2">The devs dumped on you.</p>
          </div>
        )}

        {gameState === 'CASHED_OUT' && (
          <div className="absolute inset-0 bg-green-900/40 flex flex-col items-center justify-center backdrop-blur-sm z-10">
            <div className="text-6xl mb-4">💰🐸</div>
            <h2 className="text-4xl font-black text-green-400 uppercase tracking-widest drop-shadow-md">Secured the Bag</h2>
            <p className="text-green-200 mt-2 text-xl font-bold">{currentMultiplier.toFixed(4)}x Payout</p>
          </div>
        )}

        {gameState === 'PLAYING' && (
          <div className="absolute top-4 left-4 z-0">
            <span className="text-5xl font-black text-green-500/30 tracking-tighter">
              {currentMultiplier.toFixed(4)}x
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 w-full max-w-6xl mx-auto">
      <div className="w-full md:w-80 flex flex-col gap-4 shrink-0 bg-[#0a0f0c] p-6 rounded-xl border border-gray-800">
        
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Difficulty</label>
          <div className="flex gap-2 bg-black p-1 rounded-lg border border-gray-800">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map(lvl => (
              <button
                key={lvl}
                disabled={gameState === 'PLAYING'}
                onClick={() => setDifficulty(lvl)}
                className={`flex-1 py-2 text-sm font-black uppercase rounded-md transition-all ${
                  difficulty === lvl 
                    ? 'bg-green-600 text-black shadow-[0_0_10px_rgba(34,197,94,0.3)]' 
                    : 'text-gray-400 hover:text-white disabled:opacity-50 disabled:hover:text-gray-400'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-400 text-center">
            Next Pump Chance: <span className="text-green-400 font-bold">{Math.round(displayProbability * 100)}%</span>
          </div>
        </div>

        <div className="space-y-2 mt-4">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Bet Amount (SOL)</label>
          <div className="flex gap-2">
            <input 
              type="number" 
              value={betAmount}
              onChange={(e) => setBetAmount(Number(e.target.value))}
              disabled={gameState === 'PLAYING'}
              className="w-full bg-black border border-gray-800 rounded-lg p-3 text-white font-mono focus:border-green-500 outline-none disabled:opacity-50"
            />
            <button 
              onClick={() => setBetAmount(prev => prev / 2)}
              disabled={gameState === 'PLAYING'}
              className="px-4 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 font-bold hover:bg-gray-800 disabled:opacity-50"
            >
              ½
            </button>
            <button 
              onClick={() => setBetAmount(prev => prev * 2)}
              disabled={gameState === 'PLAYING'}
              className="px-4 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 font-bold hover:bg-gray-800 disabled:opacity-50"
            >
              2x
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {gameState === 'IDLE' || gameState === 'RUGGED' || gameState === 'CASHED_OUT' ? (
             <button 
               onClick={handleStartGame}
               className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black uppercase tracking-widest rounded-lg transition-all shadow-[0_0_20px_rgba(34,197,94,0.2)] hover:shadow-[0_0_30px_rgba(34,197,94,0.4)]"
             >
               Start Game
             </button>
          ) : (
            <>
              <div 
                className="relative"
                onMouseEnter={() => setIsHoveringPump(true)}
                onMouseLeave={() => setIsHoveringPump(false)}
              >
                <button 
                  onClick={handlePump}
                  className="w-full py-4 bg-green-600 hover:bg-green-500 text-black font-black uppercase tracking-widest rounded-lg transition-all"
                >
                  Keep Holding 📈
                </button>
                
                {isHoveringPump && nextMultiplier && (
                  <div className="absolute bottom-full left-0 w-full mb-2 bg-black border border-green-900 rounded-lg p-3 shadow-xl z-20">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400">Next Multiplier:</span>
                      <span className="text-green-400 font-bold">{nextMultiplier.toFixed(4)}x</span>
                    </div>
                    <div className="flex justify-between items-center text-sm mt-1">
                      <span className="text-gray-400">Success Chance:</span>
                      <span className="text-white font-bold">{Math.round(displayProbability * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={handleCashOut}
                disabled={currentStep === 0}
                className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white font-black uppercase tracking-widest rounded-lg transition-all border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cash Out ({currentMultiplier.toFixed(4)}x)
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4">
        <div className="flex justify-between items-center bg-[#0a0f0c] border border-gray-800 p-4 rounded-xl">
          <div>
            <div className="text-xs text-gray-500 font-bold uppercase">Current Step</div>
            <div className="text-xl text-white font-mono">{currentStep} / {maxSteps}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 font-bold uppercase">Current Payout</div>
            <div className="text-xl text-green-400 font-mono">
               {(betAmount * currentMultiplier).toFixed(4)} SOL
            </div>
          </div>
        </div>
        {renderChart()}
      </div>
    </div>
  );
}