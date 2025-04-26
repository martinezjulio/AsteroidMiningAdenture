/*****************************************
 * main.js
 * - Demonstrators move via Manhattan path
 * - Vertical reward tank
 * - Summary bar in DOM below the bandit
 * - Zone background masked in bandit cells
 * - NEW features:
 *   1) Light highlight color (white-ish).
 *   2) Thick random-color border around #game-container for each zone
 *   3) Same random color used as border for summary bar icons of that zone
 ****************************************/

let timelineData = null;        
let currentStageIndex = 0;      
let prolificID = "";            

// We'll store summary icons (one per "game" stage).
let summaryIcons = []; 

// We'll store random colors for each zone: zoneColors[zoneNumber] = "#rrggbb"
let zoneColors = {};


// Adjust these as you wish:
const DEMO_SPRITE_SIZE = 40;       // user/demonstrator sprite size
const HIGHLIGHT_COLOR = 0xffffff;  // Lighter highlight => 0xffffff
const HIGHLIGHT_ALPHA = 0.25;      // Lighter alpha
const MARKER_DOT_RADIUS = 2;
const TANK_SLOT_SIZE = 12;         // Size of each slot in the reward tank
const TANK_SLOT_PADDING = 2;       // Padding between tank slots
const TANK_MARGIN_TOP = 100;       // Space between grid bottom and tank
const CELL_PADDING = 5;            // Spacing between cells (in pixels)

// Phaser config
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 700,
  parent: 'game-container',
  backgroundColor: '#000000',
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

function preload() {
  // Standard images
  this.load.image('user', 'assets/user.png');
  this.load.image('demonstrator01', 'assets/demonstrator01.png');
  this.load.image('demonstrator02', 'assets/demonstrator02.png');

  // Zone backgrounds (400x400 recommended)
  this.load.image('zone00', 'assets/zone00.png');
  this.load.image('zone01', 'assets/zone01.png');
  this.load.image('zone02', 'assets/zone02.png');
  // add more if needed
}

function create() {
  // Optional debug circle
  const circle = this.add.circle(400, 300, 40, 0xffff00, 1);
  circle.setDepth(99999);

  // Load timeline
  fetch('data/timeline.json')
    .then(r => r.json())
    .then(jsonData => {
      timelineData = jsonData;
      loadStage.call(this);
    })
    .catch(err => console.error("Error loading timeline JSON:", err));
}

function update(time, delta) {
  // Not used for this MVP
}

/****************************************************
 * loadStage():
 * Moves to the current stage. Also updates summary
 * icons if it's a practice/play/watch/indicate stage,
 * and sets a random color border on #game-container.
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

  // Possibly add an icon for summary
  maybeAddSummaryIcon(stage);

  // If stage has a zone, apply or retrieve random color
  if (stage.zone !== undefined && stage.zone !== null) {
    // If we have no color for this zone, generate one
    if (!zoneColors.hasOwnProperty(stage.zone)) {
      zoneColors[stage.zone] = pickRandomColor();
    }
    // Apply to #game-container border
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.border = `10px solid ${zoneColors[stage.zone]}`;
    }
  }

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

  // Rebuild the DOM-based summary bar
  redrawSummaryBarDOM();
}

/*******************************************************
 * Summaries / Icons below the bandit
 *******************************************************/

/**
 * If the stage is a game stage with a zone,
 * add a new summary icon. Also store the zone color for that icon.
 */
function maybeAddSummaryIcon(stage) {
  if (!stage.zone && stage.zone !== 0) return;  
  const t = stage.stage_type;
  if (!['practice','play','watch','indicate'].includes(t)) return;

  // Ensure a color is assigned to this zone
  if (!zoneColors.hasOwnProperty(stage.zone)) {
    zoneColors[stage.zone] = pickRandomColor();
  }

  let imageKey = 'user';
  if (t === 'watch' || t === 'indicate') {
    if (stage.demonstrator && stage.demonstrator.image) {
      imageKey = demonstratorKey(stage.demonstrator.image);
    } else {
      imageKey = 'demonstrator01'; // fallback
    }
  }

  summaryIcons.push({
    imageKey: imageKey,
    zone: stage.zone,
    color: zoneColors[stage.zone]  // store the random color
  });
}

