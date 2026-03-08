'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
// @ts-ignore
import idl from "../../../idl.json";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
const PROGRAM_ID = new PublicKey("BNpcicNi55iYT6yfe2isgHnqqSWBtAr8qfiGwpKbxyuz");
const HOUSE_PUBKEY = new PublicKey("Gf9QEwbxosqQY9bLBrgjKommtX8qPdNqFrKazmHfaZBv");

const WHEEL_NUMBERS = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export enum BetType {
    StraightUp = 0, Split = 1, Street = 2, Corner = 3, Line = 4, Basket = 5,
    Column = 6, Dozen = 7, RedBlack = 8, OddEven = 9, HighLow = 10,
}

export interface ClientBet { betType: BetType; data: number[]; amount: number; }

interface Props {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  logWager: (game: string, wager: number, win: boolean, payout: number, hash: string, seed: string) => void;
  setShowProvablyFair: (val: boolean) => void;
}

// Replicate contract logic for immediate UI feedback
const getMultiplier = (betType: BetType) => {
    switch(betType) {
        case BetType.StraightUp: return 36; case BetType.Split: return 18; case BetType.Street: return 12;
        case BetType.Corner: return 9; case BetType.Line: return 6; case BetType.Basket: return 7;
        case BetType.Column: return 3; case BetType.Dozen: return 3; default: return 2;
    }
};

const isWinningBet = (bet: ClientBet, winningNum: number) => {
    const d = bet.data;
    switch(bet.betType) {
        case BetType.StraightUp: return d[0] === winningNum;
        case BetType.Split: return d[0] === winningNum || d[1] === winningNum;
        case BetType.Street: return d[0] === winningNum || d[1] === winningNum || d[2] === winningNum;
        case BetType.Corner: return d.includes(winningNum);
        case BetType.Line: return winningNum >= d[0] && winningNum <= d[0] + 5 && winningNum !== 0;
        case BetType.Basket: return winningNum <= 3;
        case BetType.Column: return winningNum !== 0 && winningNum % 3 === (d[0] === 3 ? 0 : d[0]);
        case BetType.Dozen:
            if(winningNum===0) return false;
            if(d[0]===1) return winningNum >= 1 && winningNum <= 12;
            if(d[0]===2) return winningNum >= 13 && winningNum <= 24;
            return winningNum >= 25 && winningNum <= 36;
        case BetType.RedBlack:
            if(winningNum===0) return false;
            const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(winningNum);
            return d[0] === 0 ? isRed : !isRed;
        case BetType.OddEven: return winningNum !== 0 && (d[0] === 0 ? winningNum % 2 !== 0 : winningNum % 2 === 0);
        case BetType.HighLow: return winningNum !== 0 && (d[0] === 0 ? winningNum >= 1 && winningNum <= 18 : winningNum >= 19 && winningNum <= 36);
        default: return false;
    }
};

