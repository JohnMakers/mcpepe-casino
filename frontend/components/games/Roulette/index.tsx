'use client';

import React, { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
// @ts-ignore
import idl from "../../../idl.json";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
const PROGRAM_ID = new PublicKey("BNpcicNi55iYT6yfe2isgHnqqSWBtAr8qfiGwpKbxyuz");
const HOUSE_PUBKEY = new PublicKey("Gf9QEwbxosqQY9bLBrgjKommtX8qPdNqFrKazmHfaZBv");

// Enums must match the Rust program exactly
export enum BetType {
    StraightUp = 0,
    Split = 1,
    Street = 2,
    Corner = 3,
    Line = 4,
    Basket = 5,
    Column = 6,
    Dozen = 7,
    RedBlack = 8,
    OddEven = 9,
    HighLow = 10,
}

export interface ClientBet {
    betType: BetType;
    data: number[]; 
    amount: number;
}

interface Props {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  logWager: (game: string, wager: number, win: boolean, payout: number, hash: string, seed: string) => void;
  setShowProvablyFair: (val: boolean) => void;
}

export default function RouletteGame({ balance, setBalance, logWager, setShowProvablyFair }: Props) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey } = wallet;
    
    // Game State
    const [isSpinning, setIsSpinning] = useState(false);
    const [winningNumber, setWinningNumber] = useState<number | null>(null);
    const [clientSeed, setClientSeed] = useState<string>(() => "pepe-seed-" + Math.random().toString(36).substring(7));
    const [serverSeedHash, setServerSeedHash] = useState<string>('...'); 
    const [unhashedServerSeed, setUnhashedServerSeed] = useState<string>('');
    const [wheelRotation, setWheelRotation] = useState(0);

    // Betting State
    const [selectedChipValue, setSelectedChipValue] = useState<number>(0.1);
    const [currentBets, setCurrentBets] = useState<ClientBet[]>([]);
    
    // Calculate total wager dynamically
    const totalWager = currentBets.reduce((acc, bet) => acc + bet.amount, 0);

    // Fetch seed on mount and after every game
    const fetchNewSeed = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/roulette/seed`, { method: "POST" });
            const data = await res.json();
            setServerSeedHash(data.serverSeedHash);
            setUnhashedServerSeed(data.serverSeed); // Stored securely until resolution
        } catch (error) {
            console.error("Failed to fetch seed:", error);
        }
    };

    useEffect(() => {
        fetchNewSeed();
    }, []);

    // --- LOGIC ---
    const handlePlaceChip = (betType: BetType, data: number[]) => {
        if (isSpinning) return;
        
        setCurrentBets((prevBets) => {
            const existingBetIndex = prevBets.findIndex(
                (b) => b.betType === betType && JSON.stringify(b.data) === JSON.stringify(data)
            );

            if (existingBetIndex >= 0) {
                const updatedBets = [...prevBets];
                updatedBets[existingBetIndex].amount += selectedChipValue;
                updatedBets[existingBetIndex].amount = parseFloat(updatedBets[existingBetIndex].amount.toFixed(4));
                return updatedBets;
            } else {
                return [...prevBets, { betType, data, amount: selectedChipValue }];
            }
        });
    };

    const handleClearBets = () => {
        if (!isSpinning) setCurrentBets([]);
    };

    const handleSpin = async () => {
        if (!publicKey || !wallet.signTransaction) return alert("Please connect your wallet!");
        if (currentBets.length === 0) return alert("Please place a bet first!");
        if (totalWager > balance) return alert("Insufficient funds.");

        setIsSpinning(true);
        setBalance(prev => prev - totalWager); // Deduct optimistic balance
        setWinningNumber(null);

        try {
            const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
            const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

            const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
            const gameStateKeypair = Keypair.generate();
            const nonce = new anchor.BN(Date.now()); // Using timestamp as a simple nonce

            // Convert React bet state to Anchor Rust format
            const anchorBets = currentBets.map(bet => {
                const betTypeKeys = ["straightUp", "split", "street", "corner", "line", "basket", "column", "dozen", "redBlack", "oddEven", "highLow"];
                const anchorBetType: any = {};
                anchorBetType[betTypeKeys[bet.betType]] = {}; 

                return {
                    betType: anchorBetType,
                    data: bet.data,
                    amount: new anchor.BN(bet.amount * LAMPORTS_PER_SOL)
                };
            });

            const serverSeedHashBytes = Array.from(Buffer.from(serverSeedHash, 'hex'));
            const totalWagerLamports = new anchor.BN(totalWager * LAMPORTS_PER_SOL);

            // 1. Send Transaction to Blockchain
            const tx = await program.methods
                .startRoulette(serverSeedHashBytes, clientSeed, nonce, anchorBets, totalWagerLamports)
                .accounts({
                    gameState: gameStateKeypair.publicKey,
                    player: publicKey,
                    vault: vaultPDA,
                    authority: HOUSE_PUBKEY,
                    systemProgram: SystemProgram.programId,
                })
                .transaction();

            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            // Sign and Send
            const signedTx = await wallet.signTransaction(tx);
            signedTx.partialSign(gameStateKeypair);
            
            const rawTransaction = signedTx.serialize();
            const txSignature = await connection.sendRawTransaction(rawTransaction, { skipPreflight: false });
            await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash });

            // 2. Call Backend to Resolve the Game
            const backendResponse = await fetch(`${BACKEND_URL}/api/roulette/resolve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerPublicKey: publicKey.toBase58(),
                    serverSeed: unhashedServerSeed,
                    gamePda: gameStateKeypair.publicKey.toBase58(),
                })
            });

            const backendData = await backendResponse.json();
            if (!backendData.success) throw new Error(backendData.error || "Backend resolution failed");

            // 3. Replicate the Provably Fair Hash locally to determine where to stop the wheel animation
            const combinedData = unhashedServerSeed + clientSeed + nonce.toString();
            // THE FIX: Type cast the encoded data `as any` to bypass the ArrayBufferLike Web Crypto typings clash
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combinedData) as any);
            const outcomeHashBytes = new Uint8Array(hashBuffer);
            
            const dataView = new DataView(outcomeHashBytes.buffer);
            const rawNumber = dataView.getUint32(0, true);
            const winningNum = rawNumber % 37;
            
            // Calculate Wheel Rotation Animation
            const baseSpins = 360 * 5; 
            const segmentAngle = 360 / 37;
            const targetRotation = baseSpins + (winningNum * segmentAngle); 
            
            setWheelRotation(prev => prev + targetRotation + (prev % 360 !== 0 ? 360 : 0));

            // Wait for animation to finish before updating UI
            setTimeout(async () => {
                setWinningNumber(winningNum);
                setIsSpinning(false);
                
                // Fetch exact balance from chain
                try {
                    const exactBalance = await connection.getBalance(publicKey);
                    setBalance(exactBalance / LAMPORTS_PER_SOL);
                } catch (err) {
                    console.error("Balance fetch failed", err);
                }

                logWager("Roulette", totalWager, winningNum > 0 /* simplistic win check for feed */, 0, backendData.txSignature, clientSeed);
                
                fetchNewSeed();
                setCurrentBets([]);
            }, 3000);

        } catch (error) {
            console.error("Roulette Error:", error);
            alert("Transaction failed or rejected. Check the console.");
            setBalance(prev => prev + totalWager); // Refund optimistic deduction
            setIsSpinning(false);
        }
    };

    // Helper to render the visual chip on the board
    const renderChip = (targetBetType: BetType, targetData: number[]) => {
        const bet = currentBets.find(b => b.betType === targetBetType && JSON.stringify(b.data) === JSON.stringify(targetData));
        if (!bet) return null;

        return (
            <div className="absolute z-10 w-8 h-8 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold shadow-md transform scale-90 pointer-events-none">
                {bet.amount}
            </div>
        );
    };

    // Helper to render a grid number cell
    const renderNumberCell = (num: number, color: 'red' | 'black') => {
        const isWinner = winningNumber === num;
        return (
            <div 
                key={num}
                onClick={() => handlePlaceChip(BetType.StraightUp, [num, 0, 0, 0])} 
                className={`relative border border-white flex items-center justify-center transition-colors py-2 ${isWinner ? 'bg-yellow-400 animate-pulse' : 'hover:bg-green-600'}`}
            >
                <span className={`font-bold w-8 h-8 rounded-full flex items-center justify-center ${color === 'red' ? 'bg-red-500 text-white' : 'bg-gray-900 text-white'} ${isWinner ? 'border-2 border-black' : ''}`}>
                    {num}
                </span>
                {renderChip(BetType.StraightUp, [num, 0, 0, 0])}
            </div>
        );
    };

    return (
        <div className="flex flex-col xl:flex-row gap-8 w-full max-w-7xl mx-auto p-4 animate-fade-in">
            {/* Left Panel: Betting Controls */}
            <div className="flex flex-col gap-4 w-full xl:w-1/4 bg-gray-900 p-6 rounded-xl border border-green-500/30 shadow-xl relative z-10">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Bet Slip</h2>
                    <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-2 py-1 rounded border border-green-900/50 transition-colors">
                        🛡️ Provably Fair
                    </button>
                </div>
                
                <div className="space-y-4">
                    <div className="bg-black border-2 border-gray-800 p-4 rounded-xl flex justify-between items-center">
                        <span className="text-gray-400 font-bold uppercase text-sm tracking-wider">Total Wager:</span>
                        <span className="text-xl font-mono font-bold text-yellow-400">{totalWager.toFixed(2)} SOL</span>
                    </div>

                    <div className="space-y-2 border-t border-gray-800 pt-4">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Client Seed</label>
                        <input 
                            type="text" 
                            value={clientSeed} 
                            onChange={(e) => setClientSeed(e.target.value)}
                            disabled={isSpinning}
                            className="w-full bg-black border-2 border-gray-800 rounded-lg p-3 font-mono text-sm text-white outline-none focus:border-green-500 transition-colors disabled:opacity-50"
                        />
                        <p className="text-[10px] text-gray-600 font-mono break-all mt-2">Server Hash: {serverSeedHash}</p>
                    </div>

                    <button 
                        onClick={handleSpin}
                        disabled={isSpinning || currentBets.length === 0}
                        className="mt-6 w-full bg-green-500 hover:bg-green-400 text-black font-black text-2xl uppercase tracking-widest py-5 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                    >
                        {isSpinning ? 'SPINNING...' : 'PLACE BET'}
                    </button>
                </div>
            </div>

            {/* Center Panel: Wheel & Board */}
            <div className="flex flex-col items-center gap-8 w-full xl:w-3/4">
                
                {/* The Wheel */}
                <div className="relative w-64 h-64 md:w-80 md:h-80 rounded-full border-[16px] border-[#0a0f0c] shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden flex items-center justify-center bg-gray-900">
                    <div 
                        className="w-full h-full bg-[url('/roulette-wheel.png')] bg-cover bg-center transition-transform duration-[3000ms] cubic-bezier(0.2, 0.8, 0.2, 1)"
                        style={{ 
                            transform: `rotate(${wheelRotation}deg)`,
                            animation: !isSpinning && wheelRotation === 0 ? 'spin 30s linear infinite' : 'none' 
                        }}
                    ></div>
                    <div className="absolute top-0 w-6 h-10 bg-yellow-500 z-10 clip-triangle shadow-2xl border-b-4 border-yellow-700" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}></div>
                    
                    {/* Inner winning number display */}
                    {winningNumber !== null && !isSpinning && (
                        <div className="absolute inset-0 m-auto w-16 h-16 bg-black/80 rounded-full flex items-center justify-center border-2 border-yellow-500 animate-fade-in">
                            <span className="text-3xl font-black text-white">{winningNumber}</span>
                        </div>
                    )}
                </div>

                {/* Chip Denomination Selector */}
                <div className="flex flex-wrap gap-3 justify-center mt-2 w-full bg-[#0a0f0c] p-4 rounded-xl border border-gray-800 shadow-xl max-w-3xl">
                    {[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((chipValue) => (
                        <button
                            key={chipValue}
                            onClick={() => setSelectedChipValue(chipValue)}
                            disabled={isSpinning}
                            className={`w-14 h-14 rounded-full font-bold flex items-center justify-center border-4 transition-all shadow-lg font-mono text-sm disabled:opacity-50 ${
                                selectedChipValue === chipValue 
                                ? 'border-yellow-400 scale-110 bg-blue-600 text-white' 
                                : 'border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-300'
                            }`}
                        >
                            {chipValue}
                        </button>
                    ))}
                    <button 
                        onClick={handleClearBets} 
                        disabled={isSpinning}
                        className="ml-4 text-gray-400 hover:text-white font-black uppercase tracking-wider text-xs px-6 py-2 rounded-xl border-2 border-gray-800 hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                        Clear Table
                    </button>
                </div>

                {/* The Interactive Betting Board */}
                <div className={`w-full max-w-4xl overflow-x-auto pb-4 transition-opacity ${isSpinning ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                    <div className="min-w-[700px] bg-green-900 border-4 border-[#0a0f0c] text-white flex flex-col cursor-pointer select-none shadow-2xl rounded-sm">
                        
                        {/* Top Section: 0 and Numbers 1-36 */}
                        <div className="flex">
                            {/* Zero Basket */}
                            <div 
                                onClick={() => handlePlaceChip(BetType.StraightUp, [0, 0, 0, 0])}
                                className={`relative flex-none w-16 border border-white flex items-center justify-center transition-colors text-2xl font-black ${winningNumber === 0 ? 'bg-yellow-400 text-black animate-pulse' : 'bg-green-700 hover:bg-green-600'}`}
                            >
                                0
                                {renderChip(BetType.StraightUp, [0, 0, 0, 0])}
                            </div>
                            
                            {/* Numbers Grid */}
                            <div className="flex-1 grid grid-cols-12 grid-rows-3 text-center font-mono">
                                {/* Row 3 (Top) */}
                                {renderNumberCell(3, 'red')}
                                {renderNumberCell(6, 'black')}
                                {renderNumberCell(9, 'red')}
                                {renderNumberCell(12, 'red')}
                                {renderNumberCell(15, 'black')}
                                {renderNumberCell(18, 'red')}
                                {renderNumberCell(21, 'red')}
                                {renderNumberCell(24, 'black')}
                                {renderNumberCell(27, 'red')}
                                {renderNumberCell(30, 'red')}
                                {renderNumberCell(33, 'black')}
                                {renderNumberCell(36, 'red')}

                                {/* Row 2 (Middle) */}
                                {renderNumberCell(2, 'black')}
                                {renderNumberCell(5, 'red')}
                                {renderNumberCell(8, 'black')}
                                {renderNumberCell(11, 'black')}
                                {renderNumberCell(14, 'red')}
                                {renderNumberCell(17, 'black')}
                                {renderNumberCell(20, 'black')}
                                {renderNumberCell(23, 'red')}
                                {renderNumberCell(26, 'black')}
                                {renderNumberCell(29, 'black')}
                                {renderNumberCell(32, 'red')}
                                {renderNumberCell(35, 'black')}

                                {/* Row 1 (Bottom) */}
                                {renderNumberCell(1, 'red')}
                                {renderNumberCell(4, 'black')}
                                {renderNumberCell(7, 'red')}
                                {renderNumberCell(10, 'black')}
                                {renderNumberCell(13, 'black')}
                                {renderNumberCell(16, 'red')}
                                {renderNumberCell(19, 'red')}
                                {renderNumberCell(22, 'black')}
                                {renderNumberCell(25, 'red')}
                                {renderNumberCell(28, 'black')}
                                {renderNumberCell(31, 'black')}
                                {renderNumberCell(34, 'red')}
                            </div>

                            {/* 2:1 Columns */}
                            <div className="flex-none w-16 grid grid-rows-3 font-black text-sm uppercase tracking-tighter bg-[#0a0f0c] text-gray-400">
                                <div onClick={() => handlePlaceChip(BetType.Column, [3, 0, 0, 0])} className="relative border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [3, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [2, 0, 0, 0])} className="relative border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [2, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [1, 0, 0, 0])} className="relative border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [1, 0, 0, 0])}</div>
                            </div>
                        </div>

                        {/* Middle Section: Dozens */}
                        <div className="flex ml-16 mr-16 border-t border-white h-14 font-black uppercase tracking-widest bg-[#0a0f0c] text-gray-300">
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [1, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">1st 12 {renderChip(BetType.Dozen, [1, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [2, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">2nd 12 {renderChip(BetType.Dozen, [2, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [3, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">3rd 12 {renderChip(BetType.Dozen, [3, 0, 0, 0])}</div>
                        </div>

                        {/* Bottom Section: Outside Bets */}
                        <div className="flex ml-16 mr-16 border-t border-white h-16 font-black uppercase tracking-wider text-sm bg-[#0a0f0c] text-gray-300">
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [0, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">1 to 18 {renderChip(BetType.HighLow, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [1, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">Even {renderChip(BetType.OddEven, [1, 0, 0, 0])}</div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [0, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center bg-red-600 hover:bg-red-500 text-white transition-colors">
                                <div className="w-6 h-6 bg-red-500 rounded-sm border-2 border-white/30 mr-2"></div>
                                RED 
                                {renderChip(BetType.RedBlack, [0, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [1, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-white transition-colors">
                                <div className="w-6 h-6 bg-black rounded-sm border-2 border-white/30 mr-2"></div>
                                BLACK 
                                {renderChip(BetType.RedBlack, [1, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [0, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">Odd {renderChip(BetType.OddEven, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [1, 0, 0, 0])} className="relative flex-1 border border-white flex items-center justify-center hover:bg-gray-800 hover:text-white transition-colors">19 to 36 {renderChip(BetType.HighLow, [1, 0, 0, 0])}</div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}