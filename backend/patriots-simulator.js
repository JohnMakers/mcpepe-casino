// patriots-simulator.js
// Run via terminal: node patriots-simulator.js

const PATRIOTS_SYMBOLS = {
    GOLDEN_MCPEPE: 0, PEPE_HEART: 1, PURPLE_DIAMOND: 2, BLUE_OVAL: 3, 
    GREEN_GEM: 4, APPLE: 5, MELON: 6, SCATTER: 7, BOMB: 8, 
    GRAPE: 9, BANANA: 10 
};

// V4 Buffed Paytable - Increased base values by ~50% to bring RTP to 96%
const PAYTABLE = {
    [PATRIOTS_SYMBOLS.GOLDEN_MCPEPE]: { 8: 15, 10: 40, 12: 75 },
    [PATRIOTS_SYMBOLS.PEPE_HEART]: { 8: 4, 10: 15, 12: 35 },
    [PATRIOTS_SYMBOLS.PURPLE_DIAMOND]: { 8: 3, 10: 7.5, 12: 20 },
    [PATRIOTS_SYMBOLS.BLUE_OVAL]: { 8: 2, 10: 4, 12: 15 },
    [PATRIOTS_SYMBOLS.GREEN_GEM]: { 8: 1.5, 10: 2.5, 12: 12 },
    [PATRIOTS_SYMBOLS.APPLE]: { 8: 1.2, 10: 2, 12: 10 },
    [PATRIOTS_SYMBOLS.MELON]: { 8: 0.8, 10: 1.5, 12: 7.5 },
    [PATRIOTS_SYMBOLS.GRAPE]: { 8: 0.6, 10: 1.2, 12: 5 },
    [PATRIOTS_SYMBOLS.BANANA]: { 8: 0.4, 10: 1, 12: 3 }
};

// Replaced Crypto HMAC with Math.random() for instant simulation speed
function mockFloat() { return Math.random(); }

function generateSymbol(randomFloat, isFreeSpins) {
    // V3 Weights: "Goldilocks" balance between V1 (Too tight) and V2 (Too loose)
    const weights = [
        { symbol: PATRIOTS_SYMBOLS.BANANA, weight: 190 },       
        { symbol: PATRIOTS_SYMBOLS.GRAPE, weight: 165 },        
        { symbol: PATRIOTS_SYMBOLS.MELON, weight: 145 },        
        { symbol: PATRIOTS_SYMBOLS.APPLE, weight: 130 },        
        { symbol: PATRIOTS_SYMBOLS.GREEN_GEM, weight: 115 },    
        { symbol: PATRIOTS_SYMBOLS.BLUE_OVAL, weight: 95 },    
        { symbol: PATRIOTS_SYMBOLS.PURPLE_DIAMOND, weight: 75 },
        { symbol: PATRIOTS_SYMBOLS.PEPE_HEART, weight: 50 },    
        { symbol: PATRIOTS_SYMBOLS.GOLDEN_MCPEPE, weight: 20 }, 
        { symbol: PATRIOTS_SYMBOLS.SCATTER, weight: 15 }        
    ];

    if (isFreeSpins) {
        // V3 Bomb Spawn: Reduced from 75 to 55 to prevent infinite multiplier stacking
        weights.push({ symbol: PATRIOTS_SYMBOLS.BOMB, weight: 55 }); 
    }

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let rand = randomFloat * totalWeight;

    for (let w of weights) {
        if (rand < w.weight) return w.symbol;
        rand -= w.weight;
    }
    return PATRIOTS_SYMBOLS.BANANA; 
}

function getBombMultiplier(randomFloat) {
    // V3 Bomb Weights: Keeping the top-end high, but adding slightly more 2x/3x "dud" bombs 
    const bombWeights = [
        { mult: 2, weight: 220 },   
        { mult: 3, weight: 180 },   
        { mult: 5, weight: 150 },   
        { mult: 8, weight: 110 },   
        { mult: 10, weight: 100 },  
        { mult: 15, weight: 70 },   
        { mult: 20, weight: 60 },   
        { mult: 25, weight: 50 },   
        { mult: 50, weight: 40 },   
        { mult: 100, weight: 20 }   
    ];
    
    let totalWeight = bombWeights.reduce((sum, w) => sum + w.weight, 0);
    let rand = randomFloat * totalWeight;
    
    for (let bw of bombWeights) {
        if (rand < bw.weight) return bw.mult;
        rand -= bw.weight;
    }
    return 2; 
}

function generateGrid(isFreeSpins, forceScatters = false) {
    let grid = [];
    let scatterPositions = [];

    if (forceScatters) {
        while (scatterPositions.length < 4) {
            let pos = Math.floor(mockFloat() * 30);
            if (!scatterPositions.includes(pos)) scatterPositions.push(pos);
        }
    }

    for (let col = 0; col < 6; col++) {
        let column = [];
        for (let row = 0; row < 5; row++) {
            let tileIndex = col * 5 + row;
            if (forceScatters && scatterPositions.includes(tileIndex)) {
                column.push(PATRIOTS_SYMBOLS.SCATTER);
            } else {
                column.push(generateSymbol(mockFloat(), isFreeSpins));
            }
        }
        grid.push(column);
    }
    return grid;
}

