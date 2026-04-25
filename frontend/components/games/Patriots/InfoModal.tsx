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
        className="bg-[#0a0f0c] border border-blue-800 max-w-3xl w-full max-h-[85vh] rounded-xl p-8 shadow-[0_0_50px_rgba(220,38,38,0.15)] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-800">
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <span className="text-red-500">McPepe's</span> Patriots Rules
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors bg-gray-900 rounded-full w-8 h-8 flex items-center justify-center font-bold">✕</button>
        </div>

        {/* Section: Game Details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">RTP</p>
            <p className="text-blue-400 font-black text-xl">~96.7%</p>
          </div>
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Volatility</p>
            <p className="text-red-500 font-black text-xl">HIGH</p>
          </div>
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Max Win</p>
            <p className="text-yellow-400 font-black text-xl">21,100x</p>
          </div>
          <div className="bg-[#111814] border border-gray-800 p-4 rounded-lg text-center">
            <p className="text-gray-500 text-xs font-bold tracking-widest uppercase mb-1">Mechanism</p>
            <p className="text-white font-black text-[15px] mt-1 uppercase">Pay Anywhere</p>
          </div>
        </div>

        {/* Section: Feature Rules */}
        <div className="mb-10 space-y-6">
          <div>
            <h3 className="text-xl font-bold text-blue-400 uppercase tracking-widest mb-2 border-l-4 border-blue-500 pl-3">Liberty Tumble</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Winning symbols are destroyed and disappear. The remaining symbols fall to the bottom of the screen and the empty positions are replaced with new symbols falling from above. Tumbling continues until no more winning combinations appear.
            </p>
          </div>
          
          <div>
            <h3 className="text-xl font-bold text-green-400 uppercase tracking-widest mb-2 border-l-4 border-green-500 pl-3">Free Spins Bonus</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Hit <span className="text-white font-bold">4 or more Scatter symbols (Bells)</span> anywhere on the screen to trigger <span className="text-white font-bold">10 Free Spins</span>. During the Free Spins round, hitting 3 or more Scatters in a single tumble sequence awards an additional <span className="text-white font-bold">+3 Free Spins</span>.
            </p>
          </div>

          <div>
            <h3 className="text-xl font-bold text-yellow-400 uppercase tracking-widest mb-2 border-l-4 border-yellow-500 pl-3">Multiplier Bombs</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Multiplier Bombs only appear during the Free Spins round. Whenever a bomb hits, it takes a random multiplier value: <span className="text-yellow-400 font-mono">2x, 3x, 5x, 8x, 10x, 15x, 20x, 25x, 50x, or 100x</span>. When the tumble sequence ends, the values of all bombs on screen are added together and the total sequence win is multiplied by the final value.
            </p>
          </div>
        </div>

        {/* Section: Paytable */}
        <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-4 border-b border-gray-800 pb-2">Paytable (Based on 1 SOL Bet)</h3>
        <p className="text-gray-500 text-xs mb-4 uppercase tracking-widest">Symbols pay anywhere on the screen. Minimum 8 symbols required for a win.</p>
        
        <div className="space-y-3">
          {/* Header */}
          <div className="grid grid-cols-5 text-gray-500 text-xs font-bold uppercase tracking-widest pb-2 px-2">
            <div className="col-span-2">Symbol</div>
            <div className="text-center">8 - 9</div>
            <div className="text-center">10 - 11</div>
            <div className="text-center text-yellow-400">12+</div>
          </div>

          {/* Golden Beer */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_beer.png" alt="Beer" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Patriot Beer</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">15.00</div>
            <div className="text-center text-gray-300 font-mono">40.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">75.00</div>
          </div>

          {/* Torch */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_torch.png" alt="Torch" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Liberty Torch</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">4.00</div>
            <div className="text-center text-gray-300 font-mono">15.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">35.00</div>
          </div>

          {/* Musket */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_musket.png" alt="Musket" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Crossed Muskets</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">3.00</div>
            <div className="text-center text-gray-300 font-mono">7.50</div>
            <div className="text-center text-yellow-400 font-mono font-bold">20.00</div>
          </div>

          {/* Flag */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_waveflag.png" alt="Flag" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Waving Flag</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">2.00</div>
            <div className="text-center text-gray-300 font-mono">4.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">15.00</div>
          </div>

          {/* Truck */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_truck.png" alt="Truck" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Patriot Truck</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">1.50</div>
            <div className="text-center text-gray-300 font-mono">2.50</div>
            <div className="text-center text-yellow-400 font-mono font-bold">12.00</div>
          </div>

          {/* Salute */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_salute.png" alt="Salute" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Salute</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">1.20</div>
            <div className="text-center text-gray-300 font-mono">2.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">10.00</div>
          </div>

          {/* Lincoln */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_lincoln.png" alt="Lincoln" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Top Hat</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">0.80</div>
            <div className="text-center text-gray-300 font-mono">1.50</div>
            <div className="text-center text-yellow-400 font-mono font-bold">7.50</div>
          </div>

          {/* Eagle */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_eagle.png" alt="Eagle" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Bald Eagle</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">0.60</div>
            <div className="text-center text-gray-300 font-mono">1.20</div>
            <div className="text-center text-yellow-400 font-mono font-bold">5.00</div>
          </div>

          {/* Limo */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <img src="/patriots/patriots_limo.png" alt="Limo" className="w-12 h-12 object-contain" />
              <div>
                <p className="text-white font-bold text-sm">Presidential Limo</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">0.40</div>
            <div className="text-center text-gray-300 font-mono">1.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">3.00</div>
          </div>

          {/* Banana */}
          <div className="bg-[#111814] rounded-lg p-3 grid grid-cols-5 items-center border border-gray-800/50 hover:border-gray-600 transition-colors">
            <div className="col-span-2 flex items-center gap-3">
              <div className="w-12 h-12 flex items-center justify-center bg-yellow-500/20 rounded-full border border-yellow-500/50 text-xl">🍌</div>
              <div>
                <p className="text-white font-bold text-sm">Banana</p>
              </div>
            </div>
            <div className="text-center text-gray-300 font-mono">0.40</div>
            <div className="text-center text-gray-300 font-mono">1.00</div>
            <div className="text-center text-yellow-400 font-mono font-bold">3.00</div>
          </div>

        </div>
      </div>
    </div>
  );
}