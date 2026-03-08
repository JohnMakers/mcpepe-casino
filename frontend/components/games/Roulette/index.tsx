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

// European Roulette sequence
const WHEEL_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export enum BetType {
    StraightUp = 0, Split = 1, Street = 2, Corner = 3, Line = 4, Basket = 5,
    Column = 6, Dozen = 7, RedBlack = 8, OddEven = 9, HighLow = 10,
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
    const [serverSeedHash, setServerSeedHash] = useState<string>('Fetching secure seed...'); 
    const [unhashedServerSeed, setUnhashedServerSeed] = useState<string>('');
    const [wheelRotation, setWheelRotation] = useState(0);

    // Betting State
    const [selectedChipValue, setSelectedChipValue] = useState<number>(0.1);
    const [currentBets, setCurrentBets] = useState<ClientBet[]>([]);
    
    const totalWager = currentBets.reduce((acc, bet) => acc + bet.amount, 0);

    const fetchNewSeed = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/roulette/seed`, { method: "POST" });
            if (!res.ok) throw new Error("Backend not live yet");
            const data = await res.json();
            setServerSeedHash(data.serverSeedHash);
            setUnhashedServerSeed(data.serverSeed);
        } catch (error) {
            console.error("Failed to fetch seed:", error);
            setServerSeedHash("Backend Offline / Deploying...");
        }
    };

    useEffect(() => {
        fetchNewSeed();
    }, []);

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

    const handleClearBets = () => { if (!isSpinning) setCurrentBets([]); };

    const handleSpin = async () => {
        if (!publicKey || !wallet.signTransaction) return alert("Please connect your wallet!");
        if (currentBets.length === 0) return alert("Please place a bet first!");
        if (totalWager > balance) return alert("Insufficient funds.");
        if (!unhashedServerSeed) return alert("Security Error: Server seed not loaded. Ensure Render backend is live.");

        setIsSpinning(true);
        setBalance(prev => prev - totalWager);
        setWinningNumber(null);

        try {
            const provider = new anchor.AnchorProvider(connection, wallet as any, { preflightCommitment: "processed" });
            const program = new anchor.Program(idl as anchor.Idl, PROGRAM_ID, provider);

            const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId);
            const gameStateKeypair = Keypair.generate();
            const nonce = new anchor.BN(Date.now());

            const anchorBets = currentBets.map(bet => {
                const betTypeKeys = ["straightUp", "split", "street", "corner", "line", "basket", "column", "dozen", "redBlack", "oddEven", "highLow"];
                const anchorBetType: any = {};
                anchorBetType[betTypeKeys[bet.betType]] = {}; 
                return { betType: anchorBetType, data: bet.data, amount: new anchor.BN(bet.amount * LAMPORTS_PER_SOL) };
            });

            const serverSeedHashBytes = Array.from(Buffer.from(serverSeedHash, 'hex'));
            const totalWagerLamports = new anchor.BN(totalWager * LAMPORTS_PER_SOL);

            const tx = await program.methods
                .startRoulette(serverSeedHashBytes, clientSeed, nonce, anchorBets, totalWagerLamports)
                .accounts({
                    gameState: gameStateKeypair.publicKey,
                    player: publicKey,
                    vault: vaultPDA,
                    authority: HOUSE_PUBKEY,
                    systemProgram: SystemProgram.programId,
                }).transaction();

            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            const signedTx = await wallet.signTransaction(tx);
            signedTx.partialSign(gameStateKeypair);
            
            const rawTransaction = signedTx.serialize();
            const txSignature = await connection.sendRawTransaction(rawTransaction, { skipPreflight: false });
            await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash });

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

            // Hash replication for Provably Fair result
            const combinedData = unhashedServerSeed + clientSeed + nonce.toString();
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combinedData) as any);
            const outcomeHashBytes = new Uint8Array(hashBuffer);
            
            const dataView = new DataView(outcomeHashBytes.buffer);
            const rawNumber = dataView.getUint32(0, true);
            const winningNum = rawNumber % 37;
            
            // Calculate visual rotation to perfectly land on the generated number
            const targetIndex = WHEEL_NUMBERS.indexOf(winningNum);
            const baseSpins = 360 * 6; // Spin fast 6 times
            // Adjust math so the pointer lands right in the middle of the slice
            const targetRotation = baseSpins + (360 - (targetIndex * (360 / 37))); 
            
            setWheelRotation(prev => prev + targetRotation + (prev % 360 !== 0 ? 360 - (prev % 360) : 0));

            setTimeout(async () => {
                setWinningNumber(winningNum);
                setIsSpinning(false);
                try {
                    const exactBalance = await connection.getBalance(publicKey);
                    setBalance(exactBalance / LAMPORTS_PER_SOL);
                } catch (err) { }

                logWager("Roulette", totalWager, winningNum > 0, 0, backendData.txSignature, clientSeed);
                fetchNewSeed();
                setCurrentBets([]);
            }, 5000); // 5 seconds to match the new cubic-bezier CSS duration

        } catch (error) {
            console.error("Roulette Error:", error);
            alert(`Transaction failed: ${error}`);
            setBalance(prev => prev + totalWager); 
            setIsSpinning(false);
        }
    };

    // Viusal Chip logic
    const renderChip = (targetBetType: BetType, targetData: number[]) => {
        const bet = currentBets.find(b => b.betType === targetBetType && JSON.stringify(b.data) === JSON.stringify(targetData));
        if (!bet) return null;
        return (
            <div className="absolute z-10 w-8 h-8 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-400 to-blue-700 rounded-full border-4 border-dashed border-white/50 shadow-[0_4px_10px_rgba(0,0,0,0.5)] flex items-center justify-center text-[11px] font-black pointer-events-none text-white transform scale-95 transition-transform">
                {bet.amount}
            </div>
        );
    };

    const renderNumberCell = (num: number, color: 'red' | 'black') => {
        const isWinner = winningNumber === num;
        return (
            <div 
                key={num}
                onClick={() => handlePlaceChip(BetType.StraightUp, [num, 0, 0, 0])} 
                className={`relative border border-white/20 flex items-center justify-center transition-all duration-300 py-3 ${isWinner ? 'bg-yellow-400 z-20 shadow-[0_0_30px_rgba(250,204,21,0.8)] scale-110 border-yellow-200' : 'hover:bg-white/10'}`}
            >
                <span className={`font-bold w-10 h-10 rounded-full flex items-center justify-center shadow-inner font-mono text-lg ${color === 'red' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'} ${isWinner ? 'text-black border-2 border-black' : ''}`}>
                    {num}
                </span>
                {renderChip(BetType.StraightUp, [num, 0, 0, 0])}
            </div>
        );
    };

    return (
        <div className="flex flex-col xl:flex-row gap-8 w-full max-w-7xl mx-auto p-4 animate-fade-in">
            {/* Left Panel */}
            <div className="flex flex-col gap-4 w-full xl:w-1/4 bg-[#0a0f0c] p-6 rounded-2xl border border-green-500/20 shadow-2xl relative z-10">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Bet Slip</h2>
                    <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-green-500 hover:text-green-400 bg-green-900/20 px-2 py-1 rounded border border-green-900/50 transition-colors">
                        🛡️ Provably Fair
                    </button>
                </div>
                
                <div className="space-y-4">
                    <div className="bg-black border border-gray-800 p-4 rounded-xl flex justify-between items-center shadow-inner">
                        <span className="text-gray-400 font-bold uppercase text-sm tracking-wider">Total Wager:</span>
                        <span className="text-xl font-mono font-black text-yellow-400">{totalWager.toFixed(2)} SOL</span>
                    </div>

                    <div className="space-y-2 border-t border-gray-800 pt-4">
                        <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Client Seed</label>
                        <input 
                            type="text" 
                            value={clientSeed} 
                            onChange={(e) => setClientSeed(e.target.value)}
                            disabled={isSpinning}
                            className="w-full bg-black border border-gray-800 rounded-lg p-3 font-mono text-sm text-green-400 outline-none focus:border-green-500 transition-colors disabled:opacity-50"
                        />
                        <p className="text-[10px] text-gray-500 font-mono break-all mt-2 leading-relaxed">Server Hash:<br/>{serverSeedHash}</p>
                    </div>

                    <button 
                        onClick={handleSpin}
                        disabled={isSpinning || currentBets.length === 0}
                        className="mt-6 w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-black font-black text-2xl uppercase tracking-widest py-5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transform hover:-translate-y-1 active:translate-y-0"
                    >
                        {isSpinning ? 'SPINNING...' : 'PLACE BET'}
                    </button>
                </div>
            </div>

            {/* Center Panel */}
            <div className="flex flex-col items-center gap-8 w-full xl:w-3/4">
                
                {/* Mathematical Pure CSS/React Roulette Wheel */}
                <div className="relative w-[320px] h-[320px] md:w-[400px] md:h-[400px] rounded-full border-[12px] border-[#111] bg-[#1a1a1a] shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex items-center justify-center p-2 box-border ring-4 ring-[#d4af37]">
                    
                    {/* The Rotating Element */}
                    <div 
                        className="w-full h-full rounded-full relative overflow-hidden"
                        style={{ 
                            transform: `rotate(${wheelRotation}deg)`,
                            // Physics-based easing curve for a realistic spin-down
                            transition: isSpinning ? 'transform 5000ms cubic-bezier(0.15, 0.85, 0.15, 1)' : 'none',
                            animation: !isSpinning && wheelRotation === 0 ? 'spin 60s linear infinite' : 'none' 
                        }}
                    >
                        {WHEEL_NUMBERS.map((num, i) => {
                            const rotation = i * (360 / 37);
                            const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(num);
                            const bgColor = num === 0 ? 'bg-green-500' : isRed ? 'bg-red-600' : 'bg-gray-900';
                            return (
                                <div 
                                    key={num}
                                    className={`absolute top-0 left-[35%] w-[30%] h-[50%] origin-bottom ${bgColor} flex justify-center pt-2`}
                                    style={{
                                        transform: `rotate(${rotation}deg)`,
                                        clipPath: 'polygon(50% 100%, 15% 0, 85% 0)',
                                        borderLeft: '1px solid rgba(255,255,255,0.1)',
                                        borderRight: '1px solid rgba(255,255,255,0.1)'
                                    }}
                                >
                                    <span className="text-white font-black text-sm md:text-base transform -rotate-90 origin-center mt-3 drop-shadow-md">
                                        {num}
                                    </span>
                                </div>
                            )
                        })}
                        
                        {/* Center Hub */}
                        <div className="absolute top-[35%] left-[35%] w-[30%] h-[30%] bg-[#111] rounded-full border-[6px] border-[#d4af37] shadow-inner z-10 flex items-center justify-center">
                            <span className="text-3xl filter drop-shadow-lg">🐸</span>
                        </div>
                    </div>

                    {/* The Winning Pointer (Static) */}
                    <div className="absolute -top-4 w-8 h-12 bg-white z-20 shadow-[0_5px_15px_rgba(0,0,0,0.5)] border-2 border-gray-300" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}></div>
                    
                    {/* Inner winning number display pop-up */}
                    {winningNumber !== null && !isSpinning && (
                        <div className="absolute inset-0 m-auto w-24 h-24 bg-black/90 rounded-full flex items-center justify-center border-4 border-yellow-500 animate-bounce shadow-[0_0_40px_rgba(250,204,21,0.6)] z-30">
                            <span className="text-4xl font-black text-white">{winningNumber}</span>
                        </div>
                    )}
                </div>

                {/* Chip Denomination */}
                <div className="flex flex-wrap gap-3 justify-center mt-2 w-full bg-[#0a0f0c] p-4 rounded-xl border border-green-900/30 shadow-xl max-w-3xl relative z-10">
                    {[0.01, 0.05, 0.1, 0.25, 0.5, 1].map((chipValue) => (
                        <button
                            key={chipValue}
                            onClick={() => setSelectedChipValue(chipValue)}
                            disabled={isSpinning}
                            className={`w-14 h-14 rounded-full font-black flex items-center justify-center border-[3px] transition-all shadow-lg font-mono text-sm disabled:opacity-50 ${
                                selectedChipValue === chipValue 
                                ? 'border-white scale-110 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-400 to-blue-700 text-white shadow-[0_0_20px_rgba(59,130,246,0.6)]' 
                                : 'border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-400'
                            }`}
                        >
                            {chipValue}
                        </button>
                    ))}
                    <button 
                        onClick={handleClearBets} 
                        disabled={isSpinning}
                        className="ml-4 text-gray-400 hover:text-red-400 font-black uppercase tracking-wider text-xs px-6 py-2 rounded-xl border-2 border-gray-800 hover:border-red-900/50 hover:bg-red-900/10 transition-colors disabled:opacity-50"
                    >
                        Clear Table
                    </button>
                </div>

                {/* Premium Casino Felt Betting Board */}
                <div className={`w-full max-w-4xl overflow-x-auto pb-4 transition-opacity ${isSpinning ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                    <div className="min-w-[700px] bg-[#0A3B1C] border-[8px] border-[#051c0d] text-white flex flex-col cursor-pointer select-none shadow-2xl rounded-lg p-2 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
                        
                        <div className="flex border-4 border-white/20 rounded-md overflow-hidden">
                            {/* Zero Basket */}
                            <div 
                                onClick={() => handlePlaceChip(BetType.StraightUp, [0, 0, 0, 0])}
                                className={`relative flex-none w-16 border-r border-white/20 flex items-center justify-center transition-all text-3xl font-black ${winningNumber === 0 ? 'bg-yellow-400 text-black shadow-[0_0_30px_rgba(250,204,21,0.8)] z-10' : 'bg-green-600 hover:bg-green-500'}`}
                            >
                                0
                                {renderChip(BetType.StraightUp, [0, 0, 0, 0])}
                            </div>
                            
                            {/* Numbers Grid */}
                            <div className="flex-1 grid grid-cols-12 grid-rows-3 text-center">
                                {/* Row 3 (Top) */}
                                {renderNumberCell(3, 'red')} {renderNumberCell(6, 'black')} {renderNumberCell(9, 'red')} {renderNumberCell(12, 'red')} {renderNumberCell(15, 'black')} {renderNumberCell(18, 'red')} {renderNumberCell(21, 'red')} {renderNumberCell(24, 'black')} {renderNumberCell(27, 'red')} {renderNumberCell(30, 'red')} {renderNumberCell(33, 'black')} {renderNumberCell(36, 'red')}

                                {/* Row 2 (Middle) */}
                                {renderNumberCell(2, 'black')} {renderNumberCell(5, 'red')} {renderNumberCell(8, 'black')} {renderNumberCell(11, 'black')} {renderNumberCell(14, 'red')} {renderNumberCell(17, 'black')} {renderNumberCell(20, 'black')} {renderNumberCell(23, 'red')} {renderNumberCell(26, 'black')} {renderNumberCell(29, 'black')} {renderNumberCell(32, 'red')} {renderNumberCell(35, 'black')}

                                {/* Row 1 (Bottom) */}
                                {renderNumberCell(1, 'red')} {renderNumberCell(4, 'black')} {renderNumberCell(7, 'red')} {renderNumberCell(10, 'black')} {renderNumberCell(13, 'black')} {renderNumberCell(16, 'red')} {renderNumberCell(19, 'red')} {renderNumberCell(22, 'black')} {renderNumberCell(25, 'red')} {renderNumberCell(28, 'black')} {renderNumberCell(31, 'black')} {renderNumberCell(34, 'red')}
                            </div>

                            {/* 2:1 Columns */}
                            <div className="flex-none w-16 grid grid-rows-3 font-black text-sm uppercase tracking-tighter bg-[#051c0d] text-gray-400 border-l border-white/20">
                                <div onClick={() => handlePlaceChip(BetType.Column, [3, 0, 0, 0])} className="relative border-b border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [3, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [2, 0, 0, 0])} className="relative border-b border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [2, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [1, 0, 0, 0])} className="relative flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [1, 0, 0, 0])}</div>
                            </div>
                        </div>

                        {/* Middle Section: Dozens */}
                        <div className="flex ml-[4.3rem] mr-[4.2rem] mt-2 border-4 border-white/20 rounded-md overflow-hidden h-14 font-black uppercase tracking-widest bg-[#051c0d] text-gray-300">
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [1, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">1st 12 {renderChip(BetType.Dozen, [1, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [2, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2nd 12 {renderChip(BetType.Dozen, [2, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [3, 0, 0, 0])} className="relative flex-1 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">3rd 12 {renderChip(BetType.Dozen, [3, 0, 0, 0])}</div>
                        </div>

                        {/* Bottom Section: Outside Bets */}
                        <div className="flex ml-[4.3rem] mr-[4.2rem] mt-2 border-4 border-white/20 rounded-md overflow-hidden h-16 font-black uppercase tracking-wider text-sm bg-[#051c0d] text-gray-300">
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [0, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">1 to 18 {renderChip(BetType.HighLow, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [1, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">Even {renderChip(BetType.OddEven, [1, 0, 0, 0])}</div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [0, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center bg-red-600/90 hover:bg-red-500 text-white transition-colors shadow-inner">
                                <div className="w-4 h-4 bg-red-500 rounded-sm mr-2 shadow-sm"></div> RED 
                                {renderChip(BetType.RedBlack, [0, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [1, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-white transition-colors shadow-inner">
                                <div className="w-4 h-4 bg-black rounded-sm mr-2 shadow-sm"></div> BLACK 
                                {renderChip(BetType.RedBlack, [1, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [0, 0, 0, 0])} className="relative flex-1 border-r border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">Odd {renderChip(BetType.OddEven, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [1, 0, 0, 0])} className="relative flex-1 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">19 to 36 {renderChip(BetType.HighLow, [1, 0, 0, 0])}</div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}