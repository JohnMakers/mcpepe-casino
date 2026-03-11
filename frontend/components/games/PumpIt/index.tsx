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

  // Animation States
  const [time, setTime] = useState(0);
  const [popTarget, setPopTarget] = useState<{ mult: number, key: number } | null>(null);

  const levels = pumpData.levels as Record<Difficulty, { marginalProbabilities: number[], multipliers: number[] }>;
  const currentLevelData = levels[difficulty];
  const maxSteps = 24;

  useEffect(() => {
    setClientSeed(Math.random().toString(36).substring(2, 15));
  }, []);

  // Live Market Jitter Loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState === 'PLAYING') {
      interval = setInterval(() => setTime(Date.now()), 50);
    }
    return () => clearInterval(interval);
  }, [gameState]);

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
        
        // Trigger the Popping Animation
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
    const stepWidth = 120; // Fixed width per step makes jumps feel massive
    const chartHeight = 300;
    const viewBoxWidth = 600;
    const isRugged = gameState === 'RUGGED';

    // Dynamic vertical scaling (leaves 20% headroom at the top)
    const maxRenderedMultiplier = Math.max(1.5, ...chartPoints.map(p => p.multiplier)) * 1.2;

    // Fixed Historical Points
    const pointsData = chartPoints.map((p) => {
      const x = p.step * stepWidth;
      const y = chartHeight - (p.multiplier / maxRenderedMultiplier) * chartHeight * 0.8;
      return { x, y };
    });

    const lastPoint = pointsData[pointsData.length - 1];

    // The Live, Jittering Point (Simulates TradingView tick movement)
    let liveX = lastPoint.x;
    let liveY = lastPoint.y;
    if (gameState === 'PLAYING') {
        const drift = ((time % 2000) / 2000) * (stepWidth * 0.4); 
        const noise = Math.sin(time / 150) * 8 + Math.cos(time / 250) * 5; 
        liveX += drift;
        liveY += noise;
    }

    // Dynamic Panning: Keep the current action on the right side of the screen
    const targetViewX = Math.max(0, liveX - viewBoxWidth + stepWidth * 1.5);

    // Build the SVG paths
    const historicalPath = pointsData.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const fullPath = isRugged ? historicalPath : `${historicalPath} L ${liveX} ${liveY}`;
    const areaPath = `${fullPath} L ${isRugged ? lastPoint.x : liveX} ${chartHeight} L 0 ${chartHeight} Z`;

    const strokeColor = isRugged ? "#ef4444" : "#22c55e"; // Red or Green

    return (
      <div className="relative w-full h-64 bg-[#050806] border border-gray-800 rounded-lg overflow-hidden flex items-center justify-center shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]">
        
        <style>{`
          @keyframes popUpBlast {
            0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
            15% { transform: translate(-50%, -60%) scale(1.3); opacity: 1; text-shadow: 0 0 40px #22c55e, 0 0 80px #22c55e; }
            80% { transform: translate(-50%, -90%) scale(1); opacity: 1; text-shadow: 0 0 20px #22c55e; }
            100% { transform: translate(-50%, -120%) scale(0.8); opacity: 0; }
          }
          .animate-pop-blast {
            animation: popUpBlast 1.2s ease-out forwards;
          }
        `}</style>

        {/* The Giant Popping Multiplier Overlay */}
        {popTarget && (
          <div 
            key={popTarget.key} 
            className="absolute z-30 font-black text-6xl text-white pointer-events-none animate-pop-blast"
            style={{ left: '50%', top: '50%' }}
          >
            {popTarget.mult.toFixed(2)}x
          </div>
        )}

        {/* TradingView SVG Engine */}
        <svg viewBox={`${targetViewX} 0 ${viewBoxWidth} ${chartHeight}`} className="absolute inset-0 w-full h-full p-0 overflow-visible">
          
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#112211" strokeWidth="1" />
            </pattern>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Background Grid */}
          <rect x={targetViewX} y="0" width={viewBoxWidth} height={chartHeight} fill="url(#grid)" />

          {/* Area Fill */}
          <path d={areaPath} fill="url(#chartGradient)" />

          {/* Main Line */}
          <path
            d={fullPath}
            fill="none"
            stroke={strokeColor}
            strokeWidth="4"
            filter="url(#glow)"
            className="transition-all duration-[50ms] linear"
          />

          {/* The Current Live Dot */}
          <circle 
            cx={isRugged ? lastPoint.x : liveX} 
            cy={isRugged ? lastPoint.y : liveY} 
            r={isRugged ? "8" : "6"} 
            fill={strokeColor} 
            className="transition-all duration-[50ms] linear"
          />
        </svg>

        {/* Status Overlays */}
        {gameState === 'RUGGED' && (
          <div className="absolute inset-0 bg-red-900/60 flex flex-col items-center justify-center backdrop-blur-sm z-20">
            <div className="text-6xl mb-4">📉🐸</div> 
            <h2 className="text-5xl font-black text-red-500 uppercase tracking-widest drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]">Rugged!</h2>
            <p className="text-red-200 mt-2 font-bold text-lg">The devs dumped on you.</p>
          </div>
        )}

        {gameState === 'CASHED_OUT' && (
          <div className="absolute inset-0 bg-green-900/60 flex flex-col items-center justify-center backdrop-blur-sm z-20">
            <div className="text-6xl mb-4">💰🐸</div>
            <h2 className="text-5xl font-black text-green-400 uppercase tracking-widest drop-shadow-[0_0_15px_rgba(34,197,94,0.8)]">Bag Secured</h2>
            <p className="text-green-100 mt-2 text-2xl font-black">{currentMultiplier.toFixed(4)}x Payout</p>
          </div>
        )}

        {/* Current Multiplier Display (Live) */}
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
      
      {/* LEFT PANEL: Controls */}
      <div className="w-full md:w-80 flex flex-col gap-4 shrink-0 bg-[#0a0f0c] p-6 rounded-xl border border-gray-800 shadow-2xl">
        
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
          <div className="text-xs text-gray-400 text-center pt-1">
            Next Pump Chance: <span className="text-green-400 font-bold text-sm">{Math.round(displayProbability * 100)}%</span>
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
              className="w-full bg-black border border-gray-800 rounded-lg p-3 text-white font-mono focus:border-green-500 outline-none disabled:opacity-50 transition-colors"
            />
            <button 
              onClick={() => setBetAmount(prev => prev / 2)}
              disabled={gameState === 'PLAYING'}
              className="px-4 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 font-bold hover:bg-gray-800 hover:text-white disabled:opacity-50 transition-colors"
            >
              ½
            </button>
            <button 
              onClick={() => setBetAmount(prev => prev * 2)}
              disabled={gameState === 'PLAYING'}
              className="px-4 bg-gray-900 border border-gray-800 rounded-lg text-gray-400 font-bold hover:bg-gray-800 hover:text-white disabled:opacity-50 transition-colors"
            >
              2x
            </button>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          {gameState === 'IDLE' || gameState === 'RUGGED' || gameState === 'CASHED_OUT' ? (
             <button 
               onClick={handleStartGame}
               className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-black text-lg uppercase tracking-widest rounded-lg transition-all shadow-[0_0_20px_rgba(34,197,94,0.2)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] hover:-translate-y-1"
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
                  className="w-full py-4 bg-green-600 hover:bg-green-500 text-black font-black text-lg uppercase tracking-widest rounded-lg transition-all shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                >
                  Keep Holding 📈
                </button>
                
                {isHoveringPump && nextMultiplier && (
                  <div className="absolute bottom-full left-0 w-full mb-3 bg-[#0a0f0c] border border-green-900/50 rounded-lg p-4 shadow-2xl z-40">
                    <div className="flex justify-between items-center text-sm border-b border-gray-800 pb-2 mb-2">
                      <span className="text-gray-400 font-bold uppercase">Next Payout:</span>
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
                onClick={handleCashOut}
                disabled={currentStep === 0}
                className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-white font-black text-lg uppercase tracking-widest rounded-lg transition-all border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:border-gray-400"
              >
                Cash Out ({currentMultiplier.toFixed(2)}x)
              </button>
            </>
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Chart View */}
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