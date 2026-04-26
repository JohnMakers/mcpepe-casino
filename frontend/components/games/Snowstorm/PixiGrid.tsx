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

  useEffect(() => {
    if (!pixiContainer.current) return;

    const app = new PIXI.Application({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundAlpha: 0, // <-- Replaced 'transparent: true'
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    
    pixiContainer.current.appendChild(app.view as any);
    appRef.current = app;

    // Background
    const bg = PIXI.Sprite.from('/snowstorm/snowstorm_bg.png');
    bg.width = CANVAS_WIDTH;
    bg.height = CANVAS_HEIGHT;
    app.stage.addChild(bg);

    if (playData && playData.matrix) {
      animateSpin(app, playData.matrix, playData);
    }

    return () => {
      app.destroy(true, true);
    };
  }, [playData]);

  const animateSpin = (app: PIXI.Application, matrix: number[][], data: any) => {
    const container = new PIXI.Container();
    app.stage.addChild(container);

    const startX = (CANVAS_WIDTH - (SPACING * 2)) / 2;
    const startY = (CANVAS_HEIGHT - (SPACING * 2)) / 2;

    const sprites: PIXI.Sprite[] = [];

    // Construct Grid
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const symbolId = matrix[r][c];
        const sprite = PIXI.Sprite.from(SYMBOL_MAP[symbolId]);
        
        sprite.anchor.set(0.5);
        sprite.width = SYMBOL_SIZE;
        sprite.height = SYMBOL_SIZE;
        
        sprite.x = startX + (c * SPACING);
        sprite.y = startY - 400; // Start off-screen top

        container.addChild(sprite);
        sprites.push(sprite);

        // Spin Drop Animation
        gsap.to(sprite, {
          y: startY + (r * SPACING),
          duration: 0.4 + (c * 0.2), // Reel delay
          ease: "bounce.out",
        });
      }
    }

    // After reels land, check mechanics
    setTimeout(() => {
      // 1. Blizzard Multiplier Wheel Effect
      if (data.multiplier > 1) {
          const multText = new PIXI.Text({
              text: `BLIZZARD MULTIPLIER: ${data.multiplier}X!`,
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
          gsap.to(multText, { alpha: 0, duration: 0.5, delay: 2 });
      }

      onAnimationComplete();
    }, 1500);
  };

  return <div ref={pixiContainer} className="flex justify-center rounded-xl overflow-hidden shadow-2xl shadow-blue-900/50 border-4 border-blue-300" />;
}