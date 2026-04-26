import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

// ==========================================
// ⚙️ UI CONFIGURATION & DEBUG MODE ⚙️
// ==========================================
const DEBUG_MODE = true; 

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 700;
const SYMBOL_SIZE = 110;

// The Mask defines the visual "window" of the slot.
const MASK_TOP = 110; 
const MASK_BOTTOM = CANVAS_HEIGHT - 100;

// 🎯 THE PRECISION COORDINATE GRID
// Manually adjust the X and Y for every single tile on the board
const TILE_POSITIONS = [
    // ROW 0 (Top Row)
    [ { x: 323, y: 190 },  { x: 500, y: 190 },  { x: 677, y: 190 } ],
    // ROW 1 (Middle Row)
    [ { x: 323, y: 360 },  { x: 500, y: 360 },  { x: 677, y: 360 } ],
    // ROW 2 (Bottom Row)
    [ { x: 323, y: 525 },  { x: 500, y: 525 },  { x: 677, y: 525 } ]
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

      // 🛠️ DEBUG OVERLAYS (Now uses TILE_POSITIONS)
      if (DEBUG_MODE) {
          const debugGraphics = new PIXI.Graphics();
          
          // Spawn Line (Yellow)
          debugGraphics.moveTo(0, SPAWN_Y);
          debugGraphics.lineTo(CANVAS_WIDTH, SPAWN_Y);
          debugGraphics.stroke({ color: 0xffff00, width: 2, alpha: 0.8 });

          // Mask Boundaries (Green)
          debugGraphics.rect(0, MASK_TOP, CANVAS_WIDTH, MASK_BOTTOM - MASK_TOP);
          debugGraphics.stroke({ color: 0x00ff00, width: 4 }); 
          
          // Hitboxes and Center points
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
               const pos = TILE_POSITIONS[r][c];
               debugGraphics.circle(pos.x, pos.y, 6).fill(0xff0000); // Center dot
               // Bounding box
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
    if (!playData || !playData.matrix || !appRef.current || !gridContainerRef.current) return;

    const app = appRef.current;
    const container = gridContainerRef.current;
    
    // Clear previous spin results
    container.removeChildren();

    // Track sprites to pulse them later on a win
    const spriteMatrix: PIXI.Sprite[][] = [[], [], []];

    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const symbolId = playData.matrix[r][c];
        const sprite = PIXI.Sprite.from(SYMBOL_MAP[symbolId]);
        const targetPos = TILE_POSITIONS[r][c];
        
        sprite.anchor.set(0.5);
        sprite.width = SYMBOL_SIZE;
        sprite.height = SYMBOL_SIZE;
        
        // Spawn precisely at the exact X coordinate, but at the SPAWN_Y height
        sprite.x = targetPos.x;
        sprite.y = SPAWN_Y; 

        container.addChild(sprite);
        
        if (!spriteMatrix[r]) spriteMatrix[r] = [];
        spriteMatrix[r][c] = sprite;

        gsap.to(sprite, {
          y: targetPos.y, // Drop exactly to its precision coordinate
          duration: 0.4 + (c * 0.2), 
          ease: "bounce.out",
        });
      }
    }

    // Evaluate features after reels land
    const timeoutId = setTimeout(() => {
      
      // 🏆 WINNING LINE PULSE EFFECT
      if (playData.winningLines && playData.winningLines.length > 0) {
        playData.winningLines.forEach((win: any) => {
          const lineCoords = PAYLINES[win.lineIndex];
          if (lineCoords) {
            lineCoords.forEach(coord => {
               const r = coord[0];
               const c = coord[1];
               const sprite = spriteMatrix[r][c];
               if (sprite) {
                   container.addChild(sprite); 
                   gsap.to(sprite.scale, { x: 1.35, y: 1.35, duration: 0.25, yoyo: true, repeat: 3, ease: "sine.inOut" });
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
      onAnimationComplete();
    }, 1200);

    return () => clearTimeout(timeoutId);
  }, [playData]); 

  return (
    <div 
      ref={pixiContainer} 
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      className="flex justify-center items-center rounded-2xl overflow-hidden shadow-2xl shadow-blue-900/50 border-[6px] border-blue-400 bg-blue-950/80 backdrop-blur-sm max-w-full h-auto" 
    />
  );
}