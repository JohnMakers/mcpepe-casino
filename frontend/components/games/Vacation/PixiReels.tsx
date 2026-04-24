import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiReelsProps {
  playData: any;
  onAnimationComplete: () => void;
}

// 12-Symbol Mapping with Updated Paths
const SYMBOL_MAP: Record<number, string> = {
  0: '/vacations/vacation_10.png', 
  1: '/vacations/vacation_j.png', 
  2: '/vacations/vacation_q.png', 
  3: '/vacations/vacation_k.png', 
  4: '/vacations/vacation_a.png',
  5: '/vacations/vacation_sunscreen.png', 
  6: '/vacations/vacation_luggage.png', 
  7: '/vacations/vacation_coctel.png', 
  8: '/vacations/vacation_jetski.png', 
  9: '/vacations/vacation_yatch.png', 
  10: '/vacations/vacation_mcpepe.png', 
  11: '/vacations/vacation_passport.png'
};

const SYMBOL_NAMES: Record<number, string> = {
  0: '10s', 1: 'Jacks', 2: 'Queens', 3: 'Kings', 4: 'Aces',
  5: 'Sunscreen', 6: 'Luggage', 7: 'Cocktails', 8: 'Jet Skis', 9: 'Yachts',
  10: 'McPepe', 11: 'Passports'
};

// 20 Fixed Paylines for Frontend Mapping
const VAC_LINES = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2],
  [1,0,1,0,1], [1,2,1,2,1], [0,0,1,2,2], [2,2,1,0,0], [1,0,0,0,1],
  [1,2,2,2,1], [0,1,0,1,0], [2,1,2,1,2], [0,1,1,1,0], [2,1,1,1,2],
  [1,1,0,1,1], [1,1,2,1,1], [0,0,2,0,0], [2,2,0,2,2], [0,2,2,2,0]
];

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 600;
const SYMBOL_SIZE = 120;
const SPACING_X = 145;
const SPACING_Y = 140;
const OFFSET_X = 190;
const OFFSET_Y = 180;

export default function PixiReels({ playData, onAnimationComplete }: PixiReelsProps) {
  const pixiContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pixiContainer.current) return;
    let isMounted = true;
    const app = new PIXI.Application();

    const initPixi = async () => {
      await app.init({
        width: CANVAS_WIDTH, height: CANVAS_HEIGHT, backgroundAlpha: 0, antialias: true,
      });

      // Load Assets safely (including BG)
      const assetPaths = [...Object.values(SYMBOL_MAP), '/vacations/vacation_bg.png'];
      const assetsToLoad = assetPaths.map(path => 
        PIXI.Assets.load(path).catch(() => null) 
      );
      await Promise.all(assetsToLoad);

      if (!isMounted) {
        app.destroy(true, { children: true });
        return;
      }

      const style = app.canvas.style as CSSStyleDeclaration;
      style.width = '100%'; style.height = '100%'; style.position = 'absolute';
      pixiContainer.current?.appendChild(app.canvas);

      const mainContainer = new PIXI.Container();
      app.stage.addChild(mainContainer);

      // ADD SLOT BACKGROUND
      try {
        const bg = PIXI.Sprite.from('/vacations/vacation_bg.png');
        bg.width = CANVAS_WIDTH;
        bg.height = CANVAS_HEIGHT;
        mainContainer.addChild(bg);
      } catch (e) {
        console.warn("Background asset failed to load");
      }

      const mask = new PIXI.Graphics().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(0xffffff);
      mainContainer.addChild(mask);
      mainContainer.mask = mask;

      // Center Popup Text
      const centerText = new PIXI.Text({ text: "", style: { fontSize: 60, fontWeight: '900', fill: '#c084fc', stroke: { color: '#000000', width: 8 } }});
      centerText.anchor.set(0.5); centerText.x = CANVAS_WIDTH / 2; centerText.y = CANVAS_HEIGHT / 2; centerText.alpha = 0;
      app.stage.addChild(centerText);

      // Bottom Win Indicator Text
      const winInfoText = new PIXI.Text({ 
        text: "", 
        style: { fontSize: 22, fontWeight: '900', fill: '#4ade80', stroke: { color: '#000000', width: 5 }, dropShadow: { color: '#000000', blur: 4, distance: 2 } }
      });
      winInfoText.anchor.set(0.5, 1); 
      winInfoText.x = CANVAS_WIDTH / 2; 
      winInfoText.y = CANVAS_HEIGHT - 10; 
      winInfoText.alpha = 0;
      app.stage.addChild(winInfoText);

      const animateReels = async (targetGrid: number[][], luggageValues: any[] = [], expandingSymbol: number | null = null): Promise<PIXI.Container[][]> => {
        return new Promise((resolve) => {
          const activeContainers: PIXI.Container[][] = Array.from({ length: 5 }, () => []);
          const tl = gsap.timeline({ onComplete: () => resolve(activeContainers) });
          
          // Clear children EXCEPT background (index 0) and mask
          while(mainContainer.children.length > 2) {
             mainContainer.removeChildAt(2);
          }

          for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 3; row++) {
              const symType = targetGrid[col][row];
              const container = new PIXI.Container();
              const finalX = OFFSET_X + col * SPACING_X;
              const finalY = OFFSET_Y + row * SPACING_Y;
              
              container.x = finalX;
              container.y = finalY - 800; 

              try {
                const sprite = PIXI.Sprite.from(SYMBOL_MAP[symType]);
                sprite.width = SYMBOL_SIZE; sprite.height = SYMBOL_SIZE; sprite.anchor.set(0.5);
                container.addChild(sprite);
              } catch (e) {
                const fallback = new PIXI.Graphics().rect(-SYMBOL_SIZE/2, -SYMBOL_SIZE/2, SYMBOL_SIZE, SYMBOL_SIZE).fill(0x333333);
                container.addChild(fallback);
              }

              // Apply Big Bass Luggage Cash Values (Symbol 6 is Luggage)
              if (symType === 6 && luggageValues) { 
                const lugData = luggageValues.find(l => l.col === col && l.row === row);
                if (lugData) {
                  const valText = new PIXI.Text({ text: `${lugData.val}x`, style: { fontSize: 24, fontWeight: '900', fill: '#4ade80', stroke: { color: '#000000', width: 4 } }});
                  valText.anchor.set(0.5); valText.y = 40;
                  container.addChild(valText);
                }
              }

              if (expandingSymbol !== null && symType === expandingSymbol) {
                const highlight = new PIXI.Graphics().rect(-SYMBOL_SIZE/2, -SYMBOL_SIZE/2, SYMBOL_SIZE, SYMBOL_SIZE).stroke({ color: 0xc084fc, width: 6 });
                container.addChild(highlight);
              }

              mainContainer.addChild(container);
              activeContainers[col][row] = container;

              tl.to(container, {
                y: finalY + 20, 
                duration: 0.4,
                ease: "power2.in",
                delay: col * 0.15 + (row * 0.02) 
              }, 0);
              
              tl.to(container, {
                y: finalY, 
                duration: 0.15,
                ease: "back.out(2)"
              }, `>${col * 0.15}`); 
            }
          }
        });
      };

      const displayWinningLines = async (containers: PIXI.Container[][], winningLines: any[]) => {
        if (!winningLines || winningLines.length === 0) return;

        for (const line of winningLines) {
          const { lineIndex, symbol, count, win } = line;
          const linePath = VAC_LINES[lineIndex];

          // Update Bottom Text
          winInfoText.text = `Line ${lineIndex + 1}: ${count}x ${SYMBOL_NAMES[symbol]}  |  Win: ${(win / 1e9).toFixed(4)} SOL`;
          gsap.to(winInfoText, { alpha: 1, duration: 0.2 });

          const tl = gsap.timeline();
          
          // Pulsate the symbols on this specific line
          for (let col = 0; col < count; col++) {
            const row = linePath[col];
            const container = containers[col][row];
            if (container) {
              tl.to(container.scale, { x: 1.15, y: 1.15, duration: 0.15, yoyo: true, repeat: 3 }, 0);
            }
          }
          
          // Wait to let the user read it before moving to the next line
          await new Promise(r => setTimeout(r, 1200)); 
        }
        
        gsap.to(winInfoText, { alpha: 0, duration: 0.2 });
      };

      const showCenterPopup = (text: string, color: string) => {
        return new Promise<void>((resolve) => {
          centerText.text = text;
          centerText.style.fill = color;
          gsap.fromTo(centerText.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.5)" });
          gsap.fromTo(centerText, { alpha: 0 }, { alpha: 1, duration: 0.2 });
          gsap.to(centerText, { alpha: 0, y: centerText.y - 50, duration: 0.4, delay: 1.5, onComplete: () => {
            centerText.y = CANVAS_HEIGHT / 2; 
            resolve();
          }});
        });
      };

      const playSequence = async () => {
        // 1. Render Base Spin
        const baseContainers = await animateReels(playData.baseGrid);
        
        // 2. Pulse Base Wins
        if (playData.baseWinningLines && playData.baseWinningLines.length > 0) {
          await displayWinningLines(baseContainers, playData.baseWinningLines);
        }
        
        if (playData.payout > 0 && !playData.triggeredBonus) {
           await showCenterPopup(`TOTAL WIN: ${(playData.payout / 1e9).toFixed(4)} SOL`, '#facc15');
        }

        // 3. Free Spins Handling
        if (playData.triggeredBonus && playData.freeSpinsData) {
          await showCenterPopup("FREE SPINS TRIGGERED!", '#c084fc');
          
          const fsData = playData.freeSpinsData;
          await showCenterPopup(`EXPANDING SYMBOL: ${SYMBOL_NAMES[fsData.expandingSymbol].toUpperCase()}`, '#facc15');

          for (let i = 0; i < fsData.spins.length; i++) {
            if (!isMounted) break;
            const spin = fsData.spins[i];
            
            const fsContainers = await animateReels(spin.grid, spin.luggageValues, fsData.expandingSymbol);
            
            if (spin.winningLines && spin.winningLines.length > 0) {
              await displayWinningLines(fsContainers, spin.winningLines);
            }

            if (spin.collectionWin > 0) {
              await showCenterPopup(`MCPEPE COLLECTS: ${(spin.collectionWin / 1e9).toFixed(4)} SOL`, '#4ade80');
            } else if (spin.expandedWin > 0) {
               await showCenterPopup(`EXPANSION WIN: ${(spin.expandedWin / 1e9).toFixed(4)} SOL`, '#facc15');
            }

            await new Promise(r => setTimeout(r, 600)); 
          }
        }

        if (isMounted) onAnimationComplete();
      };

      playSequence();
    };

    initPixi();

    return () => {
      isMounted = false;
      gsap.globalTimeline.clear();
      app.destroy(true, { children: true });
    };
  }, [playData]);

  return (
    <div className="relative w-full h-full">
      <div ref={pixiContainer} className="absolute inset-0 overflow-hidden rounded-xl" />
    </div>
  );
}