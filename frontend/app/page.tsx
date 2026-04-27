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
import PumpIt from "../components/games/PumpIt";
import RouletteGame from "../components/games/Roulette"; 
import BlackjackGame from "../components/games/Blackjack"; 
import Patriots from '../components/games/Patriots';
import Vacation from '../components/games/Vacation';
import Snowstorm from "../components/games/Snowstorm";

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
  const [activeGame, setActiveGameState] = useState<string | null>(null);

  // Auto-close sidebars on mobile when navigating into a game
  const setActiveGame = (game: string | null) => {
    setActiveGameState(game);
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsLeftSidebarOpen(false);
      setIsRightSidebarOpen(false);
    }
  };

  const closeMobileSidebars = () => {
    setIsLeftSidebarOpen(false);
    setIsRightSidebarOpen(false);
  };

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
        {/* Mobile-only backdrop: tap anywhere outside the sidebar to close it */}
        {(isLeftSidebarOpen || isRightSidebarOpen) && (
          <div
            onClick={closeMobileSidebars}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
            aria-hidden="true"
          />
        )}

        <LeftSidebar
          isOpen={isLeftSidebarOpen}
          activeGame={activeGame}
          setActiveGame={setActiveGame}
        />

        <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0d1410] via-[#050806] to-black p-4 sm:p-8 flex flex-col relative custom-scrollbar">
          
          {!activeGame && (
            <div className="flex-1 flex flex-col items-center justify-start max-w-6xl mx-auto w-full pt-8 pb-12 animate-fade-in">
              
              <div className="text-center mb-12">
                <div className="text-6xl mb-4 animate-bounce-short drop-shadow-[0_0_15px_rgba(34,197,94,0.4)]">🎰</div>
                <h2 className="text-4xl sm:text-6xl font-black uppercase tracking-tighter text-white mb-4">
                  Enter the <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600">McPepe Casino</span>
                </h2>
                <p className="text-gray-400 font-mono text-sm sm:text-base">Provably Fair. Decentralized. Pepe.</p>
              </div>

              {/* Game Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full px-4">
                
                {/* Featured Game */}
                <div onClick={() => setActiveGame('whackd')} className="col-span-1 sm:col-span-2 lg:col-span-2 relative group cursor-pointer rounded-xl overflow-hidden border-2 border-green-500/50 bg-black/40 hover:border-green-400 transition-all duration-300 shadow-[0_0_30px_rgba(34,197,94,0.1)] hover:shadow-[0_0_40px_rgba(34,197,94,0.25)] flex flex-col justify-end min-h-[220px] p-6">
                  <div className="absolute inset-0 bg-gradient-to-t from-green-900/80 to-transparent z-0"></div>
                  <div className="relative z-10">
                    <span className="bg-green-500 text-black text-xs font-black px-2 py-1 uppercase tracking-widest rounded mb-3 inline-block">Featured</span>
                    <h3 className="text-3xl font-black text-white uppercase tracking-wider mb-1">Whackd! <span className="text-2xl">💣</span></h3>
                    <p className="text-green-300/80 font-mono text-sm">Avoid the "bombs"!</p>
                  </div>
                </div>

                {/* Standard Games */}
                <GameCard onClick={() => setActiveGame('coinflip')} icon="🪙" title="Coinflip" desc="50/50 double or nothing." color="border-green-500/30 hover:border-green-400" />
                <GameCard onClick={() => setActiveGame('roulette')} icon="🐸" title="Roulette" desc="Spin the wheel." color="border-blue-500/30 hover:border-blue-400" />
                <GameCard onClick={() => setActiveGame('rps')} icon="✂️" title="RPS" desc="Let it ride!" color="border-yellow-500/30 hover:border-yellow-400" />
                <GameCard onClick={() => setActiveGame('pumpit')} icon="📈" title="Pump It" desc="Ride the green candles." color="border-green-500/30 hover:border-green-400" />
                <GameCard onClick={() => setActiveGame('blackjack')} icon="🃏" title="Blackjack" desc="A game of skill and luck." color="border-red-500/30 hover:border-red-400" />
                
                {/* Slots Section Header visually breaking the grid slightly */}
                <div className="col-span-full mt-6 mb-2">
                  <h3 className="text-xl text-purple-500 font-black uppercase tracking-widest border-b border-purple-900/30 pb-2">McPepe Slots</h3>
                </div>

                <GameCard onClick={() => setActiveGame('patriots')} icon="🎰" title="Patriots" desc="Serve the nation." color="border-purple-500/30 hover:border-purple-400" />
                <GameCard onClick={() => setActiveGame('vacation')} icon="🍹" title="Vacation" desc="Collect the luggage." color="border-purple-500/30 hover:border-purple-400" />
                <GameCard onClick={() => setActiveGame('snowstorm')} icon="❄️" title="Snowstorm" desc="Survive the Snowstorm." color="border-purple-500/30 hover:border-purple-400" />

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

          {activeGame === 'roulette' && (
             <RouletteGame 
               balance={balance} setBalance={setBalance} logWager={logWager} 
               setShowProvablyFair={setShowProvablyFair} 
             />
          )}

          {activeGame === 'pumpit' && (
             <PumpIt />
          )}

          {activeGame === 'blackjack' && (
             <BlackjackGame 
               balance={balance} setBalance={setBalance} logWager={logWager} 
               setShowProvablyFair={setShowProvablyFair} 
             />
          )}
                  
          {activeGame === 'patriots' && (
             <Patriots />
          )}

          {activeGame === 'vacation' && (
             <Vacation />
          )}

          {activeGame === 'snowstorm' && (
             <Snowstorm />
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

// ----------------------------------------------------------------------
// HELPER COMPONENTS
// Placed outside the main Dashboard component to prevent re-rendering issues
// ----------------------------------------------------------------------

function GameCard({ onClick, icon, title, desc, color }: { onClick: () => void, icon: string, title: string, desc: string, color: string }) {
  return (
    <div onClick={onClick} className={`group cursor-pointer rounded-xl border-2 bg-[#0a0f0c]/80 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-1 hover:bg-[#111a14] flex flex-col items-start justify-between min-h-[160px] ${color}`}>
      <div className="text-4xl mb-3 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-transform duration-300">{icon}</div>
      <div>
        <h3 className="text-xl font-bold text-white uppercase tracking-wider mb-1 group-hover:text-gray-100">{title}</h3>
        <p className="text-gray-500 font-mono text-xs">{desc}</p>
      </div>
    </div>
  );
}