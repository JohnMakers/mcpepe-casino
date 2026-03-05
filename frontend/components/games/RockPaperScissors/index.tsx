import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, web3, BN } from '@coral-xyz/anchor';
import idl from '../../../idl.json';
import { PublicKey, SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey(idl.metadata.address);
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

interface RoundHistory {
    player: number;
    house: number | null;
    result: 'win' | 'loss' | 'tie' | 'pending';
}

const MOVE_MAP: Record<number, { name: string, img: string }> = {
    1: { name: 'Rock', img: '/rps_rock.png' },
    2: { name: 'Paper', img: '/rps_paper.png' },
    3: { name: 'Scissors', img: '/rps_scissors.png' }
};

export default function RockPaperScissors() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey } = wallet;

    const [streak, setStreak] = useState(0);
    const [betAmount, setBetAmount] = useState<string>("0.1");
    const [isProcessing, setIsProcessing] = useState(false);
    const [balance, setBalance] = useState(0);
    
    // UI States
    const [rounds, setRounds] = useState<RoundHistory[]>([]);
    const [isBetLocked, setIsBetLocked] = useState(false);

    useEffect(() => {
        if (publicKey) {
            connection.getBalance(publicKey).then(b => setBalance(b / web3.LAMPORTS_PER_SOL));
        }
    }, [publicKey, connection]);

    const multiplyBet = (factor: number) => {
        const current = parseFloat(betAmount) || 0;
        setBetAmount((current * factor).toFixed(2));
    };

    const handleStartGame = () => {
        const wager = parseFloat(betAmount);
        if (isNaN(wager) || wager <= 0) return alert("Enter a valid bet amount.");
        if (wager > balance) return alert("Insufficient SOL balance.");
        
        setIsBetLocked(true);
    };

    const playHand = async (move: number) => {
        if (!publicKey || !wallet.signTransaction || !wallet.sendTransaction) {
            return alert("Connect Phantom wallet first!");
        }

        const wager = parseFloat(betAmount);
        setIsProcessing(true);
        setRounds(prev => [...prev, { player: move, house: null, result: 'pending' }]);

        try {
            const provider = new AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
            const program = new Program(idl as any, PROGRAM_ID, provider);
            
            const [gameStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_game"), publicKey.toBuffer()],
                program.programId
            );

            const [vaultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_vault")],
                program.programId
            );

            const accountInfo = await connection.getAccountInfo(gameStatePda);
            const tx = new web3.Transaction();

            if (!accountInfo) {
                const initIx = await program.methods.initializeGame()
                    .accounts({
                        gameState: gameStatePda,
                        player: publicKey,
                        systemProgram: SystemProgram.programId,
                    }).instruction();
                tx.add(initIx);
            }

            const lamports = new BN(wager * web3.LAMPORTS_PER_SOL);

            const playIx = await program.methods.playHand(lamports, move)
                .accounts({
                    gameState: gameStatePda,
                    vault: vaultPda,
                    player: publicKey,
                    systemProgram: SystemProgram.programId,
                }).instruction();
            
            tx.add(playIx);

            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            const signature = await wallet.sendTransaction(tx, connection);
            await connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            });
            
            console.log("Move locked on chain. Pinging House to resolve...");

            const response = await fetch(`${BACKEND_URL}/api/rps/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerPubkeyStr: publicKey.toBase58(),
                    gameStatePubkeyStr: gameStatePda.toBase58()
                })
            });

            const data = await response.json();
            if (data.success) {
                const state: any = await program.account.rpsGameState.fetch(gameStatePda);
                
                let resultStatus: 'win' | 'loss' | 'tie' = 'loss';
                if (state.currentStreak > streak) resultStatus = 'win';
                else if (state.currentStreak === streak && data.houseMove === move) resultStatus = 'tie';
                
                setStreak(state.currentStreak);
                
                setRounds(prev => {
                    const newRounds = [...prev];
                    const lastIndex = newRounds.length - 1;
                    newRounds[lastIndex] = { ...newRounds[lastIndex], house: data.houseMove, result: resultStatus };
                    return newRounds;
                });

                if (state.currentStreak === 0 && resultStatus !== 'tie') {
                    // Reset UI on loss
                    setTimeout(() => {
                        setRounds([]);
                        setIsBetLocked(false);
                    }, 3000);
                }
            } else {
                console.error("House failed to resolve:", data.error);
                alert("Backend resolution failed.");
                setRounds(prev => prev.slice(0, -1));
                setIsBetLocked(false);
            }

        } catch (error) {
            console.error("Error playing hand:", error);
            setRounds(prev => prev.slice(0, -1));
            setIsBetLocked(false); // Unlock the UI so they can try again if they rejected the tx
        } finally {
            setIsProcessing(false);
            connection.getBalance(publicKey).then(b => setBalance(b / web3.LAMPORTS_PER_SOL));
        }
    };

    const settleStreak = async () => {
        if (!publicKey || !wallet.sendTransaction) return;

        setIsProcessing(true);
        try {
            const provider = new AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
            const program = new Program(idl as any, PROGRAM_ID, provider);
            
            const [gameStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_game"), publicKey.toBuffer()],
                program.programId
            );
            const [vaultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_vault")],
                program.programId
            );

            const tx = new web3.Transaction();
            const settleIx = await program.methods.settleStreak()
                .accounts({
                    gameState: gameStatePda,
                    vault: vaultPda,
                    player: publicKey,
                    systemProgram: SystemProgram.programId,
                }).instruction();
            
            tx.add(settleIx);
            
            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            const signature = await wallet.sendTransaction(tx, connection);
            await connection.confirmTransaction({ signature, ...latestBlockhash });
            
            setStreak(0);
            setRounds([]);
            setIsBetLocked(false);
            alert("Winnings claimed successfully! SOL deposited to wallet.");
        } catch (error) {
            console.error("Error claiming:", error);
        } finally {
            setIsProcessing(false);
            connection.getBalance(publicKey).then(b => setBalance(b / web3.LAMPORTS_PER_SOL));
        }
    };

    return (
        <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full animate-fade-in">
            {/* HEADER */}
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-black text-white uppercase tracking-tight">Pepe's High-Stakes RPS</h2>
                <div className="text-green-500 font-mono text-lg font-bold bg-green-900/20 px-4 py-2 rounded border border-green-900/50">
                    Streak: {streak} 🔥
                </div>
            </div>

            {/* THE ARENA */}
            <div className="flex flex-col items-center gap-6 mb-8 w-full min-h-[300px] p-6 bg-black/40 rounded-2xl border border-gray-800">
                {rounds.length === 0 && !isProcessing && (
                    <div className="text-gray-500 font-mono uppercase tracking-widest mt-10">
                        {isBetLocked ? 'Waiting for your move...' : 'Place your wager to begin'}
                    </div>
                )}

                {rounds.map((round, idx) => (
                    <div 
                        key={idx} 
                        className={`w-full max-w-2xl flex items-center justify-between p-4 rounded-xl border-2 transition-all duration-500 ${
                            round.result === 'win' ? 'border-green-500 bg-green-900/20' : 
                            round.result === 'loss' ? 'border-red-500 bg-red-900/20' : 
                            round.result === 'tie' ? 'border-yellow-500 bg-yellow-900/20' : 
                            'border-gray-700 bg-gray-900/50 animate-pulse'
                        }`}
                    >
                        {/* Player Side */}
                        <div className="flex flex-col items-center gap-2 w-1/3">
                            <span className="text-sm font-bold text-gray-400 uppercase">You</span>
                            <div className="w-24 h-24 bg-gray-800 rounded-lg overflow-hidden border border-gray-600 shadow-lg">
                                <img src={MOVE_MAP[round.player].img} alt={MOVE_MAP[round.player].name} className="w-full h-full object-cover" />
                            </div>
                            <span className="text-white font-mono font-bold">{MOVE_MAP[round.player].name}</span>
                        </div>

                        {/* VS / Result Center */}
                        <div className="w-1/3 flex flex-col items-center justify-center">
                            {round.result === 'pending' ? (
                                <div className="text-3xl font-black text-yellow-500 animate-bounce">VS</div>
                            ) : (
                                <div className={`text-2xl font-black uppercase tracking-widest ${
                                    round.result === 'win' ? 'text-green-500' : 
                                    round.result === 'loss' ? 'text-red-500' : 'text-yellow-500'
                                }`}>
                                    {round.result === 'win' ? 'VICTORY' : round.result === 'loss' ? 'REKT' : 'TIE'}
                                </div>
                            )}
                        </div>

                        {/* House Side */}
                        <div className="flex flex-col items-center gap-2 w-1/3">
                            <span className="text-sm font-bold text-gray-400 uppercase">House</span>
                            <div className="w-24 h-24 bg-gray-800 rounded-lg overflow-hidden border border-gray-600 shadow-lg flex items-center justify-center relative">
                                {round.house ? (
                                    <img src={MOVE_MAP[round.house].img} alt={MOVE_MAP[round.house].name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
                                )}
                            </div>
                            <span className="text-white font-mono font-bold">
                                {round.house ? MOVE_MAP[round.house].name : 'Thinking...'}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* CONTROLS */}
            <div className="w-full max-w-md mx-auto space-y-6">
                
                {/* Bet Selector - Beside Start Button */}
                {streak === 0 && (
                    <div className="flex flex-col sm:flex-row gap-3 w-full">
                        <div className="flex-1 bg-black border-2 border-gray-800 rounded-xl p-1 flex focus-within:border-green-500">
                            <input 
                                type="number" 
                                min="0" step="0.1"
                                value={betAmount} 
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === "") { setBetAmount(""); return; }
                                    setBetAmount(parseFloat(val) < 0 ? "0" : val);
                                }} 
                                disabled={isBetLocked}
                                className="w-full bg-transparent p-3 text-2xl font-mono text-white outline-none pl-4 disabled:opacity-50" 
                            />
                            <div className="flex gap-1 pr-2 items-center">
                                <button onClick={() => multiplyBet(0.5)} disabled={isBetLocked} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded disabled:opacity-50">1/2</button>
                                <button onClick={() => multiplyBet(2)} disabled={isBetLocked} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded disabled:opacity-50">2x</button>
                                <button onClick={() => setBetAmount(balance.toFixed(2))} disabled={isBetLocked} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-green-500 text-xs font-bold rounded disabled:opacity-50">MAX</button>
                            </div>
                        </div>

                        {!isBetLocked && (
                            <button 
                                onClick={handleStartGame}
                                className="px-8 bg-green-500 hover:bg-green-400 text-black font-black text-xl uppercase tracking-widest rounded-xl transition-all shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                            >
                                Start
                            </button>
                        )}
                    </div>
                )}

                {/* Move Selectors */}
                <div className="grid grid-cols-3 gap-4 relative">
                    {/* Blocker Overlay if Wager not started */}
                    {!isBetLocked && streak === 0 && (
                        <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-[2px] rounded-xl border border-gray-800 flex items-center justify-center">
                            <span className="text-gray-400 font-bold uppercase tracking-widest text-sm text-center px-4">
                                Input bet and click START
                            </span>
                        </div>
                    )}

                    {[1, 2, 3].map((move) => (
                        <button 
                            key={move}
                            onClick={() => playHand(move)}
                            disabled={isProcessing}
                            className="flex flex-col items-center p-4 bg-gray-900 border-2 border-gray-800 rounded-xl hover:border-green-500 hover:bg-green-900/20 transition-all disabled:opacity-50 group"
                        >
                            <div className="w-16 h-16 mb-2 rounded overflow-hidden group-hover:scale-110 transition-transform">
                                <img src={MOVE_MAP[move].img} alt={MOVE_MAP[move].name} className="w-full h-full object-cover" />
                            </div>
                            <span className="font-black uppercase tracking-wider text-gray-300 group-hover:text-white">
                                {MOVE_MAP[move].name}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Animated Subtitle (Shows only when active to pick) */}
                {(isBetLocked || streak > 0) && !isProcessing && (
                    <div className="mt-4 text-center animate-fade-in transition-all duration-500">
                        <h3 className="text-xl font-black text-yellow-500 uppercase tracking-widest animate-pulse drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]">
                            Select Your Fighter
                        </h3>
                    </div>
                )}

                {/* Cashout Button */}
                {streak > 0 && !isProcessing && (
                    <button 
                        onClick={settleStreak} 
                        className="w-full py-5 mt-4 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-2xl uppercase tracking-widest rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.4)] transition-all animate-bounce-short"
                    >
                        💰 Cash Out Winnings
                    </button>
                )}
            </div>
        </div>
    );
}