export default function RouletteGame({ balance, setBalance, logWager, setShowProvablyFair }: Props) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey } = wallet;
    
    const [isSpinning, setIsSpinning] = useState(false);
    const [winningNumber, setWinningNumber] = useState<number | null>(null);
    const [localPayout, setLocalPayout] = useState<number | null>(null);
    
    // Background seeds
    const clientSeedRef = useRef("pepe-" + Math.random().toString(36).substring(7));
    const [serverSeedHash, setServerSeedHash] = useState<string>(''); 
    const [unhashedServerSeed, setUnhashedServerSeed] = useState<string>('');
    
    // Animation States
    const [wheelRotation, setWheelRotation] = useState(0);
    const [ballRotation, setBallRotation] = useState(0);

    const [selectedChipValue, setSelectedChipValue] = useState<number>(0.1);
    const [currentBets, setCurrentBets] = useState<ClientBet[]>([]);
    
    const totalWager = currentBets.reduce((acc, bet) => acc + bet.amount, 0);

    const fetchNewSeed = async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/roulette/seed`, { method: "POST" });
            const data = await res.json();
            setServerSeedHash(data.serverSeedHash);
            setUnhashedServerSeed(data.serverSeed);
        } catch (error) { console.error("Seed fetch error:", error); }
    };

    useEffect(() => { fetchNewSeed(); }, []);

    const handlePlaceChip = (betType: BetType, data: number[]) => {
        if (isSpinning) return;
        setCurrentBets((prev) => {
            const idx = prev.findIndex(b => b.betType === betType && JSON.stringify(b.data) === JSON.stringify(data));
            if (idx >= 0) {
                const up = [...prev];
                up[idx].amount = parseFloat((up[idx].amount + selectedChipValue).toFixed(4));
                return up;
            }
            return [...prev, { betType, data, amount: selectedChipValue }];
        });
    };

    const handleSpin = async () => {
        if (!publicKey || !wallet.signTransaction) return alert("Connect your wallet.");
        if (currentBets.length === 0) return;
        if (totalWager > balance) return alert("Insufficient funds.");

        setIsSpinning(true);
        setBalance(prev => prev - totalWager);
        setWinningNumber(null);
        setLocalPayout(null);

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
                return { betType: anchorBetType, data: bet.data, amount: new anchor.BN(Math.round(bet.amount * LAMPORTS_PER_SOL)) };
            });

            const serverSeedHashBytes = Array.from(Buffer.from(serverSeedHash, 'hex'));
            const totalWagerLamports = new anchor.BN(Math.round(totalWager * LAMPORTS_PER_SOL));

            const tx = await program.methods
                .startRoulette(serverSeedHashBytes, clientSeedRef.current, nonce, anchorBets, totalWagerLamports)
                .accounts({
                    gameState: gameStateKeypair.publicKey, player: publicKey,
                    vault: vaultPDA, authority: HOUSE_PUBKEY, systemProgram: SystemProgram.programId,
                }).transaction();

            const latestBlockhash = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = latestBlockhash.blockhash;
            tx.feePayer = publicKey;

            const signedTx = await wallet.signTransaction(tx);
            signedTx.partialSign(gameStateKeypair);
            
            const txSignature = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: false });
            await connection.confirmTransaction({ signature: txSignature, ...latestBlockhash });

            const backendResponse = await fetch(`${BACKEND_URL}/api/roulette/resolve`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerPublicKey: publicKey.toBase58(), serverSeed: unhashedServerSeed, gamePda: gameStateKeypair.publicKey.toBase58() })
            });

            const backendData = await backendResponse.json();
            if (!backendData.success) throw new Error(backendData.error);

            // Replicate Outcome
            const combinedData = unhashedServerSeed + clientSeedRef.current + nonce.toString();
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combinedData) as any);
            const outcomeHashBytes = new Uint8Array(hashBuffer);
            const winningNum = new DataView(outcomeHashBytes.buffer).getUint32(0, true) % 37;
            
            // Calculate payout
            let calculatedPayout = 0;
            currentBets.forEach(bet => {
                if (isWinningBet(bet, winningNum)) {
                    calculatedPayout += bet.amount * getMultiplier(bet.betType);
                }
            });
            
            // Wheel Physics
            const targetIndex = WHEEL_NUMBERS.indexOf(winningNum);
            const baseSpins = 360 * 5; 
            const targetWheelRot = baseSpins + (360 - (targetIndex * (360 / 37))); 
            // The ball spins counter-clockwise and lands EXACTLY at 0 degrees relative to the viewport (the pointer)
            const targetBallRot = -(360 * 15);

            setWheelRotation(prev => prev + targetWheelRot + (prev % 360 !== 0 ? 360 - (prev % 360) : 0));
            setBallRotation(prev => prev + targetBallRot + (prev % 360 !== 0 ? 360 - (prev % 360) : 0));

            setTimeout(async () => {
                setWinningNumber(winningNum);
                setLocalPayout(calculatedPayout);
                setIsSpinning(false);
                
                try {
                    const exactBalance = await connection.getBalance(publicKey);
                    setBalance(exactBalance / LAMPORTS_PER_SOL);
                } catch (err) {}

                logWager("Roulette", totalWager, calculatedPayout > 0, calculatedPayout, backendData.txSignature, clientSeedRef.current);
                
                // Refresh client seed silently
                clientSeedRef.current = "pepe-" + Math.random().toString(36).substring(7);
                fetchNewSeed();
                setCurrentBets([]);
            }, 6000); // Wait for the 6-second physics CSS spin

        } catch (error) {
            console.error(error);
            alert("Transaction failed.");
            setBalance(prev => prev + totalWager); 
            setIsSpinning(false);
        }
    };

    const renderChip = (targetBetType: BetType, targetData: number[]) => {
        const bet = currentBets.find(b => b.betType === targetBetType && JSON.stringify(b.data) === JSON.stringify(targetData));
        if (!bet) return null;
        return (
            <div className="absolute z-10 w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-700 rounded-full border-4 border-dotted border-white shadow-[0_4px_10px_rgba(0,0,0,0.7)] flex items-center justify-center text-[10px] font-black pointer-events-none text-white transform scale-90">
                {bet.amount}
            </div>
        );
    };

    const renderNumberCell = (num: number, color: 'red' | 'black') => (
        <div 
            key={num} onClick={() => handlePlaceChip(BetType.StraightUp, [num, 0, 0, 0])} 
            className={`relative border border-white/20 flex items-center justify-center transition-all duration-200 py-3 hover:bg-white/20`}
        >
            <span className={`font-black w-10 h-10 rounded-full flex items-center justify-center shadow-inner font-mono text-xl ${color === 'red' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`}>
                {num}
            </span>
            {renderChip(BetType.StraightUp, [num, 0, 0, 0])}
        </div>
    );

    return (
        <div className="flex flex-col xl:flex-row gap-8 w-full max-w-7xl mx-auto p-4 animate-fade-in">
            {/* CLEANED UP BET SLIP */}
            <div className="flex flex-col w-full xl:w-1/4 bg-[#0a0f0c] p-6 rounded-2xl border border-green-500/20 shadow-2xl relative z-10 h-fit">
                <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">Bet Slip</h2>
                    <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-green-400 transition-colors">
                        🛡️ Provably Fair
                    </button>
                </div>
                
                <div className="space-y-6">
                    <div className="bg-black border border-gray-800 p-4 rounded-xl flex justify-between items-center shadow-inner">
                        <span className="text-gray-400 font-bold uppercase text-sm tracking-wider">Total Wager:</span>
                        <span className="text-2xl font-mono font-black text-yellow-400">{totalWager.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-center w-full bg-black/50 p-4 rounded-xl border border-gray-800">
                        {[0.05, 0.1, 0.25, 0.5, 1].map((chipValue) => (
                            <button
                                key={chipValue} onClick={() => setSelectedChipValue(chipValue)} disabled={isSpinning}
                                className={`w-12 h-12 rounded-full font-black flex items-center justify-center border-4 transition-all shadow-lg font-mono text-xs disabled:opacity-50 ${
                                    selectedChipValue === chipValue 
                                    ? 'border-yellow-400 scale-110 bg-gradient-to-br from-blue-400 to-blue-700 text-white' 
                                    : 'border-gray-600 bg-gray-800 text-gray-400 hover:bg-gray-700'
                                }`}
                            >
                                {chipValue}
                            </button>
                        ))}
                        <button onClick={() => setCurrentBets([])} disabled={isSpinning} className="w-full mt-2 text-gray-500 hover:text-red-400 font-black uppercase text-xs px-6 py-2 rounded border border-gray-800 hover:border-red-900/50 hover:bg-red-900/10 transition-colors">
                            Clear Table
                        </button>
                    </div>

                    <button 
                        onClick={handleSpin} disabled={isSpinning || currentBets.length === 0}
                        className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500 text-black font-black text-2xl uppercase tracking-widest py-6 rounded-xl transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(34,197,94,0.2)] transform hover:-translate-y-1 active:translate-y-0"
                    >
                        {isSpinning ? 'SPINNING...' : 'PLACE BET'}
                    </button>
                </div>
            </div>

            {/* ROULETTE BOARD */}
            <div className="flex flex-col items-center gap-12 w-full xl:w-3/4">
                
                {/* ADVANCED WHEEL ANIMATION */}
                <div className="relative w-[340px] h-[340px] md:w-[420px] md:h-[420px] rounded-full bg-[#111] shadow-[0_20px_60px_rgba(0,0,0,0.9)] flex items-center justify-center p-3 ring-8 ring-[#2a1a08] border-8 border-[#1a1a1a]">
                    
                    {/* The Wheel */}
                    <div className="w-full h-full rounded-full relative overflow-hidden ring-4 ring-[#d4af37]"
                         style={{ transform: `rotate(${wheelRotation}deg)`, transition: isSpinning ? 'transform 6000ms cubic-bezier(0.15, 0.85, 0.15, 1)' : 'none' }}>
                        {WHEEL_NUMBERS.map((num, i) => {
                            const rotation = i * (360 / 37);
                            const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(num);
                            return (
                                <div key={num} className={`absolute top-0 left-[35%] w-[30%] h-[50%] origin-bottom ${num === 0 ? 'bg-green-500' : isRed ? 'bg-red-600' : 'bg-gray-900'} flex justify-center pt-2`}
                                     style={{ transform: `rotate(${rotation}deg)`, clipPath: 'polygon(50% 100%, 15% 0, 85% 0)' }}>
                                    <span className="text-white font-black text-sm md:text-base transform -rotate-90 mt-4 drop-shadow">{num}</span>
                                </div>
                            )
                        })}
                        <div className="absolute top-[35%] left-[35%] w-[30%] h-[30%] bg-[#111] rounded-full border-[6px] border-[#d4af37] shadow-inner z-10 flex items-center justify-center">
                            <span className="text-3xl drop-shadow-lg">🐸</span>
                        </div>
                    </div>

                    {/* Counter-Rotating Ball Track */}
                    <div className="absolute inset-2 rounded-full border-[20px] border-transparent z-20 pointer-events-none"
                         style={{ transform: `rotate(${ballRotation}deg)`, transition: isSpinning ? 'transform 6000ms cubic-bezier(0.2, 0.8, 0.1, 1)' : 'none' }}>
                         {/* The Ball */}
                         <div className="absolute -top-[10px] left-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_15px_#fff] transform -translate-x-1/2" />
                    </div>

                    {/* Static Pointer */}
                    <div className="absolute -top-3 w-6 h-10 bg-yellow-500 z-30 shadow-xl border-b-4 border-yellow-700" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                    
                    {/* Win/Loss Overlay Popup */}
                    {winningNumber !== null && !isSpinning && (
                        <div className={`absolute inset-0 m-auto w-48 h-48 bg-black/95 rounded-full flex flex-col items-center justify-center border-4 animate-bounce z-40 ${localPayout! > 0 ? 'border-green-500 shadow-[0_0_50px_rgba(34,197,94,0.6)]' : 'border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.6)]'}`}>
                            <span className="text-gray-400 text-xs font-black uppercase tracking-widest mb-1">Result</span>
                            <span className="text-6xl font-black text-white">{winningNumber}</span>
                            {localPayout! > 0 ? (
                                <span className="text-green-400 font-black mt-2 text-lg drop-shadow-md">+{localPayout!.toFixed(2)} SOL</span>
                            ) : (
                                <span className="text-red-500 font-black mt-2 text-sm uppercase">Bust</span>
                            )}
                        </div>
                    )}
                </div>

                {/* FELT TABLE */}
                <div className={`w-full max-w-4xl overflow-x-auto pb-4 transition-opacity ${isSpinning ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                    <div className="min-w-[700px] bg-[#0A3B1C] border-[10px] border-[#051c0d] text-white flex flex-col cursor-pointer select-none shadow-2xl rounded-2xl p-3 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] relative">
                        
                        <div className="flex border-4 border-white/30 rounded-lg overflow-hidden relative z-10">
                            <div onClick={() => handlePlaceChip(BetType.StraightUp, [0, 0, 0, 0])} className={`relative flex-none w-16 border-r border-white/30 flex items-center justify-center transition-all text-4xl font-black ${winningNumber === 0 ? 'bg-yellow-400 text-black' : 'bg-green-600 hover:bg-green-500'}`}>
                                0 {renderChip(BetType.StraightUp, [0, 0, 0, 0])}
                            </div>
                            
                            <div className="flex-1 grid grid-cols-12 grid-rows-3 text-center">
                                {/* Top Row */}
                                {renderNumberCell(3, 'red')} {renderNumberCell(6, 'black')} {renderNumberCell(9, 'red')} {renderNumberCell(12, 'red')} {renderNumberCell(15, 'black')} {renderNumberCell(18, 'red')} {renderNumberCell(21, 'red')} {renderNumberCell(24, 'black')} {renderNumberCell(27, 'red')} {renderNumberCell(30, 'red')} {renderNumberCell(33, 'black')} {renderNumberCell(36, 'red')}
                                {/* Middle Row */}
                                {renderNumberCell(2, 'black')} {renderNumberCell(5, 'red')} {renderNumberCell(8, 'black')} {renderNumberCell(11, 'black')} {renderNumberCell(14, 'red')} {renderNumberCell(17, 'black')} {renderNumberCell(20, 'black')} {renderNumberCell(23, 'red')} {renderNumberCell(26, 'black')} {renderNumberCell(29, 'black')} {renderNumberCell(32, 'red')} {renderNumberCell(35, 'black')}
                                {/* Bottom Row */}
                                {renderNumberCell(1, 'red')} {renderNumberCell(4, 'black')} {renderNumberCell(7, 'red')} {renderNumberCell(10, 'black')} {renderNumberCell(13, 'black')} {renderNumberCell(16, 'red')} {renderNumberCell(19, 'red')} {renderNumberCell(22, 'black')} {renderNumberCell(25, 'red')} {renderNumberCell(28, 'black')} {renderNumberCell(31, 'black')} {renderNumberCell(34, 'red')}
                            </div>

                            <div className="flex-none w-16 grid grid-rows-3 font-black text-sm uppercase bg-[#051c0d] text-gray-400 border-l border-white/30">
                                <div onClick={() => handlePlaceChip(BetType.Column, [3, 0, 0, 0])} className="relative border-b border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [3, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [2, 0, 0, 0])} className="relative border-b border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [2, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [1, 0, 0, 0])} className="relative flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [1, 0, 0, 0])}</div>
                            </div>
                        </div>

                        <div className="flex ml-[4.3rem] mr-[4.2rem] mt-3 border-4 border-white/30 rounded-lg overflow-hidden h-16 font-black uppercase tracking-widest bg-[#051c0d] text-gray-300">
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [1, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">1st 12 {renderChip(BetType.Dozen, [1, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [2, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">2nd 12 {renderChip(BetType.Dozen, [2, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [3, 0, 0, 0])} className="relative flex-1 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">3rd 12 {renderChip(BetType.Dozen, [3, 0, 0, 0])}</div>
                        </div>

                        <div className="flex ml-[4.3rem] mr-[4.2rem] mt-3 border-4 border-white/30 rounded-lg overflow-hidden h-16 font-black uppercase tracking-wider text-sm bg-[#051c0d] text-gray-300">
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [0, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">1-18 {renderChip(BetType.HighLow, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [1, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">Even {renderChip(BetType.OddEven, [1, 0, 0, 0])}</div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [0, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center bg-red-600/90 hover:bg-red-500 text-white transition-colors">
                                <div className="w-5 h-5 bg-red-500 rounded-sm mr-2 shadow-inner"></div> RED {renderChip(BetType.RedBlack, [0, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [1, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center bg-black hover:bg-gray-900 text-white transition-colors">
                                <div className="w-5 h-5 bg-[#111] rounded-sm mr-2 shadow-inner"></div> BLACK {renderChip(BetType.RedBlack, [1, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [0, 0, 0, 0])} className="relative flex-1 border-r border-white/30 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">Odd {renderChip(BetType.OddEven, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [1, 0, 0, 0])} className="relative flex-1 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors">19-36 {renderChip(BetType.HighLow, [1, 0, 0, 0])}</div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}