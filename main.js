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
let currentSessionIndex = 0;      // Which session we're on
let currentStageIndex = 0;        // Which stage within the session we're on      
let prolificID = "";            

// We'll store summary icons (one per "game" stage).
let summaryIcons = []; 

// Adjust these as you wish:
const DEMO_SPRITE_SIZE = 40;       // user/demonstrator sprite size
const HIGHLIGHT_COLOR = 0xffffff;  // Lighter highlight => 0xffffff
const HIGHLIGHT_ALPHA = 0.25;      // Lighter alpha
const MARKER_DOT_RADIUS = 2;
const TANK_SLOT_SIZE = 12;         // Size of each slot in the reward tank
const TANK_SLOT_PADDING = 2;       // Padding between tank slots
const TANK_MARGIN_TOP = 100;       // Space between grid bottom and tank
const CELL_PADDING = 5;            // Spacing between cells (in pixels)
const BASE_CELL_SIZE = (400 / 12) * 1.5; // ~50% larger than before

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
  
  // We'll load specific demonstrator and asteroid images as needed in each stage
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
 * Loads and sets up the current stage based on session and stage indices.
 ****************************************************/
function loadStage() {
  if (!timelineData) return;
  
  // Check if we've reached the end of all sessions
  if (currentSessionIndex >= timelineData.timeline.length) {
    showEndOfGameMessage.call(this);
    return;
  }
  
  // Check if we've reached the end of current session
  const currentSession = timelineData.timeline[currentSessionIndex];
  if (currentStageIndex >= currentSession.length) {
    // This should be handled by nextStage now, but just in case
    currentSessionIndex++;
    currentStageIndex = 0;
    
    // Check again if we're done with all sessions
    if (currentSessionIndex >= timelineData.timeline.length) {
      showEndOfGameMessage.call(this);
      return;
    }
  }

  this.children.removeAll();
  document.getElementById('prolific-form-overlay').style.visibility = 'hidden';

  const stage = timelineData.timeline[currentSessionIndex][currentStageIndex];
  console.log(`Loading session ${currentSessionIndex}, stage ${currentStageIndex}, type: ${stage.stage_type}`);

  // Possibly add an icon for summary
  maybeAddSummaryIcon(stage);

  // If stage has a zone, apply its color to the game container border
  if (stage.zone) {
    const zoneColor = stage.zone.color || "#ffffff";
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.border = `10px solid ${zoneColor}`;
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
 * add a new summary icon.
 */
function maybeAddSummaryIcon(stage) {
  if (!stage.zone) return;  
  const t = stage.stage_type;
  if (!['practice','play','watch','indicate'].includes(t)) return;

  let imageKey = 'user';
  if (t === 'watch' || t === 'indicate') {
    if (stage.demonstrator && stage.demonstrator.image) {
      // Extract just the filename without path and extension
      imageKey = stage.demonstrator.image.replace('.png', '');
    } else {
      imageKey = 'demonstrator_01'; // fallback
    }
  }

  summaryIcons.push({
    imageKey: imageKey,
    zone: stage.zone.index,
    color: stage.zone.color || '#ffffff'
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
    if (iconData.imageKey.startsWith('demonstrator_')) {
      img.src = `assets/demonstrators/${iconData.imageKey}.png`;
    } else {
      img.src = `assets/${iconData.imageKey}.png`;
    }
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
  if (!stage.zone || !stage.zone.bandit) {
    console.error("Missing zone or bandit data");
    return;
  }
  
  const bandit = stage.zone.bandit;
  const num_arm_pulls = stage.num_arm_pulls;
  
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading ${isPractice ? 'PRACTICE' : 'PLAY'} with grid: ${numRows}x${numCols}`);
  
  // Use the larger fixed cell size 
  let cellWidth = BASE_CELL_SIZE;
  let cellHeight = BASE_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (this.sys.game.config.width - totalGridWidth) / 2;
  const gridOriginY = 100 + (400 - totalGridHeight) / 2;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

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
      
      // Create a simple flash effect (just one flash)
      let g = this.add.graphics();
      g.fillStyle(HIGHLIGHT_COLOR, 1);
      g.fillRect(
        gridOriginX + cursorC*(cellWidth + CELL_PADDING),
        gridOriginY + cursorR*(cellHeight + CELL_PADDING),
        cellWidth, cellHeight
      );
      
      // Fade out only to get a single flash
      this.tweens.add({
        targets: g,
        alpha: 0,
        duration: 400,
        onComplete: () => {
          g.destroy();
          
          // Record outcome and update tank
          pullOutcomes.push(outcome);
          drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC, outcome);
          drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

          if (pullsRemaining <= 0) {
            makeNextButton.call(this, "Next", () => {
              nextStage.call(this);
            });
          }
        }
      });
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
  if (!stage.zone || !stage.zone.bandit || !stage.demonstrator) {
    console.error("Missing zone, bandit, or demonstrator data");
    return;
  }
  
  const bandit = stage.zone.bandit;
  const trajectory = stage.demonstrator.trajectory;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading WATCH with grid: ${numRows}x${numCols}`);
  
  // Use the larger fixed cell size
  let cellWidth = BASE_CELL_SIZE;
  let cellHeight = BASE_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (this.sys.game.config.width - totalGridWidth) / 2;
  const gridOriginY = 100 + (400 - totalGridHeight) / 2;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Keep reward tank for watch stages to show mining outcomes
  // Use trajectory length for num_arm_pulls if it's null
  const totalPulls = stage.num_arm_pulls || trajectory.length;
  let watchOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  drawRewardTank.call(this, rewardTankContainer, totalPulls, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Load demonstrator image if not already loaded
  const demoImageKey = `demonstrator_${stage.demonstrator.index}`;
  if (!this.textures.exists(demoImageKey)) {
    this.load.image(demoImageKey, `assets/demonstrators/${stage.demonstrator.image}`);
    this.load.once('complete', () => {
      startDemonstration.call(this);
    });
    this.load.start();
  } else {
    startDemonstration.call(this);
  }
  
  function startDemonstration() {
    let startPos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
    let dSprite = this.add.image(startPos.x, startPos.y, demoImageKey)
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

      let targetLinearIndex = trajectory[currentStep];
      let targetR = Math.floor(targetLinearIndex / numCols);
      let targetC = targetLinearIndex % numCols;
      
      let pathCells = getManhattanPath(currentR, currentC, targetR, targetC);

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
            currentR = targetR;
            currentC = targetC;

            // Calculate outcome first
            let payoff = bandit[currentR][currentC];
            let outcome = (Math.random() < payoff) ? 1 : 0;
            
            // Create a simple flash effect (just one flash)
            let g = this.add.graphics();
            g.fillStyle(HIGHLIGHT_COLOR, 1);
            g.fillRect(
              gridOriginX + currentC*(cellWidth + CELL_PADDING),
              gridOriginY + currentR*(cellHeight + CELL_PADDING),
              cellWidth, cellHeight
            );
            
            // Fade out only (NO YOYO!) to get a single flash
            this.tweens.add({
              targets: g,
              alpha: 0,
              duration: 400,
              onComplete: () => {
                g.destroy();
                
                // Record outcome and update tank
                watchOutcomes.push(outcome);
                drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                drawRewardTank.call(this, rewardTankContainer, totalPulls, watchOutcomes);

                currentStep++;
                moveAlongTrajectoryStep.call(this);
              }
            });
          }
        }
      });
    }
  }
}

