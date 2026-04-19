import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiGridProps {
  playData: any;
  onAnimationComplete: () => void;
}

const SYMBOL_MAP: Record<number, string> = {
  0: '🐸', // GOLDEN_MCPEPE
  1: '💖', // PEPE_HEART
  2: '💎', // PURPLE_DIAMOND
  3: '🔵', // BLUE_OVAL
  4: '🟩', // GREEN_GEM
  5: '🍎', // APPLE
  6: '🍉', // MELON
  7: '🍭', // SCATTER
  8: '💣', // BOMB
};

const COLS = 6;
const ROWS = 5;
const SYMBOL_SIZE = 90;
const PADDING = 10;
const GRID_WIDTH = COLS * (SYMBOL_SIZE + PADDING);
const GRID_HEIGHT = ROWS * (SYMBOL_SIZE + PADDING);

export default function PixiGrid({ playData, onAnimationComplete }: PixiGridProps) {
  const pixiContainer = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const symbolsRef = useRef<PIXI.Text[][]>([]);

  useEffect(() => {
    if (!pixiContainer.current) return;

    // 1. Initialize Pixi Application
    const app = new PIXI.Application({
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      backgroundAlpha: 0, // Transparent background
      antialias: true,
    });
    
    // @ts-ignore - Handle Pixi v7 appendChild
    pixiContainer.current.appendChild(app.view);
    appRef.current = app;

    const mainContainer = new PIXI.Container();
    app.stage.addChild(mainContainer);

    // 2. Setup initial empty grid matrix
    symbolsRef.current = Array.from({ length: COLS }, () => []);

    // 3. Play the Animation Sequence
    const playSequence = async () => {
      const frames = playData.baseSpinFrames;
      
      for (let f = 0; f < frames.length; f++) {
        const frame = frames[f];
        const isFirstFrame = f === 0;

        await renderGridFrame(app, mainContainer, frame.grid, isFirstFrame);

        if (frame.winningSymbols && frame.winningSymbols.length > 0) {
          // Wait for player to see the win
          await new Promise(resolve => setTimeout(resolve, 600));
          
          // Animate Explosions
          await explodeWinningSymbols(frame.winningSymbols, frame.grid);
        } else {
          // No wins, sequence over
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // If bonus triggered, you would loop through playData.freeSpinsData here
      if (playData.triggeredBonus) {
         console.log("Free spins logic would play here!");
      }

      onAnimationComplete();
    };

    playSequence();

    // Cleanup on unmount
    return () => {
      app.destroy(true, { children: true, texture: true } as any);
    };
  }, [playData]);

  const renderGridFrame = (app: PIXI.Application, container: PIXI.Container, targetGrid: number[][], dropFromTop: boolean) => {
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: () => resolve() });

      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const targetSymbolType = targetGrid[c][r];
          const xPos = c * (SYMBOL_SIZE + PADDING) + (SYMBOL_SIZE / 2);
          const yPos = r * (SYMBOL_SIZE + PADDING) + (SYMBOL_SIZE / 2);

          let currentSprite = symbolsRef.current[c][r];

          // If there's no sprite here (initial drop or after tumble), create it
          if (!currentSprite || currentSprite.text !== SYMBOL_MAP[targetSymbolType]) {
            if (currentSprite) {
               container.removeChild(currentSprite);
               currentSprite.destroy();
            }

            const text = new PIXI.Text(SYMBOL_MAP[targetSymbolType], {
              fontSize: 60,
              dropShadow: true,
              dropShadowColor: '#000000',
              dropShadowBlur: 5,
              dropShadowDistance: 2,
            });
            text.anchor.set(0.5);
            text.x = xPos;
            text.y = dropFromTop ? yPos - 600 : yPos - 200; // Drop from above
            text.alpha = dropFromTop ? 0 : 1;
            
            container.addChild(text);
            symbolsRef.current[c][r] = text;

            // Animate falling down
            tl.to(text, {
              y: yPos,
              alpha: 1,
              duration: 0.4,
              ease: "bounce.out",
              delay: dropFromTop ? (c * 0.05) + (r * 0.02) : 0 // Staggered drop effect
            }, 0);
          } else {
            // Sprite already exists and matches (didn't explode), just ensure it's in the right place
            tl.to(currentSprite, { y: yPos, duration: 0.3, ease: "power2.out" }, 0);
          }
        }
      }
    });
  };

  const explodeWinningSymbols = (winningTypes: number[], currentGrid: number[][]) => {
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: () => resolve() });

      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const symType = currentGrid[c][r];
          if (winningTypes.includes(symType)) {
            const sprite = symbolsRef.current[c][r];
            if (sprite) {
              // The Explosion Animation
              tl.to(sprite.scale, { x: 1.5, y: 1.5, duration: 0.2, ease: "power2.out" }, 0);
              tl.to(sprite, { alpha: 0, y: sprite.y - 30, duration: 0.2, ease: "power2.in" }, 0.2);
              
              // Mark as empty so the next frame drops a new symbol here
              // @ts-ignore
              symbolsRef.current[c][r] = null; 
            }
          }
        }
      }
    });
  };

  return (
    <div className="flex justify-center items-center w-full h-full">
      <div ref={pixiContainer} className="overflow-hidden rounded-xl shadow-[0_0_40px_rgba(168,85,247,0.2)]" />
    </div>
  );
}