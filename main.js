/*****************************************
 * main.js
 * - Demonstrators move via Manhattan path
 * - Mining tank is closer to bandit (x=550)
 * - Summary "overview grid" is an HTML <div id="summary-bar"> 
 *   below the bandit, showing icons for all games
 *   (past ones dimmed, current one bright).
 ****************************************/

let timelineData = null;        
let currentStageIndex = 0;      
let prolificID = "";            

// We'll store summary icons (one per "game" stage).
// example: { imageKey: "user" or "demonstrator01", zone: 1 }
let summaryIcons = []; 

// Adjust these as desired:
const DEMO_SPRITE_SIZE = 40;       // user/demonstrator sprite size in the bandit
const HIGHLIGHT_COLOR = 0xbbbbbb;  
const MARKER_DOT_RADIUS = 2;       
const TANK_SLOT_SIZE = 12;         
const REWARD_TANK_X_OFFSET = 550;  // mining tank's X position

// Phaser config
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  backgroundColor: '#000000',
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

// Preload images
function preload() {
  this.load.image('user', 'assets/user.png');
  this.load.image('demonstrator01', 'assets/demonstrator01.png');
  this.load.image('demonstrator02', 'assets/demonstrator02.png');
}

function create() {
  // For debugging if you want:
  const circle = this.add.circle(400, 300, 40, 0xffff00, 1);
  circle.setDepth(99999);

  // Load timeline JSON
  fetch('data/timeline.json')
    .then(r => r.json())
    .then(jsonData => {
      timelineData = jsonData;
      loadStage.call(this);
    })
    .catch(err => console.error("Error loading timeline JSON:", err));
}

function update(time, delta) {
  // Not used in this MVP
}

/****************************************************
 * loadStage():
 * Moves to the current stage. Also updates summary
 * icons if it's a practice/play/watch/indicate stage.
 ****************************************************/
function loadStage() {
  if (!timelineData) return;
  if (currentStageIndex >= timelineData.timeline.length) {
    showEndOfGameMessage.call(this);
    return;
  }

  this.children.removeAll();
  document.getElementById('prolific-form-overlay').style.visibility = 'hidden';

  const stage = timelineData.timeline[currentStageIndex];
  console.log(`Loading stage ${currentStageIndex}, type: ${stage.stage_type}`);

  // Possibly add an icon for the summary overview
  maybeAddSummaryIcon(stage);

  // Switch to correct stage
  switch(stage.stage_type) {
    case 'prolific_id_form':
      setupProlificIdForm.call(this, stage);
      break;
    case 'introduction':
      setupIntroduction.call(this, stage);
      break;
    case 'practice':
      setupPlayOrPractice.call(this, stage, true);
      break;
    case 'play':
      setupPlayOrPractice.call(this, stage, false);
      break;
    case 'watch':
      setupWatch.call(this, stage);
      break;
    case 'indicate':
      setupIndicate.call(this, stage);
      break;
    default:
      console.warn("Unknown stage_type:", stage.stage_type);
      nextStage.call(this);
  }

  // Rebuild the DOM-based summary bar after loading each stage
  redrawSummaryBarDOM();
}

/*******************************************************
 * DOM-Based Summary Overview
 *******************************************************/

/**
 * If it's a "game" stage with zone, push a summary icon 
 * (user or demonstrator).
 */
function maybeAddSummaryIcon(stage) {
  // Must have a zone, and be one of these stage types
  if (!stage.zone && stage.zone !== 0) return;
  const t = stage.stage_type;
  if (!['practice','play','watch','indicate'].includes(t)) return;

  let imageKey = 'user';
  if (t === 'watch' || t === 'indicate') {
    if (stage.demonstrator && stage.demonstrator.image) {
      imageKey = demonstratorKey(stage.demonstrator.image);
    } else {
      imageKey = 'demonstrator01'; // fallback
    }
  }

  summaryIcons.push({ imageKey, zone: stage.zone });
}

/**
 * Rebuild the #summary-bar DOM element
 * so it shows all game icons in a single row,
 * dimming older ones (alpha=0.5) and highlighting the last one (alpha=1).
 */
