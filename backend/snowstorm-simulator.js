// snowstorm-simulator.js
const SNOWSTORM_PAYTABLE = { 0:80, 1:25, 2:15, 3:10, 4:7, 5:5, 6:4, 7:3, 8:2 };
const PAYLINES = [ [[1,0],[1,1],[1,2]], [[0,0],[0,1],[0,2]], [[2,0],[2,1],[2,2]], [[0,0],[1,1],[2,2]], [[2,0],[1,1],[0,2]] ];

function getRandomByte() { return Math.floor(Math.random() * 256); }

// 🎰 V19 FINAL LOCK: Reverted to the flawless V16 Base Distribution
const getTile = (val) => {
    if (val < 1) return 0;   
    if (val < 4) return 1;   
    if (val < 12) return 2;  
    if (val < 26) return 3;  
    if (val < 48) return 4;  
    if (val < 80) return 5;  
    if (val < 124) return 6; 
    if (val < 182) return 7; 
    return 8;                
};

function evaluateGrid(matrix) {
    let totalWinFactor = 0;
    for (let i = 0; i < PAYLINES.length; i++) {
        const line = PAYLINES[i];
        const s1 = matrix[line[0][0]][line[0][1]];
        const s2 = matrix[line[1][0]][line[1][1]];
        const s3 = matrix[line[2][0]][line[2][1]];

        let matchSymbol = s1 === 0 ? (s2 === 0 ? s3 : s2) : s1;
        if ((s1 === matchSymbol || s1 === 0) && (s2 === matchSymbol || s2 === 0) && (s3 === matchSymbol || s3 === 0)) {
            totalWinFactor += SNOWSTORM_PAYTABLE[matchSymbol];
        }
    }
    return totalWinFactor;
}

const isMatch = (c1, c2) => {
    const sym1 = c1.find(v => v !== 0) || 0; 
    const sym2 = c2.find(v => v !== 0) || 0;
    if (sym1 !== sym2 && sym1 !== 0 && sym2 !== 0) return false;
    const target = sym1 || sym2;
    return c1.every(v => v === target || v === 0) && c2.every(v => v === target || v === 0);
};

function runSpinCycle() {
    let matrix = [
        [getTile(getRandomByte()), getTile(getRandomByte()), getTile(getRandomByte())],
        [getTile(getRandomByte()), getTile(getRandomByte()), getTile(getRandomByte())],
        [getTile(getRandomByte()), getTile(getRandomByte()), getTile(getRandomByte())]
    ];

    let triggeredRespin = false;
    let triggeredWheel = false;

    const featureRoll = Math.floor(Math.random() * 10000);
    
    // 🔥 TRIMMED: Dials turned down to remove the final 6% RTP excess
    if (featureRoll < 25) { 
        // 0.25% Wheel Trigger
        const symArr = [8, 8, 8, 7, 7, 6, 5];
        const sym = symArr[Math.floor(Math.random() * symArr.length)];
        matrix = [[sym,sym,sym], [sym,sym,sym], [sym,sym,sym]];
    } else if (featureRoll < 775) { 
        // 7.5% Respin Trigger
        const symArr = [8, 7, 6, 5];
        const sym = symArr[Math.floor(Math.random() * symArr.length)];
        
        const safe1 = (sym + 2) % 8 + 1; 
        const safe2 = (sym + 3) % 8 + 1;
        const safe3 = (sym + 4) % 8 + 1;
        
        matrix = [
            [sym, sym, safe1],
            [sym, sym, safe2],
            [sym, sym, safe3]
        ];
    }

    let totalWinFactor = evaluateGrid(matrix);

    if (totalWinFactor === 0) {
        const col0 = [matrix[0][0], matrix[1][0], matrix[2][0]];
        const col1 = [matrix[0][1], matrix[1][1], matrix[2][1]];
        const col2 = [matrix[0][2], matrix[1][2], matrix[2][2]];

        let respinCol = null;
        if (isMatch(col0, col1)) respinCol = 2;
        else if (isMatch(col1, col2)) respinCol = 0;
        else if (isMatch(col0, col2)) respinCol = 1;

        if (respinCol !== null) {
            triggeredRespin = true;
            matrix[0][respinCol] = getTile(getRandomByte());
            matrix[1][respinCol] = getTile(getRandomByte());
            matrix[2][respinCol] = getTile(getRandomByte());
            totalWinFactor = evaluateGrid(matrix);
        }
    }

    const targetSym = matrix.flat().find(v => v !== 0) || 0;
    let isFullGrid = matrix.flat().every(val => val === targetSym || val === 0);
    
    if (isFullGrid) {
        triggeredWheel = true;
        const multiRoll = Math.floor(Math.random() * 100);
        // 🔥 TRIMMED: EV perfectly balanced
        const multiplierHit = multiRoll >= 99 ? 10 : multiRoll >= 94 ? 5 : multiRoll >= 80 ? 4 : multiRoll >= 50 ? 3 : 2;
        totalWinFactor *= multiplierHit;
    }

    if (totalWinFactor > 800) totalWinFactor = 800;
    return { payoutFactor: totalWinFactor, triggeredRespin, triggeredWheel };
}

// SIMULATION EXECUTION
const SIMULATION_ROUNDS = 1_000_000;
let totalSpent = 0, totalWon = 0, winningSpins = 0, respinTriggers = 0, wheelTriggers = 0;

for (let i = 0; i < SIMULATION_ROUNDS; i++) {
    totalSpent += 1;
    const result = runSpinCycle();
    totalWon += result.payoutFactor;
    if (result.payoutFactor > 0) winningSpins++;
    if (result.triggeredRespin) respinTriggers++;
    if (result.triggeredWheel) wheelTriggers++;
}

console.log(`\n📊 V19 FINAL LOCK RESULTS (${SIMULATION_ROUNDS.toLocaleString()} Rounds)`);
console.log(`🎯 TRUE RTP: ${((totalWon / totalSpent) * 100).toFixed(2)}%`);
console.log(`🎯 HIT FREQUENCY: ${((winningSpins / SIMULATION_ROUNDS) * 100).toFixed(2)}%`);
console.log(`🔄 RESPINS: 1 in ${(SIMULATION_ROUNDS / respinTriggers).toFixed(1)} spins`);
console.log(`🎡 WHEELS:  1 in ${(SIMULATION_ROUNDS / wheelTriggers).toFixed(1)} spins`);