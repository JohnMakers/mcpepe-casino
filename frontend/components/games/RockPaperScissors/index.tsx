import React, { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, web3, BN } from '@coral-xyz/anchor';
// @ts-ignore
import idl from '../../../idl.json';
import { PublicKey, SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey("BNpcicNi55iYT6yfe2isgHnqqSWBtAr8qfiGwpKbxyuz");
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

// We match the multipliers from the Rust contract (divided by 10)
const MULTIPLIERS = [1.9, 3.6, 6.8, 13.0, 24.5, 46.5];

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
    
    // NEW: Track the actual confirmed bet amount from the contract to calculate payouts accurately
    const [lockedBet, setLockedBet] = useState<number>(0); 
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [balance, setBalance] = useState(0);
    const [rounds, setRounds] = useState<RoundHistory[]>([]);
    const [selectedMove, setSelectedMove] = useState<number | null>(null);

    useEffect(() => {
        if (publicKey) {
            connection.getBalance(publicKey).then(b => setBalance(b / web3.LAMPORTS_PER_SOL));
        }
    }, [publicKey, connection]);

    const multiplyBet = (factor: number) => {
        const current = parseFloat(betAmount) || 0;
        setBetAmount((current * factor).toFixed(2));
    };

    const handlePlaySubmit = async () => {
        if (!selectedMove) return alert("Select a fighter first!");
        if (!publicKey || !wallet.signTransaction) return alert("Connect Phantom wallet first!");

        const wager = parseFloat(betAmount);
        if (streak === 0 && (isNaN(wager) || wager <= 0)) return alert("Enter a valid bet amount.");
        if (streak === 0 && wager > balance) return alert("Insufficient SOL balance.");

        setIsProcessing(true);
        const currentMove = selectedMove; 
        setRounds(prev => [...prev, { player: currentMove, house: null, result: 'pending' }]);

        try {
            const lamports = new BN(Math.floor(wager * web3.LAMPORTS_PER_SOL)); 
            const provider = new AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
            const program = new Program(idl as any, PROGRAM_ID, provider);
            
            const [gameStatePda] = PublicKey.findProgramAddressSync([Buffer.from("rps_game"), publicKey.toBuffer()], program.programId);
            const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("rps_vault")], program.programId);

            const accountInfo = await connection.getAccountInfo(gameStatePda);
            const tx = new web3.Transaction();

            if (!accountInfo) {
                const initIx = await program.methods.initializeRpsGame()
                    .accountsStrict({ gameState: gameStatePda, player: publicKey, systemProgram: SystemProgram.programId })
                    .instruction();
                tx.add(initIx);
            }

            const playIx = await program.methods.rpsPlayHand(lamports, currentMove)
                .accountsStrict({ gameState: gameStatePda, vault: vaultPda, player: publicKey, systemProgram: SystemProgram.programId })
                .instruction();
            tx.add(playIx);

            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            const signedTx = await wallet.signTransaction(tx);
            const signature = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false });
            
            await connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            });
            
            const response = await fetch(`${BACKEND_URL}/api/rps/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerPubkeyStr: publicKey.toBase58(), gameStatePubkeyStr: gameStatePda.toBase58() })
            });

            const data = await response.json();
            if (data.success) {
                const state: any = await program.account.rpsGameState.fetch(gameStatePda);
                
                // Fetch the true locked bet directly from the smart contract state
                const actualLockedBet = state.betAmount.toNumber() / web3.LAMPORTS_PER_SOL;
                if (actualLockedBet > 0) setLockedBet(actualLockedBet);
                
                let resultStatus: 'win' | 'loss' | 'tie' = 'loss';
                
                // If streak increased, it's either a pure win or a tie that counted as a win
                if (state.currentStreak > streak) {
                    resultStatus = (data.houseMove === currentMove) ? 'tie' : 'win';
                }
                
                setStreak(state.currentStreak);
                
                setRounds(prev => {
                    const newRounds = [...prev];
                    const lastIndex = newRounds.length - 1;
                    newRounds[lastIndex] = { ...newRounds[lastIndex], house: data.houseMove, result: resultStatus };
                    return newRounds;
                });

                if (state.currentStreak === 0) {
                    setTimeout(() => {
                        setRounds([]);
                        setSelectedMove(null);
                        setLockedBet(0);
                    }, 3000);
                } else {
                    setSelectedMove(null); 
                }
            } else {
                console.error("House failed to resolve:", data.error);
                setRounds(prev => prev.slice(0, -1));
            }

        } catch (error) {
            console.error("FATAL ERROR IN PLAYHAND:", error);
            setRounds(prev => prev.slice(0, -1));
        } finally {
            setIsProcessing(false);
            connection.getBalance(publicKey).then(b => setBalance(b / web3.LAMPORTS_PER_SOL));
        }
    };

    const settleStreak = async () => {
        if (!publicKey || !wallet.signTransaction) return;

        setIsProcessing(true);
        try {
            const provider = new AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
            const program = new Program(idl as any, PROGRAM_ID, provider);
            
            const [gameStatePda] = PublicKey.findProgramAddressSync([Buffer.from("rps_game"), publicKey.toBuffer()], program.programId);
            const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("rps_vault")], program.programId);

            const tx = new web3.Transaction();
            const settleIx = await program.methods.rpsSettleStreak()
                .accountsStrict({ gameState: gameStatePda, vault: vaultPda, player: publicKey, systemProgram: SystemProgram.programId })
                .instruction();
            
            tx.add(settleIx);
            
            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            const signedTx = await wallet.signTransaction(tx);
            const signature = await connection.sendRawTransaction(signedTx.serialize());
            
            await connection.confirmTransaction({ signature, ...latestBlockhash });
            
            setStreak(0);
            setRounds([]);
            setSelectedMove(null);
            setLockedBet(0);
            alert("Winnings claimed successfully! SOL deposited to wallet.");
        } catch (error) {
            console.error("Error claiming:", error);
        } finally {
            setIsProcessing(false);
            connection.getBalance(publicKey).then(b => setBalance(b / web3.LAMPORTS_PER_SOL));
        }
    };

    // Calculate current total value of the run
    const currentTotalValue = streak > 0 ? (lockedBet * MULTIPLIERS[streak - 1]) : 0;

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
                        Select a fighter to begin
                    </div>
                )}

                {rounds.map((round, idx) => {
                    const isSuccess = round.result === 'win' || round.result === 'tie';
                    const roundMultiplier = MULTIPLIERS[idx];
                    const roundPayoutValue = lockedBet * (roundMultiplier || 0);

                    return (
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
                                    <div className="flex flex-col items-center">
                                        <div className={`text-2xl font-black uppercase tracking-widest ${
                                            round.result === 'win' ? 'text-green-500' : 
                                            round.result === 'loss' ? 'text-red-500' : 'text-yellow-500'
                                        }`}>
                                            {round.result === 'win' ? 'VICTORY' : round.result === 'loss' ? 'REKT' : 'TIE (FREE REPLAY)'}
                                        </div>
                                        
                                        {/* INDICATOR: Payout Value for this specific tile/streak */}
                                        {isSuccess && (
                                            <div className="mt-2 px-3 py-1 bg-black/50 rounded-lg text-green-400 font-mono text-sm font-bold border border-green-500/30">
                                                {roundMultiplier}x (+{roundPayoutValue.toFixed(2)} SOL)
                                            </div>
                                        )}
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
                    );
                })}
            </div>

            {/* CONTROLS */}
            <div className="w-full max-w-md mx-auto space-y-6">
                
                {/* Bet Selector - Only editable if streak is 0 */}
                {streak === 0 && (
                    <div className="flex flex-col gap-2 w-full">
                        <label className="text-gray-400 text-sm font-bold uppercase tracking-widest pl-1">Wager Amount</label>
                        <div className="flex-1 bg-black border-2 border-gray-800 rounded-xl p-1 flex focus-within:border-green-500 transition-colors">
                            <input 
                                type="number" 
                                min="0" step="0.1"
                                value={betAmount} 
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === "") { setBetAmount(""); return; }
                                    setBetAmount(parseFloat(val) < 0 ? "0" : val);
                                }} 
                                disabled={isProcessing}
                                className="w-full bg-transparent p-3 text-2xl font-mono text-white outline-none pl-4 disabled:opacity-50" 
                            />
                            <div className="flex gap-1 pr-2 items-center">
                                <button onClick={() => multiplyBet(0.5)} disabled={isProcessing} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded disabled:opacity-50 transition-colors">1/2</button>
                                <button onClick={() => multiplyBet(2)} disabled={isProcessing} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-gray-400 text-xs font-bold rounded disabled:opacity-50 transition-colors">2x</button>
                                <button onClick={() => setBetAmount(balance.toFixed(2))} disabled={isProcessing} className="px-3 py-2 bg-[#111a14] hover:bg-[#16221a] text-green-500 text-xs font-bold rounded disabled:opacity-50 transition-colors">MAX</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Move Selectors - Click to visually select */}
                <div className="grid grid-cols-3 gap-4">
                    {[1, 2, 3].map((move) => {
                        const isSelected = selectedMove === move;
                        return (
                            <button 
                                key={move}
                                onClick={() => setSelectedMove(move)}
                                disabled={isProcessing}
                                className={`flex flex-col items-center p-4 bg-gray-900 border-2 rounded-xl transition-all disabled:opacity-50 group cursor-pointer ${
                                    isSelected 
                                        ? 'border-green-500 bg-green-900/30 scale-105 shadow-[0_0_15px_rgba(34,197,94,0.3)]' 
                                        : 'border-gray-800 hover:border-gray-500'
                                }`}
                            >
                                <div className="w-16 h-16 mb-2 rounded overflow-hidden">
                                    <img src={MOVE_MAP[move].img} alt={MOVE_MAP[move].name} className="w-full h-full object-cover" />
                                </div>
                                <span className={`font-black uppercase tracking-wider ${isSelected ? 'text-green-400' : 'text-gray-400'}`}>
                                    {MOVE_MAP[move].name}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* The Master Action Button */}
                <button 
                    onClick={handlePlaySubmit}
                    disabled={!selectedMove || isProcessing}
                    className={`w-full py-5 text-black font-black text-xl uppercase tracking-widest rounded-xl transition-all ${
                        !selectedMove || isProcessing 
                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                            : 'bg-green-500 hover:bg-green-400 shadow-[0_0_20px_rgba(34,197,94,0.4)] hover:scale-[1.02]'
                    }`}
                >
                    {isProcessing ? 'Processing...' : 
                     !selectedMove ? 'Select A Fighter First' : 
                     streak === 0 ? `START BATTLE WITH ${MOVE_MAP[selectedMove].name}` : 
                     `LET IT RIDE WITH ${MOVE_MAP[selectedMove].name}`}
                </button>

                {/* Cashout Button - UPDATED WITH TOTAL SOL */}
                {streak > 0 && !isProcessing && (
                    <button 
                        onClick={settleStreak} 
                        className="w-full py-5 mt-2 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xl uppercase tracking-widest rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.4)] transition-all hover:scale-[1.02] flex flex-col items-center justify-center leading-tight"
                    >
                        <span>💰 Cash Out Winnings</span>
                        <span className="text-sm font-bold opacity-80 mt-1">
                            TOTAL: {currentTotalValue.toFixed(2)} SOL
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
}