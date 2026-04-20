import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiGridProps {
  playData: any;
  onAnimationComplete: () => void;
}

// 1. UPDATED SYMBOL MAP TO POINT TO YOUR CUSTOM IMAGES
const SYMBOL_MAP: Record<number, string> = {
  0: '/patriots/patriots_beer.png',       // GOLDEN_MCPEPE
  1: '/patriots/patriots_torch.png',      // PEPE_HEART
  2: '/patriots/patriots_musket.png',     // PURPLE_DIAMOND
  3: '/patriots/patriots_waveflag.png',   // BLUE_OVAL
  4: '/patriots/patriots_truck.png',      // GREEN_GEM
  5: '/patriots/patriots_salute.png',     // APPLE
  6: '/patriots/patriots_lincoln.png',    // MELON
  7: '/patriots/patriots_bell.png',       // SCATTER
  8: '/patriots/patriots_bomb.png',       // BOMB (Ensure you have this image!)
  9: '/patriots/patriots_eagle.png',      // GRAPE
  10: '/patriots/patriots_limo.png',      // BANANA
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
  const symbolsRef = useRef<any[][]>([]); // Changed to any[][] to hold Sprites

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

      // 2. PRELOAD ASSETS: Ensures buttery smooth drops without visual pop-in
      await PIXI.Assets.load(Object.values(SYMBOL_MAP));

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
              fill: '#facc15', 
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

      const playSequence = async () => {
        await playSpinFrames(playData.baseSpinFrames);

        if (playData.triggeredBonus && isMounted) {
          await showPopupText("10 FREE SPINS!");
          
          const freeSpins = playData.freeSpinsData || [];
          for (let i = 0; i < freeSpins.length; i++) {
            if (!isMounted) break;
            
            await clearBoard(); 
            
            const fsSpin = freeSpins[i];
            await playSpinFrames(fsSpin.frames);
            
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

          // 3. RENDER SPRITE INSTEAD OF TEXT
          if (!currentSprite || currentSprite.symbolType !== targetSymbolType) {
            if (currentSprite) {
               container.removeChild(currentSprite);
               currentSprite.destroy();
            }

            const sprite = PIXI.Sprite.from(SYMBOL_MAP[targetSymbolType]);
            
            // Size them to 80x80 to fit inside the 90px grid cell perfectly
            sprite.width = 80;
            sprite.height = 80;
            sprite.anchor.set(0.5);
            sprite.x = xPos;
            sprite.y = dropFromTop ? yPos - 600 : yPos - 200; 
            sprite.alpha = dropFromTop ? 0 : 1;
            
            // Tag the sprite with its ID so we know if it exploded
            (sprite as any).symbolType = targetSymbolType;
            
            container.addChild(sprite);
            symbolsRef.current[c][r] = sprite;

            tl.to(sprite, {
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
              // 4. ANIMATE EXPLOSION (Scale from Current Width/Height)
              tl.to(sprite, { width: 120, height: 120, duration: 0.2, ease: "power2.out" }, 0);
              tl.to(sprite, { alpha: 0, y: sprite.y - 30, duration: 0.2, ease: "power2.in" }, 0.2);
              
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