import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiReelsProps {
  playData: any | null;
  onAnimationComplete: () => void;
  // NEW: Callback to trigger the React modal and wait for resolution
  onShowBonusModal: (spins: number, resume: () => void) => void;
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
const SYMBOL_SIZE = 110;

const SHOW_DEBUG_GRID = false; 
const DROP_START_Y = 130; 

const TILE_POSITIONS = [
  [ { x: 270, y: 210 }, { x: 270, y: 340 }, { x: 270, y: 480 } ], 
  [ { x: 382, y: 210 }, { x: 382, y: 340 }, { x: 382, y: 480 } ], 
  [ { x: 494, y: 210 }, { x: 494, y: 340 }, { x: 494, y: 480 } ], 
  [ { x: 606, y: 210 }, { x: 606, y: 340 }, { x: 606, y: 480 } ], 
  [ { x: 717, y: 210 }, { x: 717, y: 340 }, { x: 717, y: 480 } ]  
];

export default function PixiReels({ playData, onAnimationComplete, onShowBonusModal }: PixiReelsProps) {
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

      if (!playData) return;

      const centerText = new PIXI.Text({ text: "", style: { fontSize: 60, fontWeight: '900', fill: '#c084fc', stroke: { color: '#000000', width: 8 } }});
      centerText.anchor.set(0.5); centerText.x = CANVAS_WIDTH / 2; centerText.y = CANVAS_HEIGHT / 2; centerText.alpha = 0;
      app.stage.addChild(centerText);

      const winInfoText = new PIXI.Text({ 
        text: "", style: { fontSize: 22, fontWeight: '900', fill: '#4ade80', stroke: { color: '#000000', width: 5 }, dropShadow: { color: '#000000', blur: 4, distance: 2 } }
      });
      winInfoText.anchor.set(0.5, 1); winInfoText.x = CANVAS_WIDTH / 2; winInfoText.y = CANVAS_HEIGHT - 10; winInfoText.alpha = 0;
      app.stage.addChild(winInfoText);

      const hudContainer = new PIXI.Container();
      hudContainer.y = 12;
      hudContainer.x = CANVAS_WIDTH / 2 - 325; 
      hudContainer.alpha = 0; 
      app.stage.addChild(hudContainer);

      const hudBg = new PIXI.Graphics().roundRect(0, 0, 650, 95, 12).fill({ color: 0x050806, alpha: 0.95 });
      hudBg.stroke({ color: 0x4ade80, width: 2, alpha: 0.5 });
      hudContainer.addChild(hudBg);

      const hudTitle = new PIXI.Text({ text: "MCPEPE PROGRESSION", style: { fontSize: 14, fontWeight: '900', fill: '#9ca3af', letterSpacing: 2 }});
      hudTitle.x = 20; hudTitle.y = 8;
      hudContainer.addChild(hudTitle);

      const multInfo = new PIXI.Text({ text: "CURRENT: 1X", style: { fontSize: 20, fontWeight: '900', fill: '#facc15', dropShadow: { color: '#000', blur: 2, distance: 2 } }});
      multInfo.x = 480; multInfo.y = 5;
      hudContainer.addChild(multInfo);

      const ticksContainers: PIXI.Container[] = [];
      const TICK_WIDTH = 42;
      const TICK_HEIGHT = 42;
      const TICK_SPACING = 50;
      const START_X = 25;

      for (let i = 0; i < 12; i++) {
        const tickCont = new PIXI.Container();
        tickCont.x = START_X + (i * TICK_SPACING);
        tickCont.y = 30;
        hudContainer.addChild(tickCont);
        ticksContainers.push(tickCont);

        const emptyBg = new PIXI.Graphics().roundRect(0, 0, TICK_WIDTH, TICK_HEIGHT, 6).fill(0x1f2937);
        tickCont.addChild(emptyBg);

        const filledCont = new PIXI.Container();
        filledCont.alpha = 0; 
        tickCont.addChild(filledCont);

        try {
          const pepe = PIXI.Sprite.from('/vacations/vacation_mcpepe.png');
          pepe.width = TICK_WIDTH;
          pepe.height = TICK_HEIGHT;
          filledCont.addChild(pepe);
        } catch (e) {
          const fallback = new PIXI.Graphics().roundRect(0, 0, TICK_WIDTH, TICK_HEIGHT, 6).fill(0x4ade80);
          filledCont.addChild(fallback);
        }

        let bracketMult = "1X";
        if (i >= 4 && i < 8) bracketMult = "2X";
        if (i >= 8 && i < 12) bracketMult = "3X";

        const mText = new PIXI.Text({ text: bracketMult, style: { fontSize: 14, fill: '#facc15', fontWeight: '900', stroke: {color: '#000000', width: 4} }});
        mText.anchor.set(0.5);
        mText.x = TICK_WIDTH / 2;
        mText.y = TICK_HEIGHT - 6; 
        filledCont.addChild(mText);

        if (i === 3) { 
          const lbl = new PIXI.Text({ text: "2X", style: { fontSize: 13, fill: '#fff', fontWeight: 'bold' }});
          lbl.x = tickCont.x + 10; lbl.y = 75;
          hudContainer.addChild(lbl);
        }
        if (i === 7) { 
          const lbl = new PIXI.Text({ text: "3X", style: { fontSize: 13, fill: '#fff', fontWeight: 'bold' }});
          lbl.x = tickCont.x + 10; lbl.y = 75;
          hudContainer.addChild(lbl);
        }
        if (i === 11) { 
          const lbl = new PIXI.Text({ text: "10X", style: { fontSize: 15, fill: '#facc15', fontWeight: '900' }});
          lbl.x = tickCont.x + 4; lbl.y = 74;
          hudContainer.addChild(lbl);
        }
      }

      const updateHUD = (collected: number, multiplier: number) => {
        multInfo.text = `CURRENT: ${multiplier}X`;
        for (let i = 0; i < 12; i++) {
          const filledCont = ticksContainers[i].children[1] as PIXI.Container;
          if (i < collected) {
            filledCont.alpha = 1;
            gsap.fromTo(filledCont.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.3, ease: "back.out(2)" });
          } else {
            filledCont.alpha = 0;
          }
        }
      };

      const animateReels = async (targetGrid: number[][], luggageValues: any[] = [], isNudge = false, hookCol = -1): Promise<PIXI.Container[][]> => {
        return new Promise((resolve) => {
          const activeContainers: PIXI.Container[][] = Array.from({ length: 5 }, () => []);
          const tl = gsap.timeline({ onComplete: () => resolve(activeContainers) });
          
          while(mainContainer.children.length > 2) {
             mainContainer.removeChildAt(mainContainer.children.length - 1);
          }

          for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 3; row++) {
              const symType = targetGrid[col][row];
              const container = new PIXI.Container();
              const targetPos = TILE_POSITIONS[col][row];
              
              container.x = targetPos.x;

              if (isNudge) {
                container.y = targetPos.y - 140; 
              } else if (col === hookCol) {
                container.y = targetPos.y + 500; 
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
                tl.to(container, { y: targetPos.y - 20, duration: 0.5, ease: "power2.out", delay: row * 0.05 }, 0);
                tl.to(container, { y: targetPos.y, duration: 0.2, ease: "bounce.out" }, ">");
              } else {
                tl.to(container, { y: targetPos.y + 20, duration: 0.4, ease: "power2.in", delay: col * 0.15 + (row * 0.02) }, 0);
                tl.to(container, { y: targetPos.y, duration: 0.15, ease: "back.out(2)" }, `>${col * 0.15}`); 
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

        // ==========================================
        // 🚨 TRIGGER THE REACT MODAL HERE
        // ==========================================
        if (playData.triggeredBonus && playData.freeSpinsData) {
          
          // Wait for the user to click "Continue" on the React Modal
          await new Promise<void>((resolve) => {
             onShowBonusModal(playData.freeSpinsData.spins.length, resolve);
          });

          // Once resolved, proceed with the UI fade in and spin loops
          gsap.to(hudContainer, { alpha: 1, duration: 0.5 }); 
          
          const fsData = playData.freeSpinsData;
          let runningMcpepeTotal = 0;
          
          for (let i = 0; i < fsData.spins.length; i++) {
            if (!isMounted) break;
            const spin = fsData.spins[i];
            
            runningMcpepeTotal = spin.totalCollectedSoFar - spin.mcpepeCount;
            updateHUD(runningMcpepeTotal, spin.activeMultiplier);

            const fsContainers = await animateReels(spin.grid, spin.luggageValues);
            
            if (spin.winningLines?.length > 0) {
              await displayWinningLines(fsContainers, spin.winningLines);
            }

            if (spin.mcpepeCount > 0) {
              runningMcpepeTotal += spin.mcpepeCount;
              updateHUD(runningMcpepeTotal, spin.activeMultiplier);
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