"use client";

import { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import Header from "../components/layout/Header";
import LeftSidebar from "../components/layout/LeftSidebar";
import RightSidebar from "../components/layout/RightSidebar";
import ProvablyFairModal from "../components/modals/ProvablyFairModal";
import ReceiptModal from "../components/modals/ReceiptModal";
import CoinflipGame from "../components/games/Coinflip";
import WhackdGame from "../components/games/Whackd"; 
import RockPaperScissorsGame from "../components/games/RockPaperScissors";
// ADDED IMPORT
import RouletteGame from "../components/games/Roulette"; 

const INITIAL_BETS = [
  { id: "tx1", player: "8xTq...3pZx", game: "Coinflip", amount: 2.5, win: true, hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", clientSeed: "degen_1" },
];

export default function Dashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey } = wallet;

  const [balance, setBalance] = useState<number>(0);
  const [recentBets, setRecentBets] = useState(INITIAL_BETS);
  
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [activeGame, setActiveGame] = useState<string | null>(null);

  const [showProvablyFair, setShowProvablyFair] = useState(false);
  const [selectedBetInfo, setSelectedBetInfo] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setIsLeftSidebarOpen(true);
      setIsRightSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!publicKey) return;
    const fetchBalance = async () => {
      try {
        const bal = await connection.getBalance(publicKey);
        setBalance(bal / LAMPORTS_PER_SOL);
      } catch (error) {
        console.error("RPC Error fetching balance:", error);
      }
    };
    
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [publicKey, connection]);

  const logWager = (game: string, wager: number, win: boolean, payout: number, hash: string, seed: string) => {
    const newBet = {
      id: Math.random().toString(36).substring(2, 10), 
      player: publicKey ? publicKey.toBase58().substring(0, 4) + "..." + publicKey.toBase58().slice(-4) : "Anon",
      game, amount: win ? payout : wager, win, wager, payout, hash, clientSeed: seed
    };
    setRecentBets(prev => [newBet, ...prev].slice(0, 20));
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#050806] font-sans text-gray-200 overflow-hidden relative">
      
      {showProvablyFair && <ProvablyFairModal onClose={() => setShowProvablyFair(false)} />}
      {selectedBetInfo && <ReceiptModal betInfo={selectedBetInfo} onClose={() => setSelectedBetInfo(null)} />}

      <Header 
        balance={balance} publicKey={publicKey}
        isLeftSidebarOpen={isLeftSidebarOpen} setIsLeftSidebarOpen={setIsLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen} setIsRightSidebarOpen={setIsRightSidebarOpen}
        setActiveGame={setActiveGame}
      />

      <div className="flex flex-1 h-[calc(100vh-4rem)] relative">
        <LeftSidebar 
          isOpen={isLeftSidebarOpen} 
          activeGame={activeGame} 
          setActiveGame={setActiveGame} 
        />

        <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0d1410] via-[#050806] to-black p-4 sm:p-8 flex flex-col relative custom-scrollbar">
          
          {!activeGame && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto text-center animate-fade-in">
              <div className="text-7xl mb-8 animate-bounce-short">🎰</div>
              <h2 className="text-5xl font-black uppercase tracking-tighter text-white mb-6">Enter the <span className="text-green-500">Free Market</span></h2>
              <div className="flex flex-wrap gap-4 justify-center">
                  <button onClick={() => setActiveGame('coinflip')} className="bg-transparent border border-green-500 text-green-500 hover:bg-green-900/30 px-8 py-3 rounded-lg font-black uppercase tracking-widest mt-4">Coinflip</button>
                  <button onClick={() => setActiveGame('whackd')} className="bg-green-500 hover:bg-green-400 text-black px-8 py-3 rounded-lg font-black uppercase tracking-widest mt-4 shadow-[0_0_15px_rgba(34,197,94,0.2)]">Play Whackd!</button>
                  <button onClick={() => setActiveGame('rps')} className="bg-transparent border border-yellow-500 text-yellow-500 hover:bg-yellow-900/30 px-8 py-3 rounded-lg font-black uppercase tracking-widest mt-4">Play RPS</button>
                  {/* ADDED ROULETTE BUTTON */}
                  <button onClick={() => setActiveGame('roulette')} className="bg-transparent border border-blue-500 text-blue-500 hover:bg-blue-900/30 px-8 py-3 rounded-lg font-black uppercase tracking-widest mt-4">Pepe Roulette</button>
              </div>
            </div>
          )}

          {activeGame === 'coinflip' && (
            <CoinflipGame 
              balance={balance} setBalance={setBalance} logWager={logWager} 
              setShowProvablyFair={setShowProvablyFair} 
            />
          )}
          
          {activeGame === 'whackd' && (
             <WhackdGame 
               balance={balance} setBalance={setBalance} logWager={logWager} 
               setShowProvablyFair={setShowProvablyFair} 
             />
          )}

          {activeGame === 'rps' && (
             <RockPaperScissorsGame logWager={logWager} />
          )}

          {/* ADDED ROULETTE COMPONENT RENDER BLOCK */}
          {activeGame === 'roulette' && (
             <RouletteGame 
               balance={balance} setBalance={setBalance} logWager={logWager} 
               setShowProvablyFair={setShowProvablyFair} 
             />
          )}
        </main>

        <RightSidebar 
          isOpen={isRightSidebarOpen} 
          recentBets={recentBets} 
          setSelectedBetInfo={setSelectedBetInfo} 
        />
      </div>
    </div>
  );
}