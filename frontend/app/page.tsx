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
            <div className="relative w-full -mx-4 sm:-mx-8 -my-4 sm:-my-8">

              {/* Ambient glow background */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-green-500/[0.08] blur-[140px] rounded-full"></div>
                <div className="absolute top-1/3 -right-32 w-[400px] h-[400px] bg-purple-500/[0.06] blur-[120px] rounded-full"></div>
                <div className="absolute top-2/3 -left-32 w-[400px] h-[400px] bg-emerald-500/[0.06] blur-[120px] rounded-full"></div>
              </div>

              {/* Hero */}
              <section className="relative max-w-6xl mx-auto px-4 sm:px-8 pt-8 sm:pt-16 pb-6 sm:pb-10 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-5 sm:mb-6 rounded-full bg-green-500/10 border border-green-500/40 text-green-300 text-[10px] sm:text-xs font-black uppercase tracking-widest backdrop-blur-sm">
                  <span className="relative flex w-2 h-2">
                    <span className="absolute inset-0 animate-ping rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative w-2 h-2 rounded-full bg-green-400"></span>
                  </span>
                  Live · Solana Devnet
                </div>

                <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-[5.5rem] font-black uppercase tracking-tighter text-white mb-3 sm:mb-4 leading-[0.9]">
                  Welcome to the
                  <span className="block text-transparent bg-clip-text bg-gradient-to-r from-green-300 via-emerald-400 to-green-500 drop-shadow-[0_0_30px_rgba(34,197,94,0.45)]">
                    McPepe Casino
                  </span>
                </h1>
                <p className="text-gray-400 font-mono text-xs sm:text-sm md:text-base max-w-xl mx-auto mb-6 sm:mb-10">
                  Provably-fair on-chain wagers. Built for degens, settled by Solana.
                </p>

                {/* Stats strip */}
                <div className="grid grid-cols-3 gap-2 sm:gap-4 max-w-2xl mx-auto">
                  <StatCard icon="🛡️" label="Provably Fair" value="100%" tone="green" />
                  <StatCard icon="🌐" label="On-Chain" value="Decentralized" tone="emerald" />
                  <StatCard icon="🎰" label="Games" value="9" tone="purple" />
                </div>
              </section>

              {/* Casino */}
              <section className="relative max-w-6xl mx-auto px-4 sm:px-8 mb-8 sm:mb-12">
                <SectionHeader title="Casino" accent="from-green-500 via-emerald-500 to-cyan-500" />
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
                  <GameCard onClick={() => setActiveGame('coinflip')} icon="/icons/coinflip_icon.png" title="Coinflip" desc="50/50 double-up" tone="green" badge="FEATURED" />
                  <GameCard onClick={() => setActiveGame('whackd')} icon="/icons/whackd_icon.png" title="Whackd!" desc="Dodge the bombs" tone="emerald" />
                  <GameCard onClick={() => setActiveGame('roulette')} icon="/icons/roulette_icon.png" title="Roulette" desc="Spin the wheel" tone="red" />
                  <GameCard onClick={() => setActiveGame('rps')} icon="/icons/rps_icon.png" title="RPS" desc="Let it ride" tone="amber" />
                  <GameCard onClick={() => setActiveGame('pumpit')} icon="/icons/pumpit_icon.png" title="Pump It" desc="Don't get rugged" tone="emerald" />
                  <GameCard onClick={() => setActiveGame('blackjack')} icon="/icons/blackjack_icon.png" title="Blackjack" desc="Beat the dealer" tone="rose" />
                </div>
              </section>

              {/* Slots */}
              <section className="relative max-w-6xl mx-auto px-4 sm:px-8 mb-10 sm:mb-16">
                <SectionHeader title="Slots" accent="from-purple-500 via-fuchsia-500 to-pink-500" />
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-3">
                  <GameCard onClick={() => setActiveGame('patriots')} icon="/icons/patriots_icon.png" title="Patriots" desc="Serve the nation" tone="patriot" />
                  <GameCard onClick={() => setActiveGame('vacation')} icon="/icons/vacations_icon.png" title="Vacation" desc="Collect luggage" tone="cyan" />
                  <GameCard onClick={() => setActiveGame('snowstorm')} icon="/icons/snowstorm_icon.png" title="Snowstorm" desc="Survive the storm" tone="blue" />
                  {/* spacers keep slot cards the same tile size as casino cards */}
                  <div className="hidden sm:block" aria-hidden="true" />
                  <div className="hidden md:block" aria-hidden="true" />
                  <div className="hidden lg:block" aria-hidden="true" />
                </div>
              </section>

              {/* Footer info strip */}
              <footer className="relative max-w-6xl mx-auto px-4 sm:px-8 pb-6 sm:pb-10">
                <div className="border-t border-green-900/30 pt-4 sm:pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-3 text-gray-600 font-mono text-[10px] sm:text-xs uppercase tracking-widest">
                  <p className="flex items-center gap-2">
                    <img src="/icons/mcpepe_icon.png" alt="" className="w-4 h-4 object-contain opacity-80" draggable={false} />
                    <span className="text-gray-500">McPepe Casino</span> — On-chain · Provably Fair
                  </p>
                  <p>v1.0 · Solana Devnet</p>
                </div>
              </footer>
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

type Tone = 'green' | 'emerald' | 'red' | 'rose' | 'amber' | 'cyan' | 'blue' | 'purple' | 'patriot';

const TONE_MAP: Record<Tone, { bg: string, border: string, hoverBorder: string, glow: string, accent: string, iconShadow: string }> = {
  green:    { bg: 'from-green-900/40 via-green-950/40 to-black',           border: 'border-green-500/30',   hoverBorder: 'hover:border-green-400',   glow: 'group-hover:shadow-[0_0_30px_rgba(34,197,94,0.35)]',  accent: 'text-green-300',   iconShadow: 'drop-shadow-[0_0_18px_rgba(34,197,94,0.55)]' },
  emerald:  { bg: 'from-emerald-900/40 via-emerald-950/40 to-black',       border: 'border-emerald-500/30', hoverBorder: 'hover:border-emerald-400', glow: 'group-hover:shadow-[0_0_30px_rgba(16,185,129,0.35)]', accent: 'text-emerald-300', iconShadow: 'drop-shadow-[0_0_18px_rgba(16,185,129,0.55)]' },
  red:      { bg: 'from-red-900/40 via-red-950/40 to-black',               border: 'border-red-500/30',     hoverBorder: 'hover:border-red-400',     glow: 'group-hover:shadow-[0_0_30px_rgba(239,68,68,0.35)]',  accent: 'text-red-300',     iconShadow: 'drop-shadow-[0_0_18px_rgba(239,68,68,0.55)]' },
  rose:     { bg: 'from-rose-900/40 via-rose-950/40 to-black',             border: 'border-rose-500/30',    hoverBorder: 'hover:border-rose-400',    glow: 'group-hover:shadow-[0_0_30px_rgba(244,63,94,0.35)]',  accent: 'text-rose-300',    iconShadow: 'drop-shadow-[0_0_18px_rgba(244,63,94,0.55)]' },
  amber:    { bg: 'from-amber-900/40 via-amber-950/40 to-black',           border: 'border-amber-500/30',   hoverBorder: 'hover:border-amber-400',   glow: 'group-hover:shadow-[0_0_30px_rgba(245,158,11,0.35)]', accent: 'text-amber-300',   iconShadow: 'drop-shadow-[0_0_18px_rgba(245,158,11,0.55)]' },
  cyan:     { bg: 'from-cyan-900/40 via-cyan-950/40 to-black',             border: 'border-cyan-500/30',    hoverBorder: 'hover:border-cyan-400',    glow: 'group-hover:shadow-[0_0_30px_rgba(6,182,212,0.35)]',  accent: 'text-cyan-300',    iconShadow: 'drop-shadow-[0_0_18px_rgba(6,182,212,0.55)]' },
  blue:     { bg: 'from-blue-900/40 via-blue-950/40 to-black',             border: 'border-blue-500/30',    hoverBorder: 'hover:border-blue-400',    glow: 'group-hover:shadow-[0_0_30px_rgba(59,130,246,0.35)]', accent: 'text-blue-300',    iconShadow: 'drop-shadow-[0_0_18px_rgba(59,130,246,0.55)]' },
  purple:   { bg: 'from-purple-900/40 via-purple-950/40 to-black',         border: 'border-purple-500/30',  hoverBorder: 'hover:border-purple-400',  glow: 'group-hover:shadow-[0_0_30px_rgba(168,85,247,0.35)]', accent: 'text-purple-300',  iconShadow: 'drop-shadow-[0_0_18px_rgba(168,85,247,0.55)]' },
  patriot:  { bg: 'from-red-900/40 via-blue-900/30 to-black',              border: 'border-purple-500/30',  hoverBorder: 'hover:border-purple-400',  glow: 'group-hover:shadow-[0_0_30px_rgba(168,85,247,0.35)]', accent: 'text-purple-300',  iconShadow: 'drop-shadow-[0_0_18px_rgba(168,85,247,0.55)]' },
};

function StatCard({ icon, label, value, tone }: { icon: string, label: string, value: string, tone: 'green' | 'emerald' | 'purple' }) {
  const t = TONE_MAP[tone];
  // Scale value font down for longer strings so cards stay symmetrical
  const valueClass = value.length > 4
    ? 'text-xs sm:text-sm md:text-base'
    : 'text-base sm:text-xl md:text-2xl';
  return (
    <div className={`relative flex flex-col items-center justify-center p-2.5 sm:p-4 rounded-xl border ${t.border} bg-gradient-to-b ${t.bg} backdrop-blur-sm overflow-hidden min-h-[80px] sm:min-h-[110px]`}>
      <span className="text-lg sm:text-2xl mb-1">{icon}</span>
      <span className={`${valueClass} font-black font-mono ${t.accent} text-center max-w-full truncate`}>{value}</span>
      <span className="text-[8px] sm:text-[10px] uppercase tracking-widest text-gray-500 font-bold mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}

function SectionHeader({ title, accent }: { title: string, accent: string }) {
  return (
    <div className="flex items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
      <h2 className="text-xl sm:text-3xl font-black text-white uppercase tracking-tight leading-none shrink-0">{title}</h2>
      <div className={`flex-1 h-px bg-gradient-to-r ${accent} opacity-40`} />
    </div>
  );
}

function GameCard({ onClick, icon, title, desc, tone, badge }: { onClick: () => void, icon: string, title: string, desc: string, tone: Tone, badge?: 'FEATURED' | 'NEW' }) {
  const t = TONE_MAP[tone];
  const badgeContent = badge === 'FEATURED' ? '⭐ Featured' : badge;
  const badgeStyles = badge === 'FEATURED'
    ? 'bg-gradient-to-r from-yellow-300 to-amber-500 text-black border border-yellow-200/40 shadow-[0_0_12px_rgba(250,204,21,0.5)]'
    : 'bg-yellow-400 text-black';

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-xl sm:rounded-2xl overflow-hidden border-2 ${t.border} ${t.hoverBorder} bg-gradient-to-br ${t.bg} transition-all duration-300 hover:-translate-y-1 ${t.glow} aspect-[5/4] sm:aspect-square flex flex-col`}
    >
      {badge && (
        <span className={`absolute top-1.5 right-1.5 sm:top-2 sm:right-2 z-20 ${badgeStyles} text-[7px] sm:text-[8px] font-black px-1.5 py-0.5 uppercase tracking-widest rounded-full shadow-lg whitespace-nowrap`}>
          {badgeContent}
        </span>
      )}

      {/* Hover glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.06),_transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>

      {/* Icon */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-3 relative min-h-0">
        {icon.startsWith('/') ? (
          <img
            src={icon}
            alt={title}
            className={`w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain ${t.iconShadow} group-hover:scale-110 transition-transform duration-500 select-none pointer-events-none`}
            draggable={false}
          />
        ) : (
          <span className={`text-4xl sm:text-5xl md:text-6xl ${t.iconShadow} grayscale-[0.6] group-hover:grayscale-0 group-hover:scale-110 transition-all duration-500 select-none`}>
            {icon}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="relative z-10 px-2.5 sm:px-3 py-2 sm:py-2.5 bg-gradient-to-t from-black/90 via-black/55 to-transparent">
        <h3 className="text-xs sm:text-sm md:text-base font-black text-white uppercase tracking-wider truncate leading-tight">{title}</h3>
        <p className="hidden sm:block text-gray-500 font-mono text-[10px] sm:text-xs truncate mt-0.5">{desc}</p>
      </div>
    </div>
  );
}