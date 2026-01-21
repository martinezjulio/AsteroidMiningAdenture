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
 *   4) MongoDB logging for all user actions and game events
 ****************************************/

let timelineData = null;        
let currentSessionIndex = 0;      // Which session we're on
let currentStageIndex = 0;        // Which stage within the session we're on      
let prolificID = "";            

// We'll store summary icons (one per "game" stage).
let summaryIcons = [];

// Demonstrator config from server
let demonstratorConfig = null; 

// Game config from server (includes verbose flag)
let gameConfig = null;

// Track demonstrators seen in current session
let seenDemonstratorsThisSession = new Set();
let lastSessionIndex = -1; // Track when session changes to reset demonstrator history

// Global image mappings - randomized at game start
let demonstratorImageMapping = {};
let landscapeImageMapping = {};
let zoneBackgroundImageMapping = {};
let asteroidImageMapping = {};
let imageMappingsInitialized = false;

// Demonstrator style+color mapping system
let demonstratorStyleColorMapping = {}; // Maps demonstrator_global_index -> {style: 'style1', color: 'blue'}
let usedStyleColorCombos = new Set(); // Track used combos to ensure uniqueness
const AVAILABLE_STYLES = ['style1', 'style2', 'style3', 'style4', 'style5', 'style6'];
const AVAILABLE_COLORS = ['red', 'orange', 'blue', 'green', 'yellow', 'purple'];

// Zone color and ID mappings - generated on the fly
let zoneColorMapping = {}; // Maps zone_global_index -> unique color
let usedColors = new Set(); // Track used colors to ensure uniqueness
let zoneMappedBackgrounds = {}; // Maps zone_global_index -> background filename
let demonstratorMappedImages = {}; // Maps demonstrator_global_index -> image filename
let zoneBanditArmImageIds = {}; // Maps zone_global_index -> array of mapped asteroid filenames

// MongoDB Logging Variables
let userUID = generateUID(); // Generate unique user ID
let sessionID = generateSessionID(); // Generate unique session ID
let lastTrackedSessionIndex = -1; // Track session changes to regenerate session_id
let experimentID = null; // Will be fetched from server
let experimentConfigPath = null; // Will be fetched from server
let displayRunningTotalReward = false; // Config flag for displaying total reward
let currentGameStep = 0; // Reset for each game
let userTotalReward = 0; // Cumulative across all games
let currentGameReward = 0; // Reset for each game
let refreshCount = parseInt(localStorage.getItem('refreshCount') || '0', 10);

let currentGameSequence = ""; // Track sequence of games in session as string
let currentGameType = null;
let currentShotsRemaining = 0;
let currentPosition = 0;

// Choice-specific logging variables
let choiceDemonstratorId = null; // Will store the demonstrator_id of chosen demonstrator
let choiceDemonstratorType = null; // Will store the demonstrator_type of chosen demonstrator
let choiceDemonstratorData = null; // Will store the full demonstrator data object

// Generate a unique user ID
function generateUID() {
  return 'uid_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// Generate a unique session ID
function generateSessionID() {
  return 'sid_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// Verbose logging helper - only logs if verbose flag is set in config
function verboseLog(...args) {
  if (gameConfig && gameConfig.verbose) {
    console.log(...args);
  }
}

/*****************************************
 * Thompson Sampler Class
 * Implements Thompson sampling for bandit problems
 ****************************************/
class ThompsonSampler {
  constructor(numArms, banditPayoffs) {
    this.numArms = numArms;
    this.banditPayoffs = banditPayoffs;  // Flattened 1D array of payoffs
    this.alphas = new Array(numArms).fill(1);  // Initialize with 1s
    this.betas = new Array(numArms).fill(1);   // Initialize with 1s
    this.allActions = [];  // Track all actions
    this.allRewards = [];  // Track all rewards
  }
  
  // Sample from Beta distribution using Gamma distribution method
  sampleBeta(alpha, beta) {
    // Beta(alpha, beta) can be sampled as Gamma(alpha) / (Gamma(alpha) + Gamma(beta))
    const gammaAlpha = this.sampleGamma(alpha);
    const gammaBeta = this.sampleGamma(beta);
    return gammaAlpha / (gammaAlpha + gammaBeta);
  }
  
  // Sample from Gamma distribution using Marsaglia and Tsang's method
  sampleGamma(shape, scale = 1.0) {
    // Handle special case for shape < 1
    if (shape < 1) {
      return this.sampleGamma(shape + 1, scale) * Math.pow(Math.random(), 1.0 / shape);
    }
    
    const d = shape - 1.0 / 3.0;
    const c = 1.0 / Math.sqrt(9.0 * d);
    
    while (true) {
      let x, v;
      do {
        x = this.sampleNormal(0, 1);
        v = 1.0 + c * x;
      } while (v <= 0);
      
      v = v * v * v;
      const u = Math.random();
      const x2 = x * x;
      
      if (u < 1.0 - 0.0331 * x2 * x2) {
        return d * v * scale;
      }
      if (Math.log(u) < 0.5 * x2 + d * (1.0 - v + Math.log(v))) {
        return d * v * scale;
      }
    }
  }
  
  // Sample from standard normal distribution using Box-Muller transform
  sampleNormal(mean = 0, stdDev = 1) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
  }
  
  // Select arm using Thompson sampling
  selectArm() {
    const samples = this.alphas.map((alpha, i) => 
      this.sampleBeta(alpha, this.betas[i])
    );
    // Return argmax of sampled values
    return samples.indexOf(Math.max(...samples));
  }
  
  // Update alpha/beta based on reward
  update(arm, reward) {
    this.alphas[arm] += reward;
    this.betas[arm] += (1 - reward);
    this.allActions.push(arm);
    this.allRewards.push(reward);
  }
  
  // Run one step: select arm, sample reward, update
  step() {
    const arm = this.selectArm();
    const payoff = this.banditPayoffs[arm];
    const reward = (Math.random() < payoff) ? 1 : 0;
    this.update(arm, reward);
    return { arm, reward };
  }
}

// Request fullscreen mode with cross-browser compatibility
function requestFullscreen() {
  const element = document.documentElement; // Use the entire document
  
  if (element.requestFullscreen) {
    element.requestFullscreen();
  } else if (element.webkitRequestFullscreen) {
    element.webkitRequestFullscreen();
  } else if (element.mozRequestFullScreen) {
    element.mozRequestFullScreen();
  } else if (element.msRequestFullscreen) {
    element.msRequestFullscreen();
  } else {
    console.warn('Fullscreen API is not supported in this browser');
  }
}

// Fetch experiment config from server
async function fetchExperimentConfig() {
  try {
    const response = await fetch('api/config');
    const config = await response.json();
    gameConfig = config; // Store full config including verbose flag
    experimentID = config.experiment_id;
    experimentConfigPath = config.experiment_config_path;
    displayRunningTotalReward = config.display_running_total_reward || false;
    demonstratorConfig = config.demonstrator_config || null;
    
    verboseLog('Demonstrator config:', demonstratorConfig);
  } catch (error) {
    console.error('Error fetching experiment config:', error);
    experimentID = 'unknown'; // fallback
    experimentConfigPath = 'data/timeline.json'; // fallback
    displayRunningTotalReward = false; // fallback
  }
}

// MongoDB Logging Function
async function logToMongoDB(action, additionalData = {}) {
  if (!window.currentStage) return;
  
  const stage = window.currentStage;
  const logData = {
    prolific_id: prolificID,
    uid: userUID,
    session_id: sessionID,
    session_index: currentSessionIndex,
    step: currentGameStep,
    position: currentPosition,
    action: action,
    timestamp: new Date(),
    shots_remaining: currentShotsRemaining,
    game: currentGameType,
    game_total_reward: currentGameReward,
    user_total_reward: userTotalReward,
    reward_generated: additionalData.reward_generated || false,
    shot: action === 'shoot',
    transfer: stage.transfer || false,
    game_sequence: currentGameSequence,
    game_index: stage.game_index || 0,
    stage_index: stage.stage_index || 0,
    round_index: stage.round_index !== null ? stage.round_index : 0,
    demonstrator_session_index: stage.demonstrator ? stage.demonstrator.demonstrator_session_index : 
                               (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? 
                                window.onlineChoiceSelectedDemo.data.demonstrator_session_index : null),
    demonstrator_type: stage.demonstrator ? stage.demonstrator.demonstrator_type :
                      (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? 
                       window.onlineChoiceSelectedDemo.data.demonstrator_type : null),
    demonstrator_global_index: stage.demonstrator ? stage.demonstrator.demonstrator_global_index :
                               (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? 
                               window.onlineChoiceSelectedDemo.data.demonstrator_global_index : null),
    demonstrator_id: stage.demonstrator ? mapDemonstratorImage(stage.demonstrator.demonstrator_global_index, stage.demonstrator.demonstrator_style, stage.demonstrator.demonstrator_color) :
                    (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? 
                     mapDemonstratorImage(window.onlineChoiceSelectedDemo.data.demonstrator_global_index, window.onlineChoiceSelectedDemo.data.demonstrator_style, window.onlineChoiceSelectedDemo.data.demonstrator_color) : null),
    demonstrator_trajectory: stage.demonstrator ? (() => {
                           const trajectory = stage.demonstrator.demonstrator_trajectory;
                           return (trajectory && Array.isArray(trajectory)) ? trajectory.join(',') : "";
                         })() : (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? (() => {
                           const trajectory = window.onlineChoiceSelectedDemo.data.demonstrator_trajectory;
                           return (trajectory && Array.isArray(trajectory)) ? trajectory.join(',') : "";
                         })() : ""),
    
    // Inline mode demonstrator data (from additionalData if present)
    demonstrator_all_actions: additionalData.demonstrator_all_actions || null,
    demonstrator_all_rewards: additionalData.demonstrator_all_rewards || null,
    
    zone_global_index: stage.zone ? stage.zone.zone_global_index : 0,
    zone_color: stage.zone ? generateZoneColor(stage.zone.zone_global_index) : null,
    zone_background: stage.zone ? mapZoneBackground(stage.zone.zone_global_index) : null,
    zone_bandit: stage.zone ? (() => {
      const bandit = stage.zone.zone_bandit || stage.zone.bandit || [];
      return Array.isArray(bandit) ? bandit.flat().join(',') : "";
    })() : "",
    zone_bandit_id: stage.zone ? (stage.zone.bandit_id || null) : null,
    zone_bandit_arm_image_ids: stage.zone && stage.zone.zone_bandit_arm_image_indexes ? 
                               (() => {
                                 const images = mapZoneBanditArmImages(stage.zone.zone_global_index, stage.zone.zone_bandit_arm_image_indexes);
                                 return Array.isArray(images) ? images.join(',') : "";
                               })() : "",
    choice_demonstrator_id: choiceDemonstratorId,
    choice_demonstrator_type: choiceDemonstratorType,
    refresh_count: refreshCount,
    experiment_id: experimentID,
    ...additionalData
  };
  
  try {
    const response = await fetch('api/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(logData)
    });
    
    if (!response.ok) {
      console.error('Failed to log to MongoDB:', response.statusText);
    }
  } catch (error) {
    console.error('Error logging to MongoDB:', error);
  }
}

// Function to log page refresh
async function logPageRefresh() {
  refreshCount++;
  localStorage.setItem('refreshCount', refreshCount.toString());
  try {
    const response = await fetch('api/log-refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prolific_id: prolificID,
        uid: userUID,
        session_id: sessionID
      })
    });
  } catch (error) {
    console.error('Error logging page refresh:', error);
  }
}

// Initialize game sequence tracking
function initializeGameSequence() {
  if (!timelineData || currentSessionIndex >= timelineData.length) return;
  
  const currentSession = timelineData[currentSessionIndex];
  let sequenceParts = [];
  
  // Build game sequence for current session - only first round pattern
  if (Array.isArray(currentSession[0])) {
    // Nested array session
    const gamesContainer = currentSession[0]; // First container has the games
    const choiceContainer = currentSession[1]; // Second container has the choice
    
    // Only process first round (stages where round_index = 0)
    const firstRoundStages = gamesContainer.filter(stage => stage.round_index === 0);
    
    for (let stage of firstRoundStages) {
      const gameType = stage.stage_type || stage.game;
      if (gameType === 'watch') {
        // Use demonstrator expertise instead of "watch"
        const demonstratorType = stage.demonstrator?.demonstrator_type || 'unknown';
        sequenceParts.push(demonstratorType);
      } else if (gameType === 'play') {
        sequenceParts.push('play');
      } else if (['practice', 'indicate', 'blind'].includes(gameType)) {
        sequenceParts.push(gameType);
      }
    }
    
    // Add choice at the end
    if (choiceContainer && choiceContainer.length > 0) {
      sequenceParts.push('choice');
    }
  } else {
    // Simple array session (practice session)
    for (let stage of currentSession) {
      const gameType = stage.stage_type || stage.game;
      if (gameType === 'online-choice') {
        // For online-choice, add both choice and watch to the sequence
        sequenceParts.push('choice');
        sequenceParts.push('watch');
      } else if (['practice', 'play', 'watch', 'indicate', 'blind', 'choice'].includes(gameType)) {
        sequenceParts.push(gameType);
      }
    }
  }
  
  // Convert to string with dashes
  currentGameSequence = sequenceParts.join('-');
}

// Reset game-specific tracking variables
function resetGameTracking(gameType, numArmPulls = 0) {
  currentGameStep = 0;
  currentGameReward = 0;
  
  // Handle online-choice phases
  if (gameType === 'online-choice') {
    // Check which phase we're in
    if (window.onlineChoicePhase === 'choice') {
      currentGameType = 'choice';
    } else if (window.onlineChoicePhase === 'watch') {
      currentGameType = 'watch';
    } else {
      currentGameType = 'choice'; // Default to choice phase
    }
  } else {
    currentGameType = gameType;
  }
  
  currentShotsRemaining = numArmPulls;
  currentPosition = 0;
  
  // Reset choice-specific variables for non-choice games (but preserve for feedback)
  if (gameType !== 'choice' && currentGameType !== 'choice' && gameType !== 'feedback') {
    choiceDemonstratorId = null;
    choiceDemonstratorType = null;
    choiceDemonstratorData = null;
  }
}

// Track page refresh events
window.addEventListener('beforeunload', () => {
  logPageRefresh();
});

// Adjust these as you wish:
const DEMO_SPRITE_SIZE = 55;       // user/demonstrator sprite size (max dimension)
const HIGHLIGHT_COLOR = 0xffffff;  // Lighter highlight => 0xffffff
const HIGHLIGHT_ALPHA = 0.25;      // Lighter alpha

// Helper function to set sprite size while maintaining aspect ratio
function setSpriteDisplaySizeWithAspectRatio(sprite, maxSize) {
  const width = sprite.width;
  const height = sprite.height;
  const scale = Math.min(maxSize / width, maxSize / height);
  sprite.setScale(scale);
  return sprite;
}
const MARKER_DOT_RADIUS = 4;
const TANK_SLOT_SIZE = 24;         // Size of each slot in the reward tank
const TANK_SLOT_PADDING = 2;       // Padding between tank slots
const TANK_MARGIN_TOP = 150;       // Space between grid bottom and tank (increased for starship name)
const CELL_PADDING = 10;           // Spacing between cells (in pixels)
const BASE_CELL_SIZE = (400 / 12) * 1.85; // ~85% larger than before
const WATCH_START_DELAY = 500;     // Delay before starting watch demonstrations (ms)

// Function to test if an image exists (with error suppression)
async function imageExists(imagePath) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    // Suppress console errors by setting this
    img.style.display = 'none';
    img.src = imagePath;
  });
}

// Function to discover available images in a category
async function discoverAvailableImages(basePath, prefix, extension, maxToCheck = 50) {
  const availableImages = [];
  

  
  for (let i = 0; i < maxToCheck; i++) {
    const paddedIndex = i.toString().padStart(2, '0');
    const imageName = `${prefix}${paddedIndex}${extension}`;
    const fullPath = `${basePath}/${imageName}`;
    
    if (await imageExists(fullPath)) {
      availableImages.push(imageName);
    } else {
      // Stop immediately after first missing file since images are sequential
      break;
    }
  }
  

  return availableImages;
}

// Function to create a random mapping from indices to shuffled images
function createRandomMapping(imageList) {
  // Create a copy and shuffle it
  const shuffledImages = [...imageList];
  for (let i = shuffledImages.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledImages[i], shuffledImages[j]] = [shuffledImages[j], shuffledImages[i]];
  }
  
  // Create mapping from index to image filename
  const mapping = {};
  shuffledImages.forEach((imageName, index) => {
    mapping[index] = imageName;
  });
  

  return mapping;
}

