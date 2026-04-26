import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

// ==========================================
// ⚙️ UI CONFIGURATION & DEBUG MODE ⚙️
// ==========================================
const DEBUG_MODE = false; 

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 700;
const SYMBOL_SIZE = 137;

// The Mask defines the visual "window" of the slot.
const MASK_TOP = 130; 
const MASK_BOTTOM = CANVAS_HEIGHT - 100;

// 🎯 THE PRECISION COORDINATE GRID
const TILE_POSITIONS = [
    // ROW 0 (Top Row)
    [ { x: 325.4, y: 211 },  { x: 500.3, y: 211 },  { x: 676.3, y: 211 } ],
    // ROW 1 (Middle Row)
    [ { x: 325.4, y: 367 },  { x: 500.3, y: 367 },  { x: 676.3, y: 367 } ],
    // ROW 2 (Bottom Row)
    [ { x: 325.4, y: 522 },  { x: 500.3, y: 522 },  { x: 676.3, y: 522 } ]
];

// The exact Y pixel coordinate where symbols spawn before dropping
const SPAWN_Y = MASK_TOP - SYMBOL_SIZE; 

// ==========================================

const PAYLINES = [
    [[1,0], [1,1], [1,2]], // Line 1: Middle Horizontal
    [[0,0], [0,1], [0,2]], // Line 2: Top Horizontal
    [[2,0], [2,1], [2,2]], // Line 3: Bottom Horizontal
    [[0,0], [1,1], [2,2]], // Line 4: Diagonal Down
    [[2,0], [1,1], [0,2]]  // Line 5: Diagonal Up
];

const SYMBOL_MAP: Record<number, string> = {
  0: '/snowstorm/snowstorm_mcpepe.png',       
  1: '/snowstorm/snowstorm_snowman.png',      
  2: '/snowstorm/snowstorm_polar.png',     
  3: '/snowstorm/snowstorm_snowmobile.png',   
  4: '/snowstorm/snowstorm_ski.png',      
  5: '/snowstorm/snowstorm_boots.png',     
  6: '/snowstorm/snowstorm_gloves.png',    
  7: '/snowstorm/snowstorm_cocoamug.png',       
  8: '/snowstorm/snowstorm_snowflake.png'
};

interface PixiGridProps {
  playData: any;
  onAnimationComplete: () => void;
}

