// src/components/WalletProvider.tsx
"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function AppWalletProvider({ children }: { children: React.ReactNode }) {
  // 🔨 FIX: Dynamic RPC URL resolution
  // We check for a valid Vercel env variable. If missing or misconfigured, we fall back to public devnet.
  const endpoint = useMemo(() => {
    const envRpc = process.env.NEXT_PUBLIC_RPC_URL;
    
    // Ensure the env variable is actually a URL 
    if (envRpc && envRpc.startsWith("http")) {
      return envRpc;
    }
    
    // Fallback to standard Solana devnet to prevent 401s
    return clusterApiUrl('devnet');
  }, []);
  
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}