function redrawSummaryBarDOM() {
  const bar = document.getElementById('summary-bar');
  if (!bar) return; // no #summary-bar in the HTML?

  // Clear existing
  bar.innerHTML = "";

  if (summaryIcons.length === 0) {
    // No icons to show
    return;
  }

  // The last icon is the current stage => alpha=1, older => alpha=0.5
  const lastIndex = summaryIcons.length - 1;

  for (let i = 0; i < summaryIcons.length; i++) {
    const iconData = summaryIcons[i];

    // We'll build a small <div> with an <img> plus a <div> for the zone text
    const cellDiv = document.createElement("div");
    cellDiv.style.textAlign = "center"; 
    cellDiv.style.opacity = (i === lastIndex) ? "1" : "0.5";

    // The image (we build a path "assets/<imageKey>.png")
    const img = document.createElement("img");
    img.src = "assets/" + iconData.imageKey + ".png";
    img.style.width = "40px";  // or whatever size
    img.style.display = "block"; // ensures label goes below

    // The zone label
    const label = document.createElement("div");
    label.textContent = "Zone " + iconData.zone;
    label.style.color = "#fff";
    label.style.marginTop = "4px";

    cellDiv.appendChild(img);
    cellDiv.appendChild(label);

    bar.appendChild(cellDiv);
  }
}

/*******************************************************
 * Setup Functions for Each Stage Type
 *******************************************************/
function setupProlificIdForm(stage) {
  alert("Prolific ID Form - type ID, then click Submit.");

  document.getElementById('prolific-form-overlay').style.visibility = 'visible';
  const msgEl = document.getElementById('prolific-form-message');
  msgEl.innerText = stage.message || "Please enter your Prolific ID:";

  const submitBtn = document.getElementById('prolific-submit-btn');
  submitBtn.onclick = () => {
    const inputEl = document.getElementById('prolific-id-input');
    prolificID = inputEl.value.trim();
    if (!prolificID) {
      alert("Please enter a valid Prolific ID.");
      return;
    }
    nextStage.call(this);
  };
}

function setupIntroduction(stage) {
  alert("Introduction stage: click Next to proceed.");

  this.add.text(
    this.sys.game.config.width/2,
    this.sys.game.config.height/2,
    stage.message || "Introduction",
    { font: '20px Arial', fill: '#ffffff', align: 'center', wordWrap: { width: 600 } }
  ).setOrigin(0.5);

  makeNextButton.call(this, "Next", () => {
    nextStage.call(this);
  });
}

/**
 * Common logic for practice/play
 */
function setupPlayOrPractice(stage, isPractice) {
  const { bandit, num_arm_pulls } = stage;
  let gridSize = bandit.length;
  let cellSize = 400 / gridSize;

  const gridOriginX = 50;
  const gridOriginY = 100;
  const gridBottomY = gridOriginY + (gridSize * cellSize);

  this.add.text(10, 10, 
    `${isPractice ? "[PRACTICE]" : "[PLAY]"}: user below each cell, highlight, small dot markers, vertical tank.`,
    { font: '16px Arial', fill: '#ffffff' }
  );

  // draw grid
  this.add.rectangle(
    gridOriginX + (cellSize * gridSize)/2,
    gridOriginY + (cellSize * gridSize)/2,
    cellSize * gridSize,
    cellSize * gridSize,
    0x222222
  ).setOrigin(0.5).setAlpha(0.3);

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      this.add.rectangle(
        gridOriginX + c*cellSize + cellSize/2,
        gridOriginY + r*cellSize + cellSize/2,
        cellSize-2, cellSize-2,
        0x666666
      ).setOrigin(0.5).setAlpha(0.3);
    }
  }

  // outcomes for the reward tank
  let pullOutcomes = [];
  const rewardTankContainer = this.add.container(REWARD_TANK_X_OFFSET, gridBottomY);
  drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

  // user sprite
  let cursorR = 0, cursorC = 0;
  let { x: initX, y: initY } = getCellBelow(gridOriginX, gridOriginY, cellSize, 0, 0);
  let userSprite = this.add.image(initX, initY, 'user')
    .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
    .setDepth(9999)
    .setOrigin(0.5);

  // highlight
  let highlightRect = createHighlightRect.call(this, cellSize);
  highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellSize);

  let pullsRemaining = num_arm_pulls;

  // input logic
  this.input.keyboard.on('keydown', (evt) => {
    if (pullsRemaining <= 0) return;

    let oldR = cursorR, oldC = cursorC;
    if (evt.code === 'ArrowUp')    cursorR = Phaser.Math.Clamp(cursorR - 1, 0, gridSize-1);
    if (evt.code === 'ArrowDown')  cursorR = Phaser.Math.Clamp(cursorR + 1, 0, gridSize-1);
    if (evt.code === 'ArrowLeft')  cursorC = Phaser.Math.Clamp(cursorC - 1, 0, gridSize-1);
    if (evt.code === 'ArrowRight') cursorC = Phaser.Math.Clamp(cursorC + 1, 0, gridSize-1);

    if (evt.code === 'Space') {
      pullsRemaining--;
      let payoff = bandit[cursorR][cursorC];
      let outcome = (Math.random() < payoff) ? 1 : 0;
      pullOutcomes.push(outcome);

      drawMarkerDot.call(this, gridOriginX, gridOriginY, cellSize, cursorR, cursorC, outcome);
      drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

      if (pullsRemaining <= 0) {
        makeNextButton.call(this, "Next", () => {
          nextStage.call(this);
        });
      }
    }

    if (oldR !== cursorR || oldC !== cursorC) {
      let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellSize, cursorR, cursorC);
      userSprite.setPosition(x, y);
      highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellSize);
    }
  });
}

