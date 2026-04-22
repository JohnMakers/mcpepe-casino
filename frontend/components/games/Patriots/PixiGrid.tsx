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

// 🔒 STRICTLY PRESERVED COORDINATES
const TILE_POSITIONS = [
  [ { x: 20, y: 23 }, { x: 20, y: 121 }, { x: 20, y: 216.8 }, { x: 20, y: 311.5 }, { x: 20, y: 408 } ],
  [ { x: 115, y: 23 }, { x: 115, y: 121 }, { x: 115, y: 216.8 }, { x: 115, y: 311.5 }, { x: 115, y: 408 } ],
  [ { x: 211.5, y: 23 }, { x: 211.5, y: 121 }, { x: 211.5, y: 216.8 }, { x: 211.5, y: 311.5 }, { x: 211.5, y: 408 } ],
  [ { x: 308, y: 23 }, { x: 308, y: 121 }, { x: 308, y: 216.8 }, { x: 308, y: 311.5 }, { x: 308, y: 408 } ],
  [ { x: 403, y: 23 }, { x: 403, y: 121 }, { x: 403, y: 216.8 }, { x: 403, y: 311.5 }, { x: 403, y: 408 } ],
  [ { x: 500, y: 23 }, { x: 500, y: 121 }, { x: 500, y: 216.8 }, { x: 500, y: 311.5 }, { x: 500, y: 408 } ],
];

const COLS = 6;
const ROWS = 5;