/**
 * Re-draw the summary bar (#summary-bar in HTML).
 * Past icons are dimmed, the current icon is bright.
 * We also apply the zone color as a border for each cell.
 */
function redrawSummaryBarDOM() {
  const bar = document.getElementById('summary-bar');
  if (!bar) return;

  bar.innerHTML = "";
  if (summaryIcons.length === 0) return;

  const lastIndex = summaryIcons.length - 1;
  for (let i = 0; i < summaryIcons.length; i++) {
    const iconData = summaryIcons[i];

    // Create a container div
    const cellDiv = document.createElement("div");
    cellDiv.style.textAlign = "center"; 
    cellDiv.style.opacity = (i === lastIndex) ? "1" : "0.5";

    // Give it a border of the zone color
    cellDiv.style.border = `3px solid ${iconData.color}`;
    cellDiv.style.padding = "5px"; // some spacing from border

    // The image
    const img = document.createElement("img");
    img.src = "assets/" + iconData.imageKey + ".png";
    img.style.width = "40px";
    img.style.display = "block";

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
  const { bandit, num_arm_pulls, zone } = stage;
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading ${isPractice ? 'PRACTICE' : 'PLAY'} with grid: ${numRows}x${numCols}`);
  console.log('Bandit array:', JSON.stringify(bandit));
  
  // Fixed cell size based on 12x12 grid
  const FIXED_CELL_SIZE = 400 / 12; // ~33.33px per cell
  let cellWidth = FIXED_CELL_SIZE;
  let cellHeight = FIXED_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width (not just in the left portion)
  const gridOriginX = (this.sys.game.config.width - totalGridWidth) / 2;
  const gridOriginY = 100 + (400 - totalGridHeight) / 2;
  const gridBottomY = gridOriginY + totalGridHeight;

  this.add.text(10, 10, 
    `${isPractice ? "[PRACTICE]" : "[PLAY]"} stage. Grid: ${numRows}x${numCols}. Arrows=Move, Space=Pull`,
    { font: '16px Arial', fill: '#ffffff' }
  );

  // zone background
  createZoneBackgroundMask.call(this, zone, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Reward tank
  let pullOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

  // user sprite
  let cursorR = 0, cursorC = 0;
  let { x: initX, y: initY } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, 0, 0);
  let userSprite = this.add.image(initX, initY, 'user')
    .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
    .setDepth(9999)
    .setOrigin(0.5);

  // highlight rect
  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);
  highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);

  let pullsRemaining = num_arm_pulls;
  this.input.keyboard.on('keydown', (evt) => {
    if (pullsRemaining <= 0) return;

    let oldR = cursorR, oldC = cursorC;
    if (evt.code === 'ArrowUp')    cursorR = Phaser.Math.Clamp(cursorR - 1, 0, numRows-1);
    if (evt.code === 'ArrowDown')  cursorR = Phaser.Math.Clamp(cursorR + 1, 0, numRows-1);
    if (evt.code === 'ArrowLeft')  cursorC = Phaser.Math.Clamp(cursorC - 1, 0, numCols-1);
    if (evt.code === 'ArrowRight') cursorC = Phaser.Math.Clamp(cursorC + 1, 0, numCols-1);

    if (evt.code === 'Space') {
      pullsRemaining--;
      let payoff = bandit[cursorR][cursorC];
      let outcome = (Math.random() < payoff) ? 1 : 0;
      pullOutcomes.push(outcome);

      drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC, outcome);
      drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

      if (pullsRemaining <= 0) {
        makeNextButton.call(this, "Next", () => {
          nextStage.call(this);
        });
      }
    }

    if (oldR !== cursorR || oldC !== cursorC) {
      let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
      userSprite.setPosition(x, y);
      highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
    }
  });
}

/**
 * WATCH Stage
 */
function setupWatch(stage) {
  const { bandit, trajectory, demonstrator, zone } = stage;
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading WATCH with grid: ${numRows}x${numCols}`);
  
  // Fixed cell size based on 12x12 grid
  const FIXED_CELL_SIZE = 400 / 12; // ~33.33px per cell
  let cellWidth = FIXED_CELL_SIZE;
  let cellHeight = FIXED_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (this.sys.game.config.width - totalGridWidth) / 2;
  const gridOriginY = 100 + (400 - totalGridHeight) / 2;
  const gridBottomY = gridOriginY + totalGridHeight;

  this.add.text(10, 10, 
    "[WATCH] Manhattan path, highlight, red/green tank",
    { font: '16px Arial', fill: '#ffffff' }
  );

  createZoneBackgroundMask.call(this, zone, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  let watchOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  let currentR = 0, currentC = 0;
  if (trajectory.length > 0) {
    currentR = trajectory[0].row;
    currentC = trajectory[0].col;
  }
  let startPos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
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
        let pos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cell.r, cell.c);
        dSprite.setPosition(pos.x, pos.y);
        highlightCurrentCell(highlightRect, cell.r, cell.c, gridOriginX, gridOriginY, cellWidth, cellHeight);

        index++;
        if (index >= pathCells.length) {
          pathTimer.remove();
          currentR = target.row;
          currentC = target.col;

          // pull
          let payoff = bandit[currentR][currentC];
          let outcome = (Math.random() < payoff) ? 1 : 0;
          watchOutcomes.push(outcome);

          drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
          drawRewardTank.call(this, rewardTankContainer, totalSteps, watchOutcomes);

          currentStep++;
          moveAlongTrajectoryStep.call(this);
        }
      }
    });
  }
}

