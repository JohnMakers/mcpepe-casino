import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiReelsProps {
  playData: any | null;
  onAnimationComplete: () => void;
}

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

const VAC_LINES = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2],
  [1,0,0,0,1], [1,2,2,2,1], [0,0,1,2,2], [2,2,1,0,0], [1,0,1,2,1]
];

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 600;
const SYMBOL_SIZE = 80;

// ==========================================
// 🛠️ MANUAL POSITION TUNING AREA
// ==========================================

// 1. Turn this to TRUE to see the grid, boxes, and drop line. 
// Turn to FALSE when you are done tuning!
const SHOW_DEBUG_GRID = true; 

// 2. Where do symbols spawn from before dropping? 
// (Set to 20 so you can see it while debugging. Change to -150 for production).
const DROP_START_Y = 50; 

// 3. Exact X/Y resting coordinates for the 5 Columns x 3 Rows
// Adjust these numbers to perfectly align the green boxes with your background!
const TILE_POSITIONS = [
  [ { x: 260, y: 180 }, { x: 270, y: 320 }, { x: 280, y: 460 } ], // Column 0 (Far Left)
  [ { x: 375, y: 180 }, { x: 380, y: 320 }, { x: 385, y: 460 } ], // Column 1
  [ { x: 494, y: 180 }, { x: 494, y: 320 }, { x: 494, y: 460 } ], // Column 2 (Middle)
  [ { x: 605, y: 180 }, { x: 607, y: 320 }, { x: 608, y: 460 } ], // Column 3
  [ { x: 716, y: 180 }, { x: 717, y: 320 }, { x: 718, y: 460 } ]  // Column 4 (Far Right)
];