/**
 * WATCH Stage with Manhattan movement
 */
function setupWatch(stage) {
  const { bandit, trajectory, demonstrator } = stage;
  let gridSize = bandit.length;
  let cellSize = 400 / gridSize;
  const gridOriginX = 50;
  const gridOriginY = 100;
  const gridBottomY = gridOriginY + (gridSize * cellSize);

  this.add.text(10, 10, 
    "[WATCH] Manhattan path, highlight, red/green tank",
    { font: '16px Arial', fill: '#ffffff' }
  );

  // grid
  this.add.rectangle(
    gridOriginX + (cellSize * gridSize)/2,
    gridOriginY + (cellSize * gridSize)/2,
    cellSize * gridSize,
    cellSize * gridSize,
    0x222222
  ).setOrigin(0.5).setAlpha(0.3);

  for (let r=0; r<gridSize; r++){
    for (let c=0; c<gridSize; c++){
      this.add.rectangle(
        gridOriginX + c*cellSize + cellSize/2,
        gridOriginY + r*cellSize + cellSize/2,
        cellSize-2, cellSize-2,
        0x666666
      ).setOrigin(0.5).setAlpha(0.3);
    }
  }

  let watchOutcomes = [];
  const rewardTankContainer = this.add.container(REWARD_TANK_X_OFFSET, gridBottomY);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellSize);

  // start the demonstrator
  let currentR = 0, currentC = 0;
  if (trajectory.length > 0) {
    currentR = trajectory[0].row;
    currentC = trajectory[0].col;
  }
  let startPos = getCellBelow(gridOriginX, gridOriginY, cellSize, currentR, currentC);
  let dSprite = this.add.image(startPos.x, startPos.y, demonstratorKey(demonstrator.image))
    .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
    .setDepth(9999)
    .setOrigin(0.5);

  let currentStep = 0;
  let totalSteps = trajectory.length;

  moveAlongTrajectoryStep.call(this);

  function moveAlongTrajectoryStep() {
    if (currentStep >= totalSteps) {
      makeNextButton.call(this, "Next", () => {
        nextStage.call(this);
      });
      return;
    }

    let target = trajectory[currentStep];
    let pathCells = getManhattanPath(currentR, currentC, target.row, target.col);

    let index = 0;
    let pathTimer = this.time.addEvent({
      delay: 300,
      repeat: pathCells.length - 1,
      callback: () => {
        let cell = pathCells[index];
        let pos = getCellBelow(gridOriginX, gridOriginY, cellSize, cell.r, cell.c);
        dSprite.setPosition(pos.x, pos.y);
        highlightCurrentCell(highlightRect, cell.r, cell.c, gridOriginX, gridOriginY, cellSize);

        index++;
        if (index >= pathCells.length) {
          pathTimer.remove();

          currentR = target.row;
          currentC = target.col;

          // pull arm
          let payoff = bandit[currentR][currentC];
          let outcome = (Math.random() < payoff) ? 1 : 0;
          watchOutcomes.push(outcome);

          drawMarkerDot.call(this, gridOriginX, gridOriginY, cellSize, currentR, currentC, outcome);
          drawRewardTank.call(this, rewardTankContainer, totalSteps, watchOutcomes);

          currentStep++;
          moveAlongTrajectoryStep.call(this);
        }
      }
    });
  }
}

