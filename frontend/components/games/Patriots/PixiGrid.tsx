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
  9: '🍇', // GRAPE
  10: '🍌',// BANANA
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

    let isMounted = true;
    const app = new PIXI.Application();

    const initPixi = async () => {
      await app.init({
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        backgroundAlpha: 0, 
        antialias: true,
      });

      if (!isMounted) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      // @ts-ignore
      pixiContainer.current.appendChild(app.canvas);
      appRef.current = app;

      const mainContainer = new PIXI.Container();
      app.stage.addChild(mainContainer);

      symbolsRef.current = Array.from({ length: COLS }, () => []);

      // --- NEW HELPER FUNCTIONS FOR BONUS ROUNDS ---

      const clearBoard = () => {
        return new Promise<void>((resolve) => {
          let activeAnimations = 0;
          for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
              const sprite = symbolsRef.current[c][r];
              if (sprite) {
                activeAnimations++;
                gsap.to(sprite, {
                  y: sprite.y + 500,
                  alpha: 0,
                  duration: 0.3,
                  ease: "power2.in",
                  onComplete: () => {
                    mainContainer.removeChild(sprite);
                    sprite.destroy();
                    activeAnimations--;
                    if (activeAnimations === 0) resolve();
                  }
                });
                // @ts-ignore
                symbolsRef.current[c][r] = null;
              }
            }
          }
          if (activeAnimations === 0) resolve();
        });
      };

      const showPopupText = (textStr: string) => {
        return new Promise<void>((resolve) => {
          const text = new PIXI.Text({
            text: textStr,
            style: {
              fontSize: 75,
              fontWeight: '900',
              fill: '#facc15', // Vibrant Yellow
              align: 'center',
              stroke: { color: '#000000', width: 8 },
              dropShadow: { color: '#000000', blur: 15, distance: 5 }
            }
          } as any);
          
          text.anchor.set(0.5);
          text.x = GRID_WIDTH / 2;
          text.y = GRID_HEIGHT / 2;
          text.scale.set(0);
          text.alpha = 0;
          
          app.stage.addChild(text);

          const tl = gsap.timeline({ onComplete: () => {
              app.stage.removeChild(text);
              text.destroy();
              resolve();
          }});

          tl.to(text.scale, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.5)" })
            .to(text, { alpha: 1, duration: 0.2 }, "<")
            .to(text, { alpha: 0, y: text.y - 80, duration: 0.4, ease: "power2.in" }, "+=1.5");
        });
      };

      const playSpinFrames = async (frames: any[]) => {
        for (let f = 0; f < frames.length; f++) {
          if (!isMounted) break;
          const frame = frames[f];
          const isFirstFrame = f === 0;

          await renderGridFrame(app, mainContainer, frame.grid, isFirstFrame);

          if (frame.winningSymbols && frame.winningSymbols.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 600));
            if (!isMounted) break;
            await explodeWinningSymbols(frame.winningSymbols, frame.grid);
          } else {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      };

      // --- MASTER DIRECTOR LOOP ---
      const playSequence = async () => {
        // 1. Render Base Spin
        await playSpinFrames(playData.baseSpinFrames);

        // 2. Render Free Spins (If triggered)
        if (playData.triggeredBonus && isMounted) {
          await showPopupText("10 FREE SPINS!");
          
          const freeSpins = playData.freeSpinsData || [];
          for (let i = 0; i < freeSpins.length; i++) {
            if (!isMounted) break;
            
            await clearBoard(); // Wipe grid for the next spin
            
            const fsSpin = freeSpins[i];
            await playSpinFrames(fsSpin.frames);
            
            // 3. Render Bomb Multipliers
            if (fsSpin.bombMultipliers && fsSpin.bombMultipliers.length > 0 && fsSpin.totalSpinPayout > 0) {
              const multiString = fsSpin.bombMultipliers.map((m: number) => `${m}x`).join(" + ");
              await showPopupText(`BOMBS: ${multiString}\nTOTAL MULT: ${fsSpin.finalSpinMultiplier}x!`);
            }
          }
          
          if (isMounted) {
            await showPopupText("BONUS COMPLETE!");
          }
        }

        if (isMounted) onAnimationComplete();
      };

      playSequence();
    };

    initPixi();

    return () => {
      isMounted = false;
      try {
        app.destroy(true, { children: true, texture: true });
      } catch (error) {
        console.error("Cleanup error:", error);
      }
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

          if (!currentSprite || currentSprite.text !== SYMBOL_MAP[targetSymbolType]) {
            if (currentSprite) {
               container.removeChild(currentSprite);
               currentSprite.destroy();
            }

            const text = new PIXI.Text({
              text: SYMBOL_MAP[targetSymbolType], 
              style: {
                fontSize: 60,
                dropShadow: {
                  color: '#000000',
                  blur: 5,
                  distance: 2
                }
              }
            } as any);

            text.anchor.set(0.5);
            text.x = xPos;
            text.y = dropFromTop ? yPos - 600 : yPos - 200; 
            text.alpha = dropFromTop ? 0 : 1;
            
            container.addChild(text);
            symbolsRef.current[c][r] = text;

            tl.to(text, {
              y: yPos,
              alpha: 1,
              duration: 0.4,
              ease: "bounce.out",
              delay: dropFromTop ? (c * 0.05) + (r * 0.02) : 0 
            }, 0);
          } else {
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
              tl.to(sprite.scale, { x: 1.5, y: 1.5, duration: 0.2, ease: "power2.out" }, 0);
              tl.to(sprite, { alpha: 0, y: sprite.y - 30, duration: 0.2, ease: "power2.in" }, 0.2);
              
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