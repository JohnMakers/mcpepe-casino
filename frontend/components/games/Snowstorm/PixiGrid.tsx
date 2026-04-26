import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 700;
const SYMBOL_SIZE = 137;

const MASK_TOP = 130; 
const MASK_BOTTOM = CANVAS_HEIGHT - 100;

// 🎯 EXACT TILE COORDINATES
const TILE_POSITIONS = [
    [ { x: 325.4, y: 211 },  { x: 500.3, y: 211 },  { x: 676.3, y: 211 } ],
    [ { x: 325.4, y: 367 },  { x: 500.3, y: 367 },  { x: 676.3, y: 367 } ],
    [ { x: 325.4, y: 522 },  { x: 500.3, y: 522 },  { x: 676.3, y: 522 } ]
];

const PAYLINES = [
    [[1,0], [1,1], [1,2]], 
    [[0,0], [0,1], [0,2]], 
    [[2,0], [2,1], [2,2]], 
    [[0,0], [1,1], [2,2]], 
    [[2,0], [1,1], [0,2]]  
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
    const canvasRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const containerRef = useRef<PIXI.Container | null>(null);

    // Initialize PIXI App
    useEffect(() => {
        if (!canvasRef.current || appRef.current) return;

        const app = new PIXI.Application({
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            backgroundAlpha: 0,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });

        canvasRef.current.appendChild(app.view as any);
        appRef.current = app;

        const container = new PIXI.Container();
        app.stage.addChild(container);
        containerRef.current = container;

        // Visual Window Mask
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff);
        mask.drawRect(0, MASK_TOP, CANVAS_WIDTH, MASK_BOTTOM - MASK_TOP);
        mask.endFill();
        app.stage.addChild(mask);
        container.mask = mask;

        // Preload Textures
        Object.values(SYMBOL_MAP).forEach(url => {
            if (!PIXI.Assets.cache.has(url)) PIXI.Assets.add({ alias: url, src: url });
        });
        PIXI.Assets.load(Object.values(SYMBOL_MAP));

        return () => {
            app.destroy(true, true);
            appRef.current = null;
        };
    }, []);

    // 🎬 MAIN SPIN TIMELINE (Synchronous GSAP Fix)
    useEffect(() => {
        if (!playData || !appRef.current || !containerRef.current) return;

        const app = appRef.current;
        const container = containerRef.current;

        // Clear previous grid and kill all active tweens to prevent overlap
        container.removeChildren();
        gsap.killTweensOf("*");

        const baseMatrix = playData.initialMatrix || playData.matrix;
        const finalMatrix = playData.matrix;
        
        const spriteMatrix: PIXI.Sprite[][] = [
            [null as any, null as any, null as any],
            [null as any, null as any, null as any],
            [null as any, null as any, null as any]
        ];

        // 🔥 THE FIX: Use a master GSAP Timeline instead of raw setTimeouts
        const tl = gsap.timeline({ 
            onComplete: () => {
                onAnimationComplete();
            } 
        });

        let currentTime = 0;

        // 1. DROP INITIAL GRID
        for (let col = 0; col < 3; col++) {
            for (let row = 0; row < 3; row++) {
                const symVal = baseMatrix[row][col];
                const texture = PIXI.Texture.from(SYMBOL_MAP[symVal]);
                const sprite = new PIXI.Sprite(texture);

                sprite.width = SYMBOL_SIZE;
                sprite.height = SYMBOL_SIZE;
                sprite.anchor.set(0.5);

                const targetPos = TILE_POSITIONS[row][col];
                sprite.x = targetPos.x;
                sprite.y = MASK_TOP - 150; 

                spriteMatrix[row][col] = sprite;
                container.addChild(sprite);

                // Insert into timeline
                tl.to(sprite, {
                    y: targetPos.y,
                    duration: 0.4,
                    ease: "back.out(1.2)"
                }, currentTime + (col * 0.15) + (row * 0.05));
            }
        }

        currentTime += 0.4 + (2 * 0.15) + (2 * 0.05) + 0.3; // Allow grid to settle

        // 2. THE RESPIN CUTSCENE
        if (playData.respinData) {
            const spinCol = playData.respinData.spin;
            const heldCols = playData.respinData.held;

            // Dramatic Popup Text
            const respinText = new PIXI.Text({
                text: "SNOWSTORM RESPIN!",
                style: {
                    fontFamily: 'Arial', fontSize: 58, fontWeight: '900',
                    fill: '#00ffff', stroke: { color: '#000000', width: 6 },
                    dropShadow: { color: '#000000', blur: 8, distance: 4, alpha: 0.9 }
                }
            });
            respinText.anchor.set(0.5);
            respinText.x = CANVAS_WIDTH / 2;
            respinText.y = CANVAS_HEIGHT / 2;
            respinText.scale.set(0);
            app.stage.addChild(respinText);

            tl.to(respinText.scale, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.7)" }, currentTime);

            // Glow/Tint the locked columns icy blue to show they are held
            heldCols.forEach((col: number) => {
                for (let row = 0; row < 3; row++) {
                    tl.to(spriteMatrix[row][col], { tint: 0xaaffff, duration: 0.3 }, currentTime);
                }
            });

            currentTime += 1.0; // Hold the dramatic pause

            tl.to(respinText, { alpha: 0, duration: 0.3 }, currentTime);

            // Animate the old 3rd column falling out the bottom
            for (let row = 0; row < 3; row++) {
                const oldSprite = spriteMatrix[row][spinCol];
                tl.to(oldSprite, {
                    y: MASK_BOTTOM + 200,
                    duration: 0.4,
                    ease: "power2.in"
                }, currentTime + (row * 0.05));
            }

            currentTime += 0.5;

            // Drop the NEW final symbols into the 3rd column
            for (let row = 0; row < 3; row++) {
                const newSymVal = finalMatrix[row][spinCol];
                const texture = PIXI.Texture.from(SYMBOL_MAP[newSymVal]);
                const newSprite = new PIXI.Sprite(texture);

                newSprite.width = SYMBOL_SIZE;
                newSprite.height = SYMBOL_SIZE;
                newSprite.anchor.set(0.5);

                const targetPos = TILE_POSITIONS[row][spinCol];
                newSprite.x = targetPos.x;
                newSprite.y = MASK_TOP - 150; 

                spriteMatrix[row][spinCol] = newSprite;
                container.addChild(newSprite);

                tl.to(newSprite, {
                    y: targetPos.y,
                    duration: 0.5,
                    ease: "back.out(1.4)"
                }, currentTime + (row * 0.1));
            }

            currentTime += 0.8;

            // Remove the ice tint from the held columns
            heldCols.forEach((col: number) => {
                for (let row = 0; row < 3; row++) {
                    tl.to(spriteMatrix[row][col], { tint: 0xffffff, duration: 0.3 }, currentTime);
                }
            });
            
            currentTime += 0.3;
        }

        // 3. WINNING LINES & MULTIPLIER POPUP
        tl.add(() => {
            // Subtle Win Line Pulsate
            if (playData.winningLines && playData.winningLines.length > 0) {
                playData.winningLines.forEach((win: any) => {
                    const lineCoords = PAYLINES[win.lineIndex];
                    if (lineCoords) {
                        lineCoords.forEach(coord => {
                            const r = coord[0];
                            const c = coord[1];
                            const sprite = spriteMatrix[r][c];
                            if (sprite) {
                                container.addChild(sprite); // Bring to front
                                gsap.to(sprite.scale, { 
                                    x: 0.4, 
                                    y: 0.4, 
                                    duration: 1.2, 
                                    yoyo: true, 
                                    repeat: -1, 
                                    ease: "sine.inOut" 
                                });
                            }
                        });
                    }
                });
            }

            // Blizzard Multiplier Popup
            if (playData.multiplier > 1) {
                const multText = new PIXI.Text({
                    text: `BLIZZARD MULTIPLIER: ${playData.multiplier}X!`,
                    style: {
                        fontFamily: 'Arial', fontSize: 54, fontWeight: '900',
                        fill: '#00ffff', stroke: { color: '#ffffff', width: 6 }, 
                        dropShadow: { color: '#000000', blur: 6, distance: 4, alpha: 0.9 }
                    }
                });
                multText.anchor.set(0.5);
                multText.x = CANVAS_WIDTH / 2;
                multText.y = CANVAS_HEIGHT / 2;
                multText.scale.set(0);
                app.stage.addChild(multText);

                gsap.to(multText.scale, { x: 1, y: 1, duration: 0.5, ease: "back.out(1.7)" });
                gsap.to(multText, { 
                    alpha: 0, duration: 0.5, delay: 2.0,
                    onComplete: () => app.stage.removeChild(multText)
                });
            }
        }, currentTime);

    }, [playData]);

    return (
        <div className="relative w-full max-w-5xl aspect-[10/7] mx-auto overflow-hidden">
            <div ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>
    );
}