function evaluateGrid(grid) {
    let counts = {};
    let winningSymbols = [];
    let scatterCount = 0;

    for (let c = 0; c < 6; c++) {
        for (let r = 0; r < 5; r++) {
            let sym = grid[c][r];
            if (sym === PATRIOTS_SYMBOLS.SCATTER) scatterCount++;
            else counts[sym] = (counts[sym] || 0) + 1;
        }
    }

    for (const [sym, count] of Object.entries(counts)) {
        if (count >= 8 && parseInt(sym) !== PATRIOTS_SYMBOLS.BOMB) {
            winningSymbols.push(parseInt(sym));
        }
    }

    return { winningSymbols, scatterCount, counts };
}

function calculatePayout(winningSymbols, counts, betAmount) {
    let payout = 0;
    for (let sym of winningSymbols) {
        let count = counts[sym];
        let tier = count >= 12 ? 12 : (count >= 10 ? 10 : 8);
        let mult = PAYTABLE[sym][tier];
        payout += (betAmount * mult);
    }
    return payout;
}

function processTumble(grid, winningSymbols, isFreeSpins) {
    let newBombs = [];
    for (let c = 0; c < 6; c++) {
        grid[c] = grid[c].filter(sym => !winningSymbols.includes(sym));
        while (grid[c].length < 5) {
            const sym = generateSymbol(mockFloat(), isFreeSpins);
            if (isFreeSpins && sym === PATRIOTS_SYMBOLS.BOMB) {
                newBombs.push(getBombMultiplier(mockFloat()));
            }
            grid[c].unshift(sym); 
        }
    }
    return { grid, newBombs };
}

function runSpinCycle(betAmount, isFreeSpins, forceScatters = false) {
    let grid = generateGrid(isFreeSpins, forceScatters);
    let totalSpinPayout = 0;
    let activeTumble = true;
    let bombMultipliers = [];

    // Capture initial bombs
    if (isFreeSpins) {
        for (let c = 0; c < 6; c++) {
            for (let r = 0; r < 5; r++) {
                if (grid[c][r] === PATRIOTS_SYMBOLS.BOMB) {
                    bombMultipliers.push(getBombMultiplier(mockFloat()));
                }
            }
        }
    }

    let initialScatterCount = evaluateGrid(grid).scatterCount;

    while (activeTumble) {
        let { winningSymbols, counts } = evaluateGrid(grid);
        
        if (winningSymbols.length > 0) {
            totalSpinPayout += calculatePayout(winningSymbols, counts, betAmount);
            let tumbleResult = processTumble(grid, winningSymbols, isFreeSpins);
            grid = tumbleResult.grid;
            if (isFreeSpins && tumbleResult.newBombs.length > 0) {
                bombMultipliers.push(...tumbleResult.newBombs);
            }
        } else {
            activeTumble = false;
        }
    }

    let finalSpinMultiplier = 1;
    if (bombMultipliers.length > 0 && totalSpinPayout > 0) {
        finalSpinMultiplier = bombMultipliers.reduce((a, b) => a + b, 0);
        totalSpinPayout = totalSpinPayout * finalSpinMultiplier;
    }

    return { 
        totalSpinPayout, 
        triggeredBonus: !isFreeSpins && initialScatterCount >= 4,
        retriggerHit: isFreeSpins && initialScatterCount >= 3
    };
}

function runSimulation(rounds) {
    const baseBet = 1;               
    const costPerBonus = baseBet * 100; // Bonus Buy costs 100x

    let totalSpent = rounds * costPerBonus;
    let totalWon = 0;
    
    let brutalRounds = 0;
    let monsterWins = 0; // > 1000x base bet
    let maxWinsHit = 0;
    const MAX_WIN_CAP = baseBet * 21100;

    console.log(`🎰 Simulating ${rounds} PATRIOTS Bonus Rounds (V4 Math)...\n`);

    for (let i = 0; i < rounds; i++) {
        // Guarantee 4 scatters for the Bonus Buy
        let baseSpin = runSpinCycle(baseBet, false, true);
        let gamePayout = baseSpin.totalSpinPayout;
        
        let totalSpins = 10;
        let currentSpin = 0;

        while (currentSpin < totalSpins) {
            let fsSpin = runSpinCycle(baseBet, true, false);
            gamePayout += fsSpin.totalSpinPayout;
            if (fsSpin.retriggerHit) totalSpins += 3;
            currentSpin++;
        }

        // Apply Hard Cap
        if (gamePayout > MAX_WIN_CAP) {
            gamePayout = MAX_WIN_CAP;
            maxWinsHit++;
        }

        totalWon += gamePayout;

        if (gamePayout < (baseBet * 10)) brutalRounds++;
        if (gamePayout > (baseBet * 1000)) monsterWins++;
    }

    const rtp = (totalWon / totalSpent) * 100;
    
    console.log(`📊 SIMULATION RESULTS (${rounds} Rounds)`);
    console.log(`-----------------------------------`);
    console.log(`Total Bonus Buys Cost: ${totalSpent} Units`);
    console.log(`Total Payout Won:      ${totalWon.toFixed(2)} Units`);
    console.log(`\n🎯 TRUE RETURN TO PLAYER (RTP): ${rtp.toFixed(2)}%`);
    console.log(`\n💀 Brutal Rounds (< 10x Win):     ${(brutalRounds / rounds * 100).toFixed(2)}%`);
    console.log(`🔥 Monster Wins (> 1000x Win):    ${(monsterWins / rounds * 100).toFixed(2)}%`);
    console.log(`🏆 MAX WINS HIT (21,100x):        ${maxWinsHit} times`);
    console.log(`-----------------------------------`);
}

// Test 10,000 rounds
runSimulation(10000);