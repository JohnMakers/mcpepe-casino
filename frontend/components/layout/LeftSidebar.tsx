import React from 'react';

interface Props {
  isOpen: boolean;
  activeGame: string | null;
  setActiveGame: (game: string) => void;
}

export default function LeftSidebar({ isOpen, activeGame, setActiveGame }: Props) {
  return (
    <aside className={`${isOpen ? 'w-64' : 'w-0'} absolute md:relative z-40 h-full left-0 transition-all duration-300 border-r border-green-900/30 bg-[#0a0f0c] overflow-hidden flex flex-col shrink-0`}>          
      <div className="p-4 w-64">
        <h2 className="text-xs text-gray-500 font-black uppercase tracking-widest mb-4">Arcade Selection</h2>
        <div className="space-y-3">
          <button onClick={() => setActiveGame('coinflip')} className={`w-full text-left p-4 font-black uppercase tracking-wide rounded-lg transition-all border-2 group ${activeGame === 'coinflip' ? 'bg-green-900/20 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.15)]' : 'bg-black border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
            <span className="flex items-center gap-2"><span className="text-xl">🪙</span> Coinflip</span>
          </button>
          
          <button onClick={() => setActiveGame('whackd')} className={`w-full text-left p-4 font-black uppercase tracking-wide rounded-lg transition-all border-2 group ${activeGame === 'whackd' ? 'bg-green-900/20 border-green-500 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.15)]' : 'bg-black border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
            <span className="flex items-center gap-2"><span className="text-xl">💣</span> Whackd!</span>
          </button>
        </div>
      </div>
    </aside>
  );
}