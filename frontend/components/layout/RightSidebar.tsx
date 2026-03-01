import React from 'react';

interface Props {
  isOpen: boolean;
  recentBets: any[];
  setSelectedBetInfo: (bet: any) => void;
}

export default function RightSidebar({ isOpen, recentBets, setSelectedBetInfo }: Props) {
  return (
    <aside className={`${isOpen ? 'w-80' : 'w-0'} absolute md:relative z-40 h-full right-0 transition-all duration-300 border-l border-green-900/30 bg-[#0a0f0c] flex flex-col shrink-0 overflow-hidden`}>          
      <div className="h-14 flex items-center px-4 border-b border-green-900/30 bg-[#050806] w-80 shrink-0">
        <h3 className="text-green-500 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Live Global Wagers
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar w-80">
        {recentBets.map((bet) => {
          let displayVal = 0;

          if (bet.win) {
            // If the parent successfully recorded both payout and wager, calculate true profit
            if (bet.payout !== undefined && bet.wager !== undefined) {
              displayVal = bet.payout - bet.wager;
            } 
            // Fallback: If the parent state only knows the base 'amount', use it to prevent the 0.0000 bug
            else {
              displayVal = bet.amount || 0;
            }
          } else {
            // For losses, display the wager size
            displayVal = bet.wager !== undefined ? bet.wager : (bet.amount || 0);
          }

          return (
            <div key={bet.id} onClick={() => setSelectedBetInfo(bet)} className="p-3 bg-[#111a14] rounded border border-gray-900 hover:border-green-900/50 hover:bg-[#16221a] transition-all cursor-pointer flex justify-between items-center group">
              <div className="flex flex-col">
                <span className="font-mono text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{bet.player}</span>
                <span className="text-xs font-bold text-gray-300 mt-1">{bet.game}</span>
              </div>
              <div className={`font-mono text-sm font-black ${bet.win ? "text-green-400" : "text-red-500"}`}>
                {bet.win ? "+" : "-"}{Number(displayVal).toFixed(4)}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}