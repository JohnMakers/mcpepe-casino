// simulator.js
// Run via terminal: node simulator.js

const VACATION_SYMBOLS = { TEN: 0, J: 1, Q: 2, K: 3, A: 4, SUNSCREEN: 5, LUGGAGE: 6, COCKTAIL: 7, JETSKI: 8, YACHT: 9, MCPEPE: 10, PASSPORT_SCATTER: 11 };

// V5 MATHEMATICAL LOCKDOWN STRIPS (Kept exactly the same to preserve the 3.4% Max Tier)
const FS_VAC_REEL_STRIPS = [
    [0,6,1,6,2,3,4,0,6,5,10,1,6,2,3,4,0,1,7,1,2,2,3,4,0,6,8,1,0,2,3,4,0,6,9,1,1,2,3,4,0,2,1,6,3,4,0,6,1,2,3,4,0,1,2,3,4,0,1,2,3,4,6],
    [1,0,2,3,6,4,0,10,1,5,1,2,3,7,6,4,0,1,2,2,3,8,0,4,0,1,6,2,3,9,1,4,0,1,6,2,3,4,0,6,1,2,3,4,1,0,1,2,3,6,4,0,1,2,6,3,4,0,1,2,3,4,2,6],
    [2,0,3,4,6,0,1,10,2,5,1,3,4,7,6,0,1,2,0,3,4,8,1,0,1,2,6,3,4,9,2,0,1,6,2,3,4,0,6,1,2,3,4,0,1,1,2,3,4,6,0,1,2,3,6,4,0,1,2,3,4,2,6],
    [3,1,4,0,6,1,2,10,3,5,0,4,0,7,6,1,2,3,1,4,0,8,2,1,2,3,6,4,0,9,0,1,2,6,3,4,0,6,1,2,3,4,0,1,1,2,3,4,6,0,1,2,3,4,6,0,1,2,3,4,2,6],
    [4,2,0,1,6,2,3,10,4,5,1,0,1,7,6,2,3,4,0,0,1,8,1,2,3,4,6,0,1,9,2,2,3,6,4,0,6,1,2,3,4,0,2,1,2,3,4,6,0,1,2,3,4,6,0,1,2,3,4,1,6]
];

const VAC_PAYTABLE = {
    0: { 3: 5, 4: 25, 5: 100 }, 1: { 3: 5, 4: 25, 5: 100 }, 2: { 3: 5, 4: 25, 5: 100 },
    3: { 3: 10, 4: 50, 5: 150 }, 4: { 3: 10, 4: 50, 5: 150 }, 5: { 2: 5, 3: 30, 4: 100, 5: 500 },
    6: { 3: 10, 4: 50, 5: 200 }, 7: { 2: 10, 3: 40, 4: 400, 5: 1000 }, 8: { 2: 10, 3: 40, 4: 400, 5: 1000 },
    9: { 2: 20, 3: 100, 4: 1000, 5: 2000 }
};

const VAC_LINES = [
    [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2], [0,1,2,1,0], [2,1,0,1,2],
    [1,0,0,0,1], [1,2,2,2,1], [0,0,1,2,2], [2,2,1,0,0], [1,0,1,2,1]
];

function mockFloat() { return Math.random(); }

function spinVacationReelsFs() {
    let grid = [];
    for (let col = 0; col < 5; col++) {
        let strip = FS_VAC_REEL_STRIPS[col];
        let stop = Math.floor(mockFloat() * strip.length);
        grid.push([strip[stop], strip[(stop+1)%strip.length], strip[(stop+2)%strip.length]]);
    }
    return grid;
}

