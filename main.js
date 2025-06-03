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
  if (currentSessionIndex >= timelineData.length) {
    showEndOfGameMessage.call(this);
    return;
  }
  
  const currentSession = timelineData[currentSessionIndex];
  
  console.log("Current session index:", currentSessionIndex, "Stage index:", currentStageIndex);
  console.log("Current session first element:", JSON.stringify(currentSession[0], null, 2).substring(0, 150) + "...");
  
  // Check if the current session has nested arrays
  let currentStageContainer;
  let effectiveStageIndex;
  
  if (Array.isArray(currentSession[0])) {
    // Nested array session - find which container has our stage
    let totalStagesSoFar = 0;
    let foundContainer = false;
    
    for (let i = 0; i < currentSession.length; i++) {
      if (currentStageIndex < totalStagesSoFar + currentSession[i].length) {
        // Found our container
        currentStageContainer = currentSession[i];
        effectiveStageIndex = currentStageIndex - totalStagesSoFar;
        foundContainer = true;
        console.log(`Found stage in container ${i}, effective index: ${effectiveStageIndex}`);
        break;
      }
      totalStagesSoFar += currentSession[i].length;
    }
    
    if (!foundContainer) {
      console.error("Could not find container for stage index:", currentStageIndex);
      // We've reached the end of this session, move to the next
      currentSessionIndex++;
      currentStageIndex = 0;
      loadStage.call(this);
      return;
    }
  } else {
    // Simple array session
    currentStageContainer = currentSession;
    effectiveStageIndex = currentStageIndex;
  }
  
  // Check if we've reached the end of current stage container
  if (effectiveStageIndex >= currentStageContainer.length) {
    console.error("Stage index out of bounds:", effectiveStageIndex, "container length:", currentStageContainer.length);
    
    // Move to the next session
    currentSessionIndex++;
    currentStageIndex = 0;
    
    // Check again if we're done with all sessions
    if (currentSessionIndex >= timelineData.length) {
      showEndOfGameMessage.call(this);
      return;
    }
    
    // Recursively call loadStage to load the next stage
    loadStage.call(this);
    return;
  }

  this.children.removeAll();
  document.getElementById('prolific-form-overlay').style.visibility = 'hidden';

  const stage = currentStageContainer[effectiveStageIndex];
  console.log(`Loading session ${currentSessionIndex}, stage ${currentStageIndex}, type: ${stage.stage_type || stage.game}`);
  
  // Log the zone information to help with debugging
  if (stage.zone) {
    console.log(`Zone data: index=${stage.zone.zone_index}, mode=${stage.zone.zone_mode}, bandit=${!!stage.zone.zone_bandit}`);
  }

  // Store the current stage for reference in other functions if needed
  window.currentStage = stage;

  // Possibly add an icon for summary
  maybeAddSummaryIcon(stage);

  // If stage has a zone, apply its color to the game container border
  if (stage.zone) {
    // Use zone_color property for colored border to match exactly what's in timeline.json
    const zoneColor = stage.zone.zone_color || stage.zone.color || "#ffffff";
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.border = `10px solid ${zoneColor}`;
      console.log(`Applied zone border color: ${zoneColor}`);
    }
  }

  // Rebuild the DOM-based summary bar
  redrawSummaryBarDOM();

  // Determine stage type - check both stage_type and game properties
  const stageType = stage.stage_type || stage.game;

  // Switch to correct stage based on the determined stage type
  switch(stageType) {
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
    case 'blind':
      setupBlind.call(this, stage);
      break;
    case 'choice':
      setupChoice.call(this, stage);
      break;
    case 'online-choice':
      setupOnlineChoice.call(this, stage);
      break;
    case 'watch':
      setupWatch.call(this, stage);
      break;
    case 'indicate':
      setupIndicate.call(this, stage);
      break;
    default:
      console.warn("Unknown stage type:", stageType);
      nextStage.call(this);
  }
}

/*******************************************************
 * Summaries / Icons below the bandit
 *******************************************************/

/**
 * If the stage is a game stage with a zone,
 * add a new summary icon.
 */
function maybeAddSummaryIcon(stage) {
  // Use either stage_type or game property to determine stage type
  const stageType = stage.stage_type || stage.game;
  
  if (!stage.zone && stageType !== 'choice' && stageType !== 'online-choice') return;  
  if (!['practice','play','watch','indicate','blind','choice','online-choice'].includes(stageType)) return;

  // For choice games, just create a placeholder in the summaryIcons array
  // The actual image will be updated when user selects
  if (stageType === 'choice') {
    // Create a placeholder that will be updated when user selects
    summaryIcons.push({
      imageKey: null, // Will be updated when user selects
      zone: 'Choice',
      color: stage.zone && stage.zone.color ? stage.zone.color : '#888888'
    });
    return;
  }
  
  // For online-choice games, we need an icon for each sub-stage 
  if (stageType === 'online-choice') {
    // Check which sub-stage we're in
    if (window.onlineChoiceState) {
      const subStage = window.onlineChoiceState.currentSubStage;
      const round = window.onlineChoiceState.currentRound;
      
      // Only add icons for play and watch sub-stages
      if (subStage === 'play' || subStage === 'watch') {
        // First check if we already have an icon for this specific round and sub-stage
        // to avoid duplicates
        const iconId = `online-choice-${round}-${subStage}`;
        
        // Check if we already have this icon
        const exists = summaryIcons.some(icon => icon.id === iconId);
        if (exists) {
          console.log(`Skipping duplicate summary icon: ${iconId}`);
          return;
        }
        
        console.log(`Adding new summary icon: ${iconId}`);
        
        // For 'play' sub-stage, use user icon
        // For 'watch' sub-stage, use the selected demonstrator icon
        let imageKey = (subStage === 'play') ? 'user' : null;
        
        // For watch, we'll set the demonstrator image when selected
        if (subStage === 'watch' && window.onlineChoiceState.chosenDemonstrator) {
          const demoKey = window.onlineChoiceState.chosenDemonstrator;
          const demoIndex = stage.demonstrators[demoKey].demonstrator_index || 0;
          imageKey = `demonstrator_0${demoIndex}`;
        }
        
        // Create icon with appropriate label - just show Zone X
        summaryIcons.push({
          id: iconId, // Add a unique identifier
          imageKey: imageKey,
          zone: stage.zone && stage.zone.zone_index ? stage.zone.zone_index : 0,
          color: stage.zone && stage.zone.color ? stage.zone.color : '#888888',
          // Simplified label showing just the zone
          label: `Zone ${stage.zone.zone_index}`
        });
      }
    }
    return;
  }
  
    // For all other game types, use the normal icon logic
  let imageKey = 'user';
  if (stageType === 'watch' || stageType === 'indicate') {
    if (stage.demonstrator && stage.demonstrator.demonstrator_image) {
      // Extract just the filename without path and extension
      imageKey = stage.demonstrator.demonstrator_image.replace('.png', '');
    } else {
      imageKey = 'demonstrator_01'; // fallback
    }
  }

  // Add the icon with proper imageKey - prioritize zone_color from JSON directly
  const zoneColorValue = stage.zone.zone_color || stage.zone.color || '#ffffff';
  console.log(`Adding summary icon with zone_color: ${zoneColorValue}`);
  
  summaryIcons.push({
    imageKey: imageKey,
    zone: stage.zone.zone_index,
    zone_color: zoneColorValue,
    color: zoneColorValue // Keep color for backward compatibility
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
    
    // Skip icons with null imageKey (placeholders for choice/online-choice)
    if (iconData.imageKey === null) continue;

    // Create a container div
    const cellDiv = document.createElement("div");
    cellDiv.style.textAlign = "center"; 
    cellDiv.style.opacity = (i === lastIndex) ? "1" : "0.5";
    cellDiv.style.display = "flex";  // Use flexbox for better centering
    cellDiv.style.flexDirection = "column";
    cellDiv.style.alignItems = "center"; // Center children horizontally

    // Give it a border of the zone color - use zone_color property directly when available
    const borderColor = iconData.zone_color || iconData.color || "#ffffff";
    cellDiv.style.border = `3px solid ${borderColor}`;
    cellDiv.style.padding = "5px"; // some spacing from border

    // The image
    const img = document.createElement("img");
    if (iconData.imageKey.startsWith('demonstrator_')) {
      img.src = `assets/demonstrators/${iconData.imageKey}.png`;
    } else if (iconData.imageKey.startsWith('choice_demonstrator_')) {
      // For choice demonstrator keys, we need to be more cautious
      // The key format is something like 'choice_demonstrator_0'
      img.src = `assets/${iconData.imageKey}`; // Use the imageKey directly
    } else {
      img.src = `assets/${iconData.imageKey}.png`;
    }
    img.style.width = "40px";
    img.style.display = "block";
    img.style.margin = "0 auto"; // Center horizontally

    // The zone label - use custom label if provided
    const label = document.createElement("div");
        // Check if we have a custom label (for online-choice sub-stages)
    if (iconData.label) {
      label.textContent = iconData.label;
    } 
    // Handle special case for Choice zone - simplify to just "Choice"
    else if (iconData.zone === 'Choice') {
      label.textContent = "Choice";
    } else {
      label.textContent = "Zone " + iconData.zone;
    }
    label.style.color = "#fff";
    label.style.marginTop = "4px";
    label.style.textAlign = "center"; // Center text

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
  if (!stage.zone) {
    console.error("Missing zone data");
    return;
  }
  
  // Check for bandit data at zone.zone_bandit
  const bandit = stage.zone.zone_bandit;
  if (!bandit) {
    console.error("Missing bandit data in zone");
    return;
  }
  
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
  addZoneLabels(this, stage.zone.zone_index);

  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Reward tank
  let pullOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100); // Add high depth value to ensure visibility
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
  
  // Store reference to scene for use in closures
  const sceneRef = this;
  
  // Add clickable areas for each cell
  let cellRects = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      let rx = gridOriginX + c * (cellWidth + CELL_PADDING);
      let ry = gridOriginY + r * (cellHeight + CELL_PADDING);
      
      let cellRect = this.add.rectangle(rx, ry, cellWidth, cellHeight, 0xffffff, 0)
        .setOrigin(0, 0)
        .setInteractive();
        
      // Store row and col as properties to avoid closure issues
      cellRect.cellRow = r;
      cellRect.cellCol = c;
        
      cellRect.on('pointerdown', function() {
        if (pullsRemaining <= 0) return;

        // Use the stored row/col values from the rectangle properties
        const clickedR = this.cellRow;
        const clickedC = this.cellCol;

        // If the user is already at this position, pull the arm
        if (clickedR === cursorR && clickedC === cursorC) {
          pullArm.call(sceneRef, clickedR, clickedC);
        } else {
          // Otherwise, move to this position
          cursorR = clickedR;
          cursorC = clickedC;
          let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
          userSprite.setPosition(x, y);
          highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
        }
      });
      
      cellRects.push(cellRect);
    }
  }
  
  // Function to handle pulling the arm
  function pullArm(row, col) {
    const scene = this; // Capture the scene context
      pullsRemaining--;
    
    // Don't try to update remainingText - it doesn't exist in this context!
    
    let payoff = bandit[row][col];
      let outcome = (Math.random() < payoff) ? 1 : 0;
      
      // Create a simple flash effect (just one flash)
    let g = scene.add.graphics();
      g.fillStyle(HIGHLIGHT_COLOR, 1);
      g.fillRect(
      gridOriginX + col*(cellWidth + CELL_PADDING),
      gridOriginY + row*(cellHeight + CELL_PADDING),
        cellWidth, cellHeight
      );
      
      // Fade out only to get a single flash
    scene.tweens.add({
        targets: g,
        alpha: 0,
      duration: 200, // Reduced from 400 to 200
        onComplete: () => {
          g.destroy();
          
          // Record outcome and update tank
          pullOutcomes.push(outcome);
        drawMarkerDot.call(scene, gridOriginX, gridOriginY, cellWidth, cellHeight, row, col, outcome);
        drawRewardTank.call(scene, rewardTankContainer, num_arm_pulls, pullOutcomes);

      if (pullsRemaining <= 0) {
          makeNextButton.call(scene, "Next", () => {
            nextStage.call(scene);
        });
      }
        }
      });
  }

  this.input.keyboard.on('keydown', (evt) => {
    if (pullsRemaining <= 0) return;

    let oldR = cursorR, oldC = cursorC;
    if (evt.code === 'ArrowUp')    cursorR = Phaser.Math.Clamp(cursorR - 1, 0, numRows-1);
    if (evt.code === 'ArrowDown')  cursorR = Phaser.Math.Clamp(cursorR + 1, 0, numRows-1);
    if (evt.code === 'ArrowLeft')  cursorC = Phaser.Math.Clamp(cursorC - 1, 0, numCols-1);
    if (evt.code === 'ArrowRight') cursorC = Phaser.Math.Clamp(cursorC + 1, 0, numCols-1);

    if (evt.code === 'Space') {
      pullArm.call(this, cursorR, cursorC);
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
  if (!stage.zone) {
    console.error("Missing zone data");
    return;
  }
  
  // Check for bandit data at zone.zone_bandit
  const bandit = stage.zone.zone_bandit;
  if (!bandit || !stage.demonstrator) {
    console.error("Missing bandit or demonstrator data");
    return;
  }
  
  // In the new JSON format, the trajectory is directly in demonstrator.demonstrator_trajectory
  const trajectory = stage.demonstrator.demonstrator_trajectory;
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
  addZoneLabels(this, stage.zone.zone_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Keep reward tank for watch stages to show mining outcomes
  // Use trajectory length for num_arm_pulls if it's null
  const totalPulls = stage.num_arm_pulls || trajectory.length;
  let watchOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100); // Add high depth value to ensure visibility
  drawRewardTank.call(this, rewardTankContainer, totalPulls, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Create a unique key for this specific demonstrator to prevent texture caching issues
  // Include session and stage index to ensure uniqueness
  const demoIndex = stage.demonstrator.demonstrator_index;
  const demoImage = stage.demonstrator.demonstrator_image;
  const sessionIndex = stage.session_index || 0;
  const stageIndex = stage.stage_index || 0;
  const gameIndex = stage.game_index || 0;
  
  // Create a session-specific key to avoid reusing demonstrator images across sessions
  const demoImageKey = `demo_s${sessionIndex}_g${gameIndex}_${demoIndex}`;
  
  console.log(`Loading demonstrator for session ${sessionIndex}, game ${gameIndex}: ${demoImage}`);
  
  // Always load the image to ensure we get the correct one
  this.load.image(demoImageKey, `assets/demonstrators/${demoImage}`);
  this.load.once('complete', () => {
    startDemonstration.call(this);
  });
  this.load.start();
  
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
        // When demonstration is complete, show next button
        const nextButton = this.add.text(
          this.sys.game.config.width - 100,
          this.sys.game.config.height - 40,
          "Next",
          { font: '18px Arial', fill: '#00ff00', backgroundColor: '#333', padding: 5 }
        ).setOrigin(0.5).setInteractive();
        
        nextButton.on('pointerdown', () => {
          // This is where the error happens - state isn't defined in regular watch mode
          // Remove the online-choice specific code and just call nextStage
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
        delay: 600, // Increased from 300 to 600 (doubled)
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
              duration: 200, // Reduced from 400 to 200 for quicker flash
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
  if (!stage.zone) {
    console.error("Missing zone data");
    return;
  }
  
  // Check for bandit data at zone.zone_bandit
  const bandit = stage.zone.zone_bandit;
  if (!bandit || !stage.demonstrator) {
    console.error("Missing bandit or demonstrator data");
    return;
  }
  
  // In the new JSON format, the trajectory is directly in demonstrator.demonstrator_trajectory
  const trajectory = stage.demonstrator.demonstrator_trajectory;
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
  addZoneLabels(this, stage.zone.zone_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Note: We don't create a mining progress bar for indicate stages
  
  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Create a unique key for this specific demonstrator to prevent texture caching issues
  // Include session and stage index to ensure uniqueness
  const demoIndex = stage.demonstrator.demonstrator_index;
  const demoImage = stage.demonstrator.demonstrator_image;
  const sessionIndex = stage.session_index || 0;
  const stageIndex = stage.stage_index || 0;
  const gameIndex = stage.game_index || 0;
  
  // Create a session-specific key to avoid reusing demonstrator images across sessions
  const demoImageKey = `demo_s${sessionIndex}_g${gameIndex}_${demoIndex}`;
  
  console.log(`Loading demonstrator for indicate session ${sessionIndex}, game ${gameIndex}: ${demoImage}`);
  
  // Always load the image to ensure we get the correct one
  this.load.image(demoImageKey, `assets/demonstrators/${demoImage}`);
  this.load.once('complete', () => {
    startDemonstration.call(this);
  });
  this.load.start();
  
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
        delay: 600, // Increased from 300 to 600 (doubled)
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
            duration: 150, // Reduced from 300 to 150 for quicker flash
            yoyo: true,
            repeat: 1, // Reduced from 2 to 1 for quicker overall effect
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

/**
 * BLIND stage - like play but without showing outcomes
 */
function setupBlind(stage) {
  if (!stage.zone) {
    console.error("Missing zone data");
    return;
  }
  
  // Check for bandit data at zone.zone_bandit
  const bandit = stage.zone.zone_bandit;
  if (!bandit) {
    console.error("Missing bandit data in zone");
    return;
  }
  
  const num_arm_pulls = stage.num_arm_pulls;
  
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // Debug log to check dimensions
  console.log(`Loading BLIND with grid: ${numRows}x${numCols}`);
  
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
  addZoneLabels(this, stage.zone.zone_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Initialize pullOutcomes array (needed for the pullArm function)
  let pullOutcomes = [];

  // Instead of reward tank, we'll create a text counter for remaining shots
  let pullsRemaining = num_arm_pulls;
  
  // Create text to display remaining shots
  const remainingText = this.add.text(
    this.sys.game.config.width / 2,
    gridBottomY + TANK_MARGIN_TOP,
    `Remaining Shots: ${pullsRemaining}`,
    { font: '20px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);

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

  // Store reference to scene for use in closures
  const blindSceneRef = this;

  // Add clickable areas for each cell
  let cellRects = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      let rx = gridOriginX + c * (cellWidth + CELL_PADDING);
      let ry = gridOriginY + r * (cellHeight + CELL_PADDING);
      
      let cellRect = this.add.rectangle(rx, ry, cellWidth, cellHeight, 0xffffff, 0)
        .setOrigin(0, 0)
        .setInteractive();
        
      // Store row and col as properties to avoid closure issues
      cellRect.cellRow = r;
      cellRect.cellCol = c;
        
      cellRect.on('pointerdown', function() {
        if (pullsRemaining <= 0) return;

        // Use the stored row/col values from the rectangle properties
        const clickedR = this.cellRow;
        const clickedC = this.cellCol;

        // If the user is already at this position, pull the arm
        if (clickedR === cursorR && clickedC === cursorC) {
          pullArm.call(blindSceneRef, clickedR, clickedC);
        } else {
          // Otherwise, move to this position
          cursorR = clickedR;
          cursorC = clickedC;
          let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
          userSprite.setPosition(x, y);
          highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
        }
      });
      
      cellRects.push(cellRect);
    }
  }
  
  // Function to handle pulling the arm
  function pullArm(row, col) {
    const scene = this; // Capture the scene context
    pullsRemaining--;
      
    // Update the remainingText to show the new count
    remainingText.setText(`Remaining Shots: ${pullsRemaining}`);
      
    let payoff = bandit[row][col];
    let outcome = (Math.random() < payoff) ? 1 : 0;
      
    // Create a simple flash effect (just one flash)
    let g = scene.add.graphics();
    g.fillStyle(HIGHLIGHT_COLOR, 1);
    g.fillRect(
      gridOriginX + col*(cellWidth + CELL_PADDING),
      gridOriginY + row*(cellHeight + CELL_PADDING),
      cellWidth, cellHeight
    );
      
    // Fade out only to get a single flash
    scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 200, // Reduced from 400 to 200
      onComplete: () => {
        g.destroy();
          
        // In blind mode, we don't show outcomes or update tanks
        // But we still track outcomes internally
        pullOutcomes.push(outcome);
          
        if (pullsRemaining <= 0) {
          makeNextButton.call(scene, "Next", () => {
            nextStage.call(scene);
          });
        }
      }
    });
  }

  this.input.keyboard.on('keydown', (evt) => {
    if (pullsRemaining <= 0) return;

    let oldR = cursorR, oldC = cursorC;
    if (evt.code === 'ArrowUp')    cursorR = Phaser.Math.Clamp(cursorR - 1, 0, numRows-1);
    if (evt.code === 'ArrowDown')  cursorR = Phaser.Math.Clamp(cursorR + 1, 0, numRows-1);
    if (evt.code === 'ArrowLeft')  cursorC = Phaser.Math.Clamp(cursorC - 1, 0, numCols-1);
    if (evt.code === 'ArrowRight') cursorC = Phaser.Math.Clamp(cursorC + 1, 0, numCols-1);

    if (evt.code === 'Space') {
      pullArm.call(this, cursorR, cursorC);
    }

    if (oldR !== cursorR || oldC !== cursorC) {
      let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
      userSprite.setPosition(x, y);
      highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
    }
  });
}

/**
 * CHOICE stage - user chooses between demonstrators 
 */
function setupChoice(stage) {
  console.log("Loading CHOICE stage");
  console.log("Full stage data:", JSON.stringify(stage, null, 2));
  
  // Default color if none provided
  const zoneColor = stage.zone && stage.zone.color ? stage.zone.color : "#888888";
  
  // Check demonstrator data
  // In the new format, we have demonstrator1 and demonstrator2 properties
  let demonstrator1 = stage.demonstrator1 || {};
  let demonstrator2 = stage.demonstrator2 || {};
  
  console.log("Demonstrator data:", JSON.stringify({ demonstrator1, demonstrator2 }, null, 2));
  
  // Create demonstrator data if missing or invalid
  if ((!demonstrator1 || Object.keys(demonstrator1).length === 0) && 
      (!demonstrator2 || Object.keys(demonstrator2).length === 0)) {
    console.warn("Missing demonstrator data for choice stage. Creating default data.");
    demonstrator1 = {
      "demonstrator_type": "novice",
      "demonstrator_index": 0,
      "demonstrator_id": 1,
      "demonstrator_image": "demonstrator_00.png"
    };
    demonstrator2 = {
      "demonstrator_type": "expert",
      "demonstrator_index": 1,
      "demonstrator_id": 2,
      "demonstrator_image": "demonstrator_01.png"
    };
  }
  
  // Prepare demonstrator images and indices
  const demonstratorImages = [
    demonstrator1.demonstrator_image || "demonstrator_00.png",
    demonstrator2.demonstrator_image || "demonstrator_01.png"
  ];
  
  const demonstratorIndices = [
    demonstrator1.demonstrator_index || 0,
    demonstrator2.demonstrator_index || 1
  ];
  
  console.log(`Found ${demonstratorImages.length} demonstrator images:`, demonstratorImages);
  
  // Configuration
  const numDemonstrators = demonstratorImages.length;
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 30;
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (this.sys.game.config.width - totalWidth) / 2;
  const gridY = 200;
  
  // Create title text
  const titleText = this.add.text(
    this.sys.game.config.width / 2,
    100,
    "Choose your preferred partner:",
    { 
      font: '28px Arial', 
      fill: '#ffffff',
      align: 'center'
    }
  ).setOrigin(0.5);
  
  // Create instruction text
  const instructionText = this.add.text(
    this.sys.game.config.width / 2,
    gridY + cellHeight + 150,
    "If you play again in a new zone, which starship partner would you choose watch before playing to optimize your reward?",
    { 
      font: '18px Arial', 
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }
  ).setOrigin(0.5);
  
  // Create instruction for controls
  const controlsText = this.add.text(
    this.sys.game.config.width / 2,
    gridY + cellHeight + 200,
    "Use arrow keys to move and spacebar to select",
    { 
      font: '16px Arial', 
      fill: '#aaaaaa',
      align: 'center'
    }
  ).setOrigin(0.5);
  
  // Update the control display section to show choice-specific controls
  updateControlsDisplay("choice");
  
  // Selection feedback text (initially hidden)
  const feedbackText = this.add.text(
    this.sys.game.config.width / 2,
    gridY + cellHeight + 120,
    "",
    { 
      font: '20px Arial', 
      fill: '#4CAF50',
      align: 'center',
      backgroundColor: '#333333',
      padding: { x: 15, y: 10 }
    }
  ).setOrigin(0.5).setVisible(false);
  
  // Track selection
  let selectedDemonstrator = null;
  let currentPosition = 0;
  
  // Demonstrator cells array
  const cells = [];
  
  // Get session index for unique image keys
  const sessionIndex = stage.session_index || 0;
  
  // Create cells for each demonstrator
  for (let i = 0; i < numDemonstrators; i++) {
    const x = gridX + i * (cellWidth + cellPadding) + cellWidth/2;
    const y = gridY + cellHeight/2;
    
    // Create background for cell
    const cellBg = this.add.rectangle(
      x, y,
      cellWidth, cellHeight,
      0x333333
    ).setOrigin(0.5);
    
    // Create letter label
    const letter = String.fromCharCode(65 + i); // A, B, C, etc.
    const letterText = this.add.text(
      x,
      gridY - 30,
      `Partner ${letter}`,
      { 
        font: '18px Arial', 
        fill: '#ffffff',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 }
      }
    ).setOrigin(0.5);
    
    // Load demonstrator image - use a unique key for the texture that includes session index
    const imageKey = `choice_s${sessionIndex}_demonstrator_${i}`;
    
    // Make sure the image path is correct
    console.log(`Loading demonstrator image ${i} for session ${sessionIndex}: ${demonstratorImages[i]}`);
    this.load.image(imageKey, `assets/demonstrators/${demonstratorImages[i]}`);
    
    // Store cell info
    cells.push({
      x: x,
      y: y,
      letter: letter,
      background: cellBg,
      letterText: letterText,
      imageKey: imageKey,
      image: null
    });
  }
  
  // Store a reference to the scene that we can use in callbacks
  const currentScene = this;
  
  // Once all images are loaded, create the demonstrator sprites
  this.load.once('complete', () => {
    // Create demonstrator images
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      cell.image = currentScene.add.image(cell.x, cell.y, cell.imageKey)
        .setOrigin(0.5);
      
      // Scale image to fit cell
      const scale = Math.min(
        (cellWidth - 20) / cell.image.width,
        (cellHeight - 20) / cell.image.height
      );
      cell.image.setScale(scale);
      
      // Make the cells clickable
      cell.background.setInteractive();
      cell.image.setInteractive();
    }
    
    // Add highlight rect
    const highlightRect = currentScene.add.rectangle(
      cells[0].x, cells[0].y,
      cellWidth + 10, cellHeight + 10,
      parseInt(zoneColor.replace('#', '0x')) || 0x888888
    ).setOrigin(0.5).setAlpha(0.3);
    
    // Position for user sprite (below the cells)
    const userY = gridY + cellHeight + 40;
    let userX = cells[0].x;
    
    // Add user sprite
    const userSprite = currentScene.add.image(userX, userY, 'user')
      .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
      .setDepth(9999)
      .setOrigin(0.5);
    
    // Add click handlers for all cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      
      const clickHandler = () => {
        // Only allow selection if not already selected
        if (selectedDemonstrator !== null) return;
        
        // If already on this position, select it
        if (currentPosition === i) {
          selectDemonstrator(i);
        } else {
          // Move to this position
          currentPosition = i;
          userX = cells[currentPosition].x;
          userSprite.setPosition(userX, userY);
          highlightRect.setPosition(cells[currentPosition].x, cells[currentPosition].y);
        }
      };
      
      cell.background.on('pointerdown', clickHandler);
      cell.image.on('pointerdown', clickHandler);
    }
    
    // Function to handle selection
    function selectDemonstrator(index) {
      selectedDemonstrator = cells[index].letter;
      
      // Show selection feedback
      feedbackText.setText(`You selected Partner ${selectedDemonstrator}`);
      feedbackText.setVisible(true);
      
      // Highlight selected with stronger border
      highlightRect.setStrokeStyle(4, parseInt(zoneColor.replace('#', '0x')) || 0x888888);
      highlightRect.setAlpha(0.6);
      
      // Add the selected demonstrator to summary bar
      addChoiceSelectionToSummary(cells[index].imageKey, stage.zone ? stage.zone.color : "#888888");
      
      // Add next button - properly bind currentScene
      makeNextButton.call(currentScene, "Next", () => {
        console.log(`Selected Partner ${selectedDemonstrator}`);
        // Restore normal controls display before moving to next stage
        updateControlsDisplay("default");
        nextStage.call(currentScene);
      });
    }
    
    // Keyboard input
    currentScene.input.keyboard.on('keydown', (evt) => {
      // Only allow movement if not already selected
      if (selectedDemonstrator !== null) return;
      
      let oldPosition = currentPosition;
      
      if (evt.code === 'ArrowLeft') {
        currentPosition = Math.max(0, currentPosition - 1);
      }
      if (evt.code === 'ArrowRight') {
        currentPosition = Math.min(cells.length - 1, currentPosition + 1);
      }
      
      // If position changed, update user sprite and highlight
      if (oldPosition !== currentPosition) {
        userX = cells[currentPosition].x;
        userSprite.setPosition(userX, userY);
        highlightRect.setPosition(cells[currentPosition].x, cells[currentPosition].y);
      }
      
      // Space to select
      if (evt.code === 'Space') {
        selectDemonstrator.call(currentScene, currentPosition);
      }
    });
  });
  
  // Start loading the images
  this.load.start();
}

/**
 * Add a function to update the controls display based on game type
 */
function updateControlsDisplay(type = "default") {
  const controlsDisplay = document.getElementById('controls-display');
  if (!controlsDisplay) return;
  
  // Store the original HTML to restore later
  if (!window.originalControlsHTML) {
    window.originalControlsHTML = controlsDisplay.innerHTML;
  }
  
  if (type === "choice") {
    // Custom controls for choice games
    controlsDisplay.innerHTML = `
      <!-- Arrow Left -->
      <div class="control-key">
        <div class="control-icon">←</div>
        <div>Move Left</div>
      </div>
      <!-- Arrow Right -->
      <div class="control-key">
        <div class="control-icon">→</div>
        <div>Move Right</div>
      </div>
      <!-- Spacebar -->
      <div class="control-key">
        <div class="control-icon space">Spacebar</div>
        <div>Select Partner</div>
      </div>
    `;
  } else {
    // Restore default controls
    if (window.originalControlsHTML) {
      controlsDisplay.innerHTML = window.originalControlsHTML;
    }
  }
}

/**
 * Add the selected demonstrator to the summary bar after choice
 */
function addChoiceSelectionToSummary(imageKey, zoneColor) {
  // Look for a choice icon in the summaryIcons array
  let choiceIconIndex = -1;
  for (let i = 0; i < summaryIcons.length; i++) {
    if (summaryIcons[i].zone === 'Choice') {
      choiceIconIndex = i;
      break;
    }
  }
  
  // If we found a choice icon, update it with the selected demonstrator
  if (choiceIconIndex >= 0) {
    // For choice_demonstrator keys, we need to properly extract the demonstrator image path
    // First check if we have a session index in the imageKey: choice_s{session}_demonstrator_{demoIndex}
    const parts = imageKey.split('_');
    let sessionPart = '';
    let demoIndex = '';
    
    if (parts.length >= 4 && parts[1].startsWith('s')) {
      // New format with session: choice_s1_demonstrator_0
      sessionPart = parts[1];
      demoIndex = parts[3];
    } else {
      // Old format without session: choice_demonstrator_0
      demoIndex = parts[2];
    }
    
    // Get the selected demonstrator's full image path from the current stage
    const stage = window.currentStage;
    let demoImage = null;
    
    if (stage && stage.demonstrator1 && stage.demonstrator2) {
      // Determine which demonstrator was selected based on the demoIndex
      if (demoIndex === '0' && stage.demonstrator1.demonstrator_image) {
        demoImage = stage.demonstrator1.demonstrator_image.replace('.png', '');
      } else if (demoIndex === '1' && stage.demonstrator2.demonstrator_image) {
        demoImage = stage.demonstrator2.demonstrator_image.replace('.png', '');
      }
    }
    
    // Log what we're using for debugging
    console.log(`Choice selection: using demonstrator image ${demoImage} from index ${demoIndex}`);
    
    // Use the actual demonstrator image, or fall back to a default
    summaryIcons[choiceIconIndex].imageKey = demoImage || `demonstrator_${demoIndex}`;
    
    // Redraw the summary bar to show the change
    redrawSummaryBarDOM();
  }
}

/**
 * ONLINE-CHOICE stage - manages play-choice-watch cycles
 */
function setupOnlineChoice(stage) {
  if (!stage.zone || !stage.zone.bandit) {
    console.error("Missing zone or bandit data for online-choice stage");
    return;
  }
  
  if (!stage.demonstrators) {
    console.error("Missing demonstrator data for online-choice stage");
    return;
  }
  
  if (!stage.rounds || !stage.num_arm_pulls_per_block || !stage.num_demonstrator_arm_pulls_per_block) {
    console.error("Missing required parameters (rounds, pulls per block)");
    return;
  }
  
  // Store game state in a global object to persist across sub-stages
  if (!window.onlineChoiceState) {
    // Initialize state on first load
    window.onlineChoiceState = {
      currentRound: 1,
      totalRounds: stage.rounds,
      currentSubStage: "play", // "play", "choice", "watch", or "final-play"
      chosenDemonstrator: null,
      demoTrajectoryIndices: {}, // Will store indices for each demonstrator
      demonstratorHistory: [],
      // Create a map of demonstrator keys to letters (A, B, C, etc.)
      demoLetters: {},
      // Flag to track if summary icon has been added
      summaryIconAdded: false
    };
    
    // Assign letters to demonstrators (A, B, C, etc.)
    const demoKeys = Object.keys(stage.demonstrators);
    demoKeys.forEach((key, index) => {
      window.onlineChoiceState.demoLetters[key] = String.fromCharCode(65 + index); // A, B, C, etc.
      window.onlineChoiceState.demoTrajectoryIndices[key] = 0; // Initialize trajectory indices
    });
    
    console.log("Initialized online choice state:", window.onlineChoiceState);
    
    // Force add a summary icon for the first play sub-stage
    // This ensures we have an icon for the very first play game
    maybeAddSummaryIcon(stage);
  }
  
  const state = window.onlineChoiceState;
  
  // Handle each sub-stage
  switch (state.currentSubStage) {
    case "play":
      console.log(`Starting PLAY sub-stage (Round ${state.currentRound} of ${state.totalRounds})`);
      setupOnlineChoicePlay.call(this, stage);
      break;
    case "choice":
      console.log(`Starting CHOICE sub-stage (Round ${state.currentRound} of ${state.totalRounds})`);
      setupOnlineChoiceChoice.call(this, stage);
      break;
    case "watch":
      console.log(`Starting WATCH sub-stage (Round ${state.currentRound} of ${state.totalRounds})`);
      setupOnlineChoiceWatch.call(this, stage);
      break;
    case "final-play":
      console.log(`Starting FINAL PLAY sub-stage (after Round ${state.totalRounds})`);
      setupOnlineChoiceFinalPlay.call(this, stage);
      break;
  }
}

/**
 * Play sub-stage for online-choice
 */
function setupOnlineChoicePlay(stage) {
  const currentScene = this;
  
  // Initialize onlineChoiceState if not already done
  if (!window.onlineChoiceState) {
    window.onlineChoiceState = {
      currentRound: 1,
      totalRounds: stage.rounds,
      currentSubStage: "play", // "play", "choice", "watch", or "final-play"
      chosenDemonstrator: null,
      demoTrajectoryIndices: {}, // Will store indices for each demonstrator
      demonstratorHistory: [],
      // Create a map of demonstrator keys to letters (A, B, C, etc.)
      demoLetters: {},
      // Flag to track if summary icon has been added
      summaryIconAdded: false
    };
    
    // Assign letters to demonstrators (A, B, C, etc.)
    const demoKeys = Object.keys(stage.demonstrators);
    demoKeys.forEach((key, index) => {
      window.onlineChoiceState.demoLetters[key] = String.fromCharCode(65 + index); // A, B, C, etc.
      window.onlineChoiceState.demoTrajectoryIndices[key] = 0; // Initialize trajectory indices
    });
    
    console.log("Initialized online choice state:", window.onlineChoiceState);
  } else {
    // Update the state for this sub-stage
    window.onlineChoiceState.currentSubStage = 'play';
  }
  
  const state = window.onlineChoiceState;
  const bandit = stage.zone.bandit;
  const num_arm_pulls = stage.num_arm_pulls_per_block;
  
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // NOTE: We don't need to call maybeAddSummaryIcon here since loadStage already does it
  // The unique ID approach will prevent duplicates
  
  // Check if this is the final play after all rounds
  const isFinalPlay = state.currentRound === state.totalRounds && 
                     state.demonstratorHistory.length >= state.totalRounds;
  
  console.log(`Loading ONLINE-CHOICE ${isFinalPlay ? 'FINAL ' : ''}PLAY with grid: ${numRows}x${numCols}`);
  
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
  addZoneLabels(this, stage.zone.zone_index);
  
  // Show round information with final play indicator if applicable
  const roundText = this.add.text(
    this.sys.game.config.width / 2,
    50,
    isFinalPlay ? `Final Play (Round ${state.currentRound})` : `Round ${state.currentRound} of ${state.totalRounds}`,
    { font: '20px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Reward tank
  let pullOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100); // Add high depth value to ensure visibility
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
  
  // Store reference to scene for use in closures
  const sceneRef = this;
  
  // Add clickable areas for each cell
  let cellRects = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      let rx = gridOriginX + c * (cellWidth + CELL_PADDING);
      let ry = gridOriginY + r * (cellHeight + CELL_PADDING);
      
      let cellRect = this.add.rectangle(rx, ry, cellWidth, cellHeight, 0xffffff, 0)
        .setOrigin(0, 0)
        .setInteractive();
        
      // Store row and col as properties to avoid closure issues
      cellRect.cellRow = r;
      cellRect.cellCol = c;
        
      cellRect.on('pointerdown', function() {
        if (pullsRemaining <= 0) return;

        // Use the stored row/col values from the rectangle properties
        const clickedR = this.cellRow;
        const clickedC = this.cellCol;

        // If the user is already at this position, pull the arm
        if (clickedR === cursorR && clickedC === cursorC) {
          pullArm.call(sceneRef, clickedR, clickedC);
        } else {
          // Otherwise, move to this position
          cursorR = clickedR;
          cursorC = clickedC;
          let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
          userSprite.setPosition(x, y);
          highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
        }
      });
      
      cellRects.push(cellRect);
    }
  }
  
  // Function to handle pulling the arm
  function pullArm(row, col) {
    const scene = this; // Capture the scene context
      pullsRemaining--;
    
    // Don't try to update remainingText - it doesn't exist in this context!
    
    let payoff = bandit[row][col];
      let outcome = (Math.random() < payoff) ? 1 : 0;
      
      // Create a simple flash effect (just one flash)
    let g = scene.add.graphics();
      g.fillStyle(HIGHLIGHT_COLOR, 1);
      g.fillRect(
      gridOriginX + col*(cellWidth + CELL_PADDING),
      gridOriginY + row*(cellHeight + CELL_PADDING),
        cellWidth, cellHeight
      );
      
      // Fade out only to get a single flash
    scene.tweens.add({
        targets: g,
        alpha: 0,
      duration: 200, // Reduced from 400 to 200
        onComplete: () => {
          g.destroy();
          
          // Record outcome and update tank
          pullOutcomes.push(outcome);
        drawMarkerDot.call(scene, gridOriginX, gridOriginY, cellWidth, cellHeight, row, col, outcome);
        drawRewardTank.call(scene, rewardTankContainer, num_arm_pulls, pullOutcomes);

      if (pullsRemaining <= 0) {
          makeNextButton.call(scene, "Next", () => {
            nextStage.call(scene);
        });
      }
        }
      });
  }

  this.input.keyboard.on('keydown', (evt) => {
    if (pullsRemaining <= 0) return;

    let oldR = cursorR, oldC = cursorC;
    if (evt.code === 'ArrowUp')    cursorR = Phaser.Math.Clamp(cursorR - 1, 0, numRows-1);
    if (evt.code === 'ArrowDown')  cursorR = Phaser.Math.Clamp(cursorR + 1, 0, numRows-1);
    if (evt.code === 'ArrowLeft')  cursorC = Phaser.Math.Clamp(cursorC - 1, 0, numCols-1);
    if (evt.code === 'ArrowRight') cursorC = Phaser.Math.Clamp(cursorC + 1, 0, numCols-1);

    if (evt.code === 'Space') {
      pullArm.call(this, cursorR, cursorC);
    }

    if (oldR !== cursorR || oldC !== cursorC) {
      let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
      userSprite.setPosition(x, y);
      highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
    }
  });
}

/**
 * Choice sub-stage for online-choice
 */
function setupOnlineChoiceChoice(stage) {
  const currentScene = this;
  
  // Update the state for this sub-stage
  if (window.onlineChoiceState) {
    window.onlineChoiceState.currentSubStage = 'choice';
  }
  
  const state = window.onlineChoiceState;
  const zoneColor = stage.zone && stage.zone.color ? stage.zone.color : "#888888";
  
  console.log("Loading ONLINE-CHOICE CHOICE sub-stage");
  
  // Show round information
  const roundText = this.add.text(
    this.sys.game.config.width / 2,
    50,
    `Round ${state.currentRound} of ${state.totalRounds}`,
    { font: '20px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Update the control display section to show choice-specific controls
  updateControlsDisplay("choice");
  
  // Create the demonstrator cells
  const demonstrators = stage.demonstrators;
  const demoKeys = Object.keys(demonstrators);
  
  // Configuration
  const numDemonstrators = demoKeys.length;
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 100; // More padding for clearer separation
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (this.sys.game.config.width - totalWidth) / 2;
  const gridY = 200;
  
  // Create cells for each demonstrator
  const cells = [];
  
  for (let i = 0; i < demoKeys.length; i++) {
    const demoKey = demoKeys[i];
    const demo = demonstrators[demoKey];
    const partnerLetter = state.demoLetters[demoKey]; // Get assigned letter (A, B, etc.)
    
    const x = gridX + i * (cellWidth + cellPadding) + cellWidth/2;
    const y = gridY + cellHeight/2;
    
    // Create background
    const cellBg = this.add.rectangle(
      x, y,
      cellWidth, cellHeight,
      0x333333
    ).setOrigin(0.5);
    
    // Create label with Partner + Letter
    const label = this.add.text(
      x,
      gridY - 30,
      `Partner ${partnerLetter}`,
      { 
        font: '18px Arial', 
        fill: '#ffffff',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 }
      }
    ).setOrigin(0.5);
    
    // Load demonstrator image - use path directly from json
    const imageKey = `online_choice_${demoKey}`;
    
    // Get the image path from the demonstrator configuration
    // In the new format, image is in demonstrator_image
    const imagePath = demo.demonstrator_image;
    console.log(`Loading online-choice demonstrator image for ${demoKey}: ${imagePath}`);
    
    // Load from the demonstrators folder with the actual image path
    this.load.image(imageKey, `assets/demonstrators/${imagePath}`);
    
    cells.push({
      key: demoKey,
      letter: partnerLetter,
      x,
      y,
      background: cellBg,
      label,
      imageKey
    });
  }
  
  // Once all images are loaded, create the demonstrator sprites
  this.load.once('complete', () => {
    // Add images to cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      cell.image = currentScene.add.image(cell.x, cell.y, cell.imageKey).setOrigin(0.5);
      
      // Scale to fit
      const scale = Math.min(
        (cellWidth - 20) / cell.image.width,
        (cellHeight - 20) / cell.image.height
      );
      cell.image.setScale(scale);
      
      // Make cells clickable
      cell.background.setInteractive();
      cell.image.setInteractive();
    }
    
    // Add highlight for selection
    const highlightRect = currentScene.add.rectangle(
      cells[0].x, cells[0].y,
      cellWidth + 10, cellHeight + 10,
      parseInt(zoneColor.replace('#', '0x')) || 0x888888
    ).setOrigin(0.5).setAlpha(0.3);
    
    // User sprite below cells
    const userY = gridY + cellHeight + 40;
    let userX = cells[0].x;
    let currentPosition = 0;
    let selectedDemonstrator = null;
    
    // Add user sprite
    const userSprite = currentScene.add.image(userX, userY, 'user')
      .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
      .setDepth(9999)
      .setOrigin(0.5);
    
    // Selection feedback text (initially hidden)
    const feedbackText = currentScene.add.text(
      currentScene.sys.game.config.width / 2,
      gridY + cellHeight + 120,
      "",
      { 
        font: '20px Arial', 
        fill: '#4CAF50',
        align: 'center',
        backgroundColor: '#333333',
        padding: { x: 15, y: 10 }
      }
    ).setOrigin(0.5).setVisible(false);
    
    // Add click handlers for all cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      
      const clickHandler = () => {
        // Only allow selection if not already selected
        if (selectedDemonstrator !== null) return;
        
        // If already on this position, select it
        if (currentPosition === i) {
          selectDemonstrator(i);
        } else {
          // Move to this position
          currentPosition = i;
          userX = cells[currentPosition].x;
          userSprite.setPosition(userX, userY);
          highlightRect.setPosition(cells[currentPosition].x, cells[currentPosition].y);
        }
      };
      
      cell.background.on('pointerdown', clickHandler);
      cell.image.on('pointerdown', clickHandler);
    }
    
    // Function to handle selection
    function selectDemonstrator(index) {
      const demoKey = cells[index].key;
      const partnerLetter = cells[index].letter;
      
      selectedDemonstrator = demoKey;
      
      // Store the selection
      state.chosenDemonstrator = selectedDemonstrator;
      state.demonstratorHistory.push(selectedDemonstrator);
      
      // Show selection feedback using Partner Letter
      feedbackText.setText(`You selected Partner ${partnerLetter}`);
      feedbackText.setVisible(true);
      
      // Highlight selected with stronger border
      highlightRect.setStrokeStyle(4, parseInt(zoneColor.replace('#', '0x')) || 0x888888);
      highlightRect.setAlpha(0.6);
      
      // Add the selected demonstrator to the summary bar
      addOnlineChoiceSelectionToSummary(cells[index].imageKey, stage.zone);
      
      // Add next button
      const nextButton = currentScene.add.text(
        currentScene.sys.game.config.width - 100,
        currentScene.sys.game.config.height - 40,
        "Next",
        { font: '18px Arial', fill: '#00ff00', backgroundColor: '#333', padding: 5 }
      ).setOrigin(0.5).setInteractive();
      
      nextButton.on('pointerdown', () => {
        console.log(`Selected demonstrator: ${selectedDemonstrator} (Partner ${partnerLetter})`);
        
        // Restore default controls
        updateControlsDisplay("default");
        
        // Move to watch sub-stage
        state.currentSubStage = "watch";
        loadStage.call(currentScene);
      });
    }
    
    // Listen for arrow keys and spacebar
    currentScene.input.keyboard.on('keydown', (evt) => {
      // Only allow movement if not already selected
      if (selectedDemonstrator !== null) return;
      
      let oldPosition = currentPosition;
      
      if (evt.code === 'ArrowLeft') {
        currentPosition = Math.max(0, currentPosition - 1);
      }
      if (evt.code === 'ArrowRight') {
        currentPosition = Math.min(cells.length - 1, currentPosition + 1);
      }
      
      // If position changed, update user sprite and highlight
      if (oldPosition !== currentPosition) {
        userX = cells[currentPosition].x;
        userSprite.setPosition(userX, userY);
        highlightRect.setPosition(cells[currentPosition].x, cells[currentPosition].y);
      }
      
      // Space to select
      if (evt.code === 'Space') {
        selectDemonstrator(currentPosition);
      }
    });
  });
  
  // Start loading the images
  this.load.start();
}

/**
 * Add the selected demonstrator to the summary bar after online choice
 */
function addOnlineChoiceSelectionToSummary(imageKey, zone) {
  if (!zone) return;
  
  // Look for an online-choice icon in the summaryIcons array
  let choiceIconIndex = -1;
  for (let i = 0; i < summaryIcons.length; i++) {
    if (summaryIcons[i].zone === zone.zone_index) {
      choiceIconIndex = i;
      break;
    }
  }
  
  // If we found an online-choice icon, update it with the selected demonstrator
  if (choiceIconIndex >= 0) {
    // For online_choice keys (format: online_choice_expert or online_choice_novice)
    // Extract the demonstrator type from imageKey
    const demoType = imageKey.split('_').slice(2).join('_'); // Gets "expert" or "novice"
    
    // Find the corresponding image in the demonstrators object of the stage
    const demo = window.onlineChoiceState.chosenDemonstrator;
    
    // Use demonstrator format for summary icon
    // In the new format, index is in demonstrator_index 
    const demoIndex = (zone.demonstrators && zone.demonstrators[demo]) ? 
      zone.demonstrators[demo].demonstrator_index : 0;
      
    // Convert to the proper format expected by redrawSummaryBarDOM
    summaryIcons[choiceIconIndex].imageKey = `demonstrator_0${demoIndex}`;
    
    // Redraw the summary bar to show the change
    redrawSummaryBarDOM();
  }
}

/**
 * Watch sub-stage for online-choice
 */
function setupOnlineChoiceWatch(stage) {
  const currentScene = this;
  
  // Update the state for this sub-stage
  if (window.onlineChoiceState) {
    window.onlineChoiceState.currentSubStage = 'watch';
  }
  
  const state = window.onlineChoiceState;
  const bandit = stage.zone.bandit;
  const numPulls = stage.num_demonstrator_arm_pulls_per_block;
  
  // Get the selected demonstrator
  const selectedDemoKey = state.chosenDemonstrator;
  const selectedDemo = stage.demonstrators[selectedDemoKey];
  const partnerLetter = state.demoLetters[selectedDemoKey]; // Get the letter (A, B, etc.)
  
  if (!selectedDemo) {
    console.error("Selected demonstrator not found:", selectedDemoKey);
    return;
  }
  
  // Define numRows and numCols before using them
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  console.log(`Loading ONLINE-CHOICE WATCH with grid: ${numRows}x${numCols}`);
  
  // NOTE: We don't need to call maybeAddSummaryIcon here since loadStage already does it
  // The unique ID approach will prevent duplicates
  
  // Show which demonstrator is being shown (using Partner letter)
  const demoTypeText = this.add.text(
    this.sys.game.config.width / 2,
    70,
    `Watching Partner ${partnerLetter}`,
    { font: '22px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Show round information
  const roundText = this.add.text(
    this.sys.game.config.width / 2,
    30,
    `Round ${state.currentRound} of ${state.totalRounds}`,
    { font: '20px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Get the correct index for the demonstrator's trajectory
  let trajectoryStartIndex = state.demoTrajectoryIndices[selectedDemoKey] || 0;
  state.demoTrajectoryIndices[selectedDemoKey] = trajectoryStartIndex + numPulls;
  
  // Get the relevant portion of the trajectory
  // In the new format, trajectory is in demonstrator_trajectory
  const trajectory = selectedDemo.demonstrator_trajectory.slice(trajectoryStartIndex, trajectoryStartIndex + numPulls);
  console.log(`Using trajectory slice [${trajectoryStartIndex}:${trajectoryStartIndex + numPulls}]:`, trajectory);
  
  // If trajectory is too short, log warning but continue with what we have
  if (trajectory.length < numPulls) {
    console.warn(`Trajectory too short for demonstrator ${selectedDemoKey}. Using available portion.`);
  }
  
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
  addZoneLabels(this, stage.zone.zone_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Keep reward tank for watch stages to show mining outcomes
  let watchOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100); // Add high depth value to ensure visibility
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Load demonstrator image
  const demoImageKey = `online_watch_${selectedDemoKey}`;
  
  // Get the image path directly from the selected demonstrator config
  const demoImagePath = selectedDemo.demonstrator_image;
  console.log(`Loading online-choice watch demonstrator image: ${demoImagePath}`);
  
  if (!this.textures.exists(demoImageKey)) {
    this.load.image(demoImageKey, `assets/demonstrators/${demoImagePath}`);
    this.load.once('complete', () => {
      startDemonstration.call(this);
    });
    this.load.start();
  } else {
    startDemonstration.call(this);
  }
  
  function startDemonstration() {
    let startPos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
    let dSprite = currentScene.add.image(startPos.x, startPos.y, demoImageKey)
      .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
      .setDepth(9999)
      .setOrigin(0.5);

    let currentStep = 0;
    let totalSteps = trajectory.length;

    moveAlongTrajectoryStep.call(currentScene);

    function moveAlongTrajectoryStep() {
      if (currentStep >= totalSteps) {
        // When demonstration is complete, show next button
        const nextButton = currentScene.add.text(
          currentScene.sys.game.config.width - 100,
          currentScene.sys.game.config.height - 40,
          "Next",
          { font: '18px Arial', fill: '#00ff00', backgroundColor: '#333', padding: 5 }
        ).setOrigin(0.5).setInteractive();
        
        nextButton.on('pointerdown', () => {
          // Call our new function to handle completing the watch stage
          finishOnlineChoiceWatch.call(currentScene);
        });
        return;
      }

      let targetLinearIndex = trajectory[currentStep];
      let targetR = Math.floor(targetLinearIndex / numCols);
      let targetC = targetLinearIndex % numCols;
      
      let pathCells = getManhattanPath(currentR, currentC, targetR, targetC);

      let index = 0;
      let pathTimer = currentScene.time.addEvent({
        delay: 600, // Increased from 300 to 600 (doubled)
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

            // Calculate outcome
            let payoff = bandit[currentR][currentC];
            let outcome = (Math.random() < payoff) ? 1 : 0;
            
            // Create a simple flash effect (just one flash)
            let g = currentScene.add.graphics();
            g.fillStyle(HIGHLIGHT_COLOR, 1);
            g.fillRect(
              gridOriginX + currentC*(cellWidth + CELL_PADDING),
              gridOriginY + currentR*(cellHeight + CELL_PADDING),
              cellWidth, cellHeight
            );
            
            // Fade out only (NO YOYO!) to get a single flash
            currentScene.tweens.add({
              targets: g,
              alpha: 0,
              duration: 200, // Reduced from 400 to 200 for quicker flash
              onComplete: () => {
                g.destroy();
                
                // Record outcome and update tank
                watchOutcomes.push(outcome);
                drawMarkerDot.call(currentScene, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                drawRewardTank.call(currentScene, rewardTankContainer, totalSteps, watchOutcomes);

                currentStep++;
                moveAlongTrajectoryStep.call(currentScene);
              }
            });
          }
        }
      });
    }
  }
}

/**
 * FINAL PLAY sub-stage for online-choice
 */
function setupOnlineChoiceFinalPlay(stage) {
  const state = window.onlineChoiceState;
  const zoneColor = stage.zone && stage.zone.color ? stage.zone.color : "#888888";
  
  console.log("Loading ONLINE-CHOICE FINAL PLAY sub-stage");
  
  // Store a reference to the scene
  const currentScene = this;
  
  // Create title text
  const titleText = this.add.text(
    this.sys.game.config.width / 2,
    100,
    "Final Play:",
    { 
      font: '28px Arial', 
      fill: '#ffffff',
      align: 'center'
    }
  ).setOrigin(0.5);
  
  // Show round information
  const roundText = this.add.text(
    this.sys.game.config.width / 2,
    50,
    `Round ${state.totalRounds} of ${state.totalRounds}`,
    { font: '20px Arial', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Create the demonstrator cells
  const demonstrators = stage.demonstrators;
  const demoKeys = Object.keys(demonstrators);
  
  // Configuration
  const numDemonstrators = demoKeys.length;
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 100; // More padding for clearer separation
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (this.sys.game.config.width - totalWidth) / 2;
  const gridY = 200;
  
  // Create cells for each demonstrator
  const cells = [];
  
  for (let i = 0; i < demoKeys.length; i++) {
    const demoKey = demoKeys[i];
    const demo = demonstrators[demoKey];
    
    const x = gridX + i * (cellWidth + cellPadding) + cellWidth/2;
    const y = gridY + cellHeight/2;
    
    // Create background
    const cellBg = this.add.rectangle(
      x, y,
      cellWidth, cellHeight,
      0x333333
    ).setOrigin(0.5);
    
    // Create label with demonstrator type (expert/novice)
    // In the new format, type is in demonstrator_type
    const labelText = demo.demonstrator_type ? 
      demo.demonstrator_type.charAt(0).toUpperCase() + demo.demonstrator_type.slice(1) : // Capitalize
      demoKey.charAt(0).toUpperCase() + demoKey.slice(1); // Fallback to key
    
    const label = this.add.text(
      x,
      gridY - 30,
      labelText,
      { 
        font: '18px Arial', 
        fill: '#ffffff',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 }
      }
    ).setOrigin(0.5);
    
    // Load demonstrator image
    const imageKey = `online_choice_${demoKey}`;
    this.load.image(imageKey, `assets/demonstrators/${demo.demonstrator_image}`);
    
    cells.push({
      key: demoKey,
      x,
      y,
      background: cellBg,
      label,
      imageKey
    });
  }
  
  // Once all images are loaded, create the demonstrator sprites
  this.load.once('complete', () => {
    // Add images to cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      cell.image = currentScene.add.image(cell.x, cell.y, cell.imageKey).setOrigin(0.5);
      
      // Scale to fit
      const scale = Math.min(
        (cellWidth - 20) / cell.image.width,
        (cellHeight - 20) / cell.image.height
      );
      cell.image.setScale(scale);
      
      // Make cells clickable
      cell.background.setInteractive();
      cell.image.setInteractive();
    }
    
    // Add highlight for selection
    const highlightRect = currentScene.add.rectangle(
      cells[0].x, cells[0].y,
      cellWidth + 10, cellHeight + 10,
      parseInt(zoneColor.replace('#', '0x')) || 0x888888
    ).setOrigin(0.5).setAlpha(0.3);
    
    // User sprite below cells
    const userY = gridY + cellHeight + 40;
    let userX = cells[0].x;
    let currentPosition = 0;
    let selectedDemonstrator = null;
    
    // Add user sprite
    const userSprite = currentScene.add.image(userX, userY, 'user')
      .setDisplaySize(DEMO_SPRITE_SIZE, DEMO_SPRITE_SIZE)
      .setDepth(9999)
      .setOrigin(0.5);
    
    // Selection feedback text (initially hidden)
    const feedbackText = currentScene.add.text(
      currentScene.sys.game.config.width / 2,
      gridY + cellHeight + 120,
      "",
      { 
        font: '20px Arial', 
        fill: '#4CAF50',
        align: 'center',
        backgroundColor: '#333333',
        padding: { x: 15, y: 10 }
      }
    ).setOrigin(0.5).setVisible(false);
    
    // Add click handlers for all cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      
      const clickHandler = () => {
        // Only allow selection if not already selected
        if (selectedDemonstrator !== null) return;
        
        // If already on this position, select it
        if (currentPosition === i) {
          selectDemonstrator(i);
        } else {
          // Move to this position
          currentPosition = i;
          userX = cells[currentPosition].x;
          userSprite.setPosition(userX, userY);
          highlightRect.setPosition(cells[currentPosition].x, cells[currentPosition].y);
        }
      };
      
      cell.background.on('pointerdown', clickHandler);
      cell.image.on('pointerdown', clickHandler);
    }
    
    // Function to handle selection
    function selectDemonstrator(index) {
      selectedDemonstrator = cells[index].key;
      
      // Store the selection
      state.chosenDemonstrator = selectedDemonstrator;
      state.demonstratorHistory.push(selectedDemonstrator);
      
      // Show selection feedback
      feedbackText.setText(`You selected: ${selectedDemonstrator}`);
      feedbackText.setVisible(true);
      
      // Highlight selected with stronger border
      highlightRect.setStrokeStyle(4, parseInt(zoneColor.replace('#', '0x')) || 0x888888);
      highlightRect.setAlpha(0.6);
      
      // Add next button
      const nextButton = currentScene.add.text(
        currentScene.sys.game.config.width - 100,
        currentScene.sys.game.config.height - 40,
        "Next",
        { font: '18px Arial', fill: '#00ff00', backgroundColor: '#333', padding: 5 }
      ).setOrigin(0.5).setInteractive();
      
      nextButton.on('pointerdown', () => {
        console.log(`Selected demonstrator: ${selectedDemonstrator}`);
        
        // Move to watch sub-stage
        state.currentSubStage = "watch";
        loadStage.call(currentScene);
      });
    }
    
    // Listen for arrow keys and spacebar
    currentScene.input.keyboard.on('keydown', (evt) => {
      // Only allow movement if not already selected
      if (selectedDemonstrator !== null) return;
      
      let oldPosition = currentPosition;
      
      if (evt.code === 'ArrowLeft') {
        currentPosition = Math.max(0, currentPosition - 1);
      }
      if (evt.code === 'ArrowRight') {
        currentPosition = Math.min(cells.length - 1, currentPosition + 1);
      }
      
      // If position changed, update user sprite and highlight
      if (oldPosition !== currentPosition) {
        userX = cells[currentPosition].x;
        userSprite.setPosition(userX, userY);
        highlightRect.setPosition(cells[currentPosition].x, cells[currentPosition].y);
      }
      
      // Space to select
      if (evt.code === 'Space') {
        selectDemonstrator(currentPosition);
      }
    });
  });
  
  // Start loading the images
  this.load.start();
}

/************************************************
 * Utility
 ************************************************/
function nextStage() {
  // Use the structure discovery from loadStage to handle nested arrays
  const currentSession = timelineData[currentSessionIndex];
  
  console.log(`Current session: ${currentSessionIndex}, stage: ${currentStageIndex}`);
  
  // Check if we're at the end of all sessions
  if (currentSessionIndex >= timelineData.length) {
    showEndOfGameMessage.call(this);
    return;
  }
  
  // Check if the current session has nested arrays
  let isNestedArraySession = Array.isArray(currentSession[0]);
  let isLastStageInSession = false;
  
  if (isNestedArraySession) {
    // For nested array sessions, we need to find which container we're in
    let totalStagesSoFar = 0;
    let currentContainerIndex = -1;
    let stageIndexInContainer = -1;
    
    // Find which container we're in
    for (let i = 0; i < currentSession.length; i++) {
      const container = currentSession[i];
      if (totalStagesSoFar + container.length > currentStageIndex) {
        // Found our container
        currentContainerIndex = i;
        stageIndexInContainer = currentStageIndex - totalStagesSoFar;
        break;
      }
      totalStagesSoFar += container.length;
    }
    
    console.log(`In nested session, container: ${currentContainerIndex}, stage in container: ${stageIndexInContainer}`);
    
    // Check if this is the last stage in the current container
    const isLastInContainer = (stageIndexInContainer === currentSession[currentContainerIndex].length - 1);
    
    // Check if this is also the last container in the session
    const isLastContainer = (currentContainerIndex === currentSession.length - 1);
    
    // If it's the last stage in the last container, we're done with this session
    isLastStageInSession = isLastInContainer && isLastContainer;
    
    // Increment stage index
    currentStageIndex++;
    
    // Check if we need to move to the next session
    if (isLastStageInSession) {
      console.log("End of nested session reached, moving to next session");
      currentSessionIndex++;
      currentStageIndex = 0;
      
      // Clear summary icons when starting a new session
      summaryIcons = [];
      redrawSummaryBarDOM();
      console.log("Cleared summary bar for new session");
    }
  } else {
    // For simple array sessions, the logic is more straightforward
    isLastStageInSession = (currentStageIndex === currentSession.length - 1);
    
    // Increment stage index
    currentStageIndex++;
    
    // Check if we need to move to the next session
    if (currentStageIndex >= currentSession.length) {
      console.log("End of simple session reached, moving to next session");
      currentSessionIndex++;
      currentStageIndex = 0;
      
      // Clear summary icons when starting a new session
      summaryIcons = [];
      redrawSummaryBarDOM();
      console.log("Cleared summary bar for new session");
    }
  }
  
  // Check if we're at the end of all sessions
  if (currentSessionIndex >= timelineData.length) {
    showEndOfGameMessage.call(this);
    return;
  }
  
  // Get the next stage
  const nextStageObj = getCurrentStageObject();
  
  if (!nextStageObj) {
    console.error("Could not find next stage object!");
    return;
  }
  
  // Get the stage type from both possible properties
  const nextStageType = nextStageObj.stage_type || nextStageObj.game;
  console.log(`Next stage type: ${nextStageType}, session: ${currentSessionIndex}, stage: ${currentStageIndex}`);
  
  // Check if it's a gameplay stage that needs a transition overlay
  const gameplayStages = ['practice', 'play', 'watch', 'indicate', 'blind', 'choice', 'online-choice'];
  
  if (gameplayStages.includes(nextStageType)) {
    // Show the transition overlay
    showTransitionOverlay(this, nextStageObj, () => {
      // This callback runs when the user clicks the button
      loadStage.call(this);
    });
  } else {
    // For non-gameplay stages, just load directly
    loadStage.call(this);
  }
}

// Helper function to get the current stage object based on indices
function getCurrentStageObject() {
  if (!timelineData || currentSessionIndex >= timelineData.length) {
    return null;
  }
  
  const currentSession = timelineData[currentSessionIndex];
  
  // Check if the session has nested arrays
  if (Array.isArray(currentSession[0])) {
    let totalStagesSoFar = 0;
    
    for (let i = 0; i < currentSession.length; i++) {
      if (currentStageIndex < totalStagesSoFar + currentSession[i].length) {
        // This container has our stage
        const effectiveIndex = currentStageIndex - totalStagesSoFar;
        return currentSession[i][effectiveIndex];
      }
      totalStagesSoFar += currentSession[i].length;
    }
    
    return null; // Stage not found
  } else {
    // Simple array session
    if (currentStageIndex < currentSession.length) {
      return currentSession[currentStageIndex];
    }
    return null;
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

  // Check for a custom background in the zone
  let bgColor = 0x000000; // Default black
  let hasBackgroundImage = false;
  let backgroundImageKey = null;
  
  if (stage.zone.background || stage.zone.zone_background) {
    const background = stage.zone.background || stage.zone.zone_background;
    
    // If background ends with .png, it's an image file
    if (background.endsWith('.png')) {
      hasBackgroundImage = true;
      backgroundImageKey = `zone_bg_${stage.zone.zone_index}`;
      
      // Check if image is already loaded
      if (!this.textures.exists(backgroundImageKey)) {
        // Load the background image from zone_backgrounds folder
        console.log(`Loading zone background image: ${background}`);
        this.load.image(backgroundImageKey, `assets/zone_backgrounds/${background}`);
        this.load.once('complete', () => {
          applyBackground.call(this);
        });
        this.load.start();
        return; // Wait for image to load
      }
    } else {
      // It's a color name, convert to hex
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
        'grey': 0x808080
      };
      
      // If it's a hex code, convert it
      if (background.startsWith('#')) {
        bgColor = parseInt(background.replace('#', '0x'));
      } else {
        // Otherwise look it up in our color map
        bgColor = colorMap[background.toLowerCase()] || 0x000000;
      }
    }
  }
  
  // If we aren't waiting for an image to load, proceed with the background
  if (!hasBackgroundImage || this.textures.exists(backgroundImageKey)) {
    applyBackground.call(this);
  }
  
  function applyBackground() {
    // Create background for the ENTIRE game container, not just the grid
    const gameWidth = this.sys.game.config.width;
    const gameHeight = this.sys.game.config.height;
    
    // Create background - either color or image
    if (hasBackgroundImage) {
      // Add the background image to cover the entire game container
      let zoneBg = this.add.image(0, 0, backgroundImageKey)
        .setOrigin(0, 0)
        .setDisplaySize(gameWidth, gameHeight)
        .setDepth(-1000); // Set to very low depth to ensure it's behind everything
    } else {
      // Add a colored rectangle for the entire game container
      let bgRect = this.add.rectangle(
        0, 
        0, 
        gameWidth, 
        gameHeight, 
        bgColor
      ).setOrigin(0, 0).setDepth(-1000); // Set to very low depth to ensure it's behind everything
    }
    
    // Calculate grid dimensions for the cell content
    const totalGridWidth = (numCols * cellWidth) + ((numCols - 1) * CELL_PADDING);
    const totalGridHeight = (numRows * cellHeight) + ((numRows - 1) * CELL_PADDING);
    
    // Continue with the cells (either asteroid or landscape)
    const zoneMode = stage.zone.mode || stage.zone.zone_mode || "landscape";

    if (zoneMode === "landscape") {
      // LANDSCAPE MODE: one background for all cells
      // Make sure we've loaded the landscape image
      const landscapeImage = stage.zone.images || stage.zone.zone_images;
      if (!landscapeImage || landscapeImage.length === 0) {
        console.error("Missing landscape images");
        return;
      }
      
      const landscapeKey = `landscape_${stage.zone.zone_index}`;
      
      if (!this.textures.exists(landscapeKey)) {
        this.load.image(landscapeKey, `assets/landscapes/${landscapeImage[0]}`);
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
      const asteroidImages = stage.zone.images || stage.zone.zone_images;
      if (!asteroidImages || asteroidImages.length === 0) {
        console.error("Missing asteroid images");
        return;
      }
      
      const imageKeys = [];

      // Create a loader for all asteroid images
      let loadingRequired = false;
      for (let i = 0; i < asteroidImages.length; i++) {
        const asteroidKey = `asteroid_${stage.zone.zone_index}_${i}`;
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
  tankBg.setDepth(1); // Ensure it's above any background but below other elements
  container.add(tankBg);
  
  // Add a title above the tank
  const tankTitle = this.add.text(0, -15, "Mining Reward Tank", { 
    font: '14px Arial', 
    fill: '#ffffff' 
  });
  tankTitle.setOrigin(0.5, 0.5);  // Center the title
  tankTitle.setDepth(2); // Ensure it's above the background
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
    slotRect.setDepth(1);  // Same depth as the background
    container.add(slotRect);
  }
}

/** Smaller success/fail dot. */
function drawMarkerDot(gridX, gridY, cellWidth, cellHeight, row, col, outcome) {
  let { x, y } = getCellCenter(gridX, gridY, cellWidth, cellHeight, row, col);
  let offsetX = Phaser.Math.Between(-cellWidth/4, cellWidth/4);
  let offsetY = Phaser.Math.Between(-cellHeight/4, cellHeight/4);
  let color = (outcome === 1) ? 0x00ff00 : 0xff0000;

  // First draw a slightly larger black circle for the border
  let border = this.add.circle(x + offsetX, y + offsetY, MARKER_DOT_RADIUS + 1, 0x000000);
  border.setDepth(99998);
  
  // Then draw the colored dot on top
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
  const stageType = nextStage.stage_type || nextStage.game;
  let buttonText;
  
  switch(stageType) {
    case 'practice': buttonText = 'Practice'; break;
    case 'play': buttonText = 'Play'; break;
    case 'blind': buttonText = 'Play'; break; // Use "Play" for blind too
    case 'choice': buttonText = 'Choose'; break; // Add "Choose" for choice game
    case 'online-choice': buttonText = 'Start'; break; // Add "Start" for online-choice
    case 'watch': buttonText = 'Watch'; break;
    case 'indicate': buttonText = 'Watch'; break; // Indicate also uses "Watch"
    default: buttonText = 'Next';
  }
  
  // Get the overlay message - check both at top level and in zone
  const message = nextStage["overlay-message"] || 
                 (nextStage.zone && nextStage.zone["overlay-message"]) || 
                 `Get ready to ${buttonText.toLowerCase()}!`;
  
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
  if (nextStage.zone) {
    const zoneColor = nextStage.zone.zone_color || nextStage.zone.color || "#ffffff";
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
    // Always use zone_color from timeline.json rather than color property
    const zoneColor = zone.zone_color || zone.color || '#ffffff';
    console.log(`Transition overlay using zone_color: ${zoneColor}`);
    const zoneIndex = zone.zone_index;
    
    // For choice game, use a special zone display
    if (stageType === 'choice') {
      createChoiceZoneIcon(scene, zoneColor || '#888888');
    } else if (stageType === 'online-choice') {
      // For online-choice, also use the user.png image
      createOnlineChoiceZoneIcon(scene, zoneColor || '#888888', zoneIndex);
    } else {
      // Create a single icon similar to the summary bar items
      createSummaryStyleIcon(scene, stageType, nextStage, zoneColor, zoneIndex);
    }
  } else if (stageType === 'choice') {
    // Fallback for choice with no zone - use a default color
    console.log("Using fallback color for choice with no zone");
    createChoiceZoneIcon(scene, '#888888');
  } else if (stageType === 'online-choice') {
    // Fallback for online-choice with no zone - use a default color
    console.log("Using fallback color for online-choice with no zone");
    createOnlineChoiceZoneIcon(scene, '#888888', 0);
  }
  
  // Special function for online-choice zone icon
  function createOnlineChoiceZoneIcon(scene, zoneColor, zoneIndex) {
    console.log("Creating online-choice zone icon");
    
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
    
    console.log(`Online-choice zone color: ${zoneColor}, hex: ${colorHex}`);
    
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
    
    // Make sure the user image is loaded
    if (!scene.textures.exists('user')) {
        scene.load.image('user', 'assets/user.png');
        scene.load.once('complete', () => {
            addUserImage();
        });
        scene.load.start();
    } else {
        addUserImage();
    }
    
    function addUserImage() {
        // Add the player image
        const playerImage = scene.add.image(
            0,
            -20,
            'user'
        );
        
        // Debug the user image
        console.log("Adding user image for online-choice:", playerImage);
        
        // Scale image to fit
        const imageSize = 80;
        const scale = Math.min(
            imageSize / playerImage.width,
            imageSize / playerImage.height
        );
        playerImage.setScale(scale);
        container.add(playerImage);
        
        // Add zone text
        const zoneText = scene.add.text(
            0,
            50,
            `Zone ${zoneIndex}`,
            { font: '20px Arial', fill: '#ffffff' }
        ).setOrigin(0.5);
        container.add(zoneText);
    }
  }
  
  // Special function to create the choice zone icon
  function createChoiceZoneIcon(scene, zoneColor) {
    console.log(`Creating choice zone icon with color: ${zoneColor}`);
    
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
    
    console.log(`Choice zone color: ${zoneColor}, hex: ${colorHex}`);
    
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
    
    // Make sure the user image is loaded
    if (!scene.textures.exists('user')) {
        scene.load.image('user', 'assets/user.png');
        scene.load.once('complete', () => {
            addUserImage();
        });
        scene.load.start();
    } else {
        addUserImage();
    }
    
    function addUserImage() {
        // Add the player image
        const playerImage = scene.add.image(
            0,
            -20,
            'user'
        );
        
        // Debug the user image
        console.log("Adding user image for choice:", playerImage);
        
        // Scale image to fit
        const imageSize = 80;
        const scale = Math.min(
            imageSize / playerImage.width,
            imageSize / playerImage.height
        );
        playerImage.setScale(scale);
        container.add(playerImage);
        
        // Add custom zone text
        const zoneText = scene.add.text(
            0,
            50,
            "Choice Zone",
            { font: '20px Arial', fill: '#ffffff' }
        ).setOrigin(0.5);
        container.add(zoneText);
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
    if (stageType === 'practice' || stageType === 'play' || stageType === 'blind') {
        playerImageKey = 'user';
        addPlayerImageToContainer(playerImageKey);
    } else if (stageType === 'watch' || stageType === 'indicate') {
        if (nextStage.demonstrator && nextStage.demonstrator.demonstrator_image) {
            // Create a unique key for this demonstrator that includes session info
            const demoIndex = nextStage.demonstrator.demonstrator_index || 0;
            const sessionIndex = nextStage.session_index || 0;
            const gameIndex = nextStage.game_index || 0;
            playerImageKey = `overlay_demo_s${sessionIndex}_g${gameIndex}_${demoIndex}`;
            
            // Always load a fresh copy of the image to avoid caching issues
            const demoImage = nextStage.demonstrator.demonstrator_image;
            console.log(`Loading transition overlay demonstrator image: ${demoImage} for session ${sessionIndex}, game ${gameIndex}`);
            
            scene.load.image(playerImageKey, `assets/demonstrators/${demoImage}`);
            scene.load.once('complete', () => {
                addPlayerImageToContainer(playerImageKey);
            });
            scene.load.start();
        } else {
            playerImageKey = 'user';
            addPlayerImageToContainer(playerImageKey);
        }
    } else {
        playerImageKey = 'user';
        addPlayerImageToContainer(playerImageKey);
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

// Special function to create the choice zone icon
function createChoiceZoneIcon(scene, zoneColor) {
    console.log(`Creating choice zone icon with color: ${zoneColor}`);
    
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
    
    console.log(`Choice zone color: ${zoneColor}, hex: ${colorHex}`);
    
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
    
    // Make sure the user image is loaded
    if (!scene.textures.exists('user')) {
        scene.load.image('user', 'assets/user.png');
        scene.load.once('complete', () => {
            addUserImage();
        });
        scene.load.start();
    } else {
        addUserImage();
    }
    
    function addUserImage() {
        // Add the player image
        const playerImage = scene.add.image(
            0,
            -20,
            'user'
        );
        
        // Debug the user image
        console.log("Adding user image for choice:", playerImage);
        
        // Scale image to fit
        const imageSize = 80;
        const scale = Math.min(
            imageSize / playerImage.width,
            imageSize / playerImage.height
        );
        playerImage.setScale(scale);
        container.add(playerImage);
        
        // Add custom zone text
        const zoneText = scene.add.text(
            0,
            50,
            "Choice Zone",
            { font: '20px Arial', fill: '#ffffff' }
        ).setOrigin(0.5);
        container.add(zoneText);
    }
  }

function finishOnlineChoiceWatch() {
  const currentScene = this;
  
  // Update round number before proceeding to next round
  if (window.onlineChoiceState) {
    const state = window.onlineChoiceState;
    
    // Before incrementing round, set the next substage to play
    state.currentSubStage = "play";
    
    // Check if we've completed all rounds
    if (state.currentRound >= state.totalRounds) {
      console.log("All online-choice rounds completed, moving to next stage");
      window.onlineChoiceState = null; // Clear state for next time
      // Move to next stage in timeline
      nextStage.call(currentScene);
    } else {
      // Not at the last round yet, increment round number
      state.currentRound++;
      console.log(`Moving to round ${state.currentRound}`);
      // Go back to play sub-stage
      loadStage.call(currentScene);
    }
  } else {
    // If state is somehow missing, just move to next stage
    nextStage.call(currentScene);
  }
}
