import React, { useState, useEffect } from 'react';
import pumpData from '../../../config/pumpMultipliers.json';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import idl from '../../../idl.json';

type GameState = 'IDLE' | 'PLAYING' | 'CASHED_OUT' | 'RUGGED';
type Difficulty = 'easy' | 'medium' | 'hard';

interface ChartPoint {
  step: number;
  multiplier: number;
}

// ⚠️ IMPORTANT: Paste your actual Program ID from 'anchor keys list' here!
const PROGRAM_ID = new PublicKey("7pKD7FV7Pebd8ZSYgzoTHE79aFnoPLGnudHH4fpvxgSw"); 

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

  const [time, setTime] = useState(0);
  const [popTarget, setPopTarget] = useState<{ mult: number, key: number } | null>(null);

  const levels = pumpData.levels as Record<Difficulty, { marginalProbabilities: number[], multipliers: number[] }>;
  const currentLevelData = levels[difficulty];
  const maxSteps = 24;

  useEffect(() => {
    setClientSeed(Math.random().toString(36).substring(2, 15));
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState === 'PLAYING') {
      interval = setInterval(() => setTime(Date.now()), 40); 
    }
    return () => clearInterval(interval);
  }, [gameState]);

  // --- Bet Input Handlers ---
  const handleBetChange = (val: number) => {
    // Prevent negative numbers and enforce 0.1 minimum
    const safeVal = Math.max(0.1, val);
    // Round to 2 decimal places to avoid floating point weirdness
    setBetAmount(Math.round(safeVal * 100) / 100);
  };

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
      
      setGameState('PLAYING');
      setCurrentStep(0);
      setChartPoints([{ step: 0, multiplier: 1.0 }]);
      setPopTarget(null);
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
      
      const tx = await program.methods.processPump(unhashedServerSeed).accounts({
          gameState: gameStateKeypair.publicKey,
          authority: wallet.publicKey, 
      }).rpc();
      
      const state = await program.account.pumpGameState.fetch(gameStateKeypair.publicKey);
      
      if (state.isActive) {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        const newMult = currentLevelData.multipliers[nextStep - 1];
        setChartPoints(prev => [...prev, { step: nextStep, multiplier: newMult }]);
        
        setPopTarget({ mult: newMult, key: Date.now() });
      } else {
        setGameState('RUGGED');
        setChartPoints(prev => [...prev, { step: currentStep + 1, multiplier: 0 }]); 
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
      
      const tx = await program.methods.cashOutPump(finalMultiplierBps).accounts({
          gameState: gameStateKeypair.publicKey,
          player: wallet.publicKey,
          vault: vaultPDA,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
      }).rpc();

      setGameState('CASHED_OUT');
    } catch (error) {
      console.error("Failed to cash out", error);
    }
  };

  const currentMultiplier = currentStep === 0 ? 1.0 : currentLevelData.multipliers[currentStep - 1];
  const nextMultiplier = currentStep < maxSteps ? currentLevelData.multipliers[currentStep] : null;
  const displayProbability = currentLevelData.marginalProbabilities[currentStep < maxSteps ? currentStep : maxSteps - 1];

  const renderChart = () => {
    const stepWidth = 120; 
    const chartHeight = 300;
    const viewBoxWidth = 600;
    const isRugged = gameState === 'RUGGED';

    const highestValToRender = Math.max(1.5, ...chartPoints.map(p => p.multiplier), nextMultiplier ? nextMultiplier : 0);
    const maxRenderedMultiplier = highestValToRender * 1.2;

    const pointsData = chartPoints.map((p) => {
      const x = p.step * stepWidth;
      const y = chartHeight - (p.multiplier / maxRenderedMultiplier) * chartHeight * 0.8;
      return { x, y };
    });

    const lastPoint = pointsData[pointsData.length - 1];

    let liveX = lastPoint.x;
    let liveY = lastPoint.y;
    if (gameState === 'PLAYING') {
        const noiseX = (Math.sin(time / 400) + 1) * 12; 
        const noiseY = Math.sin(time / 150) * 8 + Math.cos(time / 250) * 6; 
        liveX += noiseX;
        liveY += noiseY;
    }

    const targetViewX = Math.max(0, liveX - viewBoxWidth + stepWidth * 1.5);

    const historicalPath = pointsData.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const fullPath = isRugged ? historicalPath : `${historicalPath} L ${liveX} ${liveY}`;
    const areaPath = `${fullPath} L ${isRugged ? lastPoint.x : liveX} ${chartHeight} L 0 ${chartHeight} Z`;

    const neonStrokeColor = isRugged ? "#ff2a2a" : "#39ff14"; 
    const fillColor = isRugged ? "#ef4444" : "#22c55e"; 

    // Target Line Calculation with Minimum Visual Gap Override
    let targetY = 0;
    if (nextMultiplier) {
      const rawTargetY = chartHeight - (nextMultiplier / maxRenderedMultiplier) * chartHeight * 0.8;
      const currentVisualY = chartHeight - (currentMultiplier / maxRenderedMultiplier) * chartHeight * 0.8;
      
      // If the upcoming line is less than 50 pixels away from our current line, force it higher visually
      targetY = (currentVisualY - rawTargetY < 50) ? currentVisualY - 50 : rawTargetY;
    }

    return (
      <div className="relative w-full h-64 bg-[#050806] border border-gray-800 rounded-lg overflow-hidden flex items-center justify-center shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]">
        
        <style>{`
          @keyframes popUpBlast {
            0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
            15% { transform: translate(-50%, -60%) scale(1.3); opacity: 1; text-shadow: 0 0 40px #39ff14, 0 0 80px #39ff14; }
            80% { transform: translate(-50%, -90%) scale(1); opacity: 1; text-shadow: 0 0 20px #39ff14; }
            100% { transform: translate(-50%, -120%) scale(0.8); opacity: 0; }
          }
          .animate-pop-blast { animation: popUpBlast 1.2s ease-out forwards; }
          
          /* Rugged Glitch Animation */
          @keyframes redGlitch {
            0% { transform: translate(0) }
            20% { transform: translate(-3px, 3px) }
            40% { transform: translate(-3px, -3px) }
            60% { transform: translate(3px, 3px) }
            80% { transform: translate(3px, -3px) }
            100% { transform: translate(0) }
          }
          .animate-glitch { animation: redGlitch 0.15s infinite; }

          /* Winner Float Animation */
          @keyframes winFloat {
            0% { transform: translateY(20px) scale(0.9); opacity: 0; }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
          .animate-win-float { animation: winFloat 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
        `}</style>

        {popTarget && (
          <div 
            key={popTarget.key} 
            className="absolute z-40 font-black text-6xl text-white pointer-events-none animate-pop-blast"
            style={{ left: '50%', top: '50%' }}
          >
            {popTarget.mult.toFixed(2)}x
          </div>
        )}

        <svg viewBox={`${targetViewX} 0 ${viewBoxWidth} ${chartHeight}`} className="absolute inset-0 w-full h-full p-0 overflow-visible">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#112211" strokeWidth="1" />
            </pattern>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.0" />
            </linearGradient>
            <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1"/>
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur2"/>
              <feMerge>
                <feMergeNode in="blur2"/>
                <feMergeNode in="blur1"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          <rect x={targetViewX} y="0" width={viewBoxWidth} height={chartHeight} fill="url(#grid)" />
          <path d={areaPath} fill="url(#chartGradient)" />

          {gameState === 'PLAYING' && nextMultiplier && (
            <g className="transition-all duration-500">
              <line 
                x1={targetViewX} y1={targetY} x2={targetViewX + viewBoxWidth} y2={targetY} 
                stroke="#10b981" strokeWidth="2" strokeDasharray="6,6" opacity="0.6"
              />
              <rect 
                x={targetViewX + viewBoxWidth - 80} y={targetY - 12} width="80" height="24" 
                fill="#0a0f0c" stroke="#10b981" strokeWidth="1" rx="4"
              />
              <text 
                x={targetViewX + viewBoxWidth - 40} y={targetY + 4} fill="#10b981" textAnchor="middle" 
                className="font-mono text-xs font-black drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]"
              >
                {nextMultiplier.toFixed(2)}x
              </text>
            </g>
          )}

          <path
            d={fullPath} fill="none" stroke={neonStrokeColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
            filter="url(#neonGlow)" className="transition-all duration-[40ms] linear"
          />

          <circle 
            cx={isRugged ? lastPoint.x : liveX} cy={isRugged ? lastPoint.y : liveY} r={isRugged ? "10" : "8"} 
            fill="#ffffff" stroke={neonStrokeColor} strokeWidth="3" filter="url(#neonGlow)" className="transition-all duration-[40ms] linear"
          />
        </svg>

        {/* Upgraded Rugged Screen */}
        {gameState === 'RUGGED' && (
          <div className="absolute inset-0 bg-[#0a0000]/80 flex flex-col items-center justify-center backdrop-blur-sm z-30 shadow-[inset_0_0_100px_rgba(255,0,0,0.5)]">
            <h2 className="text-7xl font-black text-red-600 uppercase tracking-tighter animate-glitch mix-blend-screen drop-shadow-[0_0_20px_rgba(239,68,68,1)]">LIQUIDATED</h2>
            <div className="mt-4 bg-red-900/40 border border-red-600/50 px-6 py-2 rounded-full">
               <p className="text-red-400 font-bold tracking-widest text-sm uppercase">The devs dumped on you</p>
            </div>
          </div>
        )}

        {/* Upgraded Winner Screen */}
        {gameState === 'CASHED_OUT' && (
          <div className="absolute inset-0 bg-[#001a00]/80 flex flex-col items-center justify-center backdrop-blur-sm z-30 shadow-[inset_0_0_100px_rgba(0,255,0,0.3)]">
            <div className="animate-win-float flex flex-col items-center">
              <h2 className="text-6xl font-black text-green-400 uppercase tracking-tighter drop-shadow-[0_0_30px_rgba(34,197,94,0.8)] mb-2">BAG SECURED</h2>
              <div className="bg-green-900/40 border border-green-500/50 px-8 py-4 rounded-2xl shadow-[0_0_40px_rgba(34,197,94,0.2)]">
                <p className="text-green-200 text-sm font-bold uppercase tracking-widest text-center mb-1">Total Payout</p>
                <p className="text-white font-mono text-4xl font-black text-center drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
                  {(betAmount * currentMultiplier).toFixed(4)} <span className="text-green-500 text-2xl">SOL</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {gameState === 'PLAYING' && (
          <div className="absolute top-6 left-6 z-10">
            <span className="text-6xl font-black text-white/10 tracking-tighter mix-blend-overlay">
              {currentMultiplier.toFixed(2)}x
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 w-full max-w-6xl mx-auto">
      
      <div className="w-full md:w-80 flex flex-col gap-4 shrink-0 bg-[#0a0f0c] p-6 rounded-xl border border-gray-800 shadow-2xl">
        
        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Difficulty</label>
          <div className="flex gap-2 bg-black p-1 rounded-lg border border-gray-800">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map(lvl => (
              <button
                key={lvl} disabled={gameState === 'PLAYING'} onClick={() => setDifficulty(lvl)}
                className={`flex-1 py-2 text-sm font-black uppercase rounded-md transition-all ${
                  difficulty === lvl ? 'bg-green-600 text-black shadow-[0_0_10px_rgba(34,197,94,0.3)]' : 'text-gray-400 hover:text-white disabled:opacity-50 disabled:hover:text-gray-400'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-400 text-center pt-1">
            Next Pump Chance: <span className="text-green-400 font-bold text-sm">{Math.round(displayProbability * 100)}%</span>
          </div>
        </div>

        {/* Upgraded Sleek Bet Slip */}
        <div className="space-y-2 mt-4">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Bet Amount</label>
          <div className="bg-[#050806] border border-gray-800 rounded-lg p-3 flex flex-col gap-3 shadow-inner">
            <div className="flex items-center justify-between px-1">
               <span className="text-gray-600 text-xs font-black uppercase tracking-widest">Wager</span>
               <span className="text-green-500 font-bold text-xs">SOL</span>
            </div>
            <div className="flex items-center gap-3">
               <button 
                 onClick={() => handleBetChange(betAmount - 0.1)} disabled={gameState === 'PLAYING'}
                 className="w-12 h-12 bg-gray-900 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white font-black text-xl disabled:opacity-50 transition-colors flex items-center justify-center shadow-md"
               >
                 -
               </button>
               <input 
                 type="number" min="0.1" step="0.1" value={betAmount} onChange={(e) => handleBetChange(Number(e.target.value))} disabled={gameState === 'PLAYING'}
                 className="flex-1 bg-transparent text-center text-white font-mono text-2xl font-black outline-none disabled:opacity-50 w-full"
               />
               <button 
                 onClick={() => handleBetChange(betAmount + 0.1)} disabled={gameState === 'PLAYING'}
                 className="w-12 h-12 bg-gray-900 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white font-black text-xl disabled:opacity-50 transition-colors flex items-center justify-center shadow-md"
               >
                 +
               </button>
            </div>
            <div className="flex gap-2 mt-1">
               <button onClick={() => handleBetChange(betAmount / 2)} disabled={gameState === 'PLAYING'} className="flex-1 py-2 bg-black border border-gray-800 rounded text-xs font-black tracking-widest text-gray-500 hover:text-white hover:border-gray-600 disabled:opacity-50 transition-all">½</button>
               <button onClick={() => handleBetChange(betAmount * 2)} disabled={gameState === 'PLAYING'} className="flex-1 py-2 bg-black border border-gray-800 rounded text-xs font-black tracking-widest text-gray-500 hover:text-white hover:border-gray-600 disabled:opacity-50 transition-all">2x</button>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {gameState === 'IDLE' || gameState === 'RUGGED' || gameState === 'CASHED_OUT' ? (
             <button 
               onClick={handleStartGame}
               className="w-full py-5 bg-green-500 hover:bg-green-400 text-black font-black text-xl uppercase tracking-widest rounded-lg transition-all shadow-[0_0_20px_rgba(34,197,94,0.2)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] hover:-translate-y-1"
             >
               Start Game
             </button>
          ) : (
            <>
              <div 
                className="relative" onMouseEnter={() => setIsHoveringPump(true)} onMouseLeave={() => setIsHoveringPump(false)}
              >
                <button 
                  onClick={handlePump}
                  className="w-full py-5 bg-green-600 hover:bg-green-500 text-black font-black text-xl uppercase tracking-widest rounded-lg transition-all shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                >
                  Keep Holding 📈
                </button>
                
                {isHoveringPump && nextMultiplier && (
                  <div className="absolute bottom-full left-0 w-full mb-3 bg-[#0a0f0c] border border-green-900/50 rounded-lg p-4 shadow-2xl z-50">
                    <div className="flex justify-between items-center text-sm border-b border-gray-800 pb-2 mb-2">
                      <span className="text-gray-400 font-bold uppercase">Next Target:</span>
                      <span className="text-green-400 font-black text-lg">{nextMultiplier.toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-400 font-bold uppercase">Survival Odds:</span>
                      <span className="text-white font-black">{Math.round(displayProbability * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={handleCashOut} disabled={currentStep === 0}
                className="w-full py-4 bg-[#0a0f0c] hover:bg-gray-900 text-white font-black text-lg uppercase tracking-widest rounded-lg transition-all border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:border-gray-400"
              >
                Cash Out ({currentMultiplier.toFixed(2)}x)
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4">
        <div className="flex justify-between items-center bg-[#0a0f0c] border border-gray-800 p-5 rounded-xl shadow-xl">
          <div>
            <div className="text-xs text-gray-500 font-black uppercase tracking-widest">Current Multiplier</div>
            <div className="text-2xl text-white font-mono font-black">{currentMultiplier.toFixed(2)}x</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 font-black uppercase tracking-widest">Potential Payout</div>
            <div className="text-2xl text-green-400 font-mono font-black drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]">
               {(betAmount * currentMultiplier).toFixed(4)} SOL
            </div>
          </div>
        </div>
        {renderChart()}
      </div>
    </div>
  );
}