/**
 * INDICATE Stage with Manhattan Movement
 */
function setupIndicate(stage) {
  const { bandit, trajectory, demonstrator } = stage;
  let gridSize = bandit.length;
  let cellSize = 400 / gridSize;
  const gridOriginX = 50;
  const gridOriginY = 100;
  const gridBottomY = gridOriginY + (gridSize * cellSize);

  this.add.text(10, 10, 
    "[INDICATE] Manhattan path, blinking highlight, no success/fail",
    { font: '16px Arial', fill: '#ffffff' }
  );

  // grid
  this.add.rectangle(
    gridOriginX + (cellSize * gridSize)/2,
    gridOriginY + (cellSize * gridSize)/2,
    cellSize * gridSize,
    cellSize * gridSize,
    0x222222
  ).setOrigin(0.5).setAlpha(0.3);

  let cellGraphics = [];
  for (let r=0; r<gridSize; r++){
    cellGraphics[r] = [];
    for (let c=0; c<gridSize; c++){
      let rect = this.add.rectangle(
        gridOriginX + c*cellSize + cellSize/2,
        gridOriginY + r*cellSize + cellSize/2,
        cellSize-2,
        cellSize-2,
        0x666666
      ).setOrigin(0.5).setAlpha(0.3);
      cellGraphics[r][c] = rect;
    }
  }

  // no success/fail
  let indicateOutcomes = [];
  const rewardTankContainer = this.add.container(REWARD_TANK_X_OFFSET, gridBottomY);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, indicateOutcomes);

  let currentR = 0, currentC = 0;
  if (trajectory.length > 0) {
    currentR = trajectory[0].row;
    currentC = trajectory[0].col;
  }
  let startPos = getCellBelow(gridOriginX, gridOriginY, cellSize, currentR, currentC);
  let dSprite = this.add.image(startPos.x, startPos.y, demonstratorKey(demonstrator.image))
    .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
    .setDepth(9999)
    .setOrigin(0.5);

  let currentStep = 0;
  let totalSteps = trajectory.length;

  moveAlongTrajectoryStep.call(this);

  function moveAlongTrajectoryStep() {
    if (currentStep >= totalSteps) {
      makeNextButton.call(this, "Next", () => {
        nextStage.call(this);
      });
      return;
    }

    let target = trajectory[currentStep];
    let pathCells = getManhattanPath(currentR, currentC, target.row, target.col);

    let index = 0;
    let pathTimer = this.time.addEvent({
      delay: 300,
      repeat: pathCells.length - 1,
      callback: () => {
        let cell = pathCells[index];
        let pos = getCellBelow(gridOriginX, gridOriginY, cellSize, cell.r, cell.c);
        dSprite.setPosition(pos.x, pos.y);

        index++;
        if (index >= pathCells.length) {
          pathTimer.remove();

          // arrived
          currentR = target.row;
          currentC = target.col;

          indicateOutcomes.push(1); // step count
          drawRewardTank.call(this, rewardTankContainer, totalSteps, indicateOutcomes);

          // Blink highlight
          let rect = cellGraphics[currentR][currentC];
          rect.setFillStyle(HIGHLIGHT_COLOR, 1);

          this.tweens.add({
            targets: rect,
            alpha: 0.1,
            duration: 300,
            yoyo: true,
            repeat: 1,
            onComplete: () => {
              rect.setFillStyle(0x666666, 0.3);
            }
          });

          currentStep++;
          moveAlongTrajectoryStep.call(this);
        }
      }
    });
  }
}

