import React from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function InfoModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-[#0a0f0c] border border-cyan-800 max-w-3xl w-full max-h-[85vh] rounded-xl p-8 shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-800">
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <span className="text-cyan-500">McPepe's</span> Vacation Rules
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors bg-gray-900 rounded-full w-8 h-8 flex items-center justify-center font-bold">✕</button>
        </div>

        {/* Section: Game Details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">RTP</p>
            <p className="text-cyan-400 font-black text-xl">~96.5%</p>
          </div>
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Volatility</p>
            <p className="text-purple-500 font-black text-xl">HIGH</p>
          </div>
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Max Win</p>
            <p className="text-yellow-400 font-black text-xl">5,000x</p>
          </div>
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Mechanism</p>
            <p className="text-white font-black text-[15px] mt-1 uppercase">10 Paylines</p>
          </div>
        </div>

        {/* Section: Feature Rules */}
        <div className="mb-10 space-y-6">
          <div>
            <h3 className="text-xl font-bold text-cyan-400 uppercase tracking-widest mb-2 border-l-4 border-cyan-500 pl-3">Base Game Mechanics</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              All symbols pay from left to right on adjacent reels starting from the leftmost reel. Only the highest win is paid per line. Scatter symbols (Passport) pay in any position. Randomly, if 2 Scatters land without a 3rd, a <strong className="text-white">Hook</strong> or <strong className="text-white">Nudge</strong> feature may trigger to pull the 3rd Scatter onto the screen.
            </p>
          </div>
          
          <div>
            <h3 className="text-xl font-bold text-purple-400 uppercase tracking-widest mb-2 border-l-4 border-purple-500 pl-3">Free Spins & McPepe Collection</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Hit <span className="text-white font-bold">3, 4, or 5 Scatters</span> to trigger 10, 15, or 20 Free Spins. During Free Spins, the <strong className="text-white">McPepe Wild Symbol</strong> is active. Each time a McPepe lands alongside Luggage symbols, he collects all their cash values (up to 100x each).
            </p>
          </div>

          <div>
            <h3 className="text-xl font-bold text-yellow-400 uppercase tracking-widest mb-2 border-l-4 border-yellow-500 pl-3">Progressive Multiplier Trail</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Every McPepe symbol that lands during the Free Spins is collected on the top HUD. 
              <br/><br/>
              • <strong className="text-white">4th McPepe:</strong> Retriggers +10 Spins & upgrades collection multiplier to <strong className="text-yellow-400">2x</strong><br/>
              • <strong className="text-white">8th McPepe:</strong> Retriggers +10 Spins & upgrades collection multiplier to <strong className="text-yellow-400">3x</strong><br/>
              • <strong className="text-white">12th McPepe:</strong> Retriggers +10 Spins & upgrades collection multiplier to <strong className="text-yellow-400">10x</strong>
            </p>
          </div>
        </div>

        {/* Section: Paytable */}
        <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-4 border-b border-gray-800 pb-2">Paytable (Based on 1 SOL Total Bet)</h3>
        <p className="text-gray-500 text-xs mb-4 uppercase tracking-widest">Values calculated automatically across 10 paylines.</p>
        
        <div className="space-y-3">
          {/* Header */}
          <div className="grid grid-cols-6 text-gray-500 text-xs font-bold uppercase tracking-widest pb-2 px-2">
            <div className="col-span-2">Symbol</div>
            <div className="text-center">2 Matches</div>
            <div className="text-center">3 Matches</div>
            <div className="text-center">4 Matches</div>
            <div className="text-center text-yellow-400">5 Matches</div>
          </div>

          {/* Yacht */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-6 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/vacations/vacation_yatch.png" alt="Yacht" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Luxury Yacht</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">2.00</div>
            <div className="text-center text-gray-300 font-mono">10.00</div>
            <div className="text-center text-gray-300 font-mono">100.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">200.00</div>
          </div>

          {/* Jet Ski & Cocktail */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-6 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <div className="flex -space-x-4">
                <img src="/vacations/vacation_jetski.png" alt="Jet Ski" className="w-10 h-10 object-contain relative z-10" />
                <img src="/vacations/vacation_coctel.png" alt="Cocktail" className="w-10 h-10 object-contain relative z-0" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Jet Ski / Drinks</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">1.00</div>
            <div className="text-center text-gray-300 font-mono">4.00</div>
            <div className="text-center text-gray-300 font-mono">40.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">100.00</div>
          </div>

          {/* Sunscreen */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-6 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/vacations/vacation_sunscreen.png" alt="Sunscreen" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Sunscreen</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">0.50</div>
            <div className="text-center text-gray-300 font-mono">3.00</div>
            <div className="text-center text-gray-300 font-mono">10.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">50.00</div>
          </div>

          {/* Luggage */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-6 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/vacations/vacation_luggage.png" alt="Luggage" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Cash Luggage</p>
              </div>
            </div>
            <div className="text-center text-gray-500 font-mono">-</div>
            <div className="text-center text-gray-300 font-mono">1.00</div>
            <div className="text-center text-gray-300 font-mono">5.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">20.00</div>
          </div>

          {/* A & K */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-6 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <div className="flex -space-x-4">
                <img src="/vacations/vacation_a.png" alt="A" className="w-10 h-10 object-contain relative z-10" />
                <img src="/vacations/vacation_k.png" alt="K" className="w-10 h-10 object-contain relative z-0" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Aces / Kings</p>
              </div>
            </div>
            <div className="text-center text-gray-500 font-mono">-</div>
            <div className="text-center text-gray-300 font-mono">1.00</div>
            <div className="text-center text-gray-300 font-mono">5.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">15.00</div>
          </div>

          {/* Q, J, 10 */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-6 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <div className="flex -space-x-4">
                <img src="/vacations/vacation_q.png" alt="Q" className="w-10 h-10 object-contain relative z-20" />
                <img src="/vacations/vacation_j.png" alt="J" className="w-10 h-10 object-contain relative z-10" />
                <img src="/vacations/vacation_10.png" alt="10" className="w-10 h-10 object-contain relative z-0" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">Q, J, 10</p>
              </div>
            </div>
            <div className="text-center text-gray-500 font-mono">-</div>
            <div className="text-center text-gray-300 font-mono">0.50</div>
            <div className="text-center text-gray-300 font-mono">2.50</div>
            <div className="text-center text-yellow-400 font-mono font-bold">10.00</div>
          </div>

        </div>
      </div>
    </div>
  );
}