export default function PixiGrid({ playData, onAnimationComplete }: PixiGridProps) {
  const pixiContainer = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const symbolsRef = useRef<any[][]>([]); 
  const currentBombMults = useRef<number[]>([]); 

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

      await PIXI.Assets.load([...Object.values(SYMBOL_MAP), '/patriots/patriots_cook.png']);

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

      if (pixiContainer.current) {
        pixiContainer.current.appendChild(app.canvas);
      }
      
      appRef.current = app;

      const mainContainer = new PIXI.Container();
      mainContainer.x = GRID_OFFSET_X;
      mainContainer.y = GRID_OFFSET_Y;
      app.stage.addChild(mainContainer);

      const mask = new PIXI.Graphics()
        .rect(-50, -40, CANVAS_WIDTH, CANVAS_HEIGHT + 40) 
        .fill(0xffffff);
      mainContainer.addChild(mask);
      mainContainer.mask = mask; 

      symbolsRef.current = Array.from({ length: COLS }, () => []);

      const trackerText = new PIXI.Text({
        text: "",
        style: {
          fontSize: 20,
          fontWeight: '900',
          fill: '#ffffff',
          stroke: { color: '#000000', width: 4 },
          dropShadow: { color: '#000000', blur: 4, distance: 2 }
        }
      });
      trackerText.anchor.set(1, 0); 
      trackerText.x = CANVAS_WIDTH - 20;
      trackerText.y = 15;
      app.stage.addChild(trackerText);

      const spinWinText = new PIXI.Text({
        text: "",
        style: {
          fontSize: 45,
          fontWeight: '900',
          fill: '#facc15', 
          stroke: { color: '#000000', width: 7 },
          dropShadow: { color: '#000000', blur: 8, distance: 4 }
        }
      });
      spinWinText.anchor.set(0.5);
      spinWinText.x = CANVAS_WIDTH / 2;
      spinWinText.y = CANVAS_HEIGHT - 60;
      spinWinText.alpha = 0;
      app.stage.addChild(spinWinText);

      const clearBoard = () => {
        return new Promise<void>((resolve) => {
          let activeAnimations = 0;
          for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS; r++) {
              const symbolContainer = symbolsRef.current[c][r];
              if (symbolContainer) {
                activeAnimations++;
                gsap.to(symbolContainer, {
                  y: symbolContainer.y + 500,
                  alpha: 0,
                  duration: 0.6, 
                  ease: "power2.in",
                  onComplete: () => {
                    mainContainer.removeChild(symbolContainer);
                    symbolContainer.destroy({ children: true });
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

      const showPopupText = (textStr: string, subTextStr?: string) => {
        return new Promise<void>((resolve) => {
          const popupContainer = new PIXI.Container();

          const mainText = new PIXI.Text({
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
          mainText.anchor.set(0.5);
          popupContainer.addChild(mainText);

          if (subTextStr) {
            const subText = new PIXI.Text({
              text: subTextStr,
              style: {
                fontSize: 60,
                fontWeight: '900',
                fill: '#4ade80',
                align: 'center',
                stroke: { color: '#000000', width: 6 },
                dropShadow: { color: '#000000', blur: 10, distance: 4 }
              }
            } as any);
            subText.anchor.set(0.5);
            subText.y = 80; 
            popupContainer.addChild(subText);
          }

          popupContainer.x = CANVAS_WIDTH / 2;
          popupContainer.y = CANVAS_HEIGHT / 2;
          popupContainer.scale.set(0);
          popupContainer.alpha = 0;
          
          app.stage.addChild(popupContainer);

          const tl = gsap.timeline({ onComplete: () => {
              app.stage.removeChild(popupContainer);
              popupContainer.destroy({ children: true });
              resolve();
          }});

          tl.to(popupContainer.scale, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.5)" })
            .to(popupContainer, { alpha: 1, duration: 0.2 }, "<")
            .to(popupContainer, { alpha: 0, y: popupContainer.y - 80, duration: 0.4, ease: "power2.in" }, "+=2.0");
        });
      };

      const showBonusModal = () => {
        return new Promise<void>((resolve) => {
          const modal = new PIXI.Container();
          
          const overlay = new PIXI.Graphics()
            .rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
            .fill({ color: 0x000000, alpha: 0.85 });
          overlay.eventMode = 'static'; 
          modal.addChild(overlay);

          const img = PIXI.Sprite.from('/patriots/patriots_cook.png');
          img.anchor.set(0.5);
          img.x = CANVAS_WIDTH / 2;
          img.y = CANVAS_HEIGHT / 2 - 20;
          img.width = 450;
          img.scale.y = img.scale.x; 
          modal.addChild(img);

          const btnContainer = new PIXI.Container();
          btnContainer.x = CANVAS_WIDTH / 2;
          btnContainer.y = CANVAS_HEIGHT / 2 + 180;
          
          const btnBg = new PIXI.Graphics().roundRect(-100, -25, 200, 50, 10).fill(0x16a34a);
          const btnText = new PIXI.Text({
            text: "CONTINUE",
            style: { fontSize: 22, fontWeight: '900', fill: '#ffffff' }
          });
          btnText.anchor.set(0.5);
          
          btnContainer.addChild(btnBg, btnText);
          btnContainer.eventMode = 'static';
          btnContainer.cursor = 'pointer';
          
          btnContainer.on('pointerdown', () => {
            gsap.to(modal, {
              alpha: 0, duration: 0.3,
              onComplete: () => {
                app.stage.removeChild(modal);
                modal.destroy({ children: true });
                resolve();
              }
            });
          });
          
          btnContainer.on('pointerover', () => { btnBg.tint = 0x22c55e; });
          btnContainer.on('pointerout', () => { btnBg.tint = 0xffffff; });

          modal.addChild(btnContainer);
          modal.alpha = 0;
          app.stage.addChild(modal);
          gsap.to(modal, { alpha: 1, duration: 0.4 });
        });
      };

      const playSpinFrames = async (frames: any[]) => {
        let currentSpinWin = 0;
        spinWinText.alpha = 0; 
        spinWinText.text = "";

        for (let f = 0; f < frames.length; f++) {
          if (!isMounted) break;
          const frame = frames[f];
          const isFirstFrame = f === 0;

          await renderGridFrame(app, mainContainer, frame.grid, isFirstFrame);

          if (frame.winningSymbols && frame.winningSymbols.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 800)); 
            if (!isMounted) break;
            
            const framePayout = frame.tumblePayout || 0;
            await explodeWinningSymbols(frame.winningSymbols, frame.grid, framePayout);

            // ✨ CRITICAL FRONTEND BUG FIX: Simulate gravity locally on the frontend 
            // reference array so existing containers (like bombs) drop smoothly 
            // instead of being destroyed and recreated on the next render.
            for (let c = 0; c < COLS; c++) {
              let newCol = [];
              for (let r = 0; r < ROWS; r++) {
                if (symbolsRef.current[c][r] !== null) {
                  newCol.push(symbolsRef.current[c][r]);
                }
              }
              while (newCol.length < ROWS) {
                newCol.unshift(null);
              }
              symbolsRef.current[c] = newCol;
            }

            if (framePayout > 0) {
              currentSpinWin += framePayout;
              spinWinText.text = `WIN: ${(currentSpinWin / 1e9).toFixed(4)}`;
              
              if (spinWinText.alpha === 0) {
                gsap.to(spinWinText, { alpha: 1, duration: 0.2 });
              }
              gsap.fromTo(spinWinText.scale, { x: 1.4, y: 1.4 }, { x: 1, y: 1, duration: 0.4, ease: "back.out(2)" });
            }

          } else {
            await new Promise(resolve => setTimeout(resolve, 600)); 
          }
        }

        if (currentSpinWin > 0) {
           await new Promise(resolve => setTimeout(resolve, 800));
           gsap.to(spinWinText, { alpha: 0, duration: 0.4 });
        }
      };

      const playSequence = async () => {
        currentBombMults.current = []; 
        await playSpinFrames(playData.baseSpinFrames);

        if (playData.triggeredBonus && isMounted) {
          
          await showBonusModal();
          
          const freeSpins = playData.freeSpinsData || [];
          let runningBonusTotal = 0;

          for (let i = 0; i < freeSpins.length; i++) {
            if (!isMounted) break;
            
            trackerText.text = `SPINS: ${freeSpins.length - i}  |  TOTAL: ${(runningBonusTotal / 1e9).toFixed(4)} SOL`;
            
            await clearBoard(); 
            
            const fsSpin = freeSpins[i];
            currentBombMults.current = [...(fsSpin.bombMultipliers || [])];
            
            await playSpinFrames(fsSpin.frames);
            
            if (fsSpin.bombMultipliers && fsSpin.bombMultipliers.length > 0 && fsSpin.totalSpinPayout > 0) {
              const multiString = fsSpin.bombMultipliers.map((m: number) => `${m}x`).join(" + ");
              await showPopupText(`BOMBS: ${multiString}\nTOTAL MULT: ${fsSpin.finalSpinMultiplier}x!`);

              spinWinText.text = `WIN: ${(fsSpin.totalSpinPayout / 1e9).toFixed(4)}`;
              spinWinText.style.fill = '#4ade80';
              spinWinText.alpha = 1;
              gsap.fromTo(spinWinText.scale, { x: 1.8, y: 1.8 }, { x: 1, y: 1, duration: 0.6, ease: "elastic.out(1, 0.3)" });
              
              await new Promise(resolve => setTimeout(resolve, 1200));
              spinWinText.style.fill = '#facc15'; 
              gsap.to(spinWinText, { alpha: 0, duration: 0.4 });
            }

            runningBonusTotal += (fsSpin.totalSpinPayout || 0);
            trackerText.text = `SPINS: ${freeSpins.length - i - 1}  |  TOTAL: ${(runningBonusTotal / 1e9).toFixed(4)} SOL`;
            
            await new Promise(resolve => setTimeout(resolve, 800));
          }
          
          if (isMounted) {
            trackerText.text = ""; 
            await showPopupText("BONUS COMPLETE!", `+${(runningBonusTotal / 1e9).toFixed(4)} SOL`);
          }
        }

        if (isMounted) onAnimationComplete();
      };

      playSequence();
    };

    initPixi();

    return () => {
      isMounted = false;
      gsap.globalTimeline.clear(); // Ensure animations don't leak into the background
      try {
        // 🔥 FIX 3: Removed `texture: true` so PIXI doesn't throw the Assets warning
        app.destroy(true, { children: true }); 
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

          let currentSymbolContainer = symbolsRef.current[c][r];

          if (!currentSymbolContainer || currentSymbolContainer.symbolType !== targetSymbolType) {
            if (currentSymbolContainer) {
               container.removeChild(currentSymbolContainer);
               currentSymbolContainer.destroy({ children: true });
            }

            const symbolContainer = new PIXI.Container();
            symbolContainer.x = xPos;
            symbolContainer.y = dropFromTop ? yPos - 800 : yPos - 300; 
            symbolContainer.alpha = dropFromTop ? 0 : 1;
            (symbolContainer as any).symbolType = targetSymbolType;

            const sprite = PIXI.Sprite.from(SYMBOL_MAP[targetSymbolType]);
            sprite.width = SYMBOL_SIZE;
            sprite.height = SYMBOL_SIZE;
            sprite.anchor.set(0.5);
            symbolContainer.addChild(sprite);

            if (targetSymbolType === 7) {
                gsap.to(sprite, {
                    rotation: 0.15,
                    duration: 0.08,
                    yoyo: true,
                    repeat: -1,
                    ease: "sine.inOut"
                });
            }

            if (targetSymbolType === 8) {
                const multValue = currentBombMults.current.shift() || 2; 
                
                const multText = new PIXI.Text({
                    text: `${multValue}X`,
                    style: {
                        fontSize: 28,
                        fontWeight: '900',
                        fill: '#facc15', 
                        stroke: { color: '#000000', width: 6 },
                        dropShadow: { color: '#000000', blur: 4, distance: 2 }
                    }
                });
                multText.anchor.set(0.5);
                
                multText.y = 22; 
                
                symbolContainer.addChild(multText);
                
                gsap.to(multText.scale, { 
                  x: 1.15, y: 1.15, 
                  duration: 0.5, 
                  yoyo: true, 
                  repeat: -1, 
                  ease: "sine.inOut" 
                });
            }

            container.addChild(symbolContainer);
            symbolsRef.current[c][r] = symbolContainer;

            tl.to(symbolContainer, {
              y: yPos,
              alpha: 1,
              duration: 0.75, 
              ease: "bounce.out",
              delay: dropFromTop ? (c * 0.08) + (r * 0.035) : 0 
            }, 0);
          } else {
            tl.to(currentSymbolContainer, { 
              y: yPos, 
              duration: 0.6, 
              ease: "power2.out" 
            }, 0); 
          }
        }
      }
    });
  };

  const explodeWinningSymbols = (winningTypes: number[], currentGrid: number[][], framePayout: number) => {
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: () => resolve() });

      let minX = 9999, minY = 9999, maxX = -9999, maxY = -9999;
      let foundWin = false;

      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const symType = currentGrid[c][r];
          if (winningTypes.includes(symType)) {
            const symbolContainer = symbolsRef.current[c][r];
            if (symbolContainer) {
              
              const globalX = symbolContainer.x + GRID_OFFSET_X;
              const globalY = symbolContainer.y + GRID_OFFSET_Y;
              if (globalX < minX) minX = globalX;
              if (globalX > maxX) maxX = globalX;
              if (globalY < minY) minY = globalY;
              if (globalY > maxY) maxY = globalY;
              foundWin = true;

              const randomTwist = (Math.random() - 0.5) * 0.5; 
              
              tl.to(symbolContainer.scale, { 
                x: 1.4, 
                y: 1.4, 
                duration: 0.35, 
                ease: "power2.out" 
              }, 0);

              tl.to(symbolContainer, { 
                rotation: randomTwist,
                duration: 0.35, 
                ease: "power2.out" 
              }, 0);
              
              tl.to(symbolContainer, { 
                alpha: 0, 
                y: symbolContainer.y - 30, 
                duration: 0.35, 
                ease: "power2.in" 
              }, 0.2);
              
              // We set this to null, which is later utilized by the gravity fix 
              // to shift the array references downward perfectly.
              symbolsRef.current[c][r] = null; 
            }
          }
        }
      }

      if (foundWin && framePayout > 0) {
        const floatText = new PIXI.Text({
          text: `+${(framePayout / 1e9).toFixed(4)} SOL`,
          style: {
            fontSize: 48, 
            fontWeight: '900',
            fill: '#4ade80', 
            stroke: { color: '#000000', width: 6 },
            dropShadow: { color: '#000000', blur: 8, distance: 4 }
          }
        });
        
        floatText.anchor.set(0.5);
        floatText.x = (minX + maxX) / 2;
        floatText.y = (minY + maxY) / 2; 
        floatText.alpha = 0;
        floatText.scale.set(0.5); 
        
        if (appRef.current) {
          appRef.current.stage.addChild(floatText);
        }
        
        tl.to(floatText.scale, { x: 1, y: 1, duration: 0.4, ease: "back.out(2)" }, 0.45);
        tl.to(floatText, { alpha: 1, duration: 0.2 }, 0.45);
        tl.to(floatText, { y: floatText.y - 60, duration: 0.8, ease: "power1.out" }, 0.6);
        tl.to(floatText, { alpha: 0, duration: 0.4, onComplete: () => floatText.destroy() }, 1.0);
      }
    });
  };

  return (
    <div className="relative w-full h-full">
      <div ref={pixiContainer} className="absolute inset-0 overflow-hidden rounded-xl" />
    </div>
  );
}