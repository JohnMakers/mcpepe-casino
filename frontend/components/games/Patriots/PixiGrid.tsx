import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiGridProps {
  playData: any;
  onAnimationComplete: () => void;
}

const SYMBOL_MAP: Record<number, string> = {
  0: '/patriots/patriots_beer.png',       
  1: '/patriots/patriots_torch.png',      
  2: '/patriots/patriots_musket.png',     
  3: '/patriots/patriots_waveflag.png',   
  4: '/patriots/patriots_truck.png',      
  5: '/patriots/patriots_salute.png',     
  6: '/patriots/patriots_lincoln.png',    
  7: '/patriots/patriots_bell.png',       
  8: '/patriots/patriots_bomb.png',       
  9: '/patriots/patriots_eagle.png',      
  10: '/patriots/patriots_limo.png',      
};

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SYMBOL_SIZE = 76;

const GRID_OFFSET_X = 138; 
const GRID_OFFSET_Y = 78;

const TILE_POSITIONS = [
  [ { x: 20, y: 19 }, { x: 20, y: 121 }, { x: 20, y: 216.8 }, { x: 20, y: 311.5 }, { x: 20, y: 408 } ],
  [ { x: 115, y: 18 }, { x: 115, y: 121 }, { x: 115, y: 216.8 }, { x: 115, y: 311.5 }, { x: 115, y: 408 } ],
  [ { x: 211.5, y: 17 }, { x: 211.5, y: 121 }, { x: 211.5, y: 216.8 }, { x: 211.5, y: 311.5 }, { x: 211.5, y: 408 } ],
  [ { x: 308, y: 16 }, { x: 308, y: 121 }, { x: 308, y: 216.8 }, { x: 308, y: 311.5 }, { x: 308, y: 408 } ],
  [ { x: 403, y: 15 }, { x: 403, y: 121 }, { x: 403, y: 216.8 }, { x: 403, y: 311.5 }, { x: 403, y: 408 } ],
  [ { x: 500, y: 14 }, { x: 500, y: 121 }, { x: 500, y: 216.8 }, { x: 500, y: 311.5 }, { x: 500, y: 408 } ],
];

const COLS = 6;
const ROWS = 5;

export default function PixiGrid({ playData, onAnimationComplete }: PixiGridProps) {
  const pixiContainer = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const symbolsRef = useRef<any[][]>([]); 

  useEffect(() => {
    if (!pixiContainer.current) return;

    let isMounted = true;
    const app = new PIXI.Application();

    const initPixi = async () => {
      await app.init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundAlpha: 0, 
        antialias: true,
      });

      await PIXI.Assets.load([...Object.values(SYMBOL_MAP)]);

      if (!isMounted) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      const style = app.canvas.style as CSSStyleDeclaration;
      style.width = '100%';
      style.height = '100%';
      style.display = 'block'; 
      style.position = 'absolute';
      style.top = '0px';
      style.left = '0px';

      // Safe Type Check for Vercel
      if (pixiContainer.current) {
        pixiContainer.current.appendChild(app.canvas);
      }
      
      appRef.current = app;

      const mainContainer = new PIXI.Container();
      mainContainer.x = GRID_OFFSET_X;
      mainContainer.y = GRID_OFFSET_Y;
      app.stage.addChild(mainContainer);

      const mask = new PIXI.Graphics()
        .rect(-50, -10, CANVAS_WIDTH, CANVAS_HEIGHT) 
        .fill(0xffffff);
      mainContainer.addChild(mask);
      mainContainer.mask = mask; 

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
                  duration: 0.6, 
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
          text.x = CANVAS_WIDTH / 2;
          text.y = CANVAS_HEIGHT / 2;
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
            await new Promise(resolve => setTimeout(resolve, 900)); 
            if (!isMounted) break;
            await explodeWinningSymbols(frame.winningSymbols, frame.grid);
          } else {
            await new Promise(resolve => setTimeout(resolve, 750)); 
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
          
          const targetPos = TILE_POSITIONS[c][r];
          const xPos = targetPos.x;
          const yPos = targetPos.y;

          let currentSprite = symbolsRef.current[c][r];

          if (!currentSprite || currentSprite.symbolType !== targetSymbolType) {
            if (currentSprite) {
               container.removeChild(currentSprite);
               currentSprite.destroy();
            }

            const sprite = PIXI.Sprite.from(SYMBOL_MAP[targetSymbolType]);
            
            sprite.width = SYMBOL_SIZE;
            sprite.height = SYMBOL_SIZE;
            sprite.anchor.set(0.5);
            sprite.x = xPos;
            
            sprite.y = dropFromTop ? yPos - 800 : yPos - 300; 
            sprite.alpha = dropFromTop ? 0 : 1;
            
            (sprite as any).symbolType = targetSymbolType;
            
            container.addChild(sprite);
            symbolsRef.current[c][r] = sprite;

            tl.to(sprite, {
              y: yPos,
              alpha: 1,
              duration: 0.75, 
              ease: "bounce.out",
              delay: dropFromTop ? (c * 0.08) + (r * 0.035) : 0 
            }, 0);
          } else {
            tl.to(currentSprite, { 
              y: yPos, 
              duration: 0.6, 
              ease: "power2.out" 
            }, 0); 
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
              const randomTwist = (Math.random() - 0.5) * 0.5; 
              
              tl.to(sprite, { 
                width: SYMBOL_SIZE * 1.4, 
                height: SYMBOL_SIZE * 1.4, 
                rotation: randomTwist,
                duration: 0.35, 
                ease: "power2.out" 
              }, 0);
              
              tl.to(sprite, { 
                alpha: 0, 
                y: sprite.y - 30, 
                duration: 0.35, 
                ease: "power2.in" 
              }, 0.2);
              
              symbolsRef.current[c][r] = null; 
            }
          }
        }
      }
    });
  };

  return (
    <div className="relative w-full h-full">
      <div ref={pixiContainer} className="absolute inset-0 overflow-hidden rounded-xl" />
    </div>
  );
}