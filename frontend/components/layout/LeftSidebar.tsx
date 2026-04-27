import React from 'react';

interface Props {
  isOpen: boolean;
  activeGame: string | null;
  setActiveGame: (game: string) => void;
}

export default function LeftSidebar({ isOpen, activeGame, setActiveGame }: Props) {
  return (
    <aside className={`${isOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full md:translate-x-0 md:w-0'} absolute md:relative z-40 h-full left-0 transition-all duration-300 ease-in-out border-r border-green-900/30 bg-[#050806]/95 backdrop-blur-md md:bg-[#0a0f0c] overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.5)]`}>
      <div className="p-4 w-64">
        <h2 className="text-xs text-green-600/70 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-600/70"></span> Casino
        </h2>
        
        <div className="space-y-2">
          {/* Main Games */}
          <SidebarButton active={activeGame === 'coinflip'} onClick={() => setActiveGame('coinflip')} icon="/icons/coinflip_icon.png" label="Coinflip" color="green" />
          <SidebarButton active={activeGame === 'whackd'} onClick={() => setActiveGame('whackd')} icon="/icons/whackd_icon.png" label="Whackd!" color="green" />
          <SidebarButton active={activeGame === 'rps'} onClick={() => setActiveGame('rps')} icon="/icons/rps_icon.png" label="RPS" color="green" />
          <SidebarButton active={activeGame === 'roulette'} onClick={() => setActiveGame('roulette')} icon="/icons/roulette_icon.png" label="Roulette" color="green" />
          <SidebarButton active={activeGame === 'pumpit'} onClick={() => setActiveGame('pumpit')} icon="/icons/pumpit_icon.png" label="Pump It" color="green" />
          <SidebarButton active={activeGame === 'blackjack'} onClick={() => setActiveGame('blackjack')} icon="/icons/blackjack_icon.png" label="Blackjack" color="red" />

          <div className="my-4 border-t border-green-900/20 pt-4">
            <h2 className="text-xs text-purple-600/70 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-600/70"></span> Slots
            </h2>
            <SidebarButton active={activeGame === 'patriots'} onClick={() => setActiveGame('patriots')} icon="/icons/patriots_icon.png" label="Patriots" color="purple" />
            <SidebarButton active={activeGame === 'vacation'} onClick={() => setActiveGame('vacation')} icon="/icons/vacations_icon.png" label="Vacation" color="purple" />
            <SidebarButton active={activeGame === 'snowstorm'} onClick={() => setActiveGame('snowstorm')} icon="/icons/snowstorm_icon.png" label="Snowstorm" color="purple" />
          </div>
        </div>
      </div>
    </aside>
  );
}

// Helper component to keep the sidebar code clean
function SidebarButton({ active, onClick, icon, label, color }: { active: boolean, onClick: () => void, icon: string, label: string, color: 'green' | 'red' | 'purple' }) {
  const colorMap = {
    green: { bg: 'bg-green-900/20', border: 'border-green-500', text: 'text-green-400', shadow: 'shadow-[0_0_15px_rgba(34,197,94,0.15)]' },
    red: { bg: 'bg-red-900/20', border: 'border-red-500', text: 'text-red-400', shadow: 'shadow-[0_0_15px_rgba(220,38,38,0.15)]' },
    purple: { bg: 'bg-purple-900/20', border: 'border-purple-500', text: 'text-purple-400', shadow: 'shadow-[0_0_15px_rgba(168,85,247,0.15)]' },
  };

  const activeClasses = colorMap[color];
  const inactiveClasses = 'bg-black/50 border-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-200 hover:bg-[#111a14]';

  const isImg = icon.startsWith('/');

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 font-bold uppercase tracking-wider text-sm rounded-lg transition-all duration-200 border-2 group flex items-center gap-3 ${active ? `${activeClasses.bg} ${activeClasses.border} ${activeClasses.text} ${activeClasses.shadow}` : inactiveClasses}`}
    >
      {isImg ? (
        <img
          src={icon}
          alt=""
          className={`w-7 h-7 object-contain shrink-0 transition-transform duration-300 group-hover:scale-110 ${active ? '' : 'opacity-80 group-hover:opacity-100'}`}
          draggable={false}
        />
      ) : (
        <span className="text-lg grayscale group-hover:grayscale-0 transition-all duration-300">{icon}</span>
      )}
      {label}
    </button>
  );
}