export default function PixiGrid({ playData, onAnimationComplete }: PixiGridProps) {
  const pixiContainer = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const gridContainerRef = useRef<PIXI.Container | null>(null);

  // 1. INITIALIZE PIXI ONCE
  useEffect(() => {
    if (!pixiContainer.current) return;
    let isCancelled = false;

    const initPixi = async () => {
      const app = new PIXI.Application();
      await app.init({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (isCancelled) {
        app.destroy(true, true);
        return;
      }

      appRef.current = app;
      if (pixiContainer.current) {
        pixiContainer.current.innerHTML = ''; 
        pixiContainer.current.appendChild(app.canvas);
      }

      // Background
      await PIXI.Assets.load('/snowstorm/snowstorm_bg.png');
      const bg = PIXI.Sprite.from('/snowstorm/snowstorm_bg.png');
      bg.width = CANVAS_WIDTH;
      bg.height = CANVAS_HEIGHT;
      app.stage.addChild(bg);

      // Container for the spinning reels
      const gridContainer = new PIXI.Container();
      app.stage.addChild(gridContainer);
      gridContainerRef.current = gridContainer;
      
      // 🛠️ MASK LOGIC
      const gridMask = new PIXI.Graphics();
      gridMask.rect(0, MASK_TOP, CANVAS_WIDTH, MASK_BOTTOM - MASK_TOP);
      gridMask.fill(0xffffff);
      app.stage.addChild(gridMask);
      gridContainer.mask = gridMask;

      if (DEBUG_MODE) {
          const debugGraphics = new PIXI.Graphics();
          debugGraphics.moveTo(0, SPAWN_Y);
          debugGraphics.lineTo(CANVAS_WIDTH, SPAWN_Y);
          debugGraphics.stroke({ color: 0xffff00, width: 2, alpha: 0.8 });

          debugGraphics.rect(0, MASK_TOP, CANVAS_WIDTH, MASK_BOTTOM - MASK_TOP);
          debugGraphics.stroke({ color: 0x00ff00, width: 4 }); 
          
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
               const pos = TILE_POSITIONS[r][c];
               debugGraphics.circle(pos.x, pos.y, 6).fill(0xff0000); 
               debugGraphics.rect(pos.x - SYMBOL_SIZE/2, pos.y - SYMBOL_SIZE/2, SYMBOL_SIZE, SYMBOL_SIZE).stroke({ color: 0xff00ff, width: 2, alpha: 0.6 });
            }
          }
          app.stage.addChild(debugGraphics);
      }

      await PIXI.Assets.load(Object.values(SYMBOL_MAP));
    };

    initPixi();

    return () => {
      isCancelled = true;
      if (appRef.current) {
        appRef.current.destroy(true, true);
        appRef.current = null;
      }
    };
  }, []); 

  // 2. TRIGGER SPIN ANIMATIONS
  useEffect(() => {
    // Determine the starting grid. Fallback to matrix if initialMatrix doesn't exist to prevent crashes.
    const startingGrid = playData?.initialMatrix || playData?.matrix;
    if (!playData || !startingGrid || !appRef.current || !gridContainerRef.current) return;

    const app = appRef.current;
    const container = gridContainerRef.current;
    
    // Clear previous spin results
    container.removeChildren();

    // Track sprites to pulse them later on a win
    const spriteMatrix: PIXI.Sprite[][] = [[], [], []];

    // Master Timeline for sequential animation mapping
    const masterTl = gsap.timeline({
      onComplete: () => {
        
        // 🏆 WINNING LINE PULSE EFFECT (Runs after all spins/respins finish)
        if (playData.winningLines && playData.winningLines.length > 0) {
          playData.winningLines.forEach((win: any) => {
            const lineCoords = PAYLINES[win.lineIndex];
            if (lineCoords) {
              lineCoords.forEach(coord => {
                const r = coord[0];
                const c = coord[1];
                const sprite = spriteMatrix[r][c];
                if (sprite) {
                  container.addChild(sprite); // bring to front
                  gsap.to(sprite.scale, { 
                    x: 0.4, 
                    y: 0.4, 
                    duration: 1.2, 
                    yoyo: true, 
                    repeat: -1, 
                    ease: "sine.inOut" });
                 }
              });
            }
          });
        }

        // ❄️ BLIZZARD MULTIPLIER TEXT
        if (playData.multiplier > 1) {
            const multText = new PIXI.Text({
                text: `BLIZZARD MULTIPLIER: ${playData.multiplier}X!`,
                style: {
                    fontFamily: 'Arial', 
                    fontSize: 54, 
                    fontWeight: '900',
                    fill: '#00ffff', 
                    stroke: { color: '#ffffff', width: 6 }, 
                    dropShadow: { color: '#000000', blur: 6, distance: 4, alpha: 0.9 }
                }
            });
            multText.anchor.set(0.5);
            multText.x = CANVAS_WIDTH / 2;
            multText.y = CANVAS_HEIGHT / 2;
            multText.scale.set(0.1);
            app.stage.addChild(multText);

            gsap.to(multText.scale, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.7)" });
            gsap.to(multText, { 
                alpha: 0, 
                duration: 0.5, 
                delay: 2.5,
                onComplete: () => app.stage.removeChild(multText)
            });
        }
        
        // Finalize state after visual effects deploy
        setTimeout(() => onAnimationComplete(), 1200);
      }
    });

    // --- PHASE 1: INITIAL DROP ---
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const symbolId = startingGrid[r][c];
        const sprite = PIXI.Sprite.from(SYMBOL_MAP[symbolId]);
        const targetPos = TILE_POSITIONS[r][c];
        
        sprite.anchor.set(0.5);
        sprite.width = SYMBOL_SIZE;
        sprite.height = SYMBOL_SIZE;
        
        // Spawn precisely at the exact X coordinate, but at the SPAWN_Y height
        sprite.x = targetPos.x;
        sprite.y = SPAWN_Y; 

        container.addChild(sprite);
        spriteMatrix[r][c] = sprite;

        // Force all to start dropping at exactly time '0' on the timeline
        masterTl.to(sprite, {
          y: targetPos.y,
          duration: 0.4 + (c * 0.2), 
          ease: "bounce.out",
        }, 0);
      }
    }

    // --- PHASE 2: RESPIN LOGIC ---
    if (playData.respinData) {
      const spinCol = playData.respinData.spin;
      
      // Delay before respin triggers, giving player a moment to see the "near miss"
      const respinStartTime = 1.2; 

      // Visual Cue: Dim the held reels slightly while waiting (adds good tension)
      playData.respinData.held.forEach((heldCol: number) => {
          for(let r=0; r<3; r++) {
             masterTl.to(spriteMatrix[r][heldCol], { alpha: 0.8, duration: 0.2 }, respinStartTime);
             masterTl.to(spriteMatrix[r][heldCol], { alpha: 1, duration: 0.2 }, respinStartTime + 1.0);
          }
      });

      // Animate the old column OUT (drop them past the mask)
      for (let r = 0; r < 3; r++) {
        const oldSprite = spriteMatrix[r][spinCol];
        masterTl.to(oldSprite, {
          y: MASK_BOTTOM + SYMBOL_SIZE * 2, // Drop well below the mask
          duration: 0.3 + (r * 0.1),
          ease: "power2.in",
          onComplete: () => container.removeChild(oldSprite) // clean up memory
        }, respinStartTime);
      }

      // Animate the NEW column IN
      for (let r = 0; r < 3; r++) {
        const symbolId = playData.matrix[r][spinCol]; // NOW we use the final matrix
        const newSprite = PIXI.Sprite.from(SYMBOL_MAP[symbolId]);
        const targetPos = TILE_POSITIONS[r][spinCol];

        newSprite.anchor.set(0.5);
        newSprite.width = SYMBOL_SIZE;
        newSprite.height = SYMBOL_SIZE;
        newSprite.x = targetPos.x;
        newSprite.y = SPAWN_Y; // Spawning them back at the top

        container.addChild(newSprite);
        spriteMatrix[r][spinCol] = newSprite; // Overwrite the matrix reference

        // Drop them in slightly after the old ones fall out
        masterTl.to(newSprite, {
          y: targetPos.y,
          duration: 0.4 + (r * 0.1),
          ease: "bounce.out"
        }, respinStartTime + 0.4); 
      }
    }

    return () => {
       // Protect from memory leaks if the user closes the modal mid-spin
       masterTl.kill(); 
    };
  }, [playData]); 

  return (
    <div 
      ref={pixiContainer} 
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      className="flex justify-center items-center rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/50 border-[6px] border-blue-400 bg-blue-950/80 backdrop-blur-sm max-w-full h-auto" 
    />
  );
}