/************************************************
 * Utility / Support
 ************************************************/
function nextStage() {
  currentStageIndex++;
  loadStage.call(this);
}

function showEndOfGameMessage() {
  this.add.text(
    this.sys.game.config.width / 2,
    this.sys.game.config.height / 2,
    "End of Game. Thank you!",
    { font: '24px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
}

function makeNextButton(label, callback) {
  const btn = this.add.text(
    this.sys.game.config.width - 100,
    this.sys.game.config.height - 40,
    label,
    { font: '18px Arial', fill: '#00ff00', backgroundColor: '#333', padding: 5 }
  ).setOrigin(0.5).setInteractive();

  btn.on('pointerdown', () => {
    if (callback) callback();
  });
}

/**
 * Draw the vertical reward tank with smaller slots.
 * 'outcomes': an array of 1=success(green),0=fail(red)
 */
function drawRewardTank(container, totalSlots, outcomes) {
  container.removeAll(true);

  for (let i = 0; i < totalSlots; i++) {
    let color = 0x444444;
    if (i < outcomes.length) {
      let val = outcomes[i];
      color = (val === 1) ? 0x00ff00 : 0xff0000; 
    }
    let slotY = -i * (TANK_SLOT_SIZE + 2);
    let slotRect = this.add.rectangle(0, slotY, TANK_SLOT_SIZE, TANK_SLOT_SIZE, color);
    slotRect.setOrigin(0.5, 1);
    container.add(slotRect);
  }
}

/** Draw a small success/fail dot in the bandit. */
function drawMarkerDot(gridX, gridY, cellSize, row, col, outcome) {
  let { x, y } = getCellCenter(gridX, gridY, cellSize, row, col);
  let offsetX = Phaser.Math.Between(-cellSize/4, cellSize/4);
  let offsetY = Phaser.Math.Between(-cellSize/4, cellSize/4);
  let color = (outcome === 1) ? 0x00ff00 : 0xff0000;

  let dot = this.add.circle(x + offsetX, y + offsetY, MARKER_DOT_RADIUS, color);
  dot.setDepth(99999);
}

/** Position the sprite below the cell by ~20px. */
function getCellBelow(gridX, gridY, cellSize, row, col) {
  const cellBottom = gridY + (row+1)*cellSize;
  let x = gridX + col*cellSize + (cellSize/2);
  let y = cellBottom + 20;
  return { x, y };
}

/** Return the center of the cell. */
function getCellCenter(gridX, gridY, cellSize, row, col) {
  return {
    x: gridX + col*cellSize + cellSize/2,
    y: gridY + row*cellSize + cellSize/2
  };
}

/** Create highlight rectangle for a single cell. */
function createHighlightRect(cellSize) {
  let highlightRect = this.add.rectangle(0, 0, cellSize-2, cellSize-2, HIGHLIGHT_COLOR, 1);
  highlightRect.setDepth(9998).setOrigin(0.5).setAlpha(0.4);
  return highlightRect;
}

/** Move highlightRect to (r,c). */
function highlightCurrentCell(highRect, r, c, gridX, gridY, cellSize) {
  let x = gridX + c*cellSize + cellSize/2;
  let y = gridY + r*cellSize + cellSize/2;
  highRect.setPosition(x, y);
  highRect.setFillStyle(HIGHLIGHT_COLOR, 0.4);
}

/** Convert "assets/demonstrator01.png" => "demonstrator01". */
function demonstratorKey(path) {
  return path.replace('assets/', '').replace('.png','');
}

/** Return a Manhattan path of grid cells from (r1,c1) to (r2,c2). */
function getManhattanPath(r1, c1, r2, c2) {
  let path = [];
  let rr = r1;
  let cc = c1;
  path.push({ r: rr, c: cc });

  // Row difference
  while (rr < r2) { rr++; path.push({ r: rr, c: cc }); }
  while (rr > r2) { rr--; path.push({ r: rr, c: cc }); }
  // Col difference
  while (cc < c2) { cc++; path.push({ r: rr, c: cc }); }
  while (cc > c2) { cc--; path.push({ r: rr, c: cc }); }

  return path;
}