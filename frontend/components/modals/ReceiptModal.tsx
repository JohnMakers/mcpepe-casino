import React from 'react';

export default function ReceiptModal({ betInfo, onClose }: { betInfo: any, onClose: () => void }) {
  if (!betInfo) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-[#0a0f0c] border border-gray-700 max-w-lg w-full rounded-xl p-6 shadow-2xl">
        <h2 className="text-xl font-black text-white uppercase tracking-wider mb-6 flex items-center justify-between border-b border-gray-800 pb-4">
          Receipt
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </h2>
        <div className="space-y-4 font-mono text-sm">
          <div className="flex justify-between border-b border-gray-800 pb-2">
            <span className="text-gray-500">Player</span><span className="text-white">{betInfo.player}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-2">
            <span className="text-gray-500">Outcome</span>
            <span className={betInfo.win ? "text-green-500 font-bold" : "text-red-500 font-bold"}>
              {betInfo.win ? "+" : "-"}{betInfo.amount.toFixed(2)} SOL
            </span>
          </div>
          <div className="flex flex-col gap-1 border-b border-gray-800 pb-2">
            <span className="text-gray-500">Network Tx Signature (Verification)</span>
            <a href={`https://explorer.solana.com/tx/${betInfo.hash}?cluster=devnet`} target="_blank" rel="noreferrer" className="text-green-400 break-all text-xs bg-[#111a14] p-2 rounded border border-green-900/30 hover:bg-green-900/40 transition-colors">
              {betInfo.hash}
            </a>
          </div>
          <div className="flex flex-col gap-1 border-b border-gray-800 pb-2">
            <span className="text-gray-500">Revealed Seed</span>
            <span className="text-white text-xs break-all">{betInfo.clientSeed}</span>
          </div>
        </div>
      </div>
    </div>
  );
}