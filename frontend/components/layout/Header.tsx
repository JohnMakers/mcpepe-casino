import React from 'react';
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

interface HeaderProps {
  balance: number;
  publicKey: any;
  isLeftSidebarOpen: boolean;
  setIsLeftSidebarOpen: (val: boolean) => void;
  isRightSidebarOpen: boolean;
  setIsRightSidebarOpen: (val: boolean) => void;
  setActiveGame: (game: string | null) => void;
}

export default function Header({ balance, publicKey, isLeftSidebarOpen, setIsLeftSidebarOpen, isRightSidebarOpen, setIsRightSidebarOpen, setActiveGame }: HeaderProps) {
  return (
    <header className="h-16 border-b border-green-900/40 bg-[#0a0f0c] px-4 flex justify-between items-center z-20 shadow-md">
      <div className="flex items-center gap-4">
        <button onClick={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)} className="text-green-500 hover:text-green-400 p-2 bg-green-900/20 rounded border border-green-900/50">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveGame(null)}>
          <span className="text-2xl">🐸</span>
          <h1 className="text-xl font-black tracking-widest text-white uppercase italic hidden sm:block">
            McPepe <span className="text-green-500">Casino</span>
          </h1>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {publicKey && (
          <div className="bg-[#111a14] border border-green-900/50 px-4 py-1.5 rounded flex gap-3 items-center">
            <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Vault</span>
            <span className="text-green-400 font-mono font-bold">{balance.toFixed(4)} SOL</span>
          </div>
        )}
        <WalletMultiButton className="!bg-green-600 hover:!bg-green-500 transition-colors !font-black !rounded !h-10 border border-green-400 uppercase text-sm" />
        <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className="text-green-500 hover:text-green-400 p-2 bg-green-900/20 rounded border border-green-900/50 ml-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
        </button>
      </div>
    </header>
  );
}