// Function to analyze timeline and extract demonstrator constraints
function analyzeTimelineDemonstrators(timeline) {
  const allDemonstrators = new Set();
  const sessionDemonstrators = {}; // Maps session_index -> Set of demonstrator_global_indexes in that session
  
  // Iterate through all sessions and stages in the timeline
  for (const session of timeline) {
    for (const stage of session) {
      if (Array.isArray(stage)) {
        // Handle nested arrays (sessions within sessions)
        for (const subStage of stage) {
          const sessionIdx = subStage.session_index;
          
          // Initialize session set if needed
          if (sessionIdx !== undefined && !sessionDemonstrators[sessionIdx]) {
            sessionDemonstrators[sessionIdx] = new Set();
          }
          
          // Track demonstrators from regular stages
          if (subStage.demonstrator && subStage.demonstrator.demonstrator_global_index !== undefined) {
            const demoIdx = subStage.demonstrator.demonstrator_global_index;
            allDemonstrators.add(demoIdx);
            if (sessionIdx !== undefined) {
              sessionDemonstrators[sessionIdx].add(demoIdx);
            }
          }
          
          // Track demonstrators from choice stages
          if (subStage.game === 'choice' && subStage.demonstrator1 && subStage.demonstrator2) {
            const idx1 = subStage.demonstrator1.demonstrator_global_index;
            const idx2 = subStage.demonstrator2.demonstrator_global_index;
            if (idx1 !== undefined) {
              allDemonstrators.add(idx1);
              if (sessionIdx !== undefined) {
                sessionDemonstrators[sessionIdx].add(idx1);
              }
            }
            if (idx2 !== undefined) {
              allDemonstrators.add(idx2);
              if (sessionIdx !== undefined) {
                sessionDemonstrators[sessionIdx].add(idx2);
              }
            }
          }
        }
      } else {
        // Handle direct stage objects
        const sessionIdx = stage.session_index;
        
        // Initialize session set if needed
        if (sessionIdx !== undefined && !sessionDemonstrators[sessionIdx]) {
          sessionDemonstrators[sessionIdx] = new Set();
        }
        
        // Track demonstrators from regular stages
        if (stage.demonstrator && stage.demonstrator.demonstrator_global_index !== undefined) {
          const demoIdx = stage.demonstrator.demonstrator_global_index;
          allDemonstrators.add(demoIdx);
          if (sessionIdx !== undefined) {
            sessionDemonstrators[sessionIdx].add(demoIdx);
          }
        }
        
        // Track demonstrators from choice stages
        if (stage.game === 'choice' && stage.demonstrator1 && stage.demonstrator2) {
          const idx1 = stage.demonstrator1.demonstrator_global_index;
          const idx2 = stage.demonstrator2.demonstrator_global_index;
          if (idx1 !== undefined) {
            allDemonstrators.add(idx1);
            if (sessionIdx !== undefined) {
              sessionDemonstrators[sessionIdx].add(idx1);
            }
          }
          if (idx2 !== undefined) {
            allDemonstrators.add(idx2);
            if (sessionIdx !== undefined) {
              sessionDemonstrators[sessionIdx].add(idx2);
            }
          }
        }
      }
    }
  }
  
  // Convert Sets to Arrays for easier processing
  const sessionDemonstratorsArray = {};
  for (const sessionIdx in sessionDemonstrators) {
    sessionDemonstratorsArray[sessionIdx] = Array.from(sessionDemonstrators[sessionIdx]);
  }
  
  return {
    allDemonstrators: Array.from(allDemonstrators),
    sessionDemonstrators: sessionDemonstratorsArray
  };
}

