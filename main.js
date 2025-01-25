/*****************************************
 * main.js
 * - Demonstrators move via Manhattan path
 * - Mining tank is closer to bandit (x=550)
 * - Summary bar in HTML below the bandit
 * - NEW: Zone-specific background image revealed
 *   only inside the cells.
 ****************************************/

let timelineData = null;        
let currentStageIndex = 0;      
let prolificID = "";            

// We'll store summary icons (one per "game" stage).
let summaryIcons = []; 

// Adjust these as you wish:
const DEMO_SPRITE_SIZE = 40;       // user/demonstrator sprite size
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

/**
 * Preload images:
 *  - user, demonstrator01, demonstrator02, etc.
 *  - Also zone00.png, zone01.png, zone02.png, etc. if needed.
 */
function preload() {
  // Required
  this.load.image('user', 'assets/user.png');
  this.load.image('demonstrator01', 'assets/demonstrator01.png');
  this.load.image('demonstrator02', 'assets/demonstrator02.png');

  // If you have multiple zones, load them here:
  // Example for zone=0,1,2:
  this.load.image('zone00', 'assets/zone00.png');
  this.load.image('zone01', 'assets/zone01.png');
  this.load.image('zone02', 'assets/zone02.png');
  // Add more if you have more zones...
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

  // Possibly add an icon for summary
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

  // Rebuild the DOM-based summary bar
  redrawSummaryBarDOM();
}

/*******************************************************
 * DOM-Based Summary Overview
 *******************************************************/
function maybeAddSummaryIcon(stage) {
  // Must have a zone, and be practice/play/watch/indicate
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

function redrawSummaryBarDOM() {
  const bar = document.getElementById('summary-bar');
  if (!bar) return;

  bar.innerHTML = "";
  if (summaryIcons.length === 0) return;

  const lastIndex = summaryIcons.length - 1;
  for (let i = 0; i < summaryIcons.length; i++) {
    const iconData = summaryIcons[i];

    const cellDiv = document.createElement("div");
    cellDiv.style.textAlign = "center"; 
    cellDiv.style.opacity = (i === lastIndex) ? "1" : "0.5";

    const img = document.createElement("img");
    img.src = "assets/" + iconData.imageKey + ".png";
    img.style.width = "40px";
    img.style.display = "block";

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
  let gridSize = bandit.length;
  let cellSize = 400 / gridSize;

  const gridOriginX = 50;
  const gridOriginY = 100;
  const gridBottomY = gridOriginY + (gridSize * cellSize);

  this.add.text(10, 10, 
    `${isPractice ? "[PRACTICE]" : "[PLAY]"} stage. Arrows to move, Space to pull.`,
    { font: '16px Arial', fill: '#ffffff' }
  );

  // 1) Create a zone background if needed:
  createZoneBackgroundMask.call(this, zone, gridOriginX, gridOriginY, gridSize, cellSize);

  // 2) outcomes for the reward tank
  let pullOutcomes = [];
  const rewardTankContainer = this.add.container(REWARD_TANK_X_OFFSET, gridBottomY);
  drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

  // 3) User sprite
  let cursorR = 0, cursorC = 0;
  let { x: initX, y: initY } = getCellBelow(gridOriginX, gridOriginY, cellSize, 0, 0);
  let userSprite = this.add.image(initX, initY, 'user')
    .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
    .setDepth(9999)
    .setOrigin(0.5);

  // 4) highlight rectangle
  let highlightRect = createHighlightRect.call(this, cellSize);
  highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellSize);

  // 5) Keyboard logic
  let pullsRemaining = num_arm_pulls;
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
  const { bandit, trajectory, demonstrator, zone } = stage;
  let gridSize = bandit.length;
  let cellSize = 400 / gridSize;
  const gridOriginX = 50;
  const gridOriginY = 100;
  const gridBottomY = gridOriginY + (gridSize * cellSize);

  this.add.text(10, 10, 
    "[WATCH] Manhattan path, highlight, red/green tank",
    { font: '16px Arial', fill: '#ffffff' }
  );

  // 1) zone background
  createZoneBackgroundMask.call(this, zone, gridOriginX, gridOriginY, gridSize, cellSize);

  // 2) watch outcomes
  let watchOutcomes = [];
  const rewardTankContainer = this.add.container(REWARD_TANK_X_OFFSET, gridBottomY);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellSize);

  // start demonstrator
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

          // pull
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
  const { bandit, trajectory, demonstrator, zone } = stage;
  let gridSize = bandit.length;
  let cellSize = 400 / gridSize;
  const gridOriginX = 50;
  const gridOriginY = 100;
  const gridBottomY = gridOriginY + (gridSize * cellSize);

  this.add.text(10, 10, 
    "[INDICATE] Manhattan path, blinking highlight, no success/fail",
    { font: '16px Arial', fill: '#ffffff' }
  );

  // 1) zone background
  createZoneBackgroundMask.call(this, zone, gridOriginX, gridOriginY, gridSize, cellSize);

  // 2) no success/fail
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

          currentR = target.row;
          currentC = target.col;
          indicateOutcomes.push(1); // step count
          drawRewardTank.call(this, rewardTankContainer, trajectory.length, indicateOutcomes);

          // blink highlight
          let rect = null; // We no longer do separate "cell rects" here
          // But if you want to highlight, or do something similar to watch, you can
          // do a phaser shape or find a stored shape, etc.

          let g = this.add.graphics();
          g.fillStyle(HIGHLIGHT_COLOR, 1);
          g.fillRect(
            gridOriginX + currentC*cellSize,
            gridOriginY + currentR*cellSize,
            cellSize, cellSize
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
 * Creates a background image for the given 'zone' and masks it so
 * only the bandit cells are visible. Also draws the cell borders.
 * 
 * zone => number, e.g. 0 => zone00.png, 1 => zone01.png, etc.
 * If zone is undefined, do nothing.
 */
function createZoneBackgroundMask(zone, gridX, gridY, gridSize, cellSize) {
  if (zone === undefined || zone === null) return;
  // Build an image key => e.g. "zone01" if zone=1
  const zoneKey = "zone0" + zone; 
  // If you have zone < 10 => "zone00", "zone01", etc. Just ensure the keys match your assets.

  // 1) Place the zone image behind everything. 
  //    We'll position it so its top-left aligns with (gridX, gridY).
  //    Make sure your zone image is 400×400 if your grid is 400×400.
  let zoneBg = this.add.image(gridX, gridY, zoneKey)
    .setOrigin(0, 0)
    .setDepth(0); // behind other objects

  // 2) Create a graphics shape that fills each cell => the "window" area
  let maskGraphics = this.add.graphics({ x: 0, y: 0 });
  maskGraphics.fillStyle(0xffffff, 1);

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      let rx = gridX + c * cellSize;
      let ry = gridY + r * cellSize;
      // fillRect full cell => reveal it
      maskGraphics.fillRect(rx, ry, cellSize, cellSize);
    }
  }

  // 3) Create a geometry mask from that shape
  let cellMask = maskGraphics.createGeometryMask();
  // Apply the mask to the zone image => only the cells become visible
  zoneBg.setMask(cellMask);

  // 4) Draw the cell borders on top
  let lineG = this.add.graphics({ lineStyle: { width: 1, color: 0xffffff } });
  lineG.setDepth(9998);
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      let rx = gridX + c * cellSize;
      let ry = gridY + r * cellSize;
      lineG.strokeRect(rx, ry, cellSize, cellSize);
    }
  }
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