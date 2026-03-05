import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, web3, BN } from '@coral-xyz/anchor';
import idl from '../../../idl.json'; // Adjust path as needed
import { PublicKey, SystemProgram } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey(idl.metadata.address);

export default function RockPaperScissors() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const [streak, setStreak] = useState(0);
    const [betAmount, setBetAmount] = useState<number>(0.1);
    const [isProcessing, setIsProcessing] = useState(false);

    const getProvider = () => {
        if (!wallet.publicKey) return null;
        return new AnchorProvider(connection, wallet as any, AnchorProvider.defaultOptions());
    };

    const playHand = async (move: number) => {
        const provider = getProvider();
        if (!provider || !wallet.publicKey) return alert("Connect wallet first!");

        setIsProcessing(true);
        try {
            const program = new Program(idl as any, PROGRAM_ID, provider);
            
            const [gameStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_game"), wallet.publicKey.toBuffer()],
                program.programId
            );

            const [vaultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_vault")],
                program.programId
            );

            // Check if GameState exists, if not, Initialize in same TX
            const accountInfo = await connection.getAccountInfo(gameStatePda);
            const tx = new web3.Transaction();

            if (!accountInfo) {
                const initIx = await program.methods.initializeGame()
                    .accounts({
                        gameState: gameStatePda,
                        player: wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    }).instruction();
                tx.add(initIx);
            }

            // Convert bet to lamports (only matters on streak 0)
            const lamports = new BN(betAmount * web3.LAMPORTS_PER_SOL);

            const playIx = await program.methods.playHand(lamports, move)
                .accounts({
                    gameState: gameStatePda,
                    vault: vaultPda,
                    player: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                }).instruction();
            
            tx.add(playIx);

            const signature = await provider.sendAndConfirm(tx);
            console.log("Move submitted! Sig:", signature);
            
            // Note: In production, your backend crank service will automatically detect 
            // the state change and call resolve_hand to update the streak.
            // You would poll the GameState PDA here to see the result.
            // Replace pollResult(program, gameStatePda); with this:
            console.log("Move locked on chain. Pinging House to resolve...");

            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/rps/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerPubkeyStr: wallet.publicKey.toBase58(),
                    gameStatePubkeyStr: gameStatePda.toBase58()
                })
            });

            const data = await response.json();
            if (data.success) {
                console.log("House resolved the hand! Signature:", data.resolveSignature);
                // Fetch the updated game state to see if the streak increased or reset
                const state: any = await program.account.rpsGameState.fetch(gameStatePda);
                setStreak(state.currentStreak);
                
                if (state.currentStreak === 0) {
                    alert(`House threw ${data.houseMove}. You lost!`);
                } else {
                    alert(`House threw ${data.houseMove}. You won! Current Streak: ${state.currentStreak}. Let it Ride?`);
                }
            } else {
                console.error("House failed to resolve:", data.error);
            }

        } catch (error) {
            console.error("Error playing hand:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    const pollResult = async (program: Program, gameStatePda: PublicKey) => {
        // Quick polling mechanism to wait for backend crank
        const interval = setInterval(async () => {
            const state: any = await program.account.rpsGameState.fetch(gameStatePda);
            if (!state.isActive) {
                clearInterval(interval);
                setStreak(state.currentStreak);
                if (state.currentStreak === 0) {
                    alert("House wins or Tie! You lost the streak.");
                } else {
                    alert(`You won! Current Streak: ${state.currentStreak}. Let it Ride?`);
                }
            }
        }, 2000);
    };

    const settleStreak = async () => {
        const provider = getProvider();
        if (!provider || !wallet.publicKey) return;

        setIsProcessing(true);
        try {
            const program = new Program(idl as any, PROGRAM_ID, provider);
            const [gameStatePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_game"), wallet.publicKey.toBuffer()],
                program.programId
            );
            const [vaultPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("rps_vault")],
                program.programId
            );

            await program.methods.settleStreak()
                .accounts({
                    gameState: gameStatePda,
                    vault: vaultPda,
                    player: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            
            setStreak(0);
            alert("Winnings claimed successfully!");
        } catch (error) {
            console.error("Error claiming:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col items-center gap-4 bg-green-900 p-8 rounded-xl text-white">
            <h2 className="text-3xl font-bold">Pepe's High-Stakes RPS</h2>
            <div className="text-xl">Current Streak: {streak} / 6</div>
            
            {streak === 0 && (
                <div className="flex gap-2 items-center">
                    <label>Bet (SOL):</label>
                    <input 
                        type="number" 
                        value={betAmount}
                        onChange={(e) => setBetAmount(Number(e.target.value))}
                        className="text-black px-2 py-1 rounded"
                    />
                </div>
            )}

            <div className="flex gap-4 mt-4">
                <button disabled={isProcessing} onClick={() => playHand(1)} className="bg-gray-700 px-6 py-3 rounded hover:bg-gray-600">Rock</button>
                <button disabled={isProcessing} onClick={() => playHand(2)} className="bg-gray-700 px-6 py-3 rounded hover:bg-gray-600">Paper</button>
                <button disabled={isProcessing} onClick={() => playHand(3)} className="bg-gray-700 px-6 py-3 rounded hover:bg-gray-600">Scissors</button>
            </div>

            {streak > 0 && (
                <button 
                    disabled={isProcessing} 
                    onClick={settleStreak} 
                    className="mt-6 bg-yellow-500 text-black font-bold px-8 py-3 rounded-full hover:bg-yellow-400"
                >
                    Cash Out Now
                </button>
            )}
        </div>
    );
}