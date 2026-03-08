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

const getChipStyles = (val: number) => {
    if (val >= 10) return 'bg-[#e67e22] text-black border-[#d35400]'; 
    if (val >= 5) return 'bg-[#8e44ad] text-white border-[#9b59b6]'; 
    if (val >= 1) return 'bg-[#2c3e50] text-white border-[#34495e]'; 
    if (val >= 0.5) return 'bg-[#27ae60] text-white border-[#2ecc71]'; 
    if (val >= 0.1) return 'bg-[#2980b9] text-white border-[#3498db]'; 
    if (val >= 0.05) return 'bg-[#c0392b] text-white border-[#e74c3c]'; 
    return 'bg-[#ecf0f1] text-black border-[#bdc3c7]'; 
};

export default function RouletteGame({ balance, setBalance, logWager, setShowProvablyFair }: Props) {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { publicKey } = wallet;
    
    const [isSpinning, setIsSpinning] = useState(false);
    const [winningNumber, setWinningNumber] = useState<number | null>(null);
    const [localPayout, setLocalPayout] = useState<number | null>(null);
    const [recentOutcomes, setRecentOutcomes] = useState<number[]>([]); 
    
    const [showOverlay, setShowOverlay] = useState(false);
    
    const clientSeedRef = useRef("pepe-" + Math.random().toString(36).substring(7));
    const [serverSeedHash, setServerSeedHash] = useState<string>(''); 
    const [unhashedServerSeed, setUnhashedServerSeed] = useState<string>('');
    
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
        
        if (showOverlay) setShowOverlay(false);

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

    const handleClearBets = () => {
        if (isSpinning) return;
        setCurrentBets([]);
        if (showOverlay) setShowOverlay(false);
    };

    const handleSpin = async () => {
        if (!publicKey || !wallet.signTransaction) return alert("Connect your wallet.");
        if (currentBets.length === 0) return;
        
        if (totalWager + 0.01 > balance) {
            return alert("Simulation Guard: Insufficient funds. You must leave at least ~0.01 SOL to cover Solana network account creation rent.");
        }

        if (!unhashedServerSeed) return alert("Security Guard: Provably Fair seeds not loaded from backend yet. Please wait a moment.");

        setIsSpinning(true);
        setShowOverlay(false); 
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
                return { 
                    betType: anchorBetType, 
                    data: [bet.data[0] || 0, bet.data[1] || 0, bet.data[2] || 0, bet.data[3] || 0], 
                    amount: new anchor.BN(Math.round(bet.amount * LAMPORTS_PER_SOL)) 
                };
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

            const combinedData = unhashedServerSeed + clientSeedRef.current + nonce.toString();
            const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combinedData) as any);
            const outcomeHashBytes = new Uint8Array(hashBuffer);
            const winningNum = new DataView(outcomeHashBytes.buffer).getUint32(0, true) % 37;
            
            let calculatedPayout = 0;
            currentBets.forEach(bet => {
                if (isWinningBet(bet, winningNum)) calculatedPayout += bet.amount * getMultiplier(bet.betType);
            });
            
            const targetIndex = WHEEL_NUMBERS.indexOf(winningNum);
            const baseSpins = 360 * 5; 
            const targetWheelRot = baseSpins + (360 - (targetIndex * (360 / 37))); 
            const targetBallRot = -(360 * 15);

            setWheelRotation(prev => prev + targetWheelRot + (prev % 360 !== 0 ? 360 - (prev % 360) : 0));
            setBallRotation(prev => prev + targetBallRot + (prev % 360 !== 0 ? 360 - (prev % 360) : 0));

            setTimeout(async () => {
                setWinningNumber(winningNum);
                setLocalPayout(calculatedPayout);
                setRecentOutcomes(prev => [winningNum, ...prev].slice(0, 8)); 
                setIsSpinning(false);
                
                setShowOverlay(true);
                setTimeout(() => setShowOverlay(false), 4000);
                
                try {
                    const exactBalance = await connection.getBalance(publicKey);
                    setBalance(exactBalance / LAMPORTS_PER_SOL);
                } catch (err) {}

                logWager("Roulette", totalWager, calculatedPayout > 0, calculatedPayout, backendData.txSignature, clientSeedRef.current);
                
                clientSeedRef.current = "pepe-" + Math.random().toString(36).substring(7);
                fetchNewSeed();
                setCurrentBets([]);
            }, 6000); 

        } catch (error) {
            console.error(error);
            alert("Transaction failed or was rejected.");
            setBalance(prev => prev + totalWager); 
            setIsSpinning(false);
        }
    };

    const renderChip = (targetBetType: BetType, targetData: number[]) => {
        const bet = currentBets.find(b => b.betType === targetBetType && JSON.stringify(b.data) === JSON.stringify(targetData));
        if (!bet) return null;
        
        const chipStyle = getChipStyles(bet.amount);
        
        return (
            <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[100] w-8 h-8 rounded-full border-[3px] border-dashed shadow-[0_5px_15px_rgba(0,0,0,0.9)] flex items-center justify-center text-[10px] font-black pointer-events-none transition-all duration-200 opacity-100 ${chipStyle}`}>
                {bet.amount}
            </div>
        );
    };

    const renderNumberCell = (num: number, color: 'red' | 'black') => (
        <div 
            key={num} onClick={() => handlePlaceChip(BetType.StraightUp, [num, 0, 0, 0])} 
            className={`relative border border-white/5 flex items-center justify-center transition-all duration-200 py-1.5 hover:bg-white/10 group cursor-pointer`}
        >
            <span className={`font-black w-8 h-8 rounded flex items-center justify-center shadow-[inset_0_-2px_6px_rgba(0,0,0,0.5)] font-mono text-lg group-hover:scale-110 transition-transform ${color === 'red' ? 'bg-[#c22020] text-white' : 'bg-[#111] text-white'}`}>
                {num}
            </span>
            {renderChip(BetType.StraightUp, [num, 0, 0, 0])}
        </div>
    );

    return (
        <div className="flex flex-col xl:flex-row gap-4 w-full max-w-7xl mx-auto p-2 md:p-4 animate-fade-in relative">
            
            {/* LEFT PANEL: COMPACT CLEAN BET SLIP */}
            <div className="flex flex-col w-full xl:w-[320px] bg-[#0a0f0c] p-4 rounded-2xl border border-green-500/20 shadow-[0_0_50px_rgba(0,0,0,0.8)] relative z-10 h-fit shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Bet Slip</h2>
                    <button onClick={() => setShowProvablyFair(true)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-500/50 hover:text-green-400 bg-green-900/20 px-3 py-1.5 rounded-full border border-green-900/50 transition-colors">
                        🛡️ Fair
                    </button>
                </div>
                
                <div className="space-y-4">
                    <div className="bg-[#050806] border-2 border-gray-800 p-4 rounded-2xl flex justify-between items-center shadow-[inset_0_5px_20px_rgba(0,0,0,1)]">
                        <span className="text-gray-500 font-bold uppercase text-xs tracking-wider">Total Wager</span>
                        <span className="text-2xl font-mono font-black text-yellow-400">{totalWager.toFixed(2)}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-center w-full bg-[#111] p-4 rounded-2xl border-2 border-gray-900">
                        {[0.01, 0.05, 0.1, 0.5, 1, 5, 10].map((chipValue) => {
                            const style = getChipStyles(chipValue);
                            return (
                                <button
                                    key={chipValue} onClick={() => setSelectedChipValue(chipValue)} disabled={isSpinning}
                                    className={`w-10 h-10 rounded-full font-black flex items-center justify-center border-[3px] border-dashed transition-all shadow-xl font-mono text-[9px] disabled:opacity-50 ${
                                        selectedChipValue === chipValue 
                                        ? `scale-110 shadow-[0_0_20px_rgba(255,255,255,0.4)] ring-2 ring-yellow-400 ${style}` 
                                        : `opacity-80 hover:opacity-100 hover:scale-105 ${style}`
                                    }`}
                                >
                                    {chipValue}
                                </button>
                            );
                        })}
                        <button onClick={handleClearBets} disabled={isSpinning} className="w-full mt-2 text-red-500/70 hover:text-red-400 font-black uppercase tracking-widest text-[10px] px-6 py-2 rounded-xl border-2 border-gray-800 hover:border-red-900/50 hover:bg-red-900/10 transition-colors">
                            Clear Table
                        </button>
                    </div>

                    <button 
                        onClick={handleSpin} disabled={isSpinning || currentBets.length === 0}
                        className="w-full bg-gradient-to-t from-[#1b5e20] to-[#22c55e] hover:brightness-125 text-black font-black text-xl uppercase tracking-widest py-4 rounded-2xl transition-all disabled:opacity-50 disabled:grayscale shadow-[0_10px_30px_rgba(34,197,94,0.3)] active:translate-y-2 border-b-4 border-[#144718]"
                    >
                        {isSpinning ? 'SPINNING...' : 'PLACE BET'}
                    </button>
                </div>
            </div>

            {/* RIGHT PANEL: COMPACT BOARD */}
            <div className="flex flex-col items-center gap-6 w-full xl:flex-1 mt-0">
                
                {/* Recent Outcomes Bar */}
                <div className="flex gap-2 bg-[#111] p-2 rounded-xl border-2 border-gray-800 w-full max-w-2xl overflow-x-auto shadow-inner">
                    <span className="text-gray-500 font-bold uppercase tracking-widest text-[10px] flex items-center px-4 border-r border-gray-800">History</span>
                    {recentOutcomes.map((num, idx) => {
                        const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(num);
                        return (
                            <div key={idx} className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-xs text-white shrink-0 shadow-lg ${num === 0 ? 'bg-green-500' : isRed ? 'bg-[#c22020]' : 'bg-[#222]'}`}>
                                {num}
                            </div>
                        )
                    })}
                </div>

                <div className="relative flex justify-center w-full">
                    
                    <div style={{ perspective: '1200px' }} className="flex justify-center w-full">
                        <div className="relative w-[300px] h-[300px] md:w-[340px] md:h-[340px] rounded-full flex items-center justify-center"
                             style={{ transform: 'rotateX(35deg) translateY(-10px)', transformStyle: 'preserve-3d' }}>
                            
                            <img 
                                src="/roulette-rim.png" 
                                alt="Roulette Rim"
                                className="absolute inset-0 w-full h-full z-0 object-contain pointer-events-none"
                                style={{ transform: 'translateZ(-2px)' }}
                            />

                            {/* FIX: Replaced `shadow-` with `drop-shadow-` so the transparent PNG pixels dictate the shape, removing the square bug entirely. */}
                            <img 
                                src="/roulette-wheel.png" 
                                alt="Roulette Wheel"
                                className="absolute w-[86%] h-[86%] z-10 object-contain pointer-events-none drop-shadow-[0_0_20px_rgba(0,0,0,0.9)]"
                                style={{ 
                                    transform: `translateZ(0px) rotate(${wheelRotation}deg)`, 
                                    transition: isSpinning ? 'transform 6000ms cubic-bezier(0.15, 0.85, 0.15, 1)' : 'none' 
                                }}
                            />

                            <div className="absolute inset-4 rounded-full border-[15px] border-transparent z-20 pointer-events-none"
                                 style={{ transform: `rotate(${ballRotation}deg)`, transition: isSpinning ? 'transform 6000ms cubic-bezier(0.2, 0.8, 0.1, 1)' : 'none' }}>
                                 <div className="absolute -top-[14px] left-1/2 w-4 h-4 bg-[radial-gradient(circle_at_30%_30%,_#fff,_#ccc,_#555)] rounded-full shadow-[0_10px_20px_rgba(0,0,0,0.9)] transform -translate-x-1/2" />
                            </div>

                            <div className="absolute -top-6 w-6 h-10 bg-gradient-to-b from-yellow-300 to-yellow-600 z-30 shadow-[0_15px_30px_rgba(0,0,0,1)] border-b-8 border-yellow-800" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                        </div>
                    </div>

                    {showOverlay && winningNumber !== null && !isSpinning && (
                        <div 
                            onClick={() => setShowOverlay(false)}
                            className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-56 h-56 bg-[#050806]/90 backdrop-blur-md rounded-full flex flex-col items-center justify-center border-4 animate-bounce-short z-[200] cursor-pointer ${localPayout! > 0 ? 'border-green-400 shadow-[0_0_100px_rgba(34,197,94,0.8)]' : 'border-red-500/80 shadow-[0_0_100px_rgba(239,68,68,0.6)]'}`}
                        >
                            <span className="text-gray-300 text-[10px] font-black uppercase tracking-widest mb-1">Outcome</span>
                            <span className="text-7xl font-black text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">{winningNumber}</span>
                            {localPayout! > 0 ? (
                                <span className="text-green-400 font-black mt-2 text-xl drop-shadow-md">+{localPayout!.toFixed(2)} SOL</span>
                            ) : (
                                <span className="text-red-400 font-black mt-2 text-sm uppercase tracking-widest">Bust</span>
                            )}
                            <span className="text-gray-500 text-[8px] absolute bottom-4 uppercase tracking-widest opacity-50">Tap to close</span>
                        </div>
                    )}

                </div>

                <div className={`w-full max-w-5xl overflow-x-auto pb-4 transition-opacity duration-500 ${isSpinning ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                    <div className="min-w-[800px] bg-[#0c4a25] border-[12px] border-[#072411] text-white flex flex-col cursor-pointer select-none shadow-[0_20px_50px_rgba(0,0,0,0.8)] rounded-3xl p-3 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] relative">
                        
                        <div className="flex border-[3px] border-white/20 rounded-xl overflow-hidden relative z-10 shadow-xl bg-[#09381c]">
                            <div onClick={() => handlePlaceChip(BetType.StraightUp, [0, 0, 0, 0])} className={`relative flex-none w-[4.3rem] border-r-[3px] border-white/20 flex items-center justify-center transition-all text-4xl font-black ${winningNumber === 0 ? 'bg-yellow-400 text-black shadow-[inset_0_0_40px_rgba(0,0,0,0.7)]' : 'bg-[#156e34] hover:bg-[#1a853f]'}`}>
                                0 {renderChip(BetType.StraightUp, [0, 0, 0, 0])}
                            </div>
                            
                            <div className="flex-1 grid grid-cols-12 grid-rows-3 text-center border-b border-r border-white/5">
                                {renderNumberCell(3, 'red')} {renderNumberCell(6, 'black')} {renderNumberCell(9, 'red')} {renderNumberCell(12, 'red')} {renderNumberCell(15, 'black')} {renderNumberCell(18, 'red')} {renderNumberCell(21, 'red')} {renderNumberCell(24, 'black')} {renderNumberCell(27, 'red')} {renderNumberCell(30, 'red')} {renderNumberCell(33, 'black')} {renderNumberCell(36, 'red')}
                                {renderNumberCell(2, 'black')} {renderNumberCell(5, 'red')} {renderNumberCell(8, 'black')} {renderNumberCell(11, 'black')} {renderNumberCell(14, 'red')} {renderNumberCell(17, 'black')} {renderNumberCell(20, 'black')} {renderNumberCell(23, 'red')} {renderNumberCell(26, 'black')} {renderNumberCell(29, 'black')} {renderNumberCell(32, 'red')} {renderNumberCell(35, 'black')}
                                {renderNumberCell(1, 'red')} {renderNumberCell(4, 'black')} {renderNumberCell(7, 'red')} {renderNumberCell(10, 'black')} {renderNumberCell(13, 'black')} {renderNumberCell(16, 'red')} {renderNumberCell(19, 'red')} {renderNumberCell(22, 'black')} {renderNumberCell(25, 'red')} {renderNumberCell(28, 'black')} {renderNumberCell(31, 'black')} {renderNumberCell(34, 'red')}
                            </div>

                            <div className="flex-none w-[4.3rem] grid grid-rows-3 font-black text-[10px] uppercase bg-[#072411] text-gray-400 border-l-[3px] border-white/20 shadow-[inset_10px_0_20px_rgba(0,0,0,0.5)]">
                                <div onClick={() => handlePlaceChip(BetType.Column, [3, 0, 0, 0])} className="relative border-b-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [3, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [2, 0, 0, 0])} className="relative border-b-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [2, 0, 0, 0])}</div>
                                <div onClick={() => handlePlaceChip(BetType.Column, [1, 0, 0, 0])} className="relative flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2:1 {renderChip(BetType.Column, [1, 0, 0, 0])}</div>
                            </div>
                        </div>

                        <div className="flex ml-[4.3rem] mr-[4.3rem] mt-3 border-[3px] border-white/20 rounded-xl overflow-hidden h-10 font-black uppercase tracking-widest bg-[#072411] text-gray-300 shadow-xl text-xs">
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [1, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">1st 12 {renderChip(BetType.Dozen, [1, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [2, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">2nd 12 {renderChip(BetType.Dozen, [2, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.Dozen, [3, 0, 0, 0])} className="relative flex-1 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">3rd 12 {renderChip(BetType.Dozen, [3, 0, 0, 0])}</div>
                        </div>

                        <div className="flex ml-[4.3rem] mr-[4.3rem] mt-3 border-[3px] border-white/20 rounded-xl overflow-hidden h-12 font-black uppercase tracking-wider text-xs bg-[#072411] text-gray-300 shadow-xl">
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [0, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">1-18 {renderChip(BetType.HighLow, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [1, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">Even {renderChip(BetType.OddEven, [1, 0, 0, 0])}</div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [0, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center bg-[#b81d1d] hover:bg-[#d62828] text-white transition-colors group">
                                <div className="w-4 h-4 bg-[#ff3333] rounded-sm mr-2 shadow-inner group-hover:scale-110 transition-transform"></div> RED {renderChip(BetType.RedBlack, [0, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.RedBlack, [1, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center bg-[#111] hover:bg-[#222] text-white transition-colors group">
                                <div className="w-4 h-4 bg-[#333] rounded-sm mr-2 shadow-inner group-hover:scale-110 transition-transform"></div> BLACK {renderChip(BetType.RedBlack, [1, 0, 0, 0])}
                            </div>
                            
                            <div onClick={() => handlePlaceChip(BetType.OddEven, [0, 0, 0, 0])} className="relative flex-1 border-r-[3px] border-white/20 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">Odd {renderChip(BetType.OddEven, [0, 0, 0, 0])}</div>
                            <div onClick={() => handlePlaceChip(BetType.HighLow, [1, 0, 0, 0])} className="relative flex-1 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors">19-36 {renderChip(BetType.HighLow, [1, 0, 0, 0])}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}