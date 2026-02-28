// frontend/app/layout.tsx
import type { Metadata } from "next";
import { Chakra_Petch } from "next/font/google";
import "./globals.css";
import AppWalletProvider from "../components/WalletProvider";

const chakra = Chakra_Petch({ 
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "McPepe Casino",
  description: "Provably Fair, Chainless, Unapologetic.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${chakra.className} bg-[#050806] text-gray-200 min-h-screen selection:bg-[#39ff14] selection:text-black relative`}>
        {/* Global CRT Scanline Overlay */}
        <div className="pointer-events-none fixed inset-0 z-50 h-full w-full bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-20 mix-blend-overlay"></div>
        <AppWalletProvider>{children}</AppWalletProvider>
      </body>
    </html>
  );
}