// Function to assign style+color combinations to demonstrators with constraints
function assignDemonstratorStyleColors(allDemonstrators, sessionDemonstrators) {
  const assignments = {};
  const usedCombos = new Set();
  
  // Helper function to create combo key
  const comboKey = (style, color) => `${style}:${color}`;
  
  // Helper function to check if a combo is available globally
  const isComboAvailable = (style, color) => !usedCombos.has(comboKey(style, color));
  
  // Helper function to check if style or color conflicts with other demonstrators in the same session
  const hasConflictInSession = (demoIdx, style, color, sessionIdx) => {
    const demosInSession = sessionDemonstrators[sessionIdx] || [];
    
    for (const otherDemoIdx of demosInSession) {
      // Skip self
      if (otherDemoIdx === demoIdx) continue;
      
      // Check if other demo is already assigned
      if (assignments[otherDemoIdx]) {
        const otherAssignment = assignments[otherDemoIdx];
        // Conflict if same style OR same color (within the same session)
        if (otherAssignment.style === style || otherAssignment.color === color) {
          return true;
        }
      }
    }
    return false;
  };
  
  // Build a map of demonstrator -> sessions it appears in
  const demoToSessions = {};
  for (const sessionIdx in sessionDemonstrators) {
    const demosInSession = sessionDemonstrators[sessionIdx];
    for (const demoIdx of demosInSession) {
      if (!demoToSessions[demoIdx]) {
        demoToSessions[demoIdx] = [];
      }
      demoToSessions[demoIdx].push(parseInt(sessionIdx));
    }
  }
  
  // Sort demonstrators: process those in multiple sessions first, then by session order
  const sortedDemonstrators = allDemonstrators.slice().sort((a, b) => {
    const aSessionCount = (demoToSessions[a] || []).length;
    const bSessionCount = (demoToSessions[b] || []).length;
    
    // Sort by number of sessions (descending)
    if (bSessionCount !== aSessionCount) {
      return bSessionCount - aSessionCount;
    }
    
    // Then by first session appearance (ascending)
    const aFirstSession = Math.min(...(demoToSessions[a] || [Infinity]));
    const bFirstSession = Math.min(...(demoToSessions[b] || [Infinity]));
    return aFirstSession - bFirstSession;
  });
  
  // Assign style+color to each demonstrator
  for (const demoIdx of sortedDemonstrators) {
    let assigned = false;
    const sessionsForDemo = demoToSessions[demoIdx] || [];
    
    // Try to find a valid style+color combination
    for (const style of AVAILABLE_STYLES) {
      for (const color of AVAILABLE_COLORS) {
        // Check if combo is globally available
        if (!isComboAvailable(style, color)) continue;
        
        // Check if this style+color conflicts with any demonstrator in any session this demo appears in
        let hasConflict = false;
        for (const sessionIdx of sessionsForDemo) {
          if (hasConflictInSession(demoIdx, style, color, sessionIdx)) {
            hasConflict = true;
            break;
          }
        }
        
        if (!hasConflict) {
          assignments[demoIdx] = { style, color };
          usedCombos.add(comboKey(style, color));
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }
    
    if (!assigned) {
      console.error(`Could not find valid style+color combination for demonstrator ${demoIdx} in sessions ${sessionsForDemo}`);
      console.error('Current assignments:', assignments);
      // Fallback: assign first available combo (shouldn't happen with 36 combos and typical timeline)
      for (const style of AVAILABLE_STYLES) {
        for (const color of AVAILABLE_COLORS) {
          if (isComboAvailable(style, color)) {
            assignments[demoIdx] = { style, color };
            usedCombos.add(comboKey(style, color));
            assigned = true;
            console.warn(`Using fallback assignment for demonstrator ${demoIdx}: ${style}/${color}`);
            break;
          }
        }
        if (assigned) break;
      }
    }
  }
  
  // Demonstrator assignments verification (logs removed to prevent revealing hidden information)
  // All constraint validation still occurs internally but results are not printed
  let allValid = true;
  for (const sessionIdx in sessionDemonstrators) {
    const demosInSession = sessionDemonstrators[sessionIdx];
    
    const usedStylesInSession = new Set();
    const usedColorsInSession = new Set();
    
    for (const demoIdx of demosInSession) {
      const combo = assignments[demoIdx];
      if (!combo) {
        console.error(`ERROR: Demo ${demoIdx} has no assignment!`);
        allValid = false;
        continue;
      }
      
      // Check for duplicate styles in session
      if (usedStylesInSession.has(combo.style)) {
        console.error(`CONSTRAINT VIOLATION: Duplicate style ${combo.style} in session ${sessionIdx}`);
        allValid = false;
      }
      usedStylesInSession.add(combo.style);
      
      // Check for duplicate colors in session
      if (usedColorsInSession.has(combo.color)) {
        console.error(`CONSTRAINT VIOLATION: Duplicate color ${combo.color} in session ${sessionIdx}`);
        allValid = false;
      }
      usedColorsInSession.add(combo.color);
    }
  }
  
  if (!allValid) {
    console.error('\n❌ SOME SESSION CONSTRAINTS VIOLATED\n');
  }
  
  return assignments;
}

// Function to initialize all image mappings
async function initializeImageMappings() {
  if (imageMappingsInitialized) return;
  
  try {
    // Analyze timeline for demonstrator constraints
    if (timelineData) {
      const { allDemonstrators, sessionDemonstrators } = analyzeTimelineDemonstrators(timelineData);
      demonstratorStyleColorMapping = assignDemonstratorStyleColors(allDemonstrators, sessionDemonstrators);
      
      // Store used combos globally
      for (const demoIdx in demonstratorStyleColorMapping) {
        const { style, color } = demonstratorStyleColorMapping[demoIdx];
        usedStyleColorCombos.add(`${style}:${color}`);
      }
    }
    
    // Note: We no longer need to discover demonstrator images from the old location
    // since we're using the style/color system
    
    // Discover and map landscape images
    const landscapeImages = await discoverAvailableImages('assets/landscapes', 'landscape_', '.png');
    if (landscapeImages.length > 0) {
      landscapeImageMapping = createRandomMapping(landscapeImages);
    } else {
      console.warn('No landscape images found, using minimal fallback');
      landscapeImageMapping = { 0: 'landscape_00.png' };
    }
    
    // Discover and map zone background images
    const zoneBackgroundImages = await discoverAvailableImages('assets/zone_backgrounds', 'zone_', '.png');
    if (zoneBackgroundImages.length > 0) {
      zoneBackgroundImageMapping = createRandomMapping(zoneBackgroundImages);
    } else {
      console.warn('No zone background images found, using minimal fallback');
      zoneBackgroundImageMapping = { 0: 'zone_00.png' };
    }
    
    // Discover and map asteroid images
    const asteroidImages = await discoverAvailableImages('assets/asteroids', 'asteroid_', '.png');
    if (asteroidImages.length > 0) {
      // Create mapping for discovered images
      const discoveredMapping = createRandomMapping(asteroidImages);
      
      // Ensure we have mappings for all possible indexes 0-79
      asteroidImageMapping = {};
      for (let i = 0; i < 80; i++) {
        if (discoveredMapping[i]) {
          // Use discovered mapping if available
          asteroidImageMapping[i] = discoveredMapping[i];
        } else {
          // Create fallback mapping for missing indexes
          asteroidImageMapping[i] = `asteroid_${i.toString().padStart(2, '0')}.png`;
        }
      }

    } else {
      console.warn('No asteroid images found, using complete fallback mapping');
      // Create a complete fallback mapping for 80 asteroids
      asteroidImageMapping = {};
      for (let i = 0; i < 80; i++) {
        asteroidImageMapping[i] = `asteroid_${i.toString().padStart(2, '0')}.png`;
      }
    }
    
    imageMappingsInitialized = true;
    
  } catch (error) {
    console.error('❌ Error initializing image mappings:', error);
    // Fallback to default mappings if discovery fails
    landscapeImageMapping = { 0: 'landscape_00.png' };
    zoneBackgroundImageMapping = { 0: 'zone_00.png' };
    // Create a fallback mapping for 80 asteroids
    const fallbackMapping = {};
    for (let i = 0; i < 80; i++) {
      fallbackMapping[i] = `asteroid_${i.toString().padStart(2, '0')}.png`;
    }
    asteroidImageMapping = fallbackMapping;
    imageMappingsInitialized = true;

  }
}

// Helper functions to get mapped image names
function getMappedDemonstratorImage(index, styleFromTimeline = null, colorFromTimeline = null) {
  // If style and color are provided from timeline, use them directly
  if (styleFromTimeline && colorFromTimeline) {
    // Cache it for consistency
    demonstratorStyleColorMapping[index] = { style: styleFromTimeline, color: colorFromTimeline };
    usedStyleColorCombos.add(`${styleFromTimeline}:${colorFromTimeline}`);
    return `styles/${styleFromTimeline}/${colorFromTimeline}.png`;
  }
  
  // Otherwise use the cached mapping
  const styleColorCombo = demonstratorStyleColorMapping[index];
  if (!styleColorCombo) {
    console.warn(`No style+color combo mapped for demonstrator ${index}, using fallback`);
    // Fallback: assign a random available combo
    for (const style of AVAILABLE_STYLES) {
      for (const color of AVAILABLE_COLORS) {
        const comboKey = `${style}:${color}`;
        if (!usedStyleColorCombos.has(comboKey)) {
          demonstratorStyleColorMapping[index] = { style, color };
          usedStyleColorCombos.add(comboKey);
          return `styles/${style}/${color}.png`;
        }
      }
    }
    // Ultimate fallback if all combos exhausted
    return 'styles/style1/blue.png';
  }
  return `styles/${styleColorCombo.style}/${styleColorCombo.color}.png`;
}

// Helper function to convert demonstrator image filename to mapped image
function getMappedDemonstratorFromFilename(filename) {
  // This function is now deprecated with the new style/color system
  // but we keep it for backward compatibility if needed
  const match = filename.match(/demonstrator_(\d+)\.png/);
  if (match) {
    const index = parseInt(match[1], 10);
    return getMappedDemonstratorImage(index);
  }
  console.warn(`Could not extract index from demonstrator filename: ${filename}`);
  return getMappedDemonstratorImage(0);
}

function getMappedLandscapeImage(index) {
  const imageName = landscapeImageMapping[index];
  if (!imageName) {
    console.warn(`No landscape image mapped for index ${index}, using default`);
    return landscapeImageMapping[0] || 'landscape_00.png';
  }
  return imageName;
}

// Helper function to convert landscape image filename to mapped image
function getMappedLandscapeFromFilename(filename) {
  // Extract index from filename like "landscape_01.png" -> 1
  const match = filename.match(/landscape_(\d+)\.png/);
  if (match) {
    const index = parseInt(match[1], 10);
    return getMappedLandscapeImage(index);
  }
  console.warn(`Could not extract index from landscape filename: ${filename}`);
  return getMappedLandscapeImage(0);
}

function getMappedZoneBackgroundImage(index) {
  const imageName = zoneBackgroundImageMapping[index];
  if (!imageName) {
    console.warn(`No zone background image mapped for index ${index}, using default`);
    return zoneBackgroundImageMapping[0] || 'zone_00.png';
  }
  return imageName;
}

// Helper function to convert zone background image filename to mapped image
function getMappedZoneBackgroundFromFilename(filename) {
  // Extract index from filename like "zone_01.png" -> 1
  const match = filename.match(/zone_(\d+)\.png/);
  if (match) {
    const index = parseInt(match[1], 10);
    return getMappedZoneBackgroundImage(index);
  }
  console.warn(`Could not extract index from zone background filename: ${filename}`);
  return getMappedZoneBackgroundImage(0);
}

// Generate unique zone color for each zone
function generateZoneColor(zoneGlobalIndex) {
  if (zoneColorMapping[zoneGlobalIndex]) {
    return zoneColorMapping[zoneGlobalIndex];
  }
  
  // Generate HSV colors with good separation
  const maxZones = 20; // Assume max 20 zones
  const hue = (zoneGlobalIndex * 137.5) % 360; // Use golden angle for good separation
  const saturation = 0.7;
  const value = 0.9;
  
  // Convert HSV to RGB
  const c = value * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = value - c;
  
  let r, g, b;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  
  const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  
  zoneColorMapping[zoneGlobalIndex] = color;
  usedColors.add(color);
  

  return color;
}

// Map zone global index to background image
function mapZoneBackground(zoneGlobalIndex) {
  if (zoneMappedBackgrounds[zoneGlobalIndex]) {
    return zoneMappedBackgrounds[zoneGlobalIndex];
  }
  
  // Use the existing zone background mapping system
  const mappedImage = getMappedZoneBackgroundImage(zoneGlobalIndex);
  zoneMappedBackgrounds[zoneGlobalIndex] = mappedImage;
  

  return mappedImage;
}

// Map demonstrator global index to image
function mapDemonstratorImage(demonstratorGlobalIndex, demonstratorStyle = null, demonstratorColor = null) {
  if (demonstratorMappedImages[demonstratorGlobalIndex]) {
    return demonstratorMappedImages[demonstratorGlobalIndex];
  }
  
  // Use the existing demonstrator mapping system, passing style/color from timeline if available
  const mappedImage = getMappedDemonstratorImage(demonstratorGlobalIndex, demonstratorStyle, demonstratorColor);
  demonstratorMappedImages[demonstratorGlobalIndex] = mappedImage;
  

  return mappedImage;
}

// Map zone bandit arm image indexes to actual filenames
function mapZoneBanditArmImages(zoneGlobalIndex, imageIndexes) {
  if (zoneBanditArmImageIds[zoneGlobalIndex]) {
    return zoneBanditArmImageIds[zoneGlobalIndex];
  }
  
  // Map each index to a randomly mapped asteroid image
  const mappedImages = imageIndexes.map(index => {
    // Use the random asteroid mapping initialized at game start
    const mappedImage = asteroidImageMapping[index];
    if (!mappedImage) {
      console.warn(`No asteroid image mapped for index ${index}, using fallback`);
      return `asteroid_${index.toString().padStart(2, '0')}.png`;
    }
    return mappedImage;
  });
  
  zoneBanditArmImageIds[zoneGlobalIndex] = mappedImages;
  

  return mappedImages;
}

// Phaser config
const config = {
  type: Phaser.AUTO,
  width: 1000,
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

  // Fetch experiment config first, then initialize image mappings and load timeline
  fetchExperimentConfig().then(() => {
    initializeImageMappings().then(() => {
      // Generate and load a fresh timeline from the server

      fetch('api/timeline')
    .then(r => {
      if (!r.ok) {
        throw new Error(`Timeline generation failed: ${r.status} ${r.statusText}`);
      }
      return r.json();
    })
    .then(jsonData => {

      timelineData = jsonData;
      loadStage.call(this);
    })
    .catch(err => {
      console.error("Error generating/loading timeline:", err);
      // Fallback to static file if dynamic generation fails
      
      fetch(experimentConfigPath)
    .then(r => r.json())
    .then(jsonData => {
      timelineData = jsonData;
      loadStage.call(this);
    })
        .catch(fallbackErr => console.error("Fallback timeline loading also failed:", fallbackErr));
    });
    });
  });
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
  
  // Check if we've moved to a new session and need to generate a new session_id
  if (currentSessionIndex !== lastTrackedSessionIndex) {
    const oldSessionID = sessionID;
    const oldSessionIndex = lastTrackedSessionIndex;
    sessionID = generateSessionID();
    lastTrackedSessionIndex = currentSessionIndex;
    // Session tracking (logs removed to prevent revealing hidden information)
    
    // Session verification logs (print once per session):
    // console.log("Current session:", timelineData[currentSessionIndex]);
  }
  
  const currentSession = timelineData[currentSessionIndex];
  
  // Stage verification logs (uncomment for debugging):
  // console.log("Current session index:", currentSessionIndex, "Stage index:", currentStageIndex);
  
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


  // Store the current stage for reference in other functions if needed
  window.currentStage = stage;

  // Initialize logging for gameplay stages
  const gameType = stage.stage_type || stage.game;
  if (['practice', 'play', 'watch', 'indicate', 'blind', 'choice', 'online-choice'].includes(gameType)) {
    // Initialize game sequence tracking if this is the first game in a session
    if (currentStageIndex === 0 || lastSessionIndex !== currentSessionIndex) {
      initializeGameSequence();
      // Reset total reward at start of new session
      userTotalReward = 0;
      lastSessionIndex = currentSessionIndex;
    }
    
    // Reset game tracking for new game
    const numArmPulls = stage.num_arm_pulls || 0;
    resetGameTracking(gameType, numArmPulls);
  }

  // Possibly add an icon for summary
  maybeAddSummaryIcon(stage);

  // If stage has a zone, apply its color to the game container border
  if (stage.zone) {
    // Generate zone color based on zone_global_index
    const zoneColor = generateZoneColor(stage.zone.zone_global_index);
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.border = `20px solid ${zoneColor}`;

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
    case 'instructions':
      setupInstructions.call(this, stage);
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
    case 'demonstrator_presentation':
      setupDemonstratorPresentation.call(this, stage);
      break;
    case 'watch':
      setupWatch.call(this, stage);
      break;
    case 'indicate':
      setupIndicate.call(this, stage);
      break;
    case 'feedback':
      setupFeedback.call(this, stage);
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

  // Duplicate prevention: check if we already have an icon for this exact stage
  const stageKey = `${currentSessionIndex}_${currentStageIndex}_${stageType}`;
  if (!window.addedSummaryIcons) {
    window.addedSummaryIcons = new Set();
  }
  
  if (window.addedSummaryIcons.has(stageKey)) {

    return; // Don't add duplicate icon
  }
  
  // Mark this stage as having an icon added
  window.addedSummaryIcons.add(stageKey);

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
    
  // For online-choice games, add an icon that will be updated when user makes choice
  if (stageType === 'online-choice') {
    // Add a placeholder icon that will be updated when user selects demonstrator
    summaryIcons.push({
      imageKey: null, // Will be updated when user selects
      zone: stage.zone && stage.zone.zone_global_index ? stage.zone.zone_global_index : 0,
      color: stage.zone && stage.zone.zone_global_index ? generateZoneColor(stage.zone.zone_global_index) : '#888888'
    });
    return;
  }
  
  // For all other game types, use the normal icon logic
  let imageKey = 'user';
  let iconName = null;
  
  if (stageType === 'watch' || stageType === 'indicate') {
    if (stage.demonstrator && stage.demonstrator.demonstrator_global_index !== undefined) {
      // Use the mapped demonstrator image based on global index
      const mappedImage = mapDemonstratorImage(stage.demonstrator.demonstrator_global_index, stage.demonstrator.demonstrator_style, stage.demonstrator.demonstrator_color);
      imageKey = mappedImage.replace('.png', '');
      // Add demonstrator name if available
      if (stage.demonstrator.demonstrator_name) {
        iconName = stage.demonstrator.demonstrator_name;
      }
    } else {
      imageKey = 'styles/style1/blue'; // fallback to default style+color
    }
  } else if (stageType === 'play' || stageType === 'practice' || stageType === 'blind') {
    // Add player name for play stages
    iconName = 'Prospector One';
  }

  // Add the icon with proper imageKey - generate zone color
  const zoneColorValue = generateZoneColor(stage.zone.zone_global_index);
  
  const iconData = {
    imageKey: imageKey,
    zone: stage.zone.zone_global_index,
    zone_color: zoneColorValue,
    color: zoneColorValue // Keep color for backward compatibility
  };
  
  // Add name if available
  if (iconName) {
    iconData.name = iconName;
  }
  
  summaryIcons.push(iconData);
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
    cellDiv.style.justifyContent = "flex-start"; // Align to top
    cellDiv.style.minHeight = "70px"; // Consistent cell height
    // No fixed width - let it size based on content
    cellDiv.style.padding = "8px"; // Padding for spacing

    // Give it a border of the zone color - use zone_color property directly when available
    const borderColor = iconData.zone_color || iconData.color || "#ffffff";
    cellDiv.style.border = `3px solid ${borderColor}`;

    // The image
    const img = document.createElement("img");
    if (iconData.imageKey.startsWith('demonstrator_') || iconData.imageKey.startsWith('styles/')) {
      // The imageKey is already a mapped demonstrator filename (without .png)
      // Don't map it again - just use it directly
      img.src = `assets/demonstrators/${iconData.imageKey}.png`;
    } else if (iconData.imageKey.startsWith('choice_demonstrator_')) {
      // For choice demonstrator keys, we need to be more cautious
      // The key format is something like 'choice_demonstrator_0'
      img.src = `assets/${iconData.imageKey}`; // Use the imageKey directly
    } else {
      img.src = `assets/${iconData.imageKey}.png`;
    }
    img.style.width = "40px";
    img.style.maxHeight = "40px"; // Limit height to keep cells consistent
    img.style.objectFit = "contain"; // Maintain aspect ratio
    img.style.display = "block";
    img.style.margin = "0 auto"; // Center horizontally

    // Add name label if available (between image and zone label)
    if (iconData.name) {
      const nameLabel = document.createElement("div");
      nameLabel.textContent = iconData.name;
      nameLabel.style.color = "#fff";
      nameLabel.style.fontSize = "10px"; // Smaller font as requested
      nameLabel.style.fontWeight = "bold";
      nameLabel.style.marginTop = "2px";
      nameLabel.style.textAlign = "center";
      cellDiv.appendChild(img);
      cellDiv.appendChild(nameLabel);
    } else {
      cellDiv.appendChild(img);
    }

    // The zone label - use custom label if provided
    const label = document.createElement("div");
        // Check if we have a custom label (for online-choice sub-stages)
    if (iconData.label) {
      label.textContent = iconData.label;
    } 
    // Handle special case for Choice zone - show choice letter if available
    else if (iconData.zone === 'Choice') {
      if (iconData.choiceLetter) {
        label.textContent = `Choice ${iconData.choiceLetter}`;
      } else {
        label.textContent = "Choice";
      }
    } 
    // Handle numeric zones (like online-choice) with choice letters
    else if (iconData.choiceLetter) {
      label.textContent = `Zone ${iconData.zone} (Choice ${iconData.choiceLetter})`;
    } else {
    label.textContent = "Zone " + iconData.zone;
    }
    label.style.color = "#fff";
    label.style.marginTop = "4px";
    label.style.textAlign = "center"; // Center text

    cellDiv.appendChild(label);
    bar.appendChild(cellDiv);
  }
}

/*******************************************************
 * Setup Functions for Each Stage Type
 *******************************************************/
function setupProlificIdForm(stage) {
  // Hide controls during prolific ID form
  updateControlsDisplay("hidden");

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
    
    // Clear console to remove any harmless 404 errors from initial asset loading
    console.clear();
    
    // Request fullscreen mode before proceeding to the game
    requestFullscreen();
    
    nextStage.call(this);
  };
}

function setupFeedback(stage) {
  // Hide controls during feedback form
  updateControlsDisplay("hidden");

  // Show the feedback overlay
  document.getElementById('feedback-form-overlay').style.visibility = 'visible';
  
  // Set the message
  const msgEl = document.getElementById('feedback-form-message');
  msgEl.innerText = stage.message || "Please fill the box below with your response to the following question:";
  
  // Determine which demonstrator was chosen based on the choice variables
  let chosenDemonstratorImage = null;
  
  if (choiceDemonstratorId) {
    // choiceDemonstratorId is in the format "styles/style1/blue.png"
    // Just prepend the assets/demonstrators/ path
    chosenDemonstratorImage = `assets/demonstrators/${choiceDemonstratorId}`;
  }
  
  // Use the stored demonstrator data directly (includes name!)
  // choiceDemonstratorData is now a global variable set during choice selection
  
  // Set the partner image
  const partnerImg = document.getElementById('feedback-partner-image');
  if (chosenDemonstratorImage) {
    partnerImg.src = chosenDemonstratorImage;
    partnerImg.style.display = 'block';
  } else {
    partnerImg.style.display = 'none';
    console.warn('Could not determine chosen demonstrator for feedback display');
  }
  
  // Set or create the partner name display
  let partnerNameDiv = document.getElementById('feedback-partner-name');
  if (!partnerNameDiv) {
    // Create the name element if it doesn't exist
    partnerNameDiv = document.createElement('div');
    partnerNameDiv.id = 'feedback-partner-name';
    partnerNameDiv.style.textAlign = 'center';
    partnerNameDiv.style.fontWeight = 'bold';
    partnerNameDiv.style.fontSize = '14px';
    partnerNameDiv.style.color = '#fff';
    partnerNameDiv.style.marginTop = '10px';
    
    // Insert it after the image in the partner display div
    const partnerDisplay = document.getElementById('feedback-partner-display');
    partnerDisplay.appendChild(partnerNameDiv);
  }
  
  // Update the name text using the global variable
  if (choiceDemonstratorData && choiceDemonstratorData.demonstrator_name) {
    partnerNameDiv.textContent = choiceDemonstratorData.demonstrator_name;
    partnerNameDiv.style.display = 'block';
  } else {
    partnerNameDiv.style.display = 'none';
  }
  
  // Clear previous text
  const textInput = document.getElementById('feedback-text-input');
  textInput.value = '';
  
  // Reset submit button state
  const submitBtn = document.getElementById('feedback-submit-btn');
  submitBtn.disabled = false;
  submitBtn.innerText = 'Submit';
  submitBtn.onclick = async () => {
    const feedbackText = textInput.value.trim();
    if (!feedbackText) {
      alert("Please enter your feedback before submitting.");
      return;
    }
    
    // Disable button to prevent double submission
    submitBtn.disabled = true;
    submitBtn.innerText = 'Submitting...';
    
    try {
      // Log feedback to main gamelogs collection only
      await logToMongoDB('feedback', {
        feedback_text: feedbackText
      });
      
      verboseLog('Feedback submitted successfully');
      
      // Hide the feedback overlay
      document.getElementById('feedback-form-overlay').style.visibility = 'hidden';
      
      // Check if this is the last session
      const isLastSession = currentSessionIndex >= timelineData.length - 1;
      
      if (isLastSession) {
        // Show end of game message with Prolific redirect
        showEndOfGameMessage.call(this);
      } else {
        // Continue to next stage/session
        nextStage.call(this);
      }
      
    } catch (error) {
      console.error('Error submitting feedback:', error);
      alert('Error submitting feedback. Please try again.');
      
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.innerText = 'Submit';
    }
  };
}

function setupIntroduction(stage) {
  const message = stage.message || "Introduction";
  
  // Hide controls during introduction
  updateControlsDisplay("hidden");
  
  // Parse the message into distinct sections
  const redBoldRegex = /\[RED_BOLD\](.*?)\[\/RED_BOLD\]/s;
  const boldRegex = /\[BOLD\](.*?)\[\/BOLD\]/s;
  
  const redBoldMatch = message.match(redBoldRegex);
  const boldMatch = message.match(boldRegex);
  
  if (redBoldMatch || boldMatch) {
    // Split message into sections more carefully
    let sections = [];
    
    // Parse the structured message
    let messageParts = message.split('[BOLD]');
    
    // Welcome section (before [BOLD])
    if (messageParts[0] && messageParts[0].trim()) {
      sections.push({
        text: messageParts[0].trim(),
        type: 'welcome',
        y: 40,  // Top of screen
        font: '22px Courier New',
        color: '#ffffff'
      });
    }
    
    // Bold section and main content (after [BOLD])
    if (messageParts[1]) {
      let afterBold = messageParts[1];
      
      // Extract bold text (between [BOLD] and [/BOLD])
      if (boldMatch) {
        const boldText = boldMatch[1].trim();
        sections.push({
          text: boldText,
          type: 'bold',
          y: 100,  // Below welcome with good spacing
          font: 'bold 40px Courier New',
          color: '#ffffff'
        });
        
        // Remove the bold tags and content to get main content
        afterBold = afterBold.replace(/.*?\[\/BOLD\]/, '').trim();
      }
      
      // Handle red bold section
      if (redBoldMatch) {
        const redBoldText = redBoldMatch[1].trim();
        sections.push({
          text: redBoldText,
          type: 'redBold',
          y: this.sys.game.config.height - 80,  // Moved up from bottom
          font: 'bold 18px Courier New',
          color: '#ff0000',
          background: true
        });
        
        // Remove red bold section from main content
        afterBold = afterBold.replace(redBoldRegex, '').trim();
      }
      
      // Main content (everything that's left)
      if (afterBold) {
        sections.push({
          text: afterBold,
          type: 'main',
          y: 320,  // Moved down further from bold section
          font: '20px Courier New',
          color: '#ffffff'
        });
      }
    }
    
    // Display all sections
    sections.forEach(section => {
      const textStyle = {
        font: section.font,
        fill: section.color,
        align: 'center', 
        wordWrap: { width: section.type === 'main' ? 750 : 700 },
        lineSpacing: 1  // Just a tiny bit of extra line spacing
      };
      
      if (section.background) {
        textStyle.backgroundColor = '#000000';
        textStyle.padding = { x: 10, y: 5 };
      }
      
      // Special handling for main content - just slightly more line spacing
      if (section.type === 'main') {
        textStyle.lineSpacing = 2; // Very small increase for main content
      }
      
    this.add.text(
      this.sys.game.config.width/2,
        section.y,
        section.text,
        textStyle
    ).setOrigin(0.5);
    });
    
  } else {
    // Original behavior for messages without special formatting
  this.add.text(
    this.sys.game.config.width/2,
    this.sys.game.config.height/2,
      message,
      { font: '20px Courier New', fill: '#ffffff', align: 'center', wordWrap: { width: 600 } }
  ).setOrigin(0.5);
  }

  makeNextButton.call(this, "Next", () => {
    nextStage.call(this);
  });
}

function setupInstructions(stage) {
  if (!stage.instructions) {
    console.error("Missing instructions data");
    return;
  }

  const instructions = stage.instructions;
  
  // Update controls display for single-row mode since all games appear to be asteroid mode
  updateControlsDisplay("single-row");
  
  // Display title
  this.add.text(
    this.sys.game.config.width / 2,
    50,
    stage.message || "Game Instructions",
    { font: 'bold 28px Courier New', fill: '#ffffff', align: 'center' }
  ).setOrigin(0.5);

  // Store reference for loading images
  const currentScene = this;
  
  // Separate GIF and PNG images
  const gifImages = [];
  const pngImages = [];
  
  for (let i = 1; i <= 5; i++) {
    const imageName = instructions[`instruction${i}_image`];
    if (imageName && imageName.endsWith('.gif')) {
      gifImages.push({ index: i, imageName });
    } else if (imageName && imageName.endsWith('.png')) {
      pngImages.push({ index: i, imageName });
      // Load PNG images through Phaser
      if (!this.textures.exists(`instruction_${i}`)) {
        this.load.image(`instruction_${i}`, `assets/introduction/${imageName}`);
      }
    }
  }

  // Load PNG images if any
  if (pngImages.length > 0) {
    this.load.once('complete', () => {
      displayInstructionLayout.call(currentScene, instructions, gifImages);
    });
    this.load.start();
  } else {
    // If no PNG images to load, display immediately
    displayInstructionLayout.call(currentScene, instructions, gifImages);
  }
}

function displayInstructionLayout(instructions, gifImages) {
  const gameWidth = this.sys.game.config.width;
  const gameHeight = this.sys.game.config.height;
  
  // Get the game canvas position for proper HTML element positioning
  const canvas = this.sys.game.canvas;
  const rect = canvas.getBoundingClientRect();
  
  // Layout configuration
  const maxImageSize = 193;
  const columnSpacing = 20; // Spacing between columns
  const imageTextGap = 10; // Small gap between image and its text
  const textHeight = 30; // Estimated text height
  const sectionGap = 30; // Gap between sections
  
  // Simple positioning - images at fixed Y positions, text positioned relative to images
  const row1ImagesY = 115;     // First row images top edge (moved up from 130)
  const row3ImagesY = 310;     // Second row images top edge (moved up from 325)
  
  // First section: 3 instructions in 3 columns (move left, move right, mine)
  const topSectionWidth = 3 * maxImageSize + 2 * columnSpacing;
  const topStartX = (gameWidth - topSectionWidth) / 2;
  
  for (let i = 1; i <= 3; i++) {
    const x = topStartX + (i - 1) * (maxImageSize + columnSpacing) + maxImageSize / 2;
    const imageKey = `instruction_${i}`;
    const imageName = instructions[`instruction${i}_image`];
    const instructionText = instructions[`instruction${i}`];
    
    // Add image (Row 1)
    if (imageName && imageName.endsWith('.gif')) {
      // Create HTML img element for GIF
      const imgElement = document.createElement('img');
      imgElement.src = `assets/introduction/${imageName}`;
      imgElement.style.position = 'absolute';
      imgElement.style.maxWidth = `${maxImageSize}px`;
      imgElement.style.maxHeight = `${maxImageSize}px`;
      
      // Try centering the GIF like we do with PNGs
      const gifCenterY = row1ImagesY + maxImageSize/2;
      
      imgElement.style.left = `${rect.left + x - maxImageSize/2}px`;
      imgElement.style.top = `${rect.top + gifCenterY - maxImageSize/2}px`; // Center the GIF properly
      imgElement.style.zIndex = '1000';
      imgElement.style.pointerEvents = 'none';
      imgElement.className = 'instruction-gif';
      
      // Debug logging

      
      document.body.appendChild(imgElement);
    } else if (this.textures.exists(imageKey)) {
      // Add Phaser image for PNG
      const pngCenterY = row1ImagesY + maxImageSize/2;
      const image = this.add.image(x, pngCenterY, imageKey); // Position PNG center
      const scale = Math.min(
        maxImageSize / image.width,
        maxImageSize / image.height
      );
      image.setScale(scale);
      image.setOrigin(0.5);
      
      // Debug logging
      
    }
    
    // Add text (Row 2) - position text right at image bottom edge  
    const textY = row1ImagesY + maxImageSize - 20; // Position text to overlap more with images
    
    
    
    this.add.text(
      x,
      textY, // Position text much closer to images
      instructionText,
      { 
        font: '16px Courier New', 
        fill: '#ffffff', 
        align: 'center',
        wordWrap: { width: maxImageSize + 20 },
        lineSpacing: 4
      }
    ).setOrigin(0.5);
  }
  
  // Second section: 2 instructions in 2 columns (successful mine, unsuccessful mine)
  const bottomSectionWidth = 2 * maxImageSize + columnSpacing;
  const bottomStartX = (gameWidth - bottomSectionWidth) / 2;
  
  for (let i = 4; i <= 5; i++) {
    const x = bottomStartX + (i - 4) * (maxImageSize + columnSpacing) + maxImageSize / 2;
    const imageKey = `instruction_${i}`;
    const imageName = instructions[`instruction${i}_image`];
    const instructionText = instructions[`instruction${i}`];
    
    // Add image (Row 3)
    if (imageName && imageName.endsWith('.gif')) {
      // Create HTML img element for GIF
      const imgElement = document.createElement('img');
      imgElement.src = `assets/introduction/${imageName}`;
      imgElement.style.position = 'absolute';
      imgElement.style.maxWidth = `${maxImageSize}px`;
      imgElement.style.maxHeight = `${maxImageSize}px`;
      imgElement.style.left = `${rect.left + x - maxImageSize/2}px`;
      imgElement.style.top = `${rect.top + row3ImagesY}px`; // Position GIF top edge
      imgElement.style.zIndex = '1000';
      imgElement.style.pointerEvents = 'none';
      imgElement.className = 'instruction-gif';
      
      document.body.appendChild(imgElement);
    } else if (this.textures.exists(imageKey)) {
      // Add Phaser image for PNG
      const image = this.add.image(x, row3ImagesY + maxImageSize/2, imageKey); // Position PNG center
      const scale = Math.min(
        maxImageSize / image.width,
        maxImageSize / image.height
      );
      image.setScale(scale);
      image.setOrigin(0.5);
    }
    
    // Add text (Row 4) - position text close to images  
    const textY2 = row3ImagesY + maxImageSize + 25; // Position text 25px below image bottom edge (increased from 15px)
    
    
    this.add.text(
      x,
      textY2, // Position text below images with small gap
      instructionText,
      { 
        font: '16px Courier New', 
        fill: '#ffffff', 
        align: 'center',
        wordWrap: { width: maxImageSize + 40 },
        lineSpacing: 4
      }
    ).setOrigin(0.5);
  }
  
  // Final instruction text (Row 5) - position it below the second section
  if (instructions.instruction6) {
    const finalTextY = row3ImagesY + maxImageSize + 15 + 30 + 60; // Position below second section text with even more spacing (increased from +45 to +60)
  
    
    this.add.text(
      gameWidth / 2,
      finalTextY, // Position below second section text with spacing
      instructions.instruction6,
      { 
        font: '18px Courier New', 
        fill: '#ffffff', 
        align: 'center',
        wordWrap: { width: 800 },
        lineSpacing: 4
      }
    ).setOrigin(0.5);
  }
  
  // Add next button
  makeNextButton.call(this, "Next", () => {
    // Clean up HTML elements before proceeding
    const gifElements = document.querySelectorAll('.instruction-gif');
    gifElements.forEach(element => element.remove());
    
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
  
  // Log bandit payoffs for play/practice games
  const flattenedPayoffs = bandit.flat();
  verboseLog('Bandit payoffs:', flattenedPayoffs);
  verboseLog('Demonstrator type: no demonstrator, this is a play game');
  
  const num_arm_pulls = stage.num_arm_pulls;
  
  let numRows = bandit.length;
  let numCols = bandit[0].length;
  
  // Debug log to check dimensions

  
  // Update controls display based on number of rows
  if (numRows === 1) {
    // Single row game (asteroid mode) - hide up/down controls
    updateControlsDisplay("single-row");
  } else {
    // Multi-row game - show all controls
    updateControlsDisplay("default");
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
  addZoneLabels(this, stage.zone.zone_global_index);

  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Reward tank
  let pullOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100); // Add high depth value to ensure visibility
  drawRewardTank.call(this, rewardTankContainer, num_arm_pulls, pullOutcomes);

  // user sprite - start at random position instead of always (0, 0)
  let cursorR = Phaser.Math.Between(0, numRows - 1);
  let cursorC = Phaser.Math.Between(0, numCols - 1);
  let { x: initX, y: initY } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
  let userSprite = this.add.image(initX, initY, 'user')
    .setOrigin(0.5)
    .setDepth(9999);
  setSpriteDisplaySizeWithAspectRatio(userSprite, DEMO_SPRITE_SIZE);

  // Add "Prospector One" name label below player sprite
  let userNameText = this.add.text(
    initX,
    initY + DEMO_SPRITE_SIZE / 2 + 15,
    'Prospector One',
    { 
      font: 'bold 14px Arial', 
      fill: '#ffffff',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 3
    }
  ).setOrigin(0.5).setDepth(10000);

  // Initialize position tracking for logging
  currentPosition = cursorR * numCols + cursorC;

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
          const oldPosition = currentPosition;
          cursorR = clickedR;
          cursorC = clickedC;
          const newPosition = cursorR * numCols + cursorC;
          
          // Log movement action BEFORE updating position and incrementing step
          currentShotsRemaining = pullsRemaining;
          const action = newPosition > oldPosition ? 'right' : 'left';
          logToMongoDB(action, {
            reward_generated: false,
            shot: false
          });
          
          // Update position and step AFTER logging
          currentPosition = newPosition;
          currentGameStep++;
          
          let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
          userSprite.setPosition(x, y);
          userNameText.setPosition(x, y + DEMO_SPRITE_SIZE / 2 + 15);
          highlightCurrentCell(highlightRect, cursorR, cursorC, gridOriginX, gridOriginY, cellWidth, cellHeight);
        }
      });
      
      cellRects.push(cellRect);
    }
  }
  
  // Function to handle pulling the arm
  function pullArm(row, col) {
    const scene = this; // Capture the scene context
    
    // Prevent multiple rapid shots (debounce protection)
    if (scene.lastShotTime && Date.now() - scene.lastShotTime < 200) {

      return;
    }
    scene.lastShotTime = Date.now();
    
      pullsRemaining--;
    
    // Don't try to update remainingText - it doesn't exist in this context!
    
    let payoff = bandit[row][col];
      let outcome = (Math.random() < payoff) ? 1 : 0;
      
      // Log the shoot action BEFORE incrementing step
      currentShotsRemaining = pullsRemaining;
      logToMongoDB('shoot', {
        reward_generated: outcome === 1,
        shot: true
      });
      
      // Update tracking variables AFTER logging
      currentGameStep++;
      if (outcome === 1) {
        currentGameReward++;
        // Only increment total reward for play games, not practice
        if (currentGameType === 'play') {
          userTotalReward++;
        }
      }
      
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
        }, "overlay");
      }
        }
      });
  }

  // Clean up any existing keyboard listeners to prevent multiple handlers
  this.input.keyboard.removeAllListeners('keydown');
  
  // Add keyboard event handler
  this.input.keyboard.on('keydown', (evt) => {
    if (pullsRemaining <= 0) return;

    let oldR = cursorR, oldC = cursorC;
    let moveAction = null;
    
    if (evt.code === 'ArrowUp')    {
      cursorR = Phaser.Math.Clamp(cursorR - 1, 0, numRows-1);
      moveAction = 'up';
    }
    if (evt.code === 'ArrowDown')  {
      cursorR = Phaser.Math.Clamp(cursorR + 1, 0, numRows-1);
      moveAction = 'down';
    }
    if (evt.code === 'ArrowLeft')  {
      cursorC = Phaser.Math.Clamp(cursorC - 1, 0, numCols-1);
      moveAction = 'left';
    }
    if (evt.code === 'ArrowRight') {
      cursorC = Phaser.Math.Clamp(cursorC + 1, 0, numCols-1);
      moveAction = 'right';
    }

    if (evt.code === 'Space') {
      pullArm.call(this, cursorR, cursorC);
    }

    if (oldR !== cursorR || oldC !== cursorC) {
      // Log movement action BEFORE updating position and incrementing step
      currentShotsRemaining = pullsRemaining;
      logToMongoDB(moveAction, {
        reward_generated: false,
        shot: false
      });
      
      // Update position and step AFTER logging
      currentPosition = cursorR * numCols + cursorC;
      currentGameStep++;
      
      let { x, y } = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cursorR, cursorC);
      userSprite.setPosition(x, y);
      userNameText.setPosition(x, y + DEMO_SPRITE_SIZE / 2 + 15);
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
  
  // Use watch-overlay-message if available, otherwise use default
  const overlayMessage = stage["watch-overlay-message"] || 
    "You will now watch your chosen starship partner.";
  
  // Get demonstrator data
  const demoData = stage.demonstrator;
  
  // Check if we're in inline mode
  const isInlineMode = demonstratorConfig && demonstratorConfig.source === 'inline';
  
  let trajectory;
  let thompsonSampler = null;
  let trajectoryData = null;  // Will store {trajectory: [], rewards: []}
  
  if (isInlineMode) {
    // Inline mode: generate trajectory using Thompson sampling
    const bandit = stage.zone.zone_bandit;
    const numRows = bandit.length;
    const numCols = bandit[0].length;
    const flattenedPayoffs = bandit.flat();
    const numArmPulls = stage.num_arm_pulls || 6;
    
    // Get experience level based on demonstrator type
    const demonstratorType = demoData.demonstrator_type;
    const experienceLevel = demonstratorType === 'expert' 
      ? demonstratorConfig.expert_demonstrator_experience 
      : demonstratorConfig.novice_demonstrator_experience;
    
    // Log bandit payoffs and demonstrator information
    verboseLog('Bandit payoffs:', flattenedPayoffs);
    verboseLog('Demonstrator type:', demonstratorType);
    verboseLog(`Generating ${demonstratorType} trajectory with ${experienceLevel} warmup iterations`);
    
    // Initialize Thompson sampler
    thompsonSampler = new ThompsonSampler(flattenedPayoffs.length, flattenedPayoffs);
    
    // Run warmup iterations (not shown to user)
    for (let i = 0; i < experienceLevel; i++) {
      thompsonSampler.step();
    }
    
    // Generate trajectory for display
    trajectory = [];
    const rewards = [];
    for (let i = 0; i < numArmPulls; i++) {
      const stepResult = thompsonSampler.step();
      trajectory.push(stepResult.arm);
      rewards.push(stepResult.reward);
    }
    
    trajectoryData = { trajectory, rewards };
    verboseLog('Generated trajectory:', trajectory);
    verboseLog('Generated rewards:', rewards);
  } else {
    // File mode: use pre-computed trajectory
    trajectory = demoData.demonstrator_trajectory;
    trajectoryData = null;
  }
  
  // Reset game tracking for watch phase
  resetGameTracking('watch', trajectory.length);
  
  const bandit = stage.zone.zone_bandit;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  
  // Hide controls during watch games - user is not actively playing
  updateControlsDisplay("hidden");
  
  // Show zone information
  const zoneText = this.add.text(
    this.sys.game.config.width / 2,
    30,
    `Zone ${stage.zone.zone_global_index}`,
    { font: 'bold 40px Courier New', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Show which demonstrator is being watched
  const demoText = this.add.text(
    this.sys.game.config.width / 2,
    70,
    "Watching Partner",
    { font: 'bold 22px Courier New', fill: '#ffffff' }
  ).setOrigin(0.5);
  
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
  addZoneLabels(this, stage.zone.zone_global_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Keep reward tank for watch stages to show mining outcomes
  let watchOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Initialize position tracking for logging
  currentPosition = currentLinearIndex;
  
  // Load demonstrator image
  const demoImageKey = `watch_${stage.demonstrator.demonstrator_global_index}`;
  const mappedDemonstratorImage = mapDemonstratorImage(stage.demonstrator.demonstrator_global_index, stage.demonstrator.demonstrator_style, stage.demonstrator.demonstrator_color);
  
  if (!this.textures.exists(demoImageKey)) {
    this.load.image(demoImageKey, `assets/demonstrators/${mappedDemonstratorImage}`);
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
    .setOrigin(0.5)
    .setDepth(9999);
    setSpriteDisplaySizeWithAspectRatio(dSprite, DEMO_SPRITE_SIZE);

    // Add name label below demonstrator if name is available
    let dNameText = null;
    if (stage.demonstrator && stage.demonstrator.demonstrator_name) {
      dNameText = this.add.text(
        startPos.x,
        startPos.y + DEMO_SPRITE_SIZE / 2 + 15,
        stage.demonstrator.demonstrator_name,
        { 
          font: 'bold 14px Arial', 
          fill: '#ffffff',
          align: 'center',
          stroke: '#000000',
          strokeThickness: 3
        }
      ).setOrigin(0.5).setDepth(10000);
    }

  let currentStep = 0;
  let totalSteps = trajectory.length;

    // Add a delay before starting the trajectory
    this.time.delayedCall(WATCH_START_DELAY, () => {
  moveAlongTrajectoryStep.call(this);
    });

  function moveAlongTrajectoryStep() {
    if (currentStep >= totalSteps) {
        // When demonstration is complete, show next button
        makeNextButton.call(this, "Next", () => {
          // Reset online choice state and move to next stage
          window.onlineChoicePhase = null;
          window.onlineChoiceSelectedDemo = null;
          nextStage.call(this);
        }, "overlay");
      return;
    }

      let targetLinearIndex = trajectory[currentStep];
      let targetR = Math.floor(targetLinearIndex / numCols);
      let targetC = targetLinearIndex % numCols;
      
      let pathCells = getManhattanPath(currentR, currentC, targetR, targetC);

    let index = 0;
    let pathTimer = this.time.addEvent({
        delay: 600,
      repeat: pathCells.length - 1,
      callback: () => {
        let cell = pathCells[index];
          let pos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cell.r, cell.c);
        dSprite.setPosition(pos.x, pos.y);
          // Update name text position if it exists
          if (dNameText) {
            dNameText.setPosition(pos.x, pos.y + DEMO_SPRITE_SIZE / 2 + 15);
          }
          highlightCurrentCell(highlightRect, cell.r, cell.c, gridOriginX, gridOriginY, cellWidth, cellHeight);

          // Log movement actions during watch (except for the first position)
          if (index > 0) {
            const prevCell = pathCells[index - 1];
            const currentCellPosition = cell.r * numCols + cell.c;
            const prevCellPosition = prevCell.r * numCols + prevCell.c;
            
            let moveAction;
            if (currentCellPosition > prevCellPosition) {
              moveAction = cell.r > prevCell.r ? 'down' : 'right';
  } else {
              moveAction = cell.r < prevCell.r ? 'up' : 'left';
            }
            
            // Log the movement action from the PREVIOUS position (where action was taken from)
            currentShotsRemaining = totalSteps - currentStep;
            logToMongoDB(moveAction, {
              reward_generated: false,
              shot: false
            });
            
            // Update position and step AFTER logging
            currentPosition = currentCellPosition;
            currentGameStep++;
          }

                  index++;
          if (index >= pathCells.length) {
            pathTimer.remove();
            currentR = targetR;
            currentC = targetC;
            
            // Define the shooting action function
            const performShootingAction = () => {
              // Calculate outcome
              let payoff = bandit[currentR][currentC];
              let outcome;
              
              if (isInlineMode && trajectoryData) {
                // Use the pre-generated reward from Thompson sampler
                outcome = trajectoryData.rewards[currentStep];
              } else {
                // Random sampling (file mode)
                outcome = (Math.random() < payoff) ? 1 : 0;
              }
              
              // Log the shoot action from current position (where shot was taken from)
              currentShotsRemaining = totalSteps - currentStep - 1;
              logToMongoDB('shoot', {
                reward_generated: outcome === 1,
                shot: true
              });
              
              // Update tracking AFTER logging
              currentPosition = currentR * numCols + currentC;
              currentGameStep++;
              
              if (outcome === 1) {
                currentGameReward++;
                // Only increment total reward for play games, not practice or watch
                if (currentGameType === 'play') {
                  userTotalReward++;
                }
              }
              
              // Create a simple flash effect
              let g = this.add.graphics();
              g.fillStyle(HIGHLIGHT_COLOR, 1);
              g.fillRect(
                gridOriginX + currentC*(cellWidth + CELL_PADDING),
                gridOriginY + currentR*(cellHeight + CELL_PADDING),
                cellWidth, cellHeight
              );
              
              // Fade out only
              this.tweens.add({
                targets: g,
                alpha: 0,
                duration: 200,
                onComplete: () => {
                  g.destroy();
                  
                  // Record outcome and update tank
                  watchOutcomes.push(outcome);
                  drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                  drawRewardTank.call(this, rewardTankContainer, totalSteps, watchOutcomes);

                  currentStep++;
                  
                  // After the last step, log complete trajectory data if in inline mode
                  if (currentStep >= totalSteps && isInlineMode && thompsonSampler) {
                    // Log all actions and rewards to MongoDB
                    logToMongoDB('trajectory_complete', {
                      demonstrator_all_actions: JSON.stringify(thompsonSampler.allActions),
                      demonstrator_all_rewards: JSON.stringify(thompsonSampler.allRewards)
                    });
                  }
                  
                  moveAlongTrajectoryStep.call(this);
                }
              });
            };
            
            // Add a brief pause before shooting if there was movement
            if (pathCells.length > 1) {
              // There was movement, add a pause before shooting
              this.time.delayedCall(400, performShootingAction);
            } else {
              // No movement, shoot immediately
              performShootingAction();
            }
          }
        }
      });
    }
    }
}

/**
 * INDICATE Stage - similar to watch but for indication games
 */
function setupIndicate(stage) {
  if (!stage.zone) {
    console.error("Missing zone data");
    return;
  }
  
  // Use indicate-overlay-message if available, otherwise use default
  const overlayMessage = stage["indicate-overlay-message"] || 
    "You will now watch the demonstrator indicate their strategy.";
  
  // Get demonstrator data
  const demoData = stage.demonstrator;
  
  // Check if we're in inline mode
  const isInlineMode = demonstratorConfig && demonstratorConfig.source === 'inline';
  
  let trajectory;
  let thompsonSampler = null;
  let trajectoryData = null;  // Will store {trajectory: [], rewards: []}
  
  if (isInlineMode) {
    // Inline mode: generate trajectory using Thompson sampling
    const bandit = stage.zone.zone_bandit;
    const numRows = bandit.length;
    const numCols = bandit[0].length;
    const flattenedPayoffs = bandit.flat();
    const numArmPulls = stage.num_arm_pulls || 6;
    
    // Get experience level based on demonstrator type
    const demonstratorType = demoData.demonstrator_type;
    const experienceLevel = demonstratorType === 'expert' 
      ? demonstratorConfig.expert_demonstrator_experience 
      : demonstratorConfig.novice_demonstrator_experience;
    
    // Log bandit payoffs and demonstrator information
    verboseLog('Bandit payoffs:', flattenedPayoffs);
    verboseLog('Demonstrator type:', demonstratorType);
    verboseLog(`Generating ${demonstratorType} trajectory with ${experienceLevel} warmup iterations`);
    
    // Initialize Thompson sampler
    thompsonSampler = new ThompsonSampler(flattenedPayoffs.length, flattenedPayoffs);
    
    // Run warmup iterations (not shown to user)
    for (let i = 0; i < experienceLevel; i++) {
      thompsonSampler.step();
    }
    
    // Generate trajectory for display
    trajectory = [];
    const rewards = [];
    for (let i = 0; i < numArmPulls; i++) {
      const stepResult = thompsonSampler.step();
      trajectory.push(stepResult.arm);
      rewards.push(stepResult.reward);
    }
    
    trajectoryData = { trajectory, rewards };
    verboseLog('Generated trajectory:', trajectory);
    verboseLog('Generated rewards:', rewards);
  } else {
    // File mode: use pre-computed trajectory
    trajectory = demoData.demonstrator_trajectory;
    trajectoryData = null;
  }
  
  // Reset game tracking for indicate phase
  resetGameTracking('indicate', trajectory.length);
  
  const bandit = stage.zone.zone_bandit;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  
  // Hide controls during indicate games - user is not actively playing
  updateControlsDisplay("hidden");
  
  // Show zone information
  const zoneText = this.add.text(
    this.sys.game.config.width / 2,
    30,
    `Zone ${stage.zone.zone_global_index}`,
    { font: 'bold 40px Courier New', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Show which demonstrator is being watched
  const demoText = this.add.text(
    this.sys.game.config.width / 2,
    70,
    "Watching Partner",
    { font: 'bold 22px Courier New', fill: '#ffffff' }
  ).setOrigin(0.5);
  
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
  addZoneLabels(this, stage.zone.zone_global_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Keep reward tank for indicate stages to show mining outcomes
  let indicateOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, indicateOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Initialize position tracking for logging
  currentPosition = currentLinearIndex;
  
  // Load demonstrator image
  const demoImageKey = `indicate_${stage.demonstrator.demonstrator_global_index}`;
  const mappedDemonstratorImage = mapDemonstratorImage(stage.demonstrator.demonstrator_global_index, stage.demonstrator.demonstrator_style, stage.demonstrator.demonstrator_color);
  
  if (!this.textures.exists(demoImageKey)) {
    this.load.image(demoImageKey, `assets/demonstrators/${mappedDemonstratorImage}`);
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
    .setOrigin(0.5)
    .setDepth(9999);
    setSpriteDisplaySizeWithAspectRatio(dSprite, DEMO_SPRITE_SIZE);

    // Add name label below demonstrator if name is available
    let dNameText = null;
    if (stage.demonstrator && stage.demonstrator.demonstrator_name) {
      dNameText = this.add.text(
        startPos.x,
        startPos.y + DEMO_SPRITE_SIZE / 2 + 15,
        stage.demonstrator.demonstrator_name,
        { 
          font: 'bold 14px Arial', 
          fill: '#ffffff',
          align: 'center',
          stroke: '#000000',
          strokeThickness: 3
        }
      ).setOrigin(0.5).setDepth(10000);
    }

    let currentStep = 0;
    let totalSteps = trajectory.length;

    // Add a delay before starting the trajectory
    this.time.delayedCall(WATCH_START_DELAY, () => {
      moveAlongTrajectoryStep.call(this);
    });

    function moveAlongTrajectoryStep() {
      if (currentStep >= totalSteps) {
        // When demonstration is complete, show next button
        makeNextButton.call(this, "Next", () => {
          nextStage.call(this);
        }, "overlay");
        return;
      }

      let targetLinearIndex = trajectory[currentStep];
      let targetR = Math.floor(targetLinearIndex / numCols);
      let targetC = targetLinearIndex % numCols;
      
      let pathCells = getManhattanPath(currentR, currentC, targetR, targetC);

      let index = 0;
      let pathTimer = this.time.addEvent({
        delay: 600,
        repeat: pathCells.length - 1,
        callback: () => {
          let cell = pathCells[index];
          let pos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cell.r, cell.c);
          dSprite.setPosition(pos.x, pos.y);
          // Update name text position if it exists
          if (dNameText) {
            dNameText.setPosition(pos.x, pos.y + DEMO_SPRITE_SIZE / 2 + 15);
          }
          highlightCurrentCell(highlightRect, cell.r, cell.c, gridOriginX, gridOriginY, cellWidth, cellHeight);

          // Log movement actions during indicate (except for the first position)
          if (index > 0) {
            const prevCell = pathCells[index - 1];
            const currentCellPosition = cell.r * numCols + cell.c;
            const prevCellPosition = prevCell.r * numCols + prevCell.c;
            
            let moveAction;
            if (currentCellPosition > prevCellPosition) {
              moveAction = cell.r > prevCell.r ? 'down' : 'right';
            } else {
              moveAction = cell.r < prevCell.r ? 'up' : 'left';
            }
            
            // Log the movement action from the PREVIOUS position (where action was taken from)
            currentShotsRemaining = totalSteps - currentStep;
            logToMongoDB(moveAction, {
              reward_generated: false,
              shot: false
            });
            
            // Update position and step AFTER logging
            currentPosition = currentCellPosition;
            currentGameStep++;
          }

          index++;
          if (index >= pathCells.length) {
            pathTimer.remove();
            currentR = targetR;
            currentC = targetC;
            
            // Define the shooting action function
            const performShootingAction = () => {
              // Calculate outcome
              let payoff = bandit[currentR][currentC];
              let outcome;
              
              if (isInlineMode && trajectoryData) {
                // Use the pre-generated reward from Thompson sampler
                outcome = trajectoryData.rewards[currentStep];
              } else {
                // Random sampling (file mode)
                outcome = (Math.random() < payoff) ? 1 : 0;
              }
              
              // Log the shoot action from current position (where shot was taken from)
              currentShotsRemaining = totalSteps - currentStep - 1;
              logToMongoDB('shoot', {
                reward_generated: outcome === 1,
                shot: true
              });
              
              // Update tracking AFTER logging
              currentPosition = currentR * numCols + currentC;
              currentGameStep++;
              
              if (outcome === 1) {
                currentGameReward++;
                // Only increment total reward for play games, not practice or watch
                if (currentGameType === 'play') {
                  userTotalReward++;
                }
              }
              
              // Create a simple flash effect
              let g = this.add.graphics();
              g.fillStyle(HIGHLIGHT_COLOR, 1);
              g.fillRect(
                gridOriginX + currentC*(cellWidth + CELL_PADDING),
                gridOriginY + currentR*(cellHeight + CELL_PADDING),
                cellWidth, cellHeight
              );
              
              // Fade out only
              this.tweens.add({
                targets: g,
                alpha: 0,
                duration: 200,
                onComplete: () => {
                  g.destroy();
                  
                  // Record outcome and update tank
                  indicateOutcomes.push(outcome);
                  drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                  drawRewardTank.call(this, rewardTankContainer, totalSteps, indicateOutcomes);

                  currentStep++;
                  
                  // After the last step, log complete trajectory data if in inline mode
                  if (currentStep >= totalSteps && isInlineMode && thompsonSampler) {
                    // Log all actions and rewards to MongoDB
                    logToMongoDB('trajectory_complete', {
                      demonstrator_all_actions: JSON.stringify(thompsonSampler.allActions),
                      demonstrator_all_rewards: JSON.stringify(thompsonSampler.allRewards)
                    });
                  }
                  
                  moveAlongTrajectoryStep.call(this);
                }
              });
            };
            
            // Add a brief pause before shooting if there was movement
            if (pathCells.length > 1) {
              // There was movement, add a pause before shooting
              this.time.delayedCall(400, performShootingAction);
            } else {
              // No movement, shoot immediately
              performShootingAction();
            }
          }
        }
      });
    }
  }
}

/**
 * DEMONSTRATOR PRESENTATION stage - show both demonstrators at session start
 */
function setupDemonstratorPresentation(stage) {
  // Hide controls during presentation
  updateControlsDisplay("hidden");
  
  // Get demonstrator data
  let demonstrator1 = stage.demonstrator1 || {};
  let demonstrator2 = stage.demonstrator2 || {};
  
  // Prepare demonstrator mapped images
  const demonstratorMappedImages = [
    mapDemonstratorImage(demonstrator1.demonstrator_global_index, demonstrator1.demonstrator_style, demonstrator1.demonstrator_color),
    mapDemonstratorImage(demonstrator2.demonstrator_global_index, demonstrator2.demonstrator_style, demonstrator2.demonstrator_color)
  ];
  
  // Configuration
  const numDemonstrators = demonstratorMappedImages.length;
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 60; // More space between partners
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (this.sys.game.config.width - totalWidth) / 2;
  const gridY = 300;
  
  // Create title text
  const titleText = this.add.text(
    this.sys.game.config.width / 2,
    150,
    stage.message || "You will now start a new session and have several watch and play games! You will have the following two partners throughout the watch games of this session:",
    { 
      font: '24px Arial', 
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 700 }
    }
  ).setOrigin(0.5);
  
  // Create cells for each demonstrator
  const cells = [];
  const currentScene = this;
  
  // Create cells and load images
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
    const letter = String.fromCharCode(65 + i); // A, B
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
    
    // Load demonstrator image - include session_index to make keys unique per session
    const imageKey = `presentation_demonstrator_s${stage.session_index}_${i}`;
    this.load.image(imageKey, `assets/demonstrators/${demonstratorMappedImages[i]}`);
    
    // Store cell info
    cells.push({
      x: x,
      y: y,
      letter: letter,
      background: cellBg,
      letterText: letterText,
      imageKey: imageKey,
      demonstrator: i === 0 ? demonstrator1 : demonstrator2,
      image: null
    });
  }
  
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
      
      // Add demonstrator name below the image if available
      if (cell.demonstrator && cell.demonstrator.demonstrator_name) {
        const nameText = currentScene.add.text(
          cell.x,
          cell.y + cellHeight/2 - 15,
          cell.demonstrator.demonstrator_name,
          { 
            font: 'bold 14px Arial', 
            fill: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 3
          }
        ).setOrigin(0.5);
      }
    }
    
    // Add "Begin Session" button
    makeNextButton.call(currentScene, "Begin Session", () => {
      // Restore normal controls display before moving to next stage
      updateControlsDisplay("default");
      nextStage.call(currentScene);
    }, "overlay");
  });
  
  this.load.start();
}