function evaluateFsGrid(grid) {
    let mcpepeCount = 0;
    let totalLuggageMult = 0;
    let lineWinTotal = 0;
    
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 3; r++) {
            const sym = grid[c][r];
            if (sym === VACATION_SYMBOLS.MCPEPE) mcpepeCount++;
            if (sym === VACATION_SYMBOLS.LUGGAGE) {
                let prizeFloat = mockFloat();
                let prizeMult;
                // V6 BUFFED LUGGAGE MATH
                if (prizeFloat < 0.55) prizeMult = 5;
                else if (prizeFloat < 0.80) prizeMult = 10;
                else if (prizeFloat < 0.94) prizeMult = 20;
                else if (prizeFloat < 0.99) prizeMult = 50;
                else prizeMult = 100; 
                
                totalLuggageMult += prizeMult;
            }
        }
    }

    for (let i = 0; i < VAC_LINES.length; i++) {
        let line = VAC_LINES[i];
        let firstSym = -1;
        let count = 0;
        for (let col = 0; col < 5; col++) {
            let sym = grid[col][line[col]];
            if (sym === VACATION_SYMBOLS.PASSPORT_SCATTER) break;
            if (firstSym === -1) { firstSym = sym; count++; } 
            else if (sym === firstSym) { count++; } 
            else { break; }
        }
        if (firstSym !== -1 && VAC_PAYTABLE[firstSym] && VAC_PAYTABLE[firstSym][count]) {
            lineWinTotal += VAC_PAYTABLE[firstSym][count]; 
        }
    }

    return { mcpepeCount, totalLuggageMult, lineWinTotal };
}

async function runSimulation(rounds) {
    const baseBet = 1;               
    const lineBet = baseBet / 10;    
    const costPerBonus = baseBet * 100; 

    let totalSpent = rounds * costPerBonus;
    let totalWon = 0;
    let maxTriggerCount = 0;
    let zeroWinCount = 0;

    console.log(`🎰 Simulating ${rounds} Bonus Rounds (V6 Buffed Math)...\n`);

    for (let i = 0; i < rounds; i++) {
        let mcpepesCollected = 0;
        let totalSpinsAwarded = 10;
        let currentSpinNum = 0;
        let roundWin = 0;
        let retriggerLevel = 0;

        while (currentSpinNum < totalSpinsAwarded) {
            let activeMultiplier = 1;
            if (currentSpinNum >= 30) activeMultiplier = 10;
            else if (currentSpinNum >= 20) activeMultiplier = 3;
            else if (currentSpinNum >= 10) activeMultiplier = 2;

            const grid = spinVacationReelsFs();
            const eval = evaluateFsGrid(grid);
            
            if (eval.mcpepeCount > 0 && eval.totalLuggageMult > 0) {
                let collectionWin = baseBet * eval.totalLuggageMult * eval.mcpepeCount * activeMultiplier;
                roundWin += collectionWin;
            }

            roundWin += (eval.lineWinTotal * lineBet);
            mcpepesCollected += eval.mcpepeCount;

            if (mcpepesCollected >= 4 && retriggerLevel === 0) { retriggerLevel = 1; totalSpinsAwarded += 10; }
            if (mcpepesCollected >= 8 && retriggerLevel === 1) { retriggerLevel = 2; totalSpinsAwarded += 10; }
            if (mcpepesCollected >= 12 && retriggerLevel === 2) { retriggerLevel = 3; totalSpinsAwarded += 10; }

            currentSpinNum++;
        }

        totalWon += roundWin;
        if (mcpepesCollected >= 12) maxTriggerCount++;
        if (roundWin < (baseBet * 5)) zeroWinCount++;
    }

    const rtp = (totalWon / totalSpent) * 100;
    
    console.log(`📊 SIMULATION RESULTS (${rounds} Rounds)`);
    console.log(`-----------------------------------`);
    console.log(`Total Bonus Buys Cost: ${totalSpent} Units`);
    console.log(`Total Payout Won:      ${totalWon.toFixed(2)} Units`);
    console.log(`\n🎯 TRUE RETURN TO PLAYER (RTP): ${rtp.toFixed(2)}%`);
    console.log(`\n🏆 Max Tier Reached (12+ Pepes): ${(maxTriggerCount / rounds * 100).toFixed(2)}% of bonuses`);
    console.log(`💀 Brutal Rounds (< 5x Win):     ${(zeroWinCount / rounds * 100).toFixed(2)}% of bonuses`);
    console.log(`-----------------------------------`);
}

runSimulation(10000);