/**
 * INDICATE Stage
 */
function setupIndicate(stage) {
  const { bandit, trajectory, demonstrator, zone } = stage;
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading INDICATE with grid: ${numRows}x${numCols}`);
  
  // Fixed cell size based on 12x12 grid
  const FIXED_CELL_SIZE = 400 / 12; // ~33.33px per cell
  let cellWidth = FIXED_CELL_SIZE;
  let cellHeight = FIXED_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (this.sys.game.config.width - totalGridWidth) / 2;
  const gridOriginY = 100 + (400 - totalGridHeight) / 2;
  const gridBottomY = gridOriginY + totalGridHeight;

  this.add.text(10, 10, 
    "[INDICATE] Manhattan path, blinking highlight, no success/fail",
    { font: '16px Arial', fill: '#ffffff' }
  );

  createZoneBackgroundMask.call(this, zone, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  let indicateOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, indicateOutcomes);

  let currentR = 0, currentC = 0;
  if (trajectory.length > 0) {
    currentR = trajectory[0].row;
    currentC = trajectory[0].col;
  }
  let startPos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
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
        let pos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cell.r, cell.c);
        dSprite.setPosition(pos.x, pos.y);

        index++;
        if (index >= pathCells.length) {
          pathTimer.remove();

          currentR = target.row;
          currentC = target.col;
          indicateOutcomes.push(1); // step count
          drawRewardTank.call(this, rewardTankContainer, trajectory.length, indicateOutcomes);

          // blink highlight
          let g = this.add.graphics();
          g.fillStyle(HIGHLIGHT_COLOR, 1);
          g.fillRect(
            gridOriginX + currentC*(cellWidth + CELL_PADDING),
            gridOriginY + currentR*(cellHeight + CELL_PADDING),
            cellWidth, cellHeight
          );
          this.tweens.add({
            targets: g,
            alpha: 0.1,
            duration: 300,
            yoyo: true,
            repeat: 1,
            onComplete: () => {
              g.destroy();
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
 * Utility
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

function pickRandomColor() {
  // Generate random R,G,B
  let r = Math.floor(Math.random()*256);
  let g = Math.floor(Math.random()*256);
  let b = Math.floor(Math.random()*256);
  // Convert to hex string
  let rr = r.toString(16).padStart(2,"0");
  let gg = g.toString(16).padStart(2,"0");
  let bb = b.toString(16).padStart(2,"0");
  return "#" + rr + gg + bb;
}

/** 
 * createZoneBackgroundMask => same as before:
 * draws a zone background image masked by cells,
 * then draws cell borders on top
 */
function createZoneBackgroundMask(zone, gridX, gridY, numRows, numCols, cellWidth, cellHeight) {
  if (zone === undefined || zone === null) return;

  // First, add a black background for the entire grid area plus padding
  const totalWidth = (numCols * cellWidth) + ((numCols - 1) * CELL_PADDING);
  const totalHeight = (numRows * cellHeight) + ((numRows - 1) * CELL_PADDING);
  
  let bgRect = this.add.rectangle(
    gridX, 
    gridY, 
    totalWidth, 
    totalHeight, 
    0x000000
  ).setOrigin(0, 0).setDepth(0);

  // E.g. zone=1 => "zone01"
  let zoneKey = "zone0" + zone; 
  let zoneBg = this.add.image(gridX, gridY, zoneKey)
    .setOrigin(0, 0)
    .setDepth(1);

  let maskGraphics = this.add.graphics({ x: 0, y: 0 });
  maskGraphics.fillStyle(0xffffff, 1);
  
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      // Calculate position with padding
      let rx = gridX + c * (cellWidth + CELL_PADDING);
      let ry = gridY + r * (cellHeight + CELL_PADDING);
      maskGraphics.fillRect(rx, ry, cellWidth, cellHeight);
    }
  }

  let cellMask = maskGraphics.createGeometryMask();
  zoneBg.setMask(cellMask);

  // Hide the white shape so it doesn't appear
  maskGraphics.setVisible(false);

  // Draw the cell borders with a subtle white line
  let lineG = this.add.graphics({ lineStyle: { width: 1, color: 0x444444 } });
  lineG.setDepth(9998);
  
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      // Calculate position with padding
      let rx = gridX + c * (cellWidth + CELL_PADDING);
      let ry = gridY + r * (cellHeight + CELL_PADDING);
      lineG.strokeRect(rx, ry, cellWidth, cellHeight);
    }
  }
}

/**
 * Draw the horizontal reward tank with smaller slots.
 * 'outcomes': array of 1=success(green), 0=fail(red)
 */
function drawRewardTank(container, totalSlots, outcomes) {
  container.removeAll(true);

  // Add a border/background for the tank
  const totalWidth = totalSlots * (TANK_SLOT_SIZE + TANK_SLOT_PADDING) - TANK_SLOT_PADDING;
  const tankBg = this.add.rectangle(0, 0, totalWidth + 4, TANK_SLOT_SIZE + 4, 0x333333);
  tankBg.setOrigin(0.5, 0.5);  // Center the background
  container.add(tankBg);
  
  // Add a title above the tank
  const tankTitle = this.add.text(0, -15, "Mining Progress:", { 
    font: '14px Arial', 
    fill: '#ffffff' 
  });
  tankTitle.setOrigin(0.5, 0.5);  // Center the title
  container.add(tankTitle);

  for (let i = 0; i < totalSlots; i++) {
    let color = 0x444444;
    if (i < outcomes.length) {
      let val = outcomes[i];
      color = (val === 1) ? 0x00ff00 : 0xff0000; 
    }
    
    // Position slots horizontally, left to right, centered around the origin
    let slotX = (i * (TANK_SLOT_SIZE + TANK_SLOT_PADDING)) - (totalWidth / 2) + (TANK_SLOT_SIZE / 2);
    let slotRect = this.add.rectangle(slotX, 0, TANK_SLOT_SIZE, TANK_SLOT_SIZE, color);
    slotRect.setOrigin(0.5, 0.5);  // Center each slot
    container.add(slotRect);
  }
}

/** Smaller success/fail dot. */
function drawMarkerDot(gridX, gridY, cellWidth, cellHeight, row, col, outcome) {
  let { x, y } = getCellCenter(gridX, gridY, cellWidth, cellHeight, row, col);
  let offsetX = Phaser.Math.Between(-cellWidth/4, cellWidth/4);
  let offsetY = Phaser.Math.Between(-cellHeight/4, cellHeight/4);
  let color = (outcome === 1) ? 0x00ff00 : 0xff0000;

  let dot = this.add.circle(x + offsetX, y + offsetY, MARKER_DOT_RADIUS, color);
  dot.setDepth(99999);
}

/** 
 * place the sprite ~20px below the bottom edge of the cell
 */
function getCellBelow(gridX, gridY, cellWidth, cellHeight, row, col) {
  // Calculate position with padding
  const x = gridX + col * (cellWidth + CELL_PADDING) + (cellWidth/2);
  const cellBottom = gridY + row * (cellHeight + CELL_PADDING) + cellHeight;
  const y = cellBottom + 20;
  return { x, y };
}

/**
 * Return the center of the cell
 */
function getCellCenter(gridX, gridY, cellWidth, cellHeight, row, col) {
  return {
    x: gridX + col * (cellWidth + CELL_PADDING) + cellWidth/2,
    y: gridY + row * (cellHeight + CELL_PADDING) + cellHeight/2
  };
}

/**
 * Create a highlight rectangle for a single cell:
 * uses the new lighter color + alpha
 */
function createHighlightRect(cellWidth, cellHeight) {
  let highlightRect = this.add.rectangle(0, 0, cellWidth-2, cellHeight-2, HIGHLIGHT_COLOR, 1);
  highlightRect.setDepth(9998).setOrigin(0.5).setAlpha(HIGHLIGHT_ALPHA);
  return highlightRect;
}

/**
 * Move highlightRect to (r,c).
 */
function highlightCurrentCell(highRect, r, c, gridX, gridY, cellWidth, cellHeight) {
  let x = gridX + c * (cellWidth + CELL_PADDING) + cellWidth/2;
  let y = gridY + r * (cellHeight + CELL_PADDING) + cellHeight/2;
  highRect.setPosition(x, y);
  highRect.setFillStyle(HIGHLIGHT_COLOR, HIGHLIGHT_ALPHA);
}

/**
 * Convert e.g. "assets/demonstrator01.png" => "demonstrator01"
 */
function demonstratorKey(path) {
  return path.replace('assets/', '').replace('.png','');
}

/**
 * Returns a Manhattan path from (r1,c1) to (r2,c2).
 */
function getManhattanPath(r1, c1, r2, c2) {
  let path = [];
  let rr = r1;
  let cc = c1;
  path.push({ r: rr, c: cc });

  while (rr < r2) { rr++; path.push({ r: rr, c: cc }); }
  while (rr > r2) { rr--; path.push({ r: rr, c: cc }); }
  while (cc < c2) { cc++; path.push({ r: rr, c: cc }); }
  while (cc > c2) { cc--; path.push({ r: rr, c: cc }); }

  return path;
}

function showEndOfGameMessage() {
  this.add.text(
    this.sys.game.config.width / 2,
    this.sys.game.config.height / 2,
    "End of Game. Thank you!",
    { font: '24px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
}

/**
 * Creates a Phaser text button in the lower-right corner 
 * that, when clicked, runs the given callback.
 */
function makeNextButton(label, callback) {
    // Adjust these positions if you prefer
    const btn = this.add.text(
      this.sys.game.config.width - 100, // near right edge
      this.sys.game.config.height - 40, // near bottom
      label,
      { font: '18px Arial', fill: '#00ff00', backgroundColor: '#333', padding: 5 }
    ).setOrigin(0.5).setInteractive();
  
    btn.on('pointerdown', () => {
      if (callback) callback();
    });
  }