// ==========================================

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

      const assetPaths = [...Object.values(SYMBOL_MAP), '/vacations/vacation_bg.png'];
      const assetsToLoad = assetPaths.map(path => PIXI.Assets.load(path).catch(() => null));
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

      // 1. Draw Default Background (Always visible)
      try {
        const bg = PIXI.Sprite.from('/vacations/vacation_bg.png');
        bg.width = CANVAS_WIDTH;
        bg.height = CANVAS_HEIGHT;
        mainContainer.addChild(bg);
      } catch (e) {
        console.warn("Background asset failed to load");
      }

      // 2. Draw the Mask (Clips symbols so they don't overlap the UI)
      const mask = new PIXI.Graphics().rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).fill(0xffffff);
      mainContainer.addChild(mask);
      mainContainer.mask = mask;

      // 3. ✨ DRAW DEBUG GRID (Attached to app.stage so it bypasses the mask)
      if (SHOW_DEBUG_GRID) {
        const debugContainer = new PIXI.Container();
        app.stage.addChild(debugContainer);

        // Draw Drop Line
        const dropLine = new PIXI.Graphics()
          .moveTo(0, DROP_START_Y)
          .lineTo(CANVAS_WIDTH, DROP_START_Y)
          .stroke({ color: 0xff0000, width: 4 });
        debugContainer.addChild(dropLine);

        const debugText = new PIXI.Text({ text: "DROP START LINE", style: { fill: '#ff0000', fontSize: 16, fontWeight: '900', stroke: {color: '#000', width: 4} }});
        debugText.x = 10;
        debugText.y = Math.max(0, DROP_START_Y - 25);
        debugContainer.addChild(debugText);

        // Draw Bounding Boxes for Tiles
        TILE_POSITIONS.forEach((col, cIndex) => {
          col.forEach((pos, rIndex) => {
            // Outline Box
            const box = new PIXI.Graphics()
              .rect(pos.x - SYMBOL_SIZE/2, pos.y - SYMBOL_SIZE/2, SYMBOL_SIZE, SYMBOL_SIZE)
              .stroke({ color: 0x4ade80, width: 3, alpha: 0.8 }); // Bright Green
            
            // Center Dot
            const centerDot = new PIXI.Graphics()
              .circle(pos.x, pos.y, 5)
              .fill(0xff00ff); // Hot Pink
            
            // Coordinate Label
            const coordText = new PIXI.Text({ 
                text: `C:${cIndex} R:${rIndex}\nX:${pos.x} Y:${pos.y}`, 
                style: { fill: '#4ade80', fontSize: 12, align: 'center', fontWeight: 'bold', stroke: {color: '#000', width: 3} }
            });
            coordText.anchor.set(0.5);
            coordText.x = pos.x;
            coordText.y = pos.y + SYMBOL_SIZE/2 + 20;

            debugContainer.addChild(box, centerDot, coordText);
          });
        });
      }

      // Stop here if there is no playData (This preserves the background on page load!)
      if (!playData) return;

      // UI Text Elements
      const centerText = new PIXI.Text({ text: "", style: { fontSize: 60, fontWeight: '900', fill: '#c084fc', stroke: { color: '#000000', width: 8 } }});
      centerText.anchor.set(0.5); centerText.x = CANVAS_WIDTH / 2; centerText.y = CANVAS_HEIGHT / 2; centerText.alpha = 0;
      app.stage.addChild(centerText);

      const winInfoText = new PIXI.Text({ 
        text: "", style: { fontSize: 22, fontWeight: '900', fill: '#4ade80', stroke: { color: '#000000', width: 5 }, dropShadow: { color: '#000000', blur: 4, distance: 2 } }
      });
      winInfoText.anchor.set(0.5, 1); winInfoText.x = CANVAS_WIDTH / 2; winInfoText.y = CANVAS_HEIGHT - 10; winInfoText.alpha = 0;
      app.stage.addChild(winInfoText);

      const hudContainer = new PIXI.Container();
      hudContainer.y = 20;
      hudContainer.alpha = 0;
      app.stage.addChild(hudContainer);

      const hudBg = new PIXI.Graphics().roundRect(CANVAS_WIDTH / 2 - 250, 0, 500, 60, 15).fill({ color: 0x000000, alpha: 0.8 });
      hudBg.stroke({ color: 0x4ade80, width: 3 });
      hudContainer.addChild(hudBg);

      const hudText = new PIXI.Text({ text: "MCPEPES: 0/4  |  MULT: 1x", style: { fontSize: 24, fontWeight: '900', fill: '#ffffff' }});
      hudText.anchor.set(0.5); hudText.x = CANVAS_WIDTH / 2; hudText.y = 30;
      hudContainer.addChild(hudText);

      const updateHUD = (collected: number, multiplier: number) => {
        let nextTarget = 4;
        if (collected >= 4) nextTarget = 8;
        if (collected >= 8) nextTarget = 12;
        if (collected >= 12) hudText.text = `MAX LEVEL REACHED!  |  MULT: 10x`;
        else hudText.text = `MCPEPES: ${collected}/${nextTarget}  |  MULT: ${multiplier}x`;
      };

      const animateReels = async (targetGrid: number[][], luggageValues: any[] = [], isNudge = false, hookCol = -1): Promise<PIXI.Container[][]> => {
        return new Promise((resolve) => {
          const activeContainers: PIXI.Container[][] = Array.from({ length: 5 }, () => []);
          const tl = gsap.timeline({ onComplete: () => resolve(activeContainers) });
          
          // Clear previous grid (preserves background and mask)
          while(mainContainer.children.length > 2) {
             mainContainer.removeChildAt(mainContainer.children.length - 1);
          }

          for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 3; row++) {
              const symType = targetGrid[col][row];
              const container = new PIXI.Container();
              
              const targetPos = TILE_POSITIONS[col][row];
              const finalX = targetPos.x;
              const finalY = targetPos.y;
              
              container.x = finalX;

              if (isNudge) {
                container.y = finalY - 140; 
              } else if (col === hookCol) {
                container.y = finalY + 500; 
              } else {
                container.y = DROP_START_Y; 
              }

              try {
                const sprite = PIXI.Sprite.from(SYMBOL_MAP[symType]);
                sprite.width = SYMBOL_SIZE; sprite.height = SYMBOL_SIZE; sprite.anchor.set(0.5);
                container.addChild(sprite);
              } catch (e) {
                const fallback = new PIXI.Graphics().rect(-SYMBOL_SIZE/2, -SYMBOL_SIZE/2, SYMBOL_SIZE, SYMBOL_SIZE).fill(0x333333);
                container.addChild(fallback);
              }

              if (symType === 6 && luggageValues) { 
                const lugData = luggageValues.find((l: any) => l.col === col && l.row === row);
                if (lugData) {
                  const valText = new PIXI.Text({ text: `${lugData.val}x`, style: { fontSize: 24, fontWeight: '900', fill: '#4ade80', stroke: { color: '#000000', width: 4 } }});
                  valText.anchor.set(0.5); valText.y = 40;
                  container.addChild(valText);
                }
              }

              mainContainer.addChild(container);
              activeContainers[col][row] = container;

              if (col === hookCol) {
                tl.to(container, { y: finalY - 20, duration: 0.5, ease: "power2.out", delay: row * 0.05 }, 0);
                tl.to(container, { y: finalY, duration: 0.2, ease: "bounce.out" }, ">");
              } else {
                tl.to(container, { y: finalY + 20, duration: 0.4, ease: "power2.in", delay: col * 0.15 + (row * 0.02) }, 0);
                tl.to(container, { y: finalY, duration: 0.15, ease: "back.out(2)" }, `>${col * 0.15}`); 
              }
            }
          }
        });
      };

      const displayWinningLines = async (containers: PIXI.Container[][], winningLines: any[]) => {
        if (!winningLines || winningLines.length === 0) return;
        for (const line of winningLines) {
          const { lineIndex, symbol, count, win } = line;
          const linePath = VAC_LINES[lineIndex];

          winInfoText.text = `Line ${lineIndex + 1}: ${count}x ${SYMBOL_NAMES[symbol]}  |  Win: ${(win / 1e9).toFixed(4)} SOL`;
          gsap.to(winInfoText, { alpha: 1, duration: 0.2 });

          const tl = gsap.timeline();
          for (let col = 0; col < count; col++) {
            const row = linePath[col];
            const container = containers[col][row];
            if (container) {
              tl.to(container.scale, { x: 1.15, y: 1.15, duration: 0.15, yoyo: true, repeat: 3 }, 0);
            }
          }
          await new Promise(r => setTimeout(r, 1200)); 
        }
        gsap.to(winInfoText, { alpha: 0, duration: 0.2 });
      };

      const showCenterPopup = (text: string, color: string) => {
        return new Promise<void>((resolve) => {
          centerText.text = text; centerText.style.fill = color;
          gsap.fromTo(centerText.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.5)" });
          gsap.fromTo(centerText, { alpha: 0 }, { alpha: 1, duration: 0.2 });
          gsap.to(centerText, { alpha: 0, y: centerText.y - 50, duration: 0.4, delay: 1.5, onComplete: () => {
            centerText.y = CANVAS_HEIGHT / 2; resolve();
          }});
        });
      };

      const animateCollection = async (containers: PIXI.Container[][], luggageValues: any[]) => {
        return new Promise<void>((resolve) => {
          const tl = gsap.timeline({ onComplete: resolve });
          const mcpepes: PIXI.Container[] = [];
          const luggages: PIXI.Container[] = [];

          for (let c = 0; c < 5; c++) {
            for (let r = 0; r < 3; r++) {
              if (playData.freeSpinsData?.spins) { 
                  const sym = containers[c][r].children[0] as PIXI.Sprite;
                  if (sym.texture === PIXI.Texture.from(SYMBOL_MAP[10])) mcpepes.push(containers[c][r]);
                  if (sym.texture === PIXI.Texture.from(SYMBOL_MAP[6])) luggages.push(containers[c][r]);
              }
            }
          }

          if (mcpepes.length > 0 && luggages.length > 0) {
            mcpepes.forEach(pepe => tl.to(pepe.scale, { x: 1.3, y: 1.3, duration: 0.3, yoyo: true, repeat: 1 }, 0));
            luggages.forEach(lug => {
              tl.to(lug, { x: CANVAS_WIDTH/2, y: CANVAS_HEIGHT/2, alpha: 0, duration: 0.5, ease: "power2.in" }, 0.2);
            });
          } else {
             resolve();
          }
        });
      };

      const playSequence = async () => {
        let baseContainers = await animateReels(playData.initialGrid);

        if (playData.nearMissData?.nudgeTriggered) {
          await new Promise(r => setTimeout(r, 800));
          await showCenterPopup("NUDGE!", '#38bdf8');
          baseContainers = await animateReels(playData.baseGrid, [], true, -1);
        } else if (playData.nearMissData?.hookTriggered) {
          await new Promise(r => setTimeout(r, 800));
          await showCenterPopup("HOOKED!", '#f87171');
          baseContainers = await animateReels(playData.baseGrid, [], false, playData.nearMissData.hookCol);
        }
        
        if (playData.baseWinningLines?.length > 0) {
          await displayWinningLines(baseContainers, playData.baseWinningLines);
        }
        
        if (playData.payout > 0 && !playData.triggeredBonus) {
           await showCenterPopup(`TOTAL WIN: ${(playData.payout / 1e9).toFixed(4)} SOL`, '#facc15');
        }

        if (playData.triggeredBonus && playData.freeSpinsData) {
          await showCenterPopup("FREE SPINS!", '#c084fc');
          gsap.to(hudContainer, { alpha: 1, duration: 0.5 }); 
          
          const fsData = playData.freeSpinsData;
          
          for (let i = 0; i < fsData.spins.length; i++) {
            if (!isMounted) break;
            const spin = fsData.spins[i];
            
            updateHUD(spin.totalCollectedSoFar, spin.activeMultiplier);
            const fsContainers = await animateReels(spin.grid, spin.luggageValues);
            
            if (spin.winningLines?.length > 0) {
              await displayWinningLines(fsContainers, spin.winningLines);
            }

            if (spin.mcpepeCount > 0 && spin.collectionWin > 0) {
              await animateCollection(fsContainers, spin.luggageValues);
              await showCenterPopup(`MCPEPE CATCHES: ${(spin.collectionWin / 1e9).toFixed(4)} SOL`, '#4ade80');
            }

            await new Promise(r => setTimeout(r, 600)); 
          }

          gsap.to(hudContainer, { alpha: 0, duration: 0.5 }); 
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