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
        className="bg-[#0a1622] border border-blue-800 max-w-3xl w-full max-h-[85vh] rounded-xl p-8 shadow-[0_0_50px_rgba(30,64,175,0.3)] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-blue-900">
          <h2 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <span className="text-blue-400">Snowstorm</span> Rules
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors bg-gray-900 rounded-full w-8 h-8 flex items-center justify-center font-bold">✕</button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#0f1d2e] border border-blue-900 p-4 rounded-lg text-center">
            <p className="text-blue-500 text-xs font-bold tracking-widest uppercase mb-1">RTP</p>
            <p className="text-blue-300 font-black text-xl">96.15%</p>
          </div>
          <div className="bg-[#0f1d2e] border border-blue-900 p-4 rounded-lg text-center">
            <p className="text-blue-500 text-xs font-bold tracking-widest uppercase mb-1">Volatility</p>
            <p className="text-cyan-500 font-black text-xl">MEDIUM</p>
          </div>
          <div className="bg-[#0f1d2e] border border-blue-900 p-4 rounded-lg text-center">
            <p className="text-blue-500 text-xs font-bold tracking-widest uppercase mb-1">Max Win</p>
            <p className="text-yellow-400 font-black text-xl">800x</p>
          </div>
          <div className="bg-[#0f1d2e] border border-blue-900 p-4 rounded-lg text-center">
            <p className="text-blue-500 text-xs font-bold tracking-widest uppercase mb-1">Paylines</p>
            <p className="text-white font-black text-[15px] mt-1 uppercase">5 Fixed</p>
          </div>
        </div>

        <div className="mb-10 space-y-6">
          <div>
            <h3 className="text-xl font-bold text-blue-400 uppercase tracking-widest mb-2 border-l-4 border-blue-500 pl-3">Snowstorm Respin</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Triggered when two reels land with matching stacked symbols but no winning payline exists. The two matching reels lock in place, and the third reel respins for a second chance at a win.
            </p>
          </div>
          
          <div>
            <h3 className="text-xl font-bold text-cyan-400 uppercase tracking-widest mb-2 border-l-4 border-cyan-500 pl-3">Blizzard Multiplier Wheel</h3>
            <p className="text-gray-400 leading-relaxed text-sm">
              Fill the entire 3x3 grid with the same symbol to trigger the Blizzard Wheel. Spin for a multiplier from <strong className="text-white">2x up to 10x</strong> applied to your total spin win!
            </p>
          </div>
        </div>

        <h3 className="text-2xl font-black text-white uppercase tracking-widest mb-4 border-b border-blue-900 pb-2">Paytable (1 SOL Bet)</h3>
        <div className="space-y-3">
          {[
            { name: "McPepe Wild", img: "snowstorm_mcpepe.png", pay: "80.00" },
            { name: "Snowman", img: "snowstorm_snowman.png", pay: "25.00" },
            { name: "Polar Bear", img: "snowstorm_polar.png", pay: "15.00" },
            { name: "Snowmobile", img: "snowstorm_snowmobile.png", pay: "10.00" },
            { name: "Skis", img: "snowstorm_ski.png", pay: "7.00" },
            { name: "Boots", img: "snowstorm_boots.png", pay: "5.00" },
            { name: "Gloves", img: "snowstorm_gloves.png", pay: "4.00" },
            { name: "Hot Cocoa", img: "snowstorm_cocoamug.png", pay: "3.00" },
            { name: "Snowflake", img: "snowstorm_snowflake.png", pay: "2.00" },
          ].map((sym, i) => (
            <div key={i} className="bg-[#0f1d2e] rounded-lg p-3 grid grid-cols-4 items-center border border-blue-900/50">
              <div className="col-span-2 flex items-center gap-3">
                <img src={`/snowstorm/${sym.img}`} alt={sym.name} className="w-10 h-10 object-contain" />
                <p className="text-white font-bold text-sm">{sym.name}</p>
              </div>
              <div className="text-center text-gray-500 text-xs uppercase font-bold">3 Matches</div>
              <div className="text-right text-green-400 font-mono font-bold">{sym.pay} SOL</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}