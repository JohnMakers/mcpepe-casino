import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

interface PixiGridProps {
  playData: any;
  onAnimationComplete: () => void;
}

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

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SYMBOL_SIZE = 120;
const SPACING = 140;

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
        pixiContainer.current.innerHTML = ''; // Prevent React Strict Mode duplicate canvas injection
        pixiContainer.current.appendChild(app.canvas);
      }

      // Preload and mount Background
      await PIXI.Assets.load('/snowstorm/snowstorm_bg.png');
      const bg = PIXI.Sprite.from('/snowstorm/snowstorm_bg.png');
      bg.width = CANVAS_WIDTH;
      bg.height = CANVAS_HEIGHT;
      app.stage.addChild(bg);

      // Create an isolated container for just the spinning reels
      const gridContainer = new PIXI.Container();
      app.stage.addChild(gridContainer);
      gridContainerRef.current = gridContainer;
      
      // Preload symbols so they don't pop-in visually on the first spin
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
  }, []); // <-- Empty array ensures we only boot up WebGL once!

  // 2. TRIGGER SPIN ANIMATIONS
  useEffect(() => {
    if (!playData || !playData.matrix || !appRef.current || !gridContainerRef.current) return;

    const app = appRef.current;
    const container = gridContainerRef.current;
    
    // Clear previous spin results
    container.removeChildren();

    const startX = (CANVAS_WIDTH - (SPACING * 2)) / 2;
    const startY = (CANVAS_HEIGHT - (SPACING * 2)) / 2;

    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const symbolId = playData.matrix[r][c];
        const sprite = PIXI.Sprite.from(SYMBOL_MAP[symbolId]);
        
        sprite.anchor.set(0.5);
        sprite.width = SYMBOL_SIZE;
        sprite.height = SYMBOL_SIZE;
        
        sprite.x = startX + (c * SPACING);
        sprite.y = startY - 400; // Drop from top

        container.addChild(sprite);

        gsap.to(sprite, {
          y: startY + (r * SPACING),
          duration: 0.4 + (c * 0.2), // Cascading delay from left to right
          ease: "bounce.out",
        });
      }
    }

    // Wait for animation to finish, then evaluate features
    const timeoutId = setTimeout(() => {
      if (playData.multiplier > 1) {
          const multText = new PIXI.Text({
              text: `BLIZZARD MULTIPLIER: ${playData.multiplier}X!`,
              style: {
                  fontFamily: 'Arial', 
                  fontSize: 48, 
                  fill: '#00ffff', 
                  stroke: { color: '#ffffff', width: 4 }, 
                  dropShadow: { color: '#000000', blur: 4, distance: 4, alpha: 0.8 }
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
              delay: 2,
              onComplete: () => app.stage.removeChild(multText)
          });
      }
      onAnimationComplete();
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [playData]); // Only re-runs when new spin data hits

  return (
    <div 
      ref={pixiContainer} 
      // Ensure the container has explicit dimensions to prevent collapsing while Pixi initializes
      style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, maxWidth: '100%' }}
      className="flex justify-center items-center rounded-xl overflow-hidden shadow-2xl shadow-blue-900/50 border-4 border-blue-300 bg-blue-950" 
    />
  );
}