/**
 * CHOICE stage - user chooses between demonstrators 
 */
function setupChoice(stage) {
  // Stage verification logs (uncomment for debugging):
  // console.log("Loading CHOICE stage");
  // console.log("Full stage data:", stage);
  
  // Reset game tracking for choice phase
  resetGameTracking('choice', 0);
  
  // Generate zone color based on zone_global_index
  const zoneColor = stage.zone && stage.zone.zone_global_index ? generateZoneColor(stage.zone.zone_global_index) : "#888888";
  
  // Check demonstrator data
  // In the new format, we have demonstrator1 and demonstrator2 properties
  let demonstrator1 = stage.demonstrator1 || {};
  let demonstrator2 = stage.demonstrator2 || {};
  
  // console.log("Demonstrator data:", { demonstrator1, demonstrator2 });
  
  // Fix demonstrator data if missing or invalid - check each demonstrator individually
  if (!demonstrator1 || Object.keys(demonstrator1).length === 0 || demonstrator1.demonstrator_global_index === undefined) {
    console.warn("Missing or incomplete demonstrator1 data for choice stage. Creating default data.");
    demonstrator1 = {
      "demonstrator_type": "novice",
      "demonstrator_session_index": 0,
      "demonstrator_global_index": 1
    };
  }
  
  if (!demonstrator2 || Object.keys(demonstrator2).length === 0 || demonstrator2.demonstrator_global_index === undefined) {
    console.warn("Missing or incomplete demonstrator2 data for choice stage. Creating default data.");
    demonstrator2 = {
      "demonstrator_type": "expert",
      "demonstrator_session_index": 1,
      "demonstrator_global_index": 2
    };
  }
  
  // Debug: Log demonstrator data
  verboseLog("Choice demonstrator1:", demonstrator1);
  verboseLog("Choice demonstrator2:", demonstrator2);
  
  // Prepare demonstrator mapped images and indices  
  const demonstratorMappedImages = [
    mapDemonstratorImage(demonstrator1.demonstrator_global_index, demonstrator1.demonstrator_style, demonstrator1.demonstrator_color),
    mapDemonstratorImage(demonstrator2.demonstrator_global_index, demonstrator2.demonstrator_style, demonstrator2.demonstrator_color)
  ];
  
  verboseLog("Mapped demonstrator images:", demonstratorMappedImages);
  
  const demonstratorSessionIndices = [
    demonstrator1.demonstrator_session_index,
    demonstrator2.demonstrator_session_index
  ];
  

  
  // Configuration
  const numDemonstrators = demonstratorMappedImages.length;
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
  const transferText = stage.transfer === true ? "in a new zone" : "in the same zone";
  const instructionText = this.add.text(
    this.sys.game.config.width / 2,
    gridY + cellHeight + 150,
    `Choose the starship you would watch before playing again to achieve higher rewards ${transferText}.`,
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
  let choicePosition = 0;
  
  // Initialize position tracking for logging  
  currentPosition = choicePosition;
  
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

    
    this.load.image(imageKey, `assets/demonstrators/${demonstratorMappedImages[i]}`);
    
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
      
      // Add demonstrator name below the image if available
      const demonstrator = i === 0 ? demonstrator1 : demonstrator2;
      if (demonstrator && demonstrator.demonstrator_name) {
        const nameText = currentScene.add.text(
          cell.x,
          cell.y + cellHeight/2 - 15, // Position below the image but above cell bottom
          demonstrator.demonstrator_name,
          { 
            font: 'bold 14px Arial', 
            fill: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 3
          }
        ).setOrigin(0.5);
      }
      
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
      .setOrigin(0.5)
      .setDepth(9999);
    setSpriteDisplaySizeWithAspectRatio(userSprite, DEMO_SPRITE_SIZE);
    
    // Add click handlers for all cells
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      
      // Track click state to prevent rapid clicking
      let isClicking = false;
      
      const clickHandler = () => {
        // Prevent rapid clicking
        if (isClicking) return;
        
        // Only allow selection if not already selected
        if (selectedDemonstrator !== null) return;
        
        isClicking = true;
        
        // If already on this position, select it
        if (choicePosition === i) {
          selectDemonstrator(i);
        } else {
          // Move to this position and log the movement
          const oldPosition = choicePosition;
          choicePosition = i;
          currentPosition = choicePosition; // Update global position for logging
          userX = cells[choicePosition].x;
          userSprite.setPosition(userX, userY);
          highlightRect.setPosition(cells[choicePosition].x, cells[choicePosition].y);
          
          // Log movement action for regular choice
          const moveAction = choicePosition > oldPosition ? 'right' : 'left';
          logToMongoDB(moveAction, {
            reward_generated: false,
            shot: false,
            choice_position: choicePosition,
            choice_letter: cells[choicePosition].letter
          });
        }
        
        // Reset click state after a short delay
        setTimeout(() => {
          isClicking = false;
        }, 200);
      };
      
      cell.background.on('pointerdown', clickHandler);
      cell.image.on('pointerdown', clickHandler);
    }
    
    // Function to handle selection
    function selectDemonstrator(index) {
      selectedDemonstrator = cells[index].letter;
      
      // Set global choice variables for logging
      if (index === 0) {
        choiceDemonstratorId = mapDemonstratorImage(demonstrator1.demonstrator_global_index, demonstrator1.demonstrator_style, demonstrator1.demonstrator_color);
        choiceDemonstratorType = demonstrator1.demonstrator_type;
        choiceDemonstratorData = demonstrator1;
      } else if (index === 1) {
        choiceDemonstratorId = mapDemonstratorImage(demonstrator2.demonstrator_global_index, demonstrator2.demonstrator_style, demonstrator2.demonstrator_color);
        choiceDemonstratorType = demonstrator2.demonstrator_type;
        choiceDemonstratorData = demonstrator2;
      }
      
      // Log the selection action
      logToMongoDB('shoot', {
        reward_generated: false,
        shot: true,
        choice_position: index,
        choice_letter: selectedDemonstrator,
        selected_demonstrator: selectedDemonstrator
      });
        
        // Show selection feedback
        feedbackText.setText(`You selected Partner ${selectedDemonstrator}`);
        feedbackText.setVisible(true);
        
        // Highlight selected with stronger border
        highlightRect.setStrokeStyle(4, parseInt(zoneColor.replace('#', '0x')) || 0x888888);
        highlightRect.setAlpha(0.6);
        
      // Add the selected demonstrator to summary bar - now pass the choice letter
      addChoiceSelectionToSummary(cells[index].imageKey, stage.zone ? generateZoneColor(stage.zone.zone_global_index) : "#888888", selectedDemonstrator);
      
      // Add next button - properly bind currentScene
      makeNextButton.call(currentScene, "Next", () => {
  
        // Restore normal controls display before moving to next stage
        updateControlsDisplay("default");
        nextStage.call(currentScene);
      }, "overlay");
    }
    
    // Clean up any existing keyboard listeners to prevent multiple handlers
    currentScene.input.keyboard.removeAllListeners('keydown');
    
    // Keyboard input
    currentScene.input.keyboard.on('keydown', (evt) => {
      // Only allow movement if not already selected
      if (selectedDemonstrator !== null) return;
      
      let oldPosition = choicePosition;
      
      if (evt.code === 'ArrowLeft') {
        choicePosition = Math.max(0, choicePosition - 1);
      }
      if (evt.code === 'ArrowRight') {
        choicePosition = Math.min(cells.length - 1, choicePosition + 1);
      }
      
      // If position changed, update user sprite and highlight
      if (oldPosition !== choicePosition) {
        currentPosition = choicePosition; // Update global position for logging
        userX = cells[choicePosition].x;
        userSprite.setPosition(userX, userY);
        highlightRect.setPosition(cells[choicePosition].x, cells[choicePosition].y);
        
        // Log keyboard movement action
        const moveAction = choicePosition > oldPosition ? 'right' : 'left';
        logToMongoDB(moveAction, {
          reward_generated: false,
          shot: false,
          choice_position: choicePosition,
          choice_letter: cells[choicePosition].letter
        });
      }
      
      // Space to select
      if (evt.code === 'Space') {
        selectDemonstrator.call(currentScene, choicePosition);
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
  } else if (type === "single-row") {
    // Controls for single-row games (asteroid mode) - no up/down arrows
    controlsDisplay.innerHTML = `
      <!-- Arrow Left -->
      <div class="control-key">
        <div class="control-icon">←</div>
        <div>Left</div>
      </div>
      <!-- Arrow Right -->
      <div class="control-key">
        <div class="control-icon">→</div>
        <div>Right</div>
      </div>
      <!-- Spacebar -->
      <div class="control-key">
        <div class="control-icon space">Spacebar</div>
        <div>Mine for Minerals</div>
      </div>
    `;
  } else if (type === "hidden") {
    // Hide controls completely
    controlsDisplay.innerHTML = "";
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
function addChoiceSelectionToSummary(imageKey, zoneColor, choiceLetter) {
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
    let demoName = null;
    
    if (stage && stage.demonstrator1 && stage.demonstrator2) {
      // Determine which demonstrator was selected based on the demoIndex
      if (demoIndex === '0' && stage.demonstrator1.demonstrator_global_index !== undefined) {
        const mappedImage = mapDemonstratorImage(stage.demonstrator1.demonstrator_global_index, stage.demonstrator1.demonstrator_style, stage.demonstrator1.demonstrator_color);
        demoImage = mappedImage.replace('.png', '');
        // Get demonstrator name if available
        if (stage.demonstrator1.demonstrator_name) {
          demoName = stage.demonstrator1.demonstrator_name;
        }
      } else if (demoIndex === '1' && stage.demonstrator2.demonstrator_global_index !== undefined) {
        const mappedImage = mapDemonstratorImage(stage.demonstrator2.demonstrator_global_index, stage.demonstrator2.demonstrator_style, stage.demonstrator2.demonstrator_color);
        demoImage = mappedImage.replace('.png', '');
        // Get demonstrator name if available
        if (stage.demonstrator2.demonstrator_name) {
          demoName = stage.demonstrator2.demonstrator_name;
        }
      }
    }
    
    // Log what we're using for debugging

    
    // Use the actual demonstrator image, or fall back to a default
    summaryIcons[choiceIconIndex].imageKey = demoImage || `demonstrator_${demoIndex}`;
    
    // Store the choice letter for display
    summaryIcons[choiceIconIndex].choiceLetter = choiceLetter;
    
    // Store the demonstrator name if available
    if (demoName) {
      summaryIcons[choiceIconIndex].name = demoName;
    }
    
    // Redraw the summary bar to show the change
    redrawSummaryBarDOM();
  }
}

/**
 * ONLINE-CHOICE stage - manages play-choice-watch cycles
 */
function setupOnlineChoice(stage) {
  if (!stage.zone || !stage.zone.zone_bandit) {
    return;
  }
  
  if (!stage.demonstrator1 || !stage.demonstrator2) {
    return;
  }
  
  // Initialize or get the current phase
  if (!window.onlineChoicePhase) {
    window.onlineChoicePhase = 'choice'; // Start with choice phase
    window.onlineChoiceSelectedDemo = null;
  }
  
  const currentPhase = window.onlineChoicePhase;
  
  if (currentPhase === 'choice') {
    // Show choice interface
    setupOnlineChoicePhaseChoice.call(this, stage);
  } else if (currentPhase === 'watch') {
    // Show watch interface with selected demonstrator
    setupOnlineChoicePhaseWatch.call(this, stage);
  }
}

/**
 * Choice phase for online-choice
 */
function setupOnlineChoicePhaseChoice(stage) {
  // Reset game tracking for choice phase
  resetGameTracking('choice', 0);
  
  const currentScene = this;
  const zoneColor = stage.zone && stage.zone.zone_global_index ? generateZoneColor(stage.zone.zone_global_index) : "#888888";
  
  // Create demonstrator data from stage
  const demonstrators = [
    {
      key: 'demonstrator1',
      data: stage.demonstrator1,
      letter: 'A'
    },
    {
      key: 'demonstrator2', 
      data: stage.demonstrator2,
      letter: 'B'
    }
  ];
  
  // Configuration
  const numDemonstrators = demonstrators.length;
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 30;
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (this.sys.game.config.width - totalWidth) / 2;
  const gridY = 200;
  
  // Create title text (same as regular choice game)
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
  
  // Create instruction text (use transfer flag to determine message)
  const transferText = stage.transfer === true ? "in a new zone" : "in the same zone";
  const instructionText = this.add.text(
    this.sys.game.config.width / 2,
    gridY + cellHeight + 150,
    `Choose the starship you would watch before playing again to achieve higher rewards ${transferText}.`,
    { 
      font: '18px Arial', 
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }
  ).setOrigin(0.5);
  
  // Create instruction for controls (same as regular choice game)
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
  
  // Create cells for each demonstrator
  const cells = [];
  
  for (let i = 0; i < demonstrators.length; i++) {
    const demo = demonstrators[i];
    const x = gridX + i * (cellWidth + cellPadding) + cellWidth/2;
    const y = gridY + cellHeight/2;
    
    // Create background
    const cellBg = this.add.rectangle(
      x, y,
      cellWidth, cellHeight,
      0x333333
    ).setOrigin(0.5);
    
    // Create letter label (same format as regular choice game)
    const letterText = this.add.text(
      x,
      gridY - 30,
      `Partner ${demo.letter}`,
      { 
        font: '18px Arial', 
        fill: '#ffffff',
        backgroundColor: '#333333',
        padding: { x: 10, y: 5 }
      }
    ).setOrigin(0.5);
    
    // Load demonstrator image
    const imageKey = `online_choice_${demo.key}`;
    const mappedDemonstratorImage = mapDemonstratorImage(demo.data.demonstrator_global_index, demo.data.demonstrator_style, demo.data.demonstrator_color);
    this.load.image(imageKey, `assets/demonstrators/${mappedDemonstratorImage}`);
    
    cells.push({
      key: demo.key,
      data: demo.data,
      letter: demo.letter,
      x,
      y,
      background: cellBg,
      letterText: letterText,
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
      
      // Add demonstrator name below the image if available
      if (cell.data && cell.data.demonstrator_name) {
        const nameText = currentScene.add.text(
          cell.x,
          cell.y + cellHeight/2 - 15, // Position below the image but above cell bottom
          cell.data.demonstrator_name,
          { 
            font: 'bold 14px Arial', 
            fill: '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 3
          }
        ).setOrigin(0.5);
      }
      
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
    
    // Position for user sprite (below the cells, same as regular choice game)
    const userY = gridY + cellHeight + 40;
    let userX = cells[0].x;
    let onlineChoicePosition = 0;
    let selectedDemonstrator = null;
    
    // Initialize position tracking for logging
    currentPosition = onlineChoicePosition;
    
    // Add user sprite
    const userSprite = currentScene.add.image(userX, userY, 'user')
      .setOrigin(0.5)
      .setDepth(9999);
    setSpriteDisplaySizeWithAspectRatio(userSprite, DEMO_SPRITE_SIZE);
    
    // Selection feedback text (initially hidden, same position as regular choice game)
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
      
      // Track click state to prevent rapid clicking
      let isClicking = false;
      
      const clickHandler = () => {
        // Prevent rapid clicking
        if (isClicking) return;
        
        // Only allow selection if not already selected
        if (selectedDemonstrator !== null) return;
        
        isClicking = true;
        
        // If already on this position, select it
        if (onlineChoicePosition === i) {
          selectDemonstrator(i);
        } else {
          // Move to this position and log the movement
          const oldPosition = onlineChoicePosition;
          onlineChoicePosition = i;
          currentPosition = onlineChoicePosition; // Update global position for logging
          userX = cells[onlineChoicePosition].x;
          userSprite.setPosition(userX, userY);
          highlightRect.setPosition(cells[onlineChoicePosition].x, cells[onlineChoicePosition].y);
          
          // Log movement action for online-choice
          const moveAction = onlineChoicePosition > oldPosition ? 'right' : 'left';
          logToMongoDB(moveAction, {
            reward_generated: false,
            shot: false,
            choice_position: onlineChoicePosition,
            choice_letter: cells[onlineChoicePosition].letter
          });
        }
        
        // Reset click state after a short delay
        setTimeout(() => {
          isClicking = false;
        }, 200);
      };
      
      cell.background.on('pointerdown', clickHandler);
      cell.image.on('pointerdown', clickHandler);
    }
    
    // Function to handle selection
    function selectDemonstrator(index) {
      const selectedCell = cells[index];
      selectedDemonstrator = selectedCell;
      
      // Set global choice variables for logging  
      choiceDemonstratorId = mapDemonstratorImage(selectedCell.data.demonstrator_global_index, selectedCell.data.demonstrator_style, selectedCell.data.demonstrator_color);
      choiceDemonstratorType = selectedCell.data.demonstrator_type;
      choiceDemonstratorData = selectedCell.data;
      
      // Log the selection action
      logToMongoDB('shoot', {
        reward_generated: false,
        shot: true,
        choice_position: index,
        choice_letter: selectedCell.letter,
        selected_demonstrator: selectedCell.letter
      });
      
      // Store the selection globally
      window.onlineChoiceSelectedDemo = selectedCell;
      
      // Show selection feedback
      feedbackText.setText(`You selected Partner ${selectedCell.letter}`);
        feedbackText.setVisible(true);
        
        // Highlight selected with stronger border
        highlightRect.setStrokeStyle(4, parseInt(zoneColor.replace('#', '0x')) || 0x888888);
        highlightRect.setAlpha(0.6);
        
      // Update summary icon with selected demonstrator
      updateOnlineChoiceSummaryIcon(selectedCell.imageKey, generateZoneColor(stage.zone.zone_global_index), selectedCell.letter);
      
      // Add next button (same as regular choice game)
      makeNextButton.call(currentScene, "Next", () => {
        // Restore default controls
        updateControlsDisplay("default");
        
        // Move to watch phase
        window.onlineChoicePhase = 'watch';
        loadStage.call(currentScene);
      }, "overlay");
    }
    
    // Clean up any existing keyboard listeners to prevent multiple handlers
    currentScene.input.keyboard.removeAllListeners('keydown');
    
    // Listen for arrow keys and spacebar (same as regular choice game)
    currentScene.input.keyboard.on('keydown', (evt) => {
      // Only allow movement if not already selected
      if (selectedDemonstrator !== null) return;
      
      let oldPosition = onlineChoicePosition;
      
      if (evt.code === 'ArrowLeft') {
        onlineChoicePosition = Math.max(0, onlineChoicePosition - 1);
      }
      if (evt.code === 'ArrowRight') {
        onlineChoicePosition = Math.min(cells.length - 1, onlineChoicePosition + 1);
      }
      
      // If position changed, update user sprite and highlight
      if (oldPosition !== onlineChoicePosition) {
        currentPosition = onlineChoicePosition; // Update global position for logging
        userX = cells[onlineChoicePosition].x;
        userSprite.setPosition(userX, userY);
        highlightRect.setPosition(cells[onlineChoicePosition].x, cells[onlineChoicePosition].y);
        
        // Log keyboard movement action for online-choice
        const moveAction = onlineChoicePosition > oldPosition ? 'right' : 'left';
        logToMongoDB(moveAction, {
          reward_generated: false,
          shot: false,
          choice_position: onlineChoicePosition,
          choice_letter: cells[onlineChoicePosition].letter
        });
      }
      
      // Space to select
      if (evt.code === 'Space') {
        selectDemonstrator(onlineChoicePosition);
      }
    });
  });
  
  // Start loading the images
  this.load.start();
}

/**
 * Watch phase for online-choice
 */
function setupOnlineChoicePhaseWatch(stage) {
  // Get the selected demonstrator from the choice phase
  const selectedDemo = window.onlineChoiceSelectedDemo;
  if (!selectedDemo) {
    return;
  }
  
  const currentScene = this;
  
  // Use watch-overlay-message if available, otherwise use default
  const overlayMessage = stage["watch-overlay-message"] || 
    "You will now watch your chosen starship partner.";
  
  // Get demonstrator data
  const demoData = selectedDemo.data;
  
  // Check if we're in inline mode
  const isInlineMode = demonstratorConfig && demonstratorConfig.source === 'inline';
  
  let trajectory;
  let thompsonSampler = null;
  let trajectoryData = null;  // Will store {trajectory: [], rewards: []}
  
  if (isInlineMode) {
    // Inline mode: generate trajectory using Thompson sampling
    const bandit = stage.zone.zone_bandit;
    const numRows = bandit.length;
    const numCols = bandit[0].length;
    const flattenedPayoffs = bandit.flat();
    const numArmPulls = stage.num_arm_pulls || 6;
    
    // Get experience level based on demonstrator type
    const demonstratorType = demoData.demonstrator_type;
    const experienceLevel = demonstratorType === 'expert' 
      ? demonstratorConfig.expert_demonstrator_experience 
      : demonstratorConfig.novice_demonstrator_experience;
    
    // Log bandit payoffs and demonstrator information
    verboseLog('Bandit payoffs:', flattenedPayoffs);
    verboseLog('Demonstrator type:', demonstratorType);
    verboseLog(`Generating ${demonstratorType} trajectory with ${experienceLevel} warmup iterations`);
    
    // Initialize Thompson sampler
    thompsonSampler = new ThompsonSampler(flattenedPayoffs.length, flattenedPayoffs);
    
    // Run warmup iterations (not shown to user)
    for (let i = 0; i < experienceLevel; i++) {
      thompsonSampler.step();
    }
    
    // Generate trajectory for display
    trajectory = [];
    const rewards = [];
    for (let i = 0; i < numArmPulls; i++) {
      const stepResult = thompsonSampler.step();
      trajectory.push(stepResult.arm);
      rewards.push(stepResult.reward);
    }
    
    trajectoryData = { trajectory, rewards };
    verboseLog('Generated trajectory:', trajectory);
    verboseLog('Generated rewards:', rewards);
  } else {
    // File mode: use pre-computed trajectory
    trajectory = demoData.demonstrator_trajectory;
    trajectoryData = null;
  }
  
  // Reset game tracking for watch phase  
  resetGameTracking('watch', trajectory.length);
  
  const bandit = stage.zone.zone_bandit;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  
  // Hide controls during online-choice watch phase - user is not actively playing
  updateControlsDisplay("hidden");
  
  // Show zone information
  const zoneText = this.add.text(
    this.sys.game.config.width / 2,
    30,
    `Zone ${stage.zone.zone_global_index}`,
    { font: 'bold 40px Courier New', fill: '#ffffff' }
  ).setOrigin(0.5);
  
  // Show which demonstrator is being watched
  const demoText = this.add.text(
    this.sys.game.config.width / 2,
    70,
    `Watching Partner ${selectedDemo.letter}`,
    { font: 'bold 22px Courier New', fill: '#ffffff' }
  ).setOrigin(0.5);
  
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
  addZoneLabels(this, stage.zone.zone_global_index);
  
  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Keep reward tank for watch stages to show mining outcomes
  let watchOutcomes = [];
  const tankX = gridOriginX + (totalGridWidth / 2);
  const tankY = gridBottomY + TANK_MARGIN_TOP;
  const rewardTankContainer = this.add.container(tankX, tankY);
  rewardTankContainer.setDepth(100);
  drawRewardTank.call(this, rewardTankContainer, trajectory.length, watchOutcomes);

  let highlightRect = createHighlightRect.call(this, cellWidth, cellHeight);

  // Convert first linear index to row,col
  let currentLinearIndex = trajectory[0];
  let currentR = Math.floor(currentLinearIndex / numCols);
  let currentC = currentLinearIndex % numCols;
  
  // Initialize position tracking for logging
  currentPosition = currentLinearIndex;
  
  // Load demonstrator image
  const demoImageKey = `online_watch_${selectedDemo.key}`;
  const mappedDemonstratorImage = mapDemonstratorImage(demoData.demonstrator_global_index, demoData.demonstrator_style, demoData.demonstrator_color);
  
  if (!this.textures.exists(demoImageKey)) {
    this.load.image(demoImageKey, `assets/demonstrators/${mappedDemonstratorImage}`);
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
      .setOrigin(0.5)
      .setDepth(9999);
    setSpriteDisplaySizeWithAspectRatio(dSprite, DEMO_SPRITE_SIZE);

    let currentStep = 0;
    let totalSteps = trajectory.length;

    // Add a delay before starting the trajectory
    currentScene.time.delayedCall(WATCH_START_DELAY, () => {
      moveAlongTrajectoryStep.call(currentScene);
    });

    function moveAlongTrajectoryStep() {
      if (currentStep >= totalSteps) {
        // When demonstration is complete, show next button
        makeNextButton.call(currentScene, "Next", () => {
          // Reset online choice state and move to next stage
          window.onlineChoicePhase = null;
          window.onlineChoiceSelectedDemo = null;
          nextStage.call(currentScene);
        }, "overlay");
        return;
      }

      let targetLinearIndex = trajectory[currentStep];
      let targetR = Math.floor(targetLinearIndex / numCols);
      let targetC = targetLinearIndex % numCols;
      
      let pathCells = getManhattanPath(currentR, currentC, targetR, targetC);

      let index = 0;
      let pathTimer = currentScene.time.addEvent({
        delay: 600,
        repeat: pathCells.length - 1,
        callback: () => {
          let cell = pathCells[index];
          let pos = getCellBelow(gridOriginX, gridOriginY, cellWidth, cellHeight, cell.r, cell.c);
          dSprite.setPosition(pos.x, pos.y);
          highlightCurrentCell(highlightRect, cell.r, cell.c, gridOriginX, gridOriginY, cellWidth, cellHeight);

          // Log movement actions during watch (except for the first position)
          if (index > 0) {
            const prevCell = pathCells[index - 1];
            const currentCellPosition = cell.r * numCols + cell.c;
            const prevCellPosition = prevCell.r * numCols + prevCell.c;
            
            let moveAction;
            if (currentCellPosition > prevCellPosition) {
              moveAction = cell.r > prevCell.r ? 'down' : 'right';
            } else {
              moveAction = cell.r < prevCell.r ? 'up' : 'left';
            }
            
            // Log the movement action from the PREVIOUS position (where action was taken from)
            currentShotsRemaining = totalSteps - currentStep;
            logToMongoDB(moveAction, {
              reward_generated: false,
              shot: false
            });
            
            // Update position and step AFTER logging
            currentPosition = currentCellPosition;
            currentGameStep++;
          }

          index++;
          if (index >= pathCells.length) {
            pathTimer.remove();
            currentR = targetR;
            currentC = targetC;

            // Define the shooting action function
            const performShootingAction = () => {
              // Calculate outcome
              let payoff = bandit[currentR][currentC];
              let outcome;
              
              if (isInlineMode && trajectoryData) {
                // Use the pre-generated reward from Thompson sampler
                outcome = trajectoryData.rewards[currentStep];
              } else {
                // Random sampling (file mode)
                outcome = (Math.random() < payoff) ? 1 : 0;
              }
              
              // Log the shoot action from current position (where shot was taken from)
              currentShotsRemaining = totalSteps - currentStep - 1;
              logToMongoDB('shoot', {
                reward_generated: outcome === 1,
                shot: true
              });
              
              // Update tracking AFTER logging
              currentPosition = currentR * numCols + currentC;
              currentGameStep++;
              
              if (outcome === 1) {
                currentGameReward++;
                // Only increment total reward for play games, not practice or watch
                if (currentGameType === 'play') {
                  userTotalReward++;
                }
              }
              
              // Create a simple flash effect
              let g = currentScene.add.graphics();
              g.fillStyle(HIGHLIGHT_COLOR, 1);
              g.fillRect(
                gridOriginX + currentC*(cellWidth + CELL_PADDING),
                gridOriginY + currentR*(cellHeight + CELL_PADDING),
                cellWidth, cellHeight
              );
              
              // Fade out only
              currentScene.tweens.add({
                targets: g,
                alpha: 0,
                duration: 200,
                onComplete: () => {
                  g.destroy();
                  
                  // Record outcome and update tank
                  watchOutcomes.push(outcome);
                  drawMarkerDot.call(currentScene, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                  drawRewardTank.call(currentScene, rewardTankContainer, totalSteps, watchOutcomes);

                  currentStep++;
                  
                  // After the last step, log complete trajectory data if in inline mode
                  if (currentStep >= totalSteps && isInlineMode && thompsonSampler) {
                    // Log all actions and rewards to MongoDB
                    logToMongoDB('trajectory_complete', {
                      demonstrator_all_actions: JSON.stringify(thompsonSampler.allActions),
                      demonstrator_all_rewards: JSON.stringify(thompsonSampler.allRewards)
                    });
                  }
                  
                  moveAlongTrajectoryStep.call(currentScene);
                }
              });
            };
            
            // Add a brief pause before shooting if there was movement
            if (pathCells.length > 1) {
              // There was movement, add a pause before shooting
              currentScene.time.delayedCall(400, performShootingAction);
            } else {
              // No movement, shoot immediately
              performShootingAction();
            }
          }
        }
      });
    }
  }
}

/**
 * Update the summary icon for online-choice selection
 */
function updateOnlineChoiceSummaryIcon(imageKey, zoneColor, choiceLetter) {
  // Look for the online-choice icon in the summaryIcons array
  let onlineChoiceIconIndex = -1;
  for (let i = 0; i < summaryIcons.length; i++) {
    if (summaryIcons[i].imageKey === null && summaryIcons[i].zone !== 'Choice') {
      onlineChoiceIconIndex = i;
      break;
    }
  }
  
  // If we found the online-choice icon, update it with the selected demonstrator
  if (onlineChoiceIconIndex >= 0) {
    // Extract demonstrator image from the selected demonstrator
    const selectedDemo = window.onlineChoiceSelectedDemo;
    if (selectedDemo && selectedDemo.data && selectedDemo.data.demonstrator_global_index !== undefined) {
      const mappedImage = mapDemonstratorImage(selectedDemo.data.demonstrator_global_index);
      const demoImage = mappedImage.replace('.png', '');
      summaryIcons[onlineChoiceIconIndex].imageKey = demoImage;
      summaryIcons[onlineChoiceIconIndex].choiceLetter = choiceLetter;
      
      // Redraw the summary bar to show the change
      redrawSummaryBarDOM();
    }
  }
}

/************************************************
 * Utility
 ************************************************/
function nextStage() {
  // Simple approach: increment stage index and let loadStage handle the complex logic
  currentStageIndex++;
  

  
  // Get total stages in current session for validation
  let totalStagesInSession = 0;
  const currentSession = timelineData[currentSessionIndex];
  
  if (Array.isArray(currentSession[0])) {
    // Nested array session - count all stages across all containers
    for (let container of currentSession) {
      totalStagesInSession += container.length;
    }
  } else {
    // Simple array session
    totalStagesInSession = currentSession.length;
  }
  

  
  // Check if we've exceeded the stages in this session
  if (currentStageIndex >= totalStagesInSession) {

    currentSessionIndex++;
    currentStageIndex = 0;
    
    // Clear summary icons when starting a new session
    summaryIcons = [];
    if (window.addedSummaryIcons) {
      window.addedSummaryIcons.clear();
    }
    redrawSummaryBarDOM();
    
  }
  
  // Check if we're at the end of all sessions
  if (currentSessionIndex >= timelineData.length) {
    showEndOfGameMessage.call(this);
    return;
  }
  
  // Get the next stage using the robust getCurrentStageObject function
  const nextStageObj = getCurrentStageObject();
  
  if (!nextStageObj) {
    console.error("Could not find next stage object!");
    console.error(`Session: ${currentSessionIndex}, Stage: ${currentStageIndex}`);
    console.error("Current session structure:", currentSession);
    return;
  }
  
  // Get the stage type from both possible properties
  const nextStageType = nextStageObj.stage_type || nextStageObj.game;

  
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
    console.error(`getCurrentStageObject: Invalid session index ${currentSessionIndex}, total sessions: ${timelineData ? timelineData.length : 'undefined'}`);
    return null;
  }
  
  const currentSession = timelineData[currentSessionIndex];
  
  // Check if the session has nested arrays
  if (Array.isArray(currentSession[0])) {
    let totalStagesSoFar = 0;
    

    
    for (let i = 0; i < currentSession.length; i++) {
      const container = currentSession[i];

      
      if (currentStageIndex >= totalStagesSoFar && currentStageIndex < totalStagesSoFar + container.length) {
        // This container has our stage
        const effectiveIndex = currentStageIndex - totalStagesSoFar;

        
        const stage = container[effectiveIndex];
        if (!stage) {
          console.error(`  ERROR: Stage at effective index ${effectiveIndex} is null/undefined`);
          return null;
        }
        
        return stage;
      }
      totalStagesSoFar += container.length;
    }
    
    console.error(`getCurrentStageObject: Stage ${currentStageIndex} not found in any container. Total stages: ${totalStagesSoFar}`);
    return null; // Stage not found
  } else {
    // Simple array session

    
    if (currentStageIndex >= 0 && currentStageIndex < currentSession.length) {
      const stage = currentSession[currentStageIndex];
      if (!stage) {
        console.error(`getCurrentStageObject: Stage at index ${currentStageIndex} is null/undefined`);
        return null;
      }
      return stage;
    }
    
    console.error(`getCurrentStageObject: Stage index ${currentStageIndex} out of bounds for session with ${currentSession.length} stages`);
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
  const returnUrl = timelineData.return_url || "https://app.prolific.com/submissions/complete?cc=CTVM94DF";
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

  // Always use background images now based on zone_global_index
  const mappedBackground = mapZoneBackground(stage.zone.zone_global_index);
  const backgroundImageKey = `zone_bg_${stage.zone.zone_global_index}`;
  
  // Check if image is already loaded
  if (!this.textures.exists(backgroundImageKey)) {
    // Load the background image from zone_backgrounds folder

    
    this.load.image(backgroundImageKey, `assets/zone_backgrounds/${mappedBackground}`);
    this.load.once('complete', () => {
      applyBackground.call(this);
    });
    this.load.start();
    return; // Wait for image to load
  }
  
  // If image is already loaded, proceed with the background
  applyBackground.call(this);
  
  function applyBackground() {
    // Create background for the ENTIRE game container, not just the grid
    const gameWidth = this.sys.game.config.width;
    const gameHeight = this.sys.game.config.height;
    
    // Add the background image to cover the entire game container
    let zoneBg = this.add.image(0, 0, backgroundImageKey)
      .setOrigin(0, 0)
      .setDisplaySize(gameWidth, gameHeight)
      .setDepth(-1000); // Set to very low depth to ensure it's behind everything
    
    // Calculate grid dimensions for the cell content
    const totalGridWidth = (numCols * cellWidth) + ((numCols - 1) * CELL_PADDING);
    const totalGridHeight = (numRows * cellHeight) + ((numRows - 1) * CELL_PADDING);
    
    // Continue with the cells (asteroid mode only now)
    const zoneMode = stage.zone.zone_mode || "asteroid";

    if (zoneMode === "asteroid") {
      // ASTEROID MODE: each cell gets its own asteroid
      // Get the mapped asteroid image filenames
      const asteroidImageIndexes = stage.zone.zone_bandit_arm_image_indexes;
      if (!asteroidImageIndexes || asteroidImageIndexes.length === 0) {
        console.error("Missing asteroid image indexes");
        return;
      }
      
      // Map the indexes to actual filenames
      const mappedAsteroidImages = mapZoneBanditArmImages(stage.zone.zone_global_index, asteroidImageIndexes);
      const imageKeys = [];

      // Create a loader for all asteroid images
      let loadingRequired = false;
      for (let i = 0; i < mappedAsteroidImages.length; i++) {
        const asteroidKey = `asteroid_${stage.zone.zone_global_index}_${i}`;
        imageKeys.push(asteroidKey);
        
        if (!this.textures.exists(asteroidKey)) {
          this.load.image(asteroidKey, `assets/asteroids/${mappedAsteroidImages[i]}`);
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
 * Calculate color for total reward display based on value (0 to 30+)
 * Returns a hex color string that goes from visible grey (0) to bright green (30)
 * Stays at bright green for values 30-36
 */
function getTotalRewardColor(totalReward) {
  const maxReward = 30; // Brightest green reached at 30 rewards
  const ratio = Math.min(totalReward / maxReward, 1.0); // Clamp to [0, 1]
  
  // Light grey base color: rgb(180, 180, 180) - more visible than darker grey
  // Bright green target: rgb(0, 255, 0)
  const r = Math.round(180 * (1 - ratio));
  const g = Math.round(180 + 75 * ratio); // Goes from 180 to 255
  const b = Math.round(180 * (1 - ratio));
  
  // Convert to hex string
  const hexR = r.toString(16).padStart(2, '0');
  const hexG = g.toString(16).padStart(2, '0');
  const hexB = b.toString(16).padStart(2, '0');
  
  return '#' + hexR + hexG + hexB;
}

/**
 * Draw the horizontal reward tank with smaller slots.
 * 'outcomes': array of 1=success(green), 0=fail(red)
 */
function drawRewardTank(container, totalSlots, outcomes) {
  container.removeAll(true);

  // Add a border/background for the tank
  const totalWidth = totalSlots * (TANK_SLOT_SIZE + TANK_SLOT_PADDING) - TANK_SLOT_PADDING;
  const slotHeight = TANK_SLOT_SIZE * 0.6; // Match the rectangle height
  const tankBg = this.add.rectangle(0, 0, totalWidth + 4, slotHeight + 4, 0x333333);
  tankBg.setOrigin(0.5, 0.5);  // Center the background
  tankBg.setDepth(1); // Ensure it's above any background but below other elements
  container.add(tankBg);
  
  // Add a title above the tank
  const tankTitle = this.add.text(0, -40, "Mining Reward Tank", { 
    font: 'bold 22px Courier New', 
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
    let slotHeight = TANK_SLOT_SIZE * 0.6; // Make rectangles shorter than they are wide
    let slotRect = this.add.rectangle(slotX, 0, TANK_SLOT_SIZE, slotHeight, color);
    slotRect.setStrokeStyle(2, 0x00CCFF); // Bright blue border, 2px thick
    slotRect.setOrigin(0.5, 0.5);  // Center each slot
    slotRect.setDepth(1);  // Same depth as the background
    container.add(slotRect);
  }
  
  // Add total reward display if enabled (only for play games)
  if (displayRunningTotalReward && currentGameType === 'play') {
    const totalRewardColor = getTotalRewardColor(userTotalReward);
    const totalRewardText = this.add.text(0, 45, `TOTAL REWARD: ${userTotalReward}`, {
      font: 'bold 26px Arial',
      fill: totalRewardColor,
      stroke: '#000000',
      strokeThickness: 4
    });
    totalRewardText.setOrigin(0.5, 0.5);
    totalRewardText.setDepth(2);
    container.add(totalRewardText);
  }
}

/** Smaller success/fail dot. */
function drawMarkerDot(gridX, gridY, cellWidth, cellHeight, row, col, outcome) {
  let { x, y } = getCellCenter(gridX, gridY, cellWidth, cellHeight, row, col);
  let offsetX = Phaser.Math.Between(-cellWidth/4, cellWidth/4);
  let offsetY = Phaser.Math.Between(-cellHeight/4, cellHeight/4);
  let color = (outcome === 1) ? 0x00ff00 : 0xff0000;

  // First draw a slightly larger black circle for the border
  let border = this.add.circle(x + offsetX, y + offsetY, MARKER_DOT_RADIUS + 1.5, 0x000000);
  border.setDepth(99998);
  
  // Then draw the colored dot on top
  let dot = this.add.circle(x + offsetX, y + offsetY, MARKER_DOT_RADIUS, color);
  dot.setDepth(99999);
}

/** 
 * place the sprite ~30px below the bottom edge of the cell
 */
function getCellBelow(gridX, gridY, cellWidth, cellHeight, row, col) {
  // Calculate position with padding
  const x = gridX + col * (cellWidth + CELL_PADDING) + (cellWidth/2);
  const cellBottom = gridY + row * (cellHeight + CELL_PADDING) + cellHeight;
  const y = cellBottom + 30;
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
 * Creates a Phaser text button centered horizontally at the bottom 
 * that, when clicked, runs the given callback.
 */
function makeNextButton(label, callback, position = "default") {
    // Determine Y position based on context
    let yPosition;
    if (position === "overlay") {
      // Match the transition overlay button position (PRACTICE, WATCH, PLAY buttons)
      yPosition = this.sys.game.config.height - 100;
    } else {
      // Default position for intro/tutorial stages
      yPosition = this.sys.game.config.height - 30;
    }
    
    // Create a prominent button centered horizontally
    const btn = this.add.text(
      this.sys.game.config.width / 2, // centered horizontally
      yPosition, // position based on context
      label.toUpperCase(), // Convert to all caps
      { 
        font: 'bold 20px Arial', // Smaller, bold font
        fill: '#ffffff', // White text
        backgroundColor: '#4CAF50', // Green background
        padding: { x: 16, y: 10 }, // Less padding for smaller button
        borderRadius: 8 // Rounded corners
      }
    ).setOrigin(0.5).setInteractive();
  
    // Track button state to prevent multiple clicks
    let isClicked = false;
    
    // Add hover effects to make it more interactive
    btn.on('pointerover', () => {
      if (!isClicked) {
        btn.setStyle({ backgroundColor: '#45a049' }); // Darker green on hover
        this.game.canvas.style.cursor = 'pointer';
      }
    });
    
    btn.on('pointerout', () => {
      if (!isClicked) {
        btn.setStyle({ backgroundColor: '#4CAF50' }); // Original green
        this.game.canvas.style.cursor = 'default';
      }
    });
  
    btn.on('pointerdown', () => {
      if (!isClicked && callback) {
        isClicked = true;
        // Disable the button visually
        btn.setStyle({ backgroundColor: '#888888' });
        btn.disableInteractive();
        this.game.canvas.style.cursor = 'default';
        
        // Small delay to prevent rapid clicking issues
        setTimeout(() => {
          callback();
        }, 100);
      }
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
    { font: 'bold 32px Courier New', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setDepth(10000);
  
  // Top right
  scene.add.text(
    scene.sys.game.config.width - 10, 10, 
    labelText, 
    { font: 'bold 32px Courier New', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setOrigin(1, 0).setDepth(10000);
  
  // Bottom left
  scene.add.text(
    10, scene.sys.game.config.height - 10, 
    labelText, 
    { font: 'bold 32px Courier New', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
  ).setOrigin(0, 1).setDepth(10000);
  
  // Bottom right
  scene.add.text(
    scene.sys.game.config.width - 10, scene.sys.game.config.height - 10, 
    labelText, 
    { font: 'bold 32px Courier New', fill: '#ffffff', backgroundColor: '#000000', padding: { x: 5, y: 2 } }
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
  
  // Hide controls during transition overlays
  updateControlsDisplay("hidden");
  
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
    case 'play': buttonText = 'Play'; break; // Use "Play" for blind too
    case 'blind': buttonText = 'Play'; break; // Use "Play" for blind too
    case 'choice': buttonText = 'Ready to Choose'; break; // Changed from "Choose" to "Ready to Choose"
    case 'online-choice': buttonText = 'Ready to Choose'; break; // Use same as choice
    case 'watch': buttonText = 'Watch'; break;
    case 'indicate': buttonText = 'Watch'; break; // Indicate also uses "Watch"
    default: buttonText = 'Next';
  }
  
  // Get the overlay message - for online-choice, use choice-overlay-message
  let message;
  if (stageType === 'online-choice') {
    message = nextStage["choice-overlay-message"] || 
             "Choose the starship you would watch before playing again to achieve higher rewards.";
  } else {
    message = nextStage["overlay-message"] || 
                 (nextStage.zone && nextStage.zone["overlay-message"]) || 
                 `Get ready to ${buttonText.toLowerCase()}!`;
  }
  
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
  
  // Add secondary message if it exists (for watch games)
  let secondaryMessage = null;
  if (stageType === 'watch' || stageType === 'indicate') {
    // Only use secondary-overlay-message if it's explicitly set in the stage data
    // Don't provide a fallback to respect the omit_explicit_experience_transfer_message config
    secondaryMessage = nextStage["secondary-overlay-message"] || null;
  }
  
  // Update the game container border color immediately to match the next stage's zone
  if (nextStage.zone) {
    const zoneColor = generateZoneColor(nextStage.zone.zone_global_index);
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.style.border = `20px solid ${zoneColor}`;
  
    }
  }
  
  // Create the button early so it always appears
  createButton();
  
  // Get zone info
  const zone = nextStage.zone;
  if (zone) {
    // Generate zone color based on zone_global_index
    const zoneColor = generateZoneColor(zone.zone_global_index);
  
    const zoneIndex = zone.zone_global_index;
    
    // For choice game, use a special zone display
    if (stageType === 'choice') {
      createChoiceZoneIcon(scene, zoneColor || '#888888');
    } else if (stageType === 'online-choice') {
      // For online-choice, also use the user.png image
      createOnlineChoiceZoneIcon(scene, zoneColor || '#888888', zoneIndex);
    } else {
      // Create a single icon similar to the summary bar items
      createSummaryStyleIcon(scene, stageType, nextStage, zoneColor, zoneIndex, secondaryMessage);
    }
  } else if (stageType === 'choice') {
    // Fallback for choice with no zone - use a default color

    createChoiceZoneIcon(scene, '#888888');
  } else if (stageType === 'online-choice') {
    // Fallback for online-choice with no zone - use a default color
    
    createOnlineChoiceZoneIcon(scene, '#888888', 0);
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
    
    // Track button state to prevent multiple clicks
    let isClicked = false;
    
    // Button hover effects
    button.on('pointerover', () => {
      if (!isClicked) {
        button.setFillStyle(0x45a049); // Darker shade when hovered
        scene.game.canvas.style.cursor = 'pointer';
      }
    });
    
    button.on('pointerout', () => {
      if (!isClicked) {
        button.setFillStyle(0x4CAF50); // Original color
        scene.game.canvas.style.cursor = 'default';
      }
    });
    
    // Button click
    button.on('pointerdown', () => {
      if (!isClicked && startCallback) {
        isClicked = true;
        // Disable the button visually
        button.setFillStyle(0x888888);
        buttonLabel.setStyle({ fill: '#666666' });
        button.disableInteractive();
        scene.game.canvas.style.cursor = 'default';
        
        // Small delay to prevent rapid clicking issues
        setTimeout(() => {
          startCallback();
        }, 100);
      }
    });
  }
}

// Create a summary-style icon (similar to the summary bar)
function createSummaryStyleIcon(scene, stageType, nextStage, zoneColor, zoneIndex, secondaryMessage = null) {
  
    
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
    

    
    // Create dimensions for the icon
    const iconWidth = 140;
    const iconHeight = 200; // Increased from 160 to prevent overlap with name
    const borderThickness = 10;
    
    // Create a container at the center of the screen
    const container = scene.add.container(scene.sys.game.config.width / 2, 340); // Moved down to avoid overlap with text
    
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
        if (nextStage.demonstrator && nextStage.demonstrator.demonstrator_global_index !== undefined) {
            // Create a unique key for this demonstrator that includes session info
            const demoSessionIndex = nextStage.demonstrator.demonstrator_session_index || 0;
            const sessionIndex = nextStage.session_index || 0;
            const gameIndex = nextStage.game_index || 0;
            playerImageKey = `overlay_demo_s${sessionIndex}_g${gameIndex}_${demoSessionIndex}`;
            
            // Get the mapped demonstrator image
            const mappedDemonstratorImage = mapDemonstratorImage(nextStage.demonstrator.demonstrator_global_index, nextStage.demonstrator.demonstrator_style, nextStage.demonstrator.demonstrator_color);
      
            
            scene.load.image(playerImageKey, `assets/demonstrators/${mappedDemonstratorImage}`);
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
            font: '40px Arial', 
            fill: '#ffffff',
            align: 'center' 
        }
    ).setOrigin(0.5);
    container.add(zoneText);
    
    // Add secondary message below the zone text if it exists
    if (secondaryMessage) {
        const secondaryText = scene.add.text(
            0,
            iconHeight/2 + 80,
            secondaryMessage,
            { 
                font: '24px Arial', 
                fill: '#ffffff',
                align: 'center',
                wordWrap: { width: 600 }
            }
        ).setOrigin(0.5);
        container.add(secondaryText);
    }
    
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
        
        // Add name text below the player image if available
        let nameText = '';
        if (stageType === 'practice' || stageType === 'play' || stageType === 'blind') {
            nameText = 'Prospector One';
        } else if ((stageType === 'watch' || stageType === 'indicate') && 
                   nextStage.demonstrator && nextStage.demonstrator.demonstrator_name) {
            nameText = nextStage.demonstrator.demonstrator_name;
        }
        
        if (nameText) {
            const nameLabel = scene.add.text(
                0,
                30, // Position below the image
                nameText,
                { 
                    font: 'bold 14px Arial', 
                    fill: '#ffffff',
                    align: 'center',
                    stroke: '#000000',
                    strokeThickness: 2
                }
            ).setOrigin(0.5);
            container.add(nameLabel);
        }
    }
  }
  
  // Special function to create the choice zone icon
  function createChoiceZoneIcon(scene, zoneColor) {

    
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
    
    
    
    // Create dimensions for the icon (wider for "Choice Zone" text)
    const iconWidth = 240; // Increased to fit "Choice Zone" text comfortably
    const iconHeight = 200; // Increased from 160 to prevent overlap with name
    const borderThickness = 10;
    
    // Create a container at the center of the screen
    const container = scene.add.container(scene.sys.game.config.width / 2, 340); // Moved down to avoid overlap with text
    
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
            { font: '40px Arial', fill: '#ffffff' }
        ).setOrigin(0.5);
        container.add(zoneText);
    }
  }
  
// Special function for online-choice zone icon
function createOnlineChoiceZoneIcon(scene, zoneColor, zoneIndex) {

    
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
    
    
    
    // Create dimensions for the icon
    const iconWidth = 140;
    const iconHeight = 200; // Increased from 160 to prevent overlap with name
    const borderThickness = 10;
    
    // Create a container at the center of the screen
    const container = scene.add.container(scene.sys.game.config.width / 2, 340); // Moved down to avoid overlap with text
    
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
            { font: '40px Arial', fill: '#ffffff' }
        ).setOrigin(0.5);
        container.add(zoneText);
    }
  }

function getMappedAsteroidImage(index) {
  const imageName = asteroidImageMapping[index];
  if (!imageName) {
    console.warn(`No asteroid image mapped for index ${index}, using default`);
    return `asteroid_${index.toString().padStart(2, '0')}.png`;
  }
  return imageName;
}