/**
 * INDICATE Stage
 */
function setupIndicate(stage) {
  if (!stage.zone || !stage.zone.bandit || !stage.demonstrator) {
    console.error("Missing zone, bandit, or demonstrator data");
    return;
  }
  
  const bandit = stage.zone.bandit;
  const trajectory = stage.demonstrator.trajectory;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading INDICATE with grid: ${numRows}x${numCols}`);
  console.log(`Trajectory length: ${trajectory.length}`);
  
  // Use the larger fixed cell size
  let cellWidth = BASE_CELL_SIZE;
  let cellHeight = BASE_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (this.sys.game.config.width - totalGridWidth) / 2;
  const gridOriginY = 100 + (400 - totalGridHeight) / 2;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Note: We don't create a mining progress bar for indicate stages
  
  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Load demonstrator image if not already loaded
  const demoImageKey = `demonstrator_${stage.demonstrator.index}`;
  if (!this.textures.exists(demoImageKey)) {
    this.load.image(demoImageKey, `assets/demonstrators/${stage.demonstrator.image}`);
    this.load.once('complete', () => {
      startDemonstration.call(this);
    });
    this.load.start();
  } else {
    startDemonstration.call(this);
  }
  
  function startDemonstration() {
    let startPos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
    let dSprite = this.add.image(startPos.x, startPos.y, demoImageKey)
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

      let targetLinearIndex = trajectory[currentStep];
      let targetR = Math.floor(targetLinearIndex / numCols);
      let targetC = targetLinearIndex % numCols;
      
      let pathCells = getManhattanPath(currentR, currentC, targetR, targetC);

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

            currentR = targetR;
            currentC = targetC;
            
            // No mining tank updates in indicate mode
            
            // Create a more pronounced blinking highlight
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
              repeat: 2, // More repeats for better visibility
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
}

/************************************************
 * Utility
 ************************************************/
function nextStage() {
  currentStageIndex++;
  
  // Check if we need to move to the next session or if we're at the end
  if (currentSessionIndex >= timelineData.timeline.length) {
    showEndOfGameMessage.call(this);
    return;
  }
  
  if (currentStageIndex >= timelineData.timeline[currentSessionIndex].length) {
    currentSessionIndex++;
    currentStageIndex = 0;
    
    if (currentSessionIndex >= timelineData.timeline.length) {
      showEndOfGameMessage.call(this);
      return;
    }
  }
  
  // Get the next stage
  const nextStage = timelineData.timeline[currentSessionIndex][currentStageIndex];
  
  // Check if it's a gameplay stage that needs a transition overlay
  const gameplayStages = ['practice', 'play', 'watch', 'indicate'];
  if (gameplayStages.includes(nextStage.stage_type)) {
    // Show the transition overlay
    showTransitionOverlay(this, nextStage, () => {
      // This callback runs when the user clicks the button
      loadStage.call(this);
    });
  } else {
    // For non-gameplay stages, just load directly
    loadStage.call(this);
  }
}

function showEndOfGameMessage() {
  // Clear the game screen
  this.children.removeAll();

  // Add a semi-transparent overlay
  const overlay = this.add.rectangle(
    0, 0, 
    this.sys.game.config.width, 
    this.sys.game.config.height, 
    0x000000, 0.7
  );
  overlay.setOrigin(0, 0);

  // Add the end of game message
  const message = this.add.text(
    this.sys.game.config.width / 2,
    this.sys.game.config.height / 2 - 50,
    "Game has ended",
    { 
      font: '32px Arial', 
      fill: '#ffffff',
      align: 'center'
    }
  ).setOrigin(0.5);

  // Create a button to return to Prolific
  const returnUrl = timelineData.return_url || "https://www.google.com";
  const buttonWidth = 250;
  const buttonHeight = 50;
  
  const buttonBackground = this.add.rectangle(
    this.sys.game.config.width / 2,
    this.sys.game.config.height / 2 + 30,
    buttonWidth,
    buttonHeight,
    0x4CAF50
  ).setOrigin(0.5).setInteractive();
  
  const buttonText = this.add.text(
    this.sys.game.config.width / 2,
    this.sys.game.config.height / 2 + 30,
    "Click here to return to Prolific",
    { 
      font: '18px Arial', 
      fill: '#ffffff',
      align: 'center'
    }
  ).setOrigin(0.5);

  // Make button clickable
  buttonBackground.on('pointerover', () => {
    buttonBackground.setFillStyle(0x45a049); // Darker shade when hovered
    document.body.style.cursor = 'pointer';
  });
  
  buttonBackground.on('pointerout', () => {
    buttonBackground.setFillStyle(0x4CAF50); // Original color
    document.body.style.cursor = 'default';
  });
  
  buttonBackground.on('pointerdown', () => {
    window.location.href = returnUrl;
  });
}

/** 
 * createZoneBackgroundMask:
 * Creates cell backgrounds based on zone.mode:
 * - landscape: one background image masked by all cells
 * - asteroid: each cell gets its own specified asteroid image
 */
function createZoneBackgroundMask(stage, gridX, gridY, numRows, numCols, cellWidth, cellHeight) {
  if (!stage.zone) return;

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

  const zoneMode = stage.zone.mode || "landscape";

  if (zoneMode === "landscape") {
    // LANDSCAPE MODE: one background for all cells
    // Make sure we've loaded the landscape image
    const landscapeImage = stage.zone.images[0];
    const landscapeKey = `landscape_${stage.zone.index}`;
    
    if (!this.textures.exists(landscapeKey)) {
      this.load.image(landscapeKey, `assets/landscapes/${landscapeImage}`);
      this.load.once('complete', () => {
        createLandscapeBackground.call(this, landscapeKey, gridX, gridY, numRows, numCols, cellWidth, cellHeight);
      });
      this.load.start();
    } else {
      createLandscapeBackground.call(this, landscapeKey, gridX, gridY, numRows, numCols, cellWidth, cellHeight);
    }
  } 
  else if (zoneMode === "asteroid") {
    // ASTEROID MODE: each cell gets its own asteroid
    // Make sure we've loaded all the asteroid images
    const asteroidImages = stage.zone.images;
    const imageKeys = [];

    // Create a loader for all asteroid images
    let loadingRequired = false;
    for (let i = 0; i < asteroidImages.length; i++) {
      const asteroidKey = `asteroid_${stage.zone.index}_${i}`;
      imageKeys.push(asteroidKey);
      
      if (!this.textures.exists(asteroidKey)) {
        this.load.image(asteroidKey, `assets/asteroids/${asteroidImages[i]}`);
        loadingRequired = true;
      }
    }

    if (loadingRequired) {
      this.load.once('complete', () => {
        createAsteroidBackgrounds.call(this, imageKeys, gridX, gridY, numRows, numCols, cellWidth, cellHeight);
      });
      this.load.start();
    } else {
      createAsteroidBackgrounds.call(this, imageKeys, gridX, gridY, numRows, numCols, cellWidth, cellHeight);
    }
  }

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
 * Helper function to create landscape background 
 */
function createLandscapeBackground(landscapeKey, gridX, gridY, numRows, numCols, cellWidth, cellHeight) {
  // Create landscape background
  let zoneBg = this.add.image(gridX, gridY, landscapeKey)
    .setOrigin(0, 0)
    .setDepth(1);
    
  // Create mask for all cells
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
}

/**
 * Helper function to create asteroid backgrounds
 */
function createAsteroidBackgrounds(imageKeys, gridX, gridY, numRows, numCols, cellWidth, cellHeight) {
  // Place asteroids in each cell
  let index = 0;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (index >= imageKeys.length) break;
      
      // Calculate position with padding
      let rx = gridX + c * (cellWidth + CELL_PADDING);
      let ry = gridY + r * (cellHeight + CELL_PADDING);
      
      // Add the asteroid image
      const asteroidKey = imageKeys[index];
      index++;
      
      const asteroidImg = this.add.image(rx + cellWidth/2, ry + cellHeight/2, asteroidKey)
        .setDepth(1);
      
      // Scale asteroid to fit inside cell while maintaining aspect ratio
      let scale = Math.min(
        cellWidth / asteroidImg.width,
        cellHeight / asteroidImg.height
      );
      asteroidImg.setScale(scale);
      
      // Create a mask for this specific cell
      let cellMaskGraphics = this.add.graphics({ x: 0, y: 0 });
      cellMaskGraphics.fillStyle(0xffffff, 1);
      cellMaskGraphics.fillRect(rx, ry, cellWidth, cellHeight);
      
      let cellMask = cellMaskGraphics.createGeometryMask();
      asteroidImg.setMask(cellMask);
      
      // Hide the mask graphics
      cellMaskGraphics.setVisible(false);
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

/**
 * Add zone labels to the four corners of the game container
 */
function addZoneLabels(scene, zoneIndex) {
  const gameContainer = document.getElementById('game-container');
  const containerWidth = gameContainer.offsetWidth;
  const containerHeight = gameContainer.offsetHeight;
  
  // Create the label text
  const labelText = `Zone ${zoneIndex}`;
  
  // Top left
  scene.add.text(
    10, 10, 
    labelText, 
    { font: '16px Arial', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setDepth(10000);
  
  // Top right
  scene.add.text(
    scene.sys.game.config.width - 10, 10, 
    labelText, 
    { font: '16px Arial', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setOrigin(1, 0).setDepth(10000);
  
  // Bottom left
  scene.add.text(
    10, scene.sys.game.config.height - 10, 
    labelText, 
    { font: '16px Arial', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setOrigin(0, 1).setDepth(10000);
  
  // Bottom right
  scene.add.text(
    scene.sys.game.config.width - 10, scene.sys.game.config.height - 10, 
    labelText, 
    { font: '16px Arial', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setOrigin(1, 1).setDepth(10000);
}

/**
 * Shows a transition overlay before starting a gameplay stage.
 * @param {object} scene - The Phaser scene
 * @param {object} nextStage - The stage that will be shown next
 * @param {function} startCallback - Function to call when the user clicks the button
 */
function showTransitionOverlay(scene, nextStage, startCallback) {
  // Clear existing scene elements
  scene.children.removeAll();
  
  // Add a semi-transparent overlay background
  const overlay = scene.add.rectangle(
    0, 0, 
    scene.sys.game.config.width, 
    scene.sys.game.config.height, 
    0x000000, 0.85
  );
  overlay.setOrigin(0, 0);
  
  // Get stage type and set button text accordingly
  const stageType = nextStage.stage_type;
  let buttonText;
  
  switch(stageType) {
    case 'practice': buttonText = 'Practice'; break;
    case 'play': buttonText = 'Play'; break;
    case 'watch': buttonText = 'Watch'; break;
    case 'indicate': buttonText = 'Watch'; break; // Indicate also uses "Watch"
    default: buttonText = 'Next';
  }
  
  // Get the overlay message
  const message = nextStage["overlay-message"] || `Get ready to ${buttonText.toLowerCase()}!`;
  
  // Add the message text
  const messageText = scene.add.text(
    scene.sys.game.config.width / 2,
    150,
    message,
    { 
      font: '24px Arial', 
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }
  ).setOrigin(0.5);
  
  // Update the game container border color immediately to match the next stage's zone
  if (nextStage.zone && nextStage.zone.color) {
    const zoneColor = nextStage.zone.color;
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.border = `10px solid ${zoneColor}`;
      console.log(`Updated game container border to ${zoneColor}`);
    }
  }
  
  // Create the button early so it always appears
  createButton();
  
  // Get zone info
  const zone = nextStage.zone;
  if (zone) {
    const zoneColor = zone.color || '#ffffff';
    const zoneIndex = zone.index;
    
    // Create a single icon similar to the summary bar items
    createSummaryStyleIcon(scene, stageType, nextStage, zoneColor, zoneIndex);
  }
  
  // Create a summary-style icon (similar to the summary bar)
  function createSummaryStyleIcon(scene, stageType, nextStage, zoneColor, zoneIndex) {
    console.log(`Creating summary icon with zone color: ${zoneColor}`);
    
    // Convert color string to hex number - handle both named colors and hex codes
    let colorHex;
    
    // Color name to hex mapping
    const colorMap = {
        'red': 0xFF0000,
        'green': 0x00FF00,
        'blue': 0x0000FF,
        'yellow': 0xFFFF00,
        'purple': 0x800080,
        'orange': 0xFFA500,
        'black': 0x000000,
        'white': 0xFFFFFF,
        'gray': 0x808080,
        'grey': 0x808080,
        'cyan': 0x00FFFF,
        'magenta': 0xFF00FF,
        'brown': 0xA52A2A,
        'pink': 0xFFC0CB
    };
    
    // Check if it's a named color or hex code
    if (zoneColor.startsWith('#')) {
        // It's a hex code, convert it to a number
        colorHex = parseInt(zoneColor.replace('#', '0x'));
    } else {
        // It's a named color, look it up in our map
        colorHex = colorMap[zoneColor.toLowerCase()] || 0xFF0000; // Default to red if not found
    }
    
    console.log(`Converted color hex: 0x${colorHex.toString(16).padStart(6, '0').toUpperCase()}`);
    
    // Create dimensions for the icon
    const iconWidth = 140;
    const iconHeight = 160;
    const borderThickness = 10;
    
    // Create a container at the center of the screen
    const container = scene.add.container(scene.sys.game.config.width / 2, 300);
    
    // Create a graphics object for drawing the border
    const border = scene.add.graphics();
    
    // Set fill style to zone color
    border.fillStyle(colorHex, 1);
    
    // Draw the outer rectangle (this is the border)
    border.fillRect(
        -iconWidth/2 - borderThickness, 
        -iconHeight/2 - borderThickness, 
        iconWidth + borderThickness*2, 
        iconHeight + borderThickness*2
    );
    
    // Set fill style to dark background
    border.fillStyle(0x222222, 1);
    
    // Draw the inner rectangle (creates border effect)
    border.fillRect(
        -iconWidth/2, 
        -iconHeight/2, 
        iconWidth, 
        iconHeight
    );
    
    // Add the graphics to the container
    container.add(border);
    
    // Determine and load the appropriate player image
    let playerImageKey;
    if (stageType === 'practice' || stageType === 'play') {
        playerImageKey = 'user';
        addPlayerImageToContainer(playerImageKey);
    } else if (stageType === 'watch' || stageType === 'indicate') {
        if (nextStage.demonstrator && nextStage.demonstrator.image) {
            playerImageKey = `demonstrator_${nextStage.demonstrator.index}`;
            if (!scene.textures.exists(playerImageKey)) {
                scene.load.image(playerImageKey, `assets/demonstrators/${nextStage.demonstrator.image}`);
                scene.load.once('complete', () => {
                    addPlayerImageToContainer(playerImageKey);
                });
                scene.load.start();
            } else {
                addPlayerImageToContainer(playerImageKey);
            }
        } else {
            playerImageKey = 'user';
            addPlayerImageToContainer(playerImageKey);
        }
    }
    
    // Add zone text below the image
    const zoneText = scene.add.text(
        0,
        iconHeight/2 - 40,
        `Zone ${zoneIndex}`,
        { 
            font: '20px Arial', 
            fill: '#ffffff',
            align: 'center' 
        }
    ).setOrigin(0.5);
    container.add(zoneText);
    
    function addPlayerImageToContainer(imageKey) {
        // Add player image centered and slightly above center
        const playerImage = scene.add.image(
            0,
            -20,
            imageKey
        );
        
        // Scale the image to match summary bar style
        const imageSize = 80;
        const scale = Math.min(
            imageSize / playerImage.width,
            imageSize / playerImage.height
        );
        
        playerImage.setScale(scale);
        container.add(playerImage);
    }
  }
  
  // Create the button
  function createButton() {
    const buttonWidth = 200;
    const buttonHeight = 50;
    
    const button = scene.add.rectangle(
      scene.sys.game.config.width / 2,
      scene.sys.game.config.height - 100,
      buttonWidth,
      buttonHeight,
      0x4CAF50
    ).setInteractive();
    
    const buttonLabel = scene.add.text(
      scene.sys.game.config.width / 2,
      scene.sys.game.config.height - 100,
      buttonText,
      { font: '20px Arial', fill: '#ffffff' }
    ).setOrigin(0.5);
    
    // Button hover effects
    button.on('pointerover', () => {
      button.setFillStyle(0x45a049); // Darker shade when hovered
      scene.game.canvas.style.cursor = 'pointer';
    });
    
    button.on('pointerout', () => {
      button.setFillStyle(0x4CAF50); // Original color
      scene.game.canvas.style.cursor = 'default';
    });
    
    // Button click
    button.on('pointerdown', () => {
      if (startCallback) startCallback();
    });
  }
}