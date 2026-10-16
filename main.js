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
let prolificStudyID = null;       // STUDY_ID from the Prolific URL, if present
let prolificSessionID = null;     // SESSION_ID from the Prolific URL, if present

// We'll store summary icons (one per "game" stage).
let summaryIcons = [];
let summaryCurrentDone = false; // true once the participant clicks Next on the game the last summary icon stands for (icon dims)

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
let partnerRowOrder = null; // shuffled once per page load; see showPartnerRow()

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
let totalRewardScope = 'per_session'; // 'per_session' | 'across_sessions' (from config)
let reportPlayRewardsBetweenRounds = false; // Config flag for inter-round recap stage
let currentGameStep = 0; // Reset for each game
let sessionTotals = {}; // { [sessionIndex]: number } — current session live, completed sessions frozen
let roundPlayRewards = {}; // { [roundIndex]: { zone, rewards: number[] } } — per-play-game rewards within a round
let totalRewardShownThisSession = false; // Once true, the total reward display stays visible until session reset
let rewardBreakdownDisplay = 'none'; // 'none' | 'per_game' (from config) — reward ledger under the summary bar
let ledgerSessions = []; // sessions (expeditions) that have started, in order — rows exist before their first play game
let playGames = {}; // "s{session}:g{game_index}" -> { session, zone, gameIndex, kind, label, shots, outcomes: [] }, insertion-ordered
let ledgerLiveKey = null; // key of the game in progress (bright ledger box); cleared when the participant clicks Next
let currentGameReward = 0; // Reset for each game
let refreshCount = parseInt(localStorage.getItem('refreshCount') || '0', 10);

let currentGameSequence = ""; // Track sequence of games in session as string
let currentGameType = null;
let currentShotsRemaining = 0;
let currentPosition = 0;

// Choice-specific logging variables
let choiceDemonstratorId = null; // Will store the demonstrator_id of chosen demonstrator
let choiceDemonstratorIndex = null; // 0 = demo-1, 1 = demo-2 — replaces the old "expert"/"novice" type
let choiceDemonstratorData = null; // Will store the full demonstrator data object

// Look up a demonstrator's prior_experience (Thompson warmup iterations) from
// its slot index. Replaces the old `demonstratorType === 'expert' ? expert_exp : novice_exp` pattern.
function getDemoPriorExperience(demoData, demonstratorConfig) {
  if (!demoData || !demonstratorConfig) return 0;
  const idx = (typeof demoData.demonstrator_index === 'number')
    ? demoData.demonstrator_index
    : demoData.demonstrator_session_index;  // fallback
  return idx === 0
    ? demonstratorConfig.demo_1_prior_experience
    : demonstratorConfig.demo_2_prior_experience;
}

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

/*****************************************
 * Per-zone demonstrator runs
 * Both partners' runs for a zone are drawn together the first time either is
 * watched, so a config filter (demonstrator_config.demonstrator_filter) can
 * constrain the PAIR: 'expert_gt_novice' (expert's realized reward strictly
 * higher) or 'expert_policy_gt_novice' (expert's chosen arms have a strictly
 * higher true-payoff sum, so any novice win is reward noise, not a better policy).
 * Each slot keeps its own sampler, so the warmup + shown history logged on
 * trajectory_complete is exactly what it was when runs were drawn per stage.
 ****************************************/
let zoneDemoTrajectories = {}; // "s{session}:z{zone}" -> { 0: run, 1: run, filter, attempts, satisfied }

function drawDemoRun(payoffs, warmup, numPulls) {
  const sampler = new ThompsonSampler(payoffs.length, payoffs);
  for (let i = 0; i < warmup; i++) sampler.step();
  const trajectory = [];
  const rewards = [];
  for (let i = 0; i < numPulls; i++) {
    const step = sampler.step();
    trajectory.push(step.arm);
    rewards.push(step.reward);
  }
  return { sampler, trajectory, rewards };
}

function demoPairPassesFilter(filter, runs, payoffs) {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  // Expected value of a run: sum of the TRUE payoffs of the arms chosen (ignores reward noise).
  const ev = (arms) => arms.reduce((s, arm) => s + payoffs[arm], 0);
  if (filter === 'expert_gt_novice') return sum(runs[0].rewards) > sum(runs[1].rewards);
  if (filter === 'expert_policy_gt_novice') return ev(runs[0].trajectory) > ev(runs[1].trajectory);
  return true; // 'none' (or an unknown value, which the server never sends)
}

// Returns { sampler, trajectory, rewards, filter, attempts, satisfied } for one slot.
function getZoneDemoTrajectory(stage, demoIdx, payoffs, numPulls) {
  const key = `s${stage.session_index}:z${stage.zone.zone_global_index}`;
  if (!zoneDemoTrajectories[key]) {
    const cfg = demonstratorConfig || {};
    const filter = cfg.demonstrator_filter || 'none';
    const maxAttempts = Math.max(1, cfg.demonstrator_filter_max_attempts || 200);
    const warmups = [cfg.demo_1_prior_experience || 0, cfg.demo_2_prior_experience || 0];
    let runs = null;
    let attempts = 0;
    let satisfied = false;
    while (attempts < maxAttempts && !satisfied) {
      runs = [drawDemoRun(payoffs, warmups[0], numPulls), drawDemoRun(payoffs, warmups[1], numPulls)];
      attempts++;
      satisfied = demoPairPassesFilter(filter, runs, payoffs);
    }
    zoneDemoTrajectories[key] = { 0: runs[0], 1: runs[1], filter, attempts, satisfied };
    verboseLog(`Zone ${stage.zone.zone_global_index}: demonstrator pair drawn in ${attempts} attempt(s); filter=${filter}, satisfied=${satisfied}`);
  }
  const entry = zoneDemoTrajectories[key];
  return { ...entry[demoIdx], filter: entry.filter, attempts: entry.attempts, satisfied: entry.satisfied };
}

// Screen order of the two partner slots on the presentation and choice screens:
// order[i] is the slot (0 = demo-1, 1 = demo-2) drawn in cell i. Generated per
// session in models.py so slot 0 is not always "Partner A" / the left cell.
function displayOrderOf(stage) {
  const o = stage && stage.display_order;
  return (Array.isArray(o) && o.length === 2 && o.includes(0) && o.includes(1)) ? o : [0, 1];
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
    totalRewardScope = config.total_reward_scope || 'per_session';
    reportPlayRewardsBetweenRounds = config.report_play_rewards_between_rounds || false;
    rewardBreakdownDisplay = config.reward_breakdown_display || 'none';
    demonstratorConfig = config.demonstrator_config || null;

    verboseLog('Demonstrator config:', demonstratorConfig);
  } catch (error) {
    console.error('Error fetching experiment config:', error);
    experimentID = 'unknown'; // fallback
    experimentConfigPath = 'data/timeline.json'; // fallback
    displayRunningTotalReward = false; // fallback
    totalRewardScope = 'per_session';
    reportPlayRewardsBetweenRounds = false;
  }
}

// Returns the running total reward, scoped per the active config:
//   per_session     → just the current session's tally
//   across_sessions → sum across every session's tally
function getUserTotalReward() {
  if (totalRewardScope === 'across_sessions') {
    return Object.values(sessionTotals).reduce((a, b) => a + b, 0);
  }
  return sessionTotals[currentSessionIndex] || 0;
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
    user_total_reward: getUserTotalReward(),
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
    demonstrator_index: stage.demonstrator ? stage.demonstrator.demonstrator_index :
                       (stage.demonstrator1 && window.onlineChoiceSelectedDemo ?
                        window.onlineChoiceSelectedDemo.data.demonstrator_index : null),
    demonstrator_global_index: stage.demonstrator ? stage.demonstrator.demonstrator_global_index :
                               (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? 
                               window.onlineChoiceSelectedDemo.data.demonstrator_global_index : null),
    demonstrator_id: stage.demonstrator ? mapDemonstratorImage(stage.demonstrator.demonstrator_global_index, stage.demonstrator.demonstrator_style, stage.demonstrator.demonstrator_color) :
                    (stage.demonstrator1 && window.onlineChoiceSelectedDemo ? 
                     mapDemonstratorImage(window.onlineChoiceSelectedDemo.data.demonstrator_global_index, window.onlineChoiceSelectedDemo.data.demonstrator_style, window.onlineChoiceSelectedDemo.data.demonstrator_color) : null),
    
    // Demonstrator trajectory data (unified for both inline and file modes)
    demonstrator_actions: additionalData.demonstrator_actions || null,
    demonstrator_rewards: additionalData.demonstrator_rewards || null,
    
    // Demonstrator configuration metadata
    demonstrator_source: additionalData.demonstrator_source || null,
    demonstrator_experience: additionalData.demonstrator_experience || null,
    demonstrator_strategy: additionalData.demonstrator_strategy || null,
    demonstrator_bandit_payoffs: additionalData.demonstrator_bandit_payoffs || null,
    
    // User play trajectory data
    play_actions: additionalData.play_actions || null,
    play_rewards: additionalData.play_rewards || null,
    
    zone_global_index: stage.zone ? stage.zone.zone_global_index : 0,
    zone_color: stage.zone ? generateZoneColor(stage.zone.zone_global_index) : null,
    zone_background: stage.zone ? mapZoneBackground(stage.zone.zone_global_index) : null,
    zone_bandit: stage.zone ? (() => {
      const bandit = stage.zone.zone_bandit || stage.zone.bandit || [];
      return Array.isArray(bandit) ? JSON.stringify(bandit.flat()) : null;
    })() : null,
    zone_bandit_id: stage.zone ? (stage.zone.bandit_id || null) : null,
    zone_bandit_arm_image_ids: stage.zone && stage.zone.zone_bandit_arm_image_indexes ? 
                               (() => {
                                 const images = mapZoneBanditArmImages(stage.zone.zone_global_index, stage.zone.zone_bandit_arm_image_indexes);
                                 return Array.isArray(images) ? JSON.stringify(images) : null;
                               })() : null,
    choice_demonstrator_id: choiceDemonstratorId,
    choice_demonstrator_index: choiceDemonstratorIndex,
    refresh_count: refreshCount,
    experiment_id: experimentID,
    prolific_study_id: prolificStudyID,
    prolific_session_id: prolificSessionID,
    ...additionalData
  };

  return enqueueLog(logData);
}

/*****************************************
 * Log queue
 * Rows are sent one at a time, in order. A failed POST (network error, 5xx) is
 * retried with exponential backoff instead of being dropped, so a brief Atlas or
 * Cloud Run hiccup doesn't silently lose actions. The end-of-game screen waits for
 * the queue to drain before offering the Prolific link.
 ****************************************/
const LOG_QUEUE = [];           // { data, resolve, reject, attempts }
const LOG_MAX_ATTEMPTS = 5;     // retries per row before it is given up on
const LOG_BACKOFF_MIN_MS = 500;
const LOG_BACKOFF_MAX_MS = 4000;
let logQueueBusy = false;
let logBackoffMs = LOG_BACKOFF_MIN_MS; // current delay; grows on failure, resets on success
let logDeadLetters = 0;         // rows that exhausted their retries (never expected)

function enqueueLog(data) {
  const p = new Promise((resolve, reject) => {
    LOG_QUEUE.push({ data, resolve, reject, attempts: 0 });
    flushLogQueue();
  });
  // Most callers fire-and-forget; mark the rejection handled so a given-up row
  // doesn't surface as an unhandled rejection. Callers that await still see it.
  p.catch(() => {});
  return p;
}

async function flushLogQueue() {
  if (logQueueBusy) return;
  logQueueBusy = true;
  try {
    while (LOG_QUEUE.length > 0) {
      const item = LOG_QUEUE[0];
      let ok = false;
      let detail = '';
      try {
        const response = await fetch('api/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.data),
          keepalive: true
        });
        ok = response.ok;
        detail = `${response.status} ${response.statusText}`;
        // 4xx means the row itself is rejected (schema/validation) — retrying won't help.
        if (!ok && response.status >= 400 && response.status < 500) item.attempts = LOG_MAX_ATTEMPTS;
      } catch (error) {
        detail = String(error);
      }

      if (ok) {
        LOG_QUEUE.shift();
        logBackoffMs = LOG_BACKOFF_MIN_MS;
        item.resolve(true);
        continue;
      }

      item.attempts++;
      if (item.attempts >= LOG_MAX_ATTEMPTS) {
        // Give up on this row but keep the current backoff for the next one, so a
        // dead server doesn't make every queued row start its retries from scratch.
        console.error('Giving up on log row after repeated failures:', detail, item.data.action);
        LOG_QUEUE.shift();
        logDeadLetters++;
        item.reject(new Error(`log failed: ${detail}`));
        continue;
      }
      console.warn(`Log POST failed (${detail}); retrying in ${logBackoffMs}ms`);
      await new Promise(r => setTimeout(r, logBackoffMs));
      logBackoffMs = Math.min(logBackoffMs * 2, LOG_BACKOFF_MAX_MS);
    }
  } finally {
    logQueueBusy = false;
  }
}

// Resolves when every queued row has been sent (or given up on), or after timeoutMs.
function drainLogQueue(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise(resolve => {
    const check = () => {
      if (LOG_QUEUE.length === 0 && !logQueueBusy) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}

// Function to log page refresh. Uses sendBeacon so the request survives unload.
function logPageRefresh() {
  refreshCount++;
  localStorage.setItem('refreshCount', refreshCount.toString());
  const payload = JSON.stringify({
    prolific_id: prolificID,
    uid: userUID,
    session_id: sessionID
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('api/log-refresh', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('api/log-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      });
    }
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
        // Tag the watch by which demo slot it's for (0/1)
        const demoIdx = (typeof stage.demonstrator_index === 'number')
          ? stage.demonstrator_index
          : stage.demonstrator?.demonstrator_index;
        sequenceParts.push(typeof demoIdx === 'number' ? `watch-demo-${demoIdx + 1}` : 'watch');
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
    choiceDemonstratorIndex = null;
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
const TANK_MARGIN_TOP = 158;       // Space between grid bottom and tank (ship + name sit in between)
const GRID_TOP_Y = 200;            // Top edge of the asteroid grid (pips + underline sit above it)
const BULLET_FLIGHT_MS = 150;      // Bullet travel time from ship to asteroid before the outcome shows
const CELL_PADDING = 10;           // Spacing between cells (in pixels)
const BASE_CELL_SIZE = (400 / 12) * 1.85; // ~85% larger than before
const WATCH_START_DELAY = 500;     // Delay before starting watch demonstrations (ms)

// Outcome tally pips drawn above each asteroid (one per pull on that cell).
const PIP_RADIUS = 6;
const PIP_SPACING = 14;
const OUTCOME_TRACK_OFFSET = 8;  // thin line this far above each asteroid row; pips sit above it
let outcomePips = {};              // "row,col" -> { hit, miss } pips drawn so far (reset per stage)
// zone_global_index of the last stage that drew the asteroid grid. The transition
// slide compares the next stage against it to decide whether the zone changes
// (blackout slide) or stays (in-place slide, see showInPlaceTransition).
let lastGridZone = null;

// Logical game size. The canvas is created at GAME_W*DPR × GAME_H*DPR and the main
// camera is zoomed by DPR, so every coordinate in this file stays in 1000×600 space
// while text and sprites render at device resolution (Phaser ignores devicePixelRatio).
const GAME_W = 1000;
const GAME_H = 600;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

// All canvas text goes through here so it rasterizes at device resolution.
function addText(scene, x, y, text, style = {}) {
  return scene.add.text(x, y, text, { resolution: DPR, ...style });
}

// Centered, word-wrapped paragraph in which given words (partner names) take their
// own color. Phaser text has no per-word color, so this lays the words out itself:
// greedy wrap at style.wordWrap.width, one text object per same-colored run.
// `highlights` is [{ name, color }]; a word matches when, after any leading
// punctuation, it starts with a name that is not followed by another letter
// ("Orion," "(Orion)" "Orion's"). Only the name itself is colored; attached
// punctuation keeps the paragraph color.
// `originY` works like setOrigin's y (0 = top at y, 0.5 = vertically centered).
function addRichText(scene, cx, y, text, style, highlights, originY = 0.5) {
  const base = { resolution: DPR, font: style.font, fill: style.fill };
  const wrapW = (style.wordWrap && style.wordWrap.width) || GAME_W;
  const lineSpacing = style.lineSpacing || 0;
  // Split one whitespace-delimited word into colored pieces: [{ text, color }].
  const pieces = (word) => {
    const lead = (word.match(/^[^\w]*/) || [''])[0];
    const rest = word.slice(lead.length);
    const h = highlights.find(x => x.name && rest.startsWith(x.name) && !/\w/.test(rest.charAt(x.name.length)));
    if (!h) return [{ text: word, color: style.fill }];
    const out = [];
    if (lead) out.push({ text: lead, color: style.fill });
    out.push({ text: h.name, color: h.color });
    const trail = rest.slice(h.name.length);
    if (trail) out.push({ text: trail, color: style.fill });
    return out;
  };
  const meter = scene.add.text(0, 0, '', base).setVisible(false);
  const measure = (s) => { meter.setText(s); return meter.width; };
  const spaceW = measure('a b') - measure('ab');
  const lineH = measure('Ag') ? meter.height : 0;

  // Wrap into lines of words (explicit newlines start new lines).
  const lines = [];
  text.split('\n').forEach(par => {
    let line = [], w = 0;
    par.split(/\s+/).filter(Boolean).forEach(word => {
      const ww = measure(word);
      if (line.length && w + spaceW + ww > wrapW) { lines.push(line); line = []; w = 0; }
      w += (line.length ? spaceW : 0) + ww;
      line.push(word);
    });
    lines.push(line);
  });
  meter.destroy();

  const totalH = lines.length * (lineH + lineSpacing) - lineSpacing;
  const y0 = y - totalH * originY;
  const objects = [];
  lines.forEach((line, li) => {
    // Flatten words into pieces (a space precedes each word but not the pieces
    // inside it), then merge consecutive same-colored pieces into runs.
    const runs = [];
    line.forEach((word, wi) => {
      pieces(word).forEach((pc, pi) => {
        const gap = wi > 0 && pi === 0;
        const last = runs[runs.length - 1];
        if (last && last.color === pc.color) last.text += (gap ? ' ' : '') + pc.text;
        else runs.push({ color: pc.color, text: pc.text, gap });
      });
    });
    const texts = runs.map(r => scene.add.text(0, 0, r.text, { ...base, fill: r.color }).setOrigin(0, 0));
    const lineW = texts.reduce((a, t, i) => a + t.width + (runs[i].gap ? spaceW : 0), 0);
    let x = cx - lineW / 2;
    texts.forEach((t, i) => {
      if (runs[i].gap) x += spaceW;
      t.setPosition(x, y0 + li * (lineH + lineSpacing));
      x += t.width;
    });
    objects.push(...texts);
  });
  return { objects, height: totalH, destroy: () => objects.forEach(o => o.destroy()) };
}

// [{ name, color }] for every partner a stage's copy may name: the demonstrators
// attached to it (watch: `demonstrator`; presentation/choice: `demonstrator1`/
// `demonstrator2`) plus every partner in the same session, because play copy names
// the partners watched in the zone without carrying their data.
function partnerHighlights(stage) {
  const sameSession = (timelineData || []).flatMap(flattenSession)
    .filter(s => s.session_index !== undefined && s.session_index === stage.session_index);
  const seen = new Set();
  return [stage, ...sameSession]
    .flatMap(s => [s.demonstrator, s.demonstrator1, s.demonstrator2])
    .filter(d => d && d.demonstrator_name && !seen.has(d.demonstrator_name) && seen.add(d.demonstrator_name))
    .map(d => ({ name: d.demonstrator_name, color: partnerColor(d) || THEME.text }));
}

// Visual theme shared by the Phaser scene; mirrors the CSS variables in index.html.
// NOTE: Phaser's `font` shorthand splits on spaces, so font family names must be
// single tokens (hence Inter / Orbitron, no fallback list).
const THEME = {
  fontBody: 'Inter',
  fontDisplay: 'Orbitron',
  text: '#f3f4f6',
  textMuted: '#9aa3b2',
  panel: 0x161a23,
  panelHex: '#161a23',
  accent: 0x3b82f6,
  accentHover: 0x2563eb,
  disabled: 0x4b5563,
  success: 0x22c55e,
  successHex: '#22c55e',
  fail: 0xef4444,
  slotEmpty: 0x2a3140,
  overlay: 0x05070c,
  neutralBorderHex: '#262c38'
};

// Partner (demonstrator) name colors, keyed by `demonstrator_color` — the same value
// that picks the ship PNG (assets/demonstrators/styles/*/<color>.png). Sampled from
// the ships' dominant hue and lightened slightly for legibility on the dark theme.
// Used wherever a partner's name stands alone as a label (names inside sentences
// stay in the regular text color).
const PARTNER_COLORS = {
  red: '#f04a3e',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#3b9ff5',
  purple: '#b073ec'
};
function partnerColor(demo) {
  return (demo && PARTNER_COLORS[demo.demonstrator_color]) || null;
}

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
    
    // Fetch all asset listings in one round-trip instead of probing each filename.
    // Falls back to the old per-file discovery if the manifest endpoint isn't available
    // (e.g. running against an older server build).
    let manifest = null;
    try {
      const resp = await fetch('api/asset-manifest');
      if (resp.ok) manifest = await resp.json();
    } catch (e) {
      console.warn('asset-manifest fetch failed, falling back to discovery:', e);
    }

    const landscapeImages = manifest?.landscapes
      ?? await discoverAvailableImages('assets/landscapes', 'landscape_', '.png');
    if (landscapeImages.length > 0) {
      landscapeImageMapping = createRandomMapping(landscapeImages);
    } else {
      console.warn('No landscape images found, using minimal fallback');
      landscapeImageMapping = { 0: 'landscape_00.png' };
    }

    const zoneBackgroundImages = manifest?.zone_backgrounds
      ?? await discoverAvailableImages('assets/zone_backgrounds', 'zone_', '.png');
    if (zoneBackgroundImages.length > 0) {
      zoneBackgroundImageMapping = createRandomMapping(zoneBackgroundImages);
    } else {
      console.warn('No zone background images found, using minimal fallback');
      zoneBackgroundImageMapping = { 0: 'zone_00.png' };
    }

    const asteroidImages = manifest?.asteroids
      ?? await discoverAvailableImages('assets/asteroids', 'asteroid_', '.png');
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

// Hue band reserved for the reward green (THEME.success, hue ≈142): no zone border,
// summary cell or ledger box may look like "reward". Zone hues that would fall in it
// are skipped, so the sequence stays golden-angle separated without that green.
const ZONE_HUE_EXCLUDED = [95, 170];

// Hue of the n-th zone: the n-th golden-angle hue (k * 137.5° mod 360) outside the
// excluded band. Zone 0 (practice) stays red; zones 1.. become purple, yellow, cyan,
// pink, blue, orange, … Virtual choice zones (1000+) walk the same sequence.
function zoneHue(zoneGlobalIndex) {
  let accepted = -1;
  for (let k = 0; ; k++) {
    const hue = (k * 137.5) % 360;
    if (hue >= ZONE_HUE_EXCLUDED[0] && hue <= ZONE_HUE_EXCLUDED[1]) continue;
    accepted++;
    if (accepted === zoneGlobalIndex) return hue;
  }
}

// Generate unique zone color for each zone
function generateZoneColor(zoneGlobalIndex) {
  if (zoneColorMapping[zoneGlobalIndex]) {
    return zoneColorMapping[zoneGlobalIndex];
  }
  
  // Generate HSV colors with good separation
  const hue = zoneHue(zoneGlobalIndex);
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
  width: GAME_W * DPR,
  height: GAME_H * DPR,
  parent: 'game-container',
  backgroundColor: '#000000',
  // Keep 1000×600 game coordinates; scale the canvas to fit #game-container so the
  // page fits smaller laptop screens without scrolling.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
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

// Wait for the web fonts so Phaser doesn't bake a fallback font into canvas text.
// Resolves regardless of outcome (fallback fonts are acceptable).
function waitForFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load(`700 20px ${THEME.fontDisplay}`),
    document.fonts.load(`400 16px ${THEME.fontBody}`),
    document.fonts.load(`700 16px ${THEME.fontBody}`)
  ]).catch(() => {});
}

function create() {
  // Space and arrow keys are also browser scroll keys; keep them from scrolling the page.
  const KC = Phaser.Input.Keyboard.KeyCodes;
  this.input.keyboard.addCapture([KC.SPACE, KC.LEFT, KC.RIGHT, KC.UP, KC.DOWN]);

  // Device-resolution rendering: see GAME_W/GAME_H/DPR above.
  this.cameras.main.setZoom(DPR).centerOn(GAME_W / 2, GAME_H / 2);

  // Fonts → experiment config → image mappings → fresh timeline → first stage
  waitForFonts()
    .then(() => fetchExperimentConfig())
    .then(() => initializeImageMappings())
    .then(() => fetch('api/timeline'))
    .then(r => {
      if (!r.ok) {
        throw new Error(`Timeline generation failed: ${r.status} ${r.statusText}`);
      }
      return r.json();
    })
    .then(jsonData => {
      timelineData = jsonData;
      setLedgerRowHeight();
      loadStage.call(this);
    })
    .catch(err => {
      console.error("Error generating/loading timeline:", err);
      addText(this, 
        GAME_W / 2,
        GAME_H / 2,
        "Sorry, the game could not be loaded.\nPlease refresh the page, and contact the researcher if this keeps happening.",
        { font: `18px ${THEME.fontBody}`, fill: THEME.text, align: 'center', wordWrap: { width: 700 } }
      ).setOrigin(0.5);
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

  // If the just-finished stage was a play game, capture its final reward BEFORE any
  // early-return path or resetGameTracking clobbers currentGameReward. Two consumers:
  //   1. The "+X" annotation under that play game's icon in the summary bar.
  //   2. roundPlayRewards (only when reportPlayRewardsBetweenRounds is on).
  // Putting this at the very top covers the last-play-game-before-end-of-game case.
  capturePreviousPlayReward();

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

  clearScene(this);
  outcomePips = {};
  restoreGameFrame(); // DOM pages (Prolific form, intro, how to play) hide the frame; they re-hide it in their setup

  const stage = currentStageContainer[effectiveStageIndex];

  // Store the current stage for reference in other functions if needed
  window.currentStage = stage;
  if (stage.zone && ['practice', 'play', 'watch', 'indicate', 'blind'].includes(stage.stage_type || stage.game)) {
    lastGridZone = stage.zone.zone_global_index;
  }
  ledgerLiveKey = null; // re-set by ledgerGameStarted below if this stage is a play/watch game

  // Initialize logging for gameplay stages
  const gameType = stage.stage_type || stage.game;
  if (['practice', 'play', 'watch', 'indicate', 'blind', 'choice', 'online-choice'].includes(gameType)) {
    // Initialize game sequence tracking if this is the first game in a session
    if (currentStageIndex === 0 || lastSessionIndex !== currentSessionIndex) {
      initializeGameSequence();
      lastSessionIndex = currentSessionIndex;

      // Session-boundary init that used to live only in the demonstrator_presentation
      // handler. Fires regardless of whether the session opens with a presentation,
      // so all-play sessions also get a fresh totals bucket, the sticky display flag,
      // and a clean per-round-play-reward map. round_index is reused across sessions
      // (0..num_rounds-1), so wiping prevents a later round_recap from picking up
      // plays from a prior session's same round_index.
      if (currentSessionIndex >= 1) {
        if (!(currentSessionIndex in sessionTotals)) {
          sessionTotals[currentSessionIndex] = 0;
        }
        if (displayRunningTotalReward) {
          totalRewardShownThisSession = true;
        }
        roundPlayRewards = {};
        ledgerSessionStarted(currentSessionIndex);
      }
    }

    // Reset game tracking for new game
    const numArmPulls = stage.num_arm_pulls || 0;
    resetGameTracking(gameType, numArmPulls);
    if (gameType === 'play' || gameType === 'watch') ledgerGameStarted(stage);
  }

  // demonstrator_presentation isn't in the gameplay-stage list above, so it doesn't
  // flow through the session-boundary init block. Mirror that init here so the running
  // total appears during the presentation itself for sessions that open with one.
  if (gameType === 'demonstrator_presentation') {
    if (!(currentSessionIndex in sessionTotals)) {
      sessionTotals[currentSessionIndex] = 0;
    }
    if (displayRunningTotalReward) {
      totalRewardShownThisSession = true;
    }
    roundPlayRewards = {};
    ledgerSessionStarted(currentSessionIndex);
  }

  updateTotalRewardDisplay();

  // Possibly add an icon for summary
  maybeAddSummaryIcon(stage);

  // Zone stages get the zone color on the game container border; stages without a
  // zone (forms, intro, partner presentation) get a neutral border so the previous
  // zone's color doesn't linger.
  setGameBorderColor(stage.zone ? generateZoneColor(stage.zone.zone_global_index) : THEME.neutralBorderHex);

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
    case 'round_recap':
      setupRoundRecap.call(this, stage);
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
      color: stage.zone && stage.zone.color ? stage.zone.color : '#888888',
      gameType: stageType,
      session_index: stage.session_index,
      round_index: stage.round_index
    });
      return;
    }

  // For online-choice games, add an icon that will be updated when user makes choice
  if (stageType === 'online-choice') {
    // Add a placeholder icon that will be updated when user selects demonstrator
    summaryIcons.push({
      imageKey: null, // Will be updated when user selects
      zone: stage.zone && stage.zone.zone_global_index ? stage.zone.zone_global_index : 0,
      color: stage.zone && stage.zone.zone_global_index ? generateZoneColor(stage.zone.zone_global_index) : '#888888',
      gameType: stageType,
      session_index: stage.session_index,
      round_index: stage.round_index
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
    iconName = 'Prospector';
  }

  // Add the icon with proper imageKey - generate zone color
  const zoneColorValue = generateZoneColor(stage.zone.zone_global_index);
  
  const iconData = {
    imageKey: imageKey,
    zone: stage.zone.zone_global_index,
    zone_color: zoneColorValue,
    color: zoneColorValue, // Keep color for backward compatibility
    nameColor: partnerColor(stage.demonstrator), // null for the player's own games
    gameType: stageType,
    session_index: stage.session_index,
    round_index: stage.round_index
  };
  
  // Add name if available
  if (iconName) {
    iconData.name = iconName;
  }
  
  summaryIcons.push(iconData);
  summaryCurrentDone = false;
}

// Tag the current play stage's summary icon with its final reward (drives the "+X"
// label) and, if the recap flag is on, append the reward to roundPlayRewards so a
// later round_recap stage can render the per-play-game breakdown. Idempotent —
// the most-recent-unrewarded-icon walk skips already-tagged icons, so it's safe to
// call this both eagerly (when the last shot resolves) and as a top-of-loadStage
// fallback. No-op for any non-play stage.
function capturePreviousPlayReward() {
  const previousStage = window.currentStage;
  if (!previousStage || previousStage.game !== 'play') return;

  // Walk from the end so back-to-back play stages each get their own annotation
  // rather than overwriting one. Both the icon-tag and the recap-push live in the
  // same iteration so the recap doesn't get a duplicate entry on a second call.
  for (let i = summaryIcons.length - 1; i >= 0; i--) {
    if (summaryIcons[i].gameType === 'play' && summaryIcons[i].reward_earned === undefined) {
      summaryIcons[i].reward_earned = currentGameReward;
      redrawSummaryBarDOM();
      if (reportPlayRewardsBetweenRounds) {
        const roundIdx = previousStage.round_index;
        if (typeof roundIdx === 'number') {
          if (!roundPlayRewards[roundIdx]) {
            roundPlayRewards[roundIdx] = {
              zone: previousStage.zone ? previousStage.zone.zone_global_index : null,
              rewards: []
            };
          }
          roundPlayRewards[roundIdx].rewards.push(currentGameReward);
        }
      }
      return;
    }
  }
}

function setGameBorderColor(color) {
  const frame = document.getElementById('game-frame');
  if (frame) frame.style.borderColor = color;
}

function updateTotalRewardDisplay() {
  const el = document.getElementById('total-reward-display');
  if (!el) return;
  // Toggle visibility (not display) so the row keeps its height and the canvas
  // doesn't jump between stages.
  if (!displayRunningTotalReward || !totalRewardShownThisSession) {
    el.style.visibility = 'hidden';
    return;
  }
  // Live in-game display is single-line in both modes:
  //   per_session     → just the current session's tally
  //   across_sessions → the running sum across every session
  // (End-of-game screen still renders the per-session breakdown in per_session mode.)
  const value = getUserTotalReward();
  el.innerHTML = '';
  if (rewardBreakdownDisplay === 'per_game') {
    el.appendChild(buildRewardLedgerDOM());
  } else {
    el.appendChild(document.createTextNode(`TOTAL REWARD: ${value}`));
    const bonus = buildBonusLineDOM(value);
    if (bonus) el.appendChild(bonus);
  }
  el.style.visibility = 'visible';
}

// bonus_per_reward from the YAML (via /api/config); null hides every bonus line.
function bonusRate() {
  return gameConfig && typeof gameConfig.bonus_per_reward === 'number' ? gameConfig.bonus_per_reward : null;
}

function bonusMoney(v) {
  const cur = (gameConfig && gameConfig.bonus_currency) || '$';
  return `${cur}${v.toFixed(2)}`;
}

// "Bonus $0.52" under the running total, so participants can glance at what the
// total is worth. Returns null when no bonus rate is configured.
function buildBonusLineDOM(totalReward) {
  const rate = bonusRate();
  if (rate === null) return null;
  const d = document.createElement('div');
  d.className = 'ledger-bonus';
  d.textContent = `Bonus ${bonusMoney(totalReward * rate)}`;
  return d;
}

/*****************************************
 * Reward ledger (reward_breakdown_display: per_game)
 * One row per expedition (session), one box per play or watch game, outlined in
 * the game's zone color. Play boxes are mini Reward Tanks (one slot per shot,
 * filled green per reward earned); watch boxes are same-size placeholders showing
 * the watched partner's name, so every expedition's boxes line up. A box appears
 * when its game starts. Only the current game's box is bright; the EXPEDITION
 * caption dims once the expedition is over.
 ****************************************/
function flattenSession(session) {
  return Array.isArray(session[0]) ? session.flat() : session;
}

function ledgerKey(stage) {
  return `s${stage.session_index}:g${stage.game_index}`;
}

function ledgerSessionStarted(sessionIndex) {
  if (sessionIndex < 1 || ledgerSessions.includes(sessionIndex)) return;
  ledgerSessions.push(sessionIndex);
}

function ledgerGameStarted(stage) {
  if (!stage || !stage.zone || stage.session_index < 1) return;
  const key = ledgerKey(stage);
  if (!playGames[key]) {
    const demoName = stage.demonstrator && stage.demonstrator.demonstrator_name;
    playGames[key] = {
      session: stage.session_index,
      zone: stage.zone.zone_global_index,
      gameIndex: stage.game_index,
      kind: stage.game,
      label: stage.game === 'watch' ? (demoName || 'WATCH') : null,
      labelColor: stage.game === 'watch' ? partnerColor(stage.demonstrator) : null,
      shots: stage.num_arm_pulls || 0,
      outcomes: []
    };
  } else {
    playGames[key].outcomes = [];
  }
  ledgerLiveKey = key;
}

// The box whose game is in progress: bright from the moment the game starts until
// the participant clicks Next (nextStage clears the key before any transition slide).
function ledgerIsCurrent(g) {
  return ledgerLiveKey === `s${g.session}:g${g.gameIndex}`;
}

function ledgerRecordShot(outcome) {
  const stage = window.currentStage;
  if (!stage || stage.game !== 'play') return;
  const g = playGames[ledgerKey(stage)];
  if (!g) return;
  g.outcomes.push(outcome);
  updateTotalRewardDisplay();
}

// Number of expeditions that contain a play or watch game — fixes the ledger's height up front.
function ledgerSessionCount() {
  if (!timelineData) return 0;
  let n = 0;
  for (let i = 1; i < timelineData.length; i++) {
    if (flattenSession(timelineData[i]).some(st => st.game === 'play' || st.game === 'watch')) n++;
  }
  return n;
}

// Reserve the reward row's final height before the first stage renders so the
// canvas never moves when rows appear. #game-frame's fit formula reads the same var.
function setLedgerRowHeight() {
  let h = 60;
  if (rewardBreakdownDisplay === 'per_game') h = ledgerSessionCount() * 38 + 64; // 34px .ledger-row + 4px gap
  if (bonusRate() !== null) h += 18; // .ledger-bonus line under the total
  document.documentElement.style.setProperty('--reward-rows-h', `${h}px`);
}

// [{ session, subtotal, dimmed, groups: [{ zone, color, games: [...] }] }] in play order.
function ledgerRows(dimPrevious) {
  const rows = ledgerSessions.map(si => ({ session: si, subtotal: sessionTotals[si] || 0, dimmed: false, groups: [] }));
  Object.values(playGames).forEach(g => {
    let row = rows.find(r => r.session === g.session);
    if (!row) {
      row = { session: g.session, subtotal: sessionTotals[g.session] || 0, dimmed: false, groups: [] };
      rows.push(row);
    }
    let grp = row.groups[row.groups.length - 1];
    if (!grp || grp.zone !== g.zone) {
      grp = { zone: g.zone, color: generateZoneColor(g.zone), games: [] };
      row.groups.push(grp);
    }
    grp.games.push(g);
  });
  rows.forEach(r => { r.dimmed = dimPrevious && r.session !== currentSessionIndex; });
  return rows;
}

function buildRewardLedgerDOM() {
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
  const wrap = mk('ledger');
  ledgerRows(true).forEach(row => {
    const r = mk('ledger-row');
    const cap = mk('ledger-cap' + (row.dimmed ? ' dimmed' : ''));
    cap.textContent = `EXPEDITION ${row.session}`;
    r.appendChild(cap);
    row.groups.forEach(grp => {
      const z = mk('ledger-zone');
      const boxes = mk('ledger-zone-boxes');
      grp.games.forEach(g => {
        const box = mk('ledger-box ' + g.kind + (ledgerIsCurrent(g) ? ' active' : ' dimmed'));
        box.style.borderColor = grp.color;
        if (g.kind === 'watch') {
          // Same outer size as a play box with the same shot count (8px slots + 1px gaps).
          box.style.width = `${g.shots * 9 - 1}px`;
          box.textContent = g.label;
          if (g.labelColor) box.style.color = g.labelColor;
          box.title = `Zone ${grp.zone}: watched ${g.label}`;
        } else {
          const earned = g.outcomes.reduce((a, b) => a + b, 0);
          box.title = `Zone ${grp.zone}: ${earned} / ${g.shots}`;
          for (let i = 0; i < g.shots; i++) {
            const cls = g.outcomes[i] === 1 ? ' hit' : (g.outcomes[i] === 0 ? ' miss' : '');
            box.appendChild(mk('ledger-slot' + cls));
          }
        }
        boxes.appendChild(box);
      });
      z.appendChild(boxes);
      const label = mk('ledger-zone-label' + (row.dimmed ? ' dimmed' : ''));
      label.textContent = `ZONE ${grp.zone}`;
      label.style.color = grp.color;
      z.appendChild(label);
      r.appendChild(z);
    });
    wrap.appendChild(r);
  });
  const total = mk('ledger-total');
  total.textContent = `TOTAL REWARD ${getUserTotalReward()}`;
  wrap.appendChild(total);
  const bonus = buildBonusLineDOM(getUserTotalReward());
  if (bonus) wrap.appendChild(bonus);
  return wrap;
}

// Canvas version for the end screen (larger, with zone labels). Returns height used.
function drawRewardLedgerCanvas(scene, cx, y) {
  const rows = ledgerRows(false);
  if (rows.length === 0) return 0;
  const slotW = 12, slotH = 18, slotGap = 2, pad = 3, border = 2;
  const boxGap = 6, zoneGap = 18, capW = 120, capGap = 14, labelH = 16;
  const boxH = slotH + pad * 2 + border * 2;
  const rowH = boxH + labelH + 8;
  const boxWidth = (g) => g.shots * (slotW + slotGap) - slotGap + pad * 2 + border * 2;
  const rowWidth = (row) => row.groups.reduce((a, grp) =>
    a + grp.games.reduce((b, g) => b + boxWidth(g) + boxGap, -boxGap) + zoneGap, -zoneGap);
  const maxRowW = Math.max(...rows.map(rowWidth));
  const x0 = cx - (capW + capGap + maxRowW) / 2;

  const gfx = scene.add.graphics();
  rows.forEach((row, ri) => {
    const ry = y + ri * rowH;
    addText(scene, x0 + capW, ry + boxH / 2, `EXPEDITION ${row.session}`, {
      font: `bold 13px ${THEME.fontBody}`, fill: THEME.textMuted
    }).setOrigin(1, 0.5);
    let x = x0 + capW + capGap;
    row.groups.forEach(grp => {
      const color = parseInt(grp.color.replace('#', '0x'));
      const gx = x;
      grp.games.forEach(g => {
        const w = boxWidth(g);
        gfx.fillStyle(THEME.panel, 0.95);
        gfx.fillRoundedRect(x, ry, w, boxH, 5);
        gfx.lineStyle(border, color, 1);
        gfx.strokeRoundedRect(x + border / 2, ry + border / 2, w - border, boxH - border, 5);
        if (g.kind === 'watch') {
          addText(scene, x + w / 2, ry + boxH / 2, g.label, {
            font: `600 10px ${THEME.fontBody}`, fill: g.labelColor || THEME.textMuted
          }).setOrigin(0.5, 0.5);
        } else {
          for (let i = 0; i < g.shots; i++) {
            const fill = g.outcomes[i] === 1 ? THEME.success : (g.outcomes[i] === 0 ? THEME.fail : THEME.slotEmpty);
            gfx.fillStyle(fill, 1);
            gfx.fillRoundedRect(x + border + pad + i * (slotW + slotGap), ry + border + pad, slotW, slotH, 2);
          }
        }
        x += w + boxGap;
      });
      x -= boxGap;
      addText(scene, (gx + x) / 2, ry + boxH + 3, `ZONE ${grp.zone}`, {
        font: `bold 11px ${THEME.fontBody}`, fill: grp.color
      }).setOrigin(0.5, 0);
      x += zoneGap;
    });
  });
  return rows.length * rowH;
}

/**
 * Re-draw the summary bar (#summary-bar in HTML).
 * Past icons are dimmed, the current icon is bright until the participant clicks
 * Next on its stage (summaryCurrentDone). We also apply the zone color as a border.
 */
/**
 * Decorative starship row under the canvas, shown only before practice. It lives in
 * #summary-bar (empty until then) so it takes no extra space and is wiped by
 * redrawSummaryBarDOM() on the next stage. The row spans the game frame.
 *  - 'roster' (Prolific form + introduction): shuffled partner images; CSS clips to
 *    one centred line so only as many as fit are shown.
 *  - 'prospector' (instructions): the player's ship with its name underneath.
 */
function showPartnerRow(mode = 'roster') {
  const bar = document.getElementById('summary-bar');
  const frame = document.getElementById('game-frame');
  if (!bar || !frame) return;

  if (mode === 'prospector') {
    bar.innerHTML = "";
    const row = document.createElement('div');
    row.className = 'partner-row partner-row--single';
    const cell = document.createElement('div');
    cell.className = 'partner-cell';
    const img = document.createElement('img');
    img.src = 'assets/user.png';
    img.alt = '';
    const name = document.createElement('div');
    name.className = 'partner-name';
    name.textContent = 'Prospector';
    cell.appendChild(img);
    cell.appendChild(name);
    row.appendChild(cell);
    bar.appendChild(row);
    return;
  }

  if (!partnerRowOrder) {
    partnerRowOrder = [];
    AVAILABLE_STYLES.forEach(style => AVAILABLE_COLORS.forEach(color => partnerRowOrder.push({ style, color })));
    for (let i = partnerRowOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [partnerRowOrder[i], partnerRowOrder[j]] = [partnerRowOrder[j], partnerRowOrder[i]];
    }
  }

  bar.innerHTML = "";
  const row = document.createElement('div');
  row.className = 'partner-row';
  row.style.width = `${frame.getBoundingClientRect().width}px`;
  partnerRowOrder.forEach(({ style, color }) => {
    const img = document.createElement('img');
    img.src = `assets/demonstrators/styles/${style}/${color}.png`;
    img.alt = '';
    row.appendChild(img);
  });
  bar.appendChild(row);
}

function redrawSummaryBarDOM() {
  const bar = document.getElementById('summary-bar');
  if (!bar) return;

  bar.innerHTML = "";
  if (summaryIcons.length === 0) return;

  // Group consecutive renderable icons by (session, round, "choice"-vs-zone). Each
  // group renders as a column: cells row → underline → single label (Zone N or Choice X).
  // A dashed vertical separator is drawn between groups.
  const groups = [];
  let active = null;
  const renderable = [];
  const lastIndex = summaryIcons.length - 1;
  for (let i = 0; i < summaryIcons.length; i++) {
    const ic = summaryIcons[i];
    if (ic.imageKey === null) continue;
    const isChoice = ic.zone === 'Choice' || ic.gameType === 'choice';
    const groupKey = `${ic.session_index}|${ic.round_index}|${isChoice ? 'C' : 'Z'}`;
    if (!active || active.key !== groupKey) {
      active = { key: groupKey, isChoice, icons: [] };
      groups.push(active);
    }
    active.icons.push({ ic, isLast: i === lastIndex });
    renderable.push(ic);
  }

  // Styling lives in index.html (.sb-* classes); only the zone color is inline.
  groups.forEach((group, gIdx) => {
    if (gIdx > 0) {
      const sep = document.createElement("div");
      sep.className = "sb-sep";
      bar.appendChild(sep);
    }

    const groupDiv = document.createElement("div");
    groupDiv.className = "sb-group";

    // Row of icon cells (uniform height, no per-cell zone label).
    const cellsRow = document.createElement("div");
    cellsRow.className = "sb-cells";
    group.icons.forEach(({ ic, isLast }) => {
      cellsRow.appendChild(buildSummaryCell(ic, isLast));
    });
    groupDiv.appendChild(cellsRow);

    // Underline that visually ties the cells in the group together.
    const underline = document.createElement("div");
    underline.className = "sb-underline";
    groupDiv.appendChild(underline);

    // Single label below the underline.
    const groupLabel = document.createElement("div");
    groupLabel.className = "sb-label";
    if (group.isChoice) {
      const letterIcon = group.icons.find(o => o.ic.choiceLetter);
      groupLabel.textContent = letterIcon ? `Choice ${letterIcon.ic.choiceLetter}` : 'Choice';
    } else {
      groupLabel.textContent = `Zone ${group.icons[0].ic.zone}`;
    }
    groupDiv.appendChild(groupLabel);

    bar.appendChild(groupDiv);
  });
}

// Build one summary-bar cell with fixed height so play (with +X) and non-play cells
// align vertically. The "+X" reward slot is always rendered (with &nbsp; placeholder
// for non-play or pre-completion play cells) so heights stay uniform.
function buildSummaryCell(iconData, isLast) {
  const cellDiv = document.createElement("div");
  cellDiv.className = (isLast && !summaryCurrentDone) ? "sb-cell current" : "sb-cell";
  cellDiv.style.borderColor = iconData.zone_color || iconData.color || "#ffffff";

  const img = document.createElement("img");
  if (iconData.imageKey.startsWith('demonstrator_') || iconData.imageKey.startsWith('styles/')) {
    img.src = `assets/demonstrators/${iconData.imageKey}.png`;
  } else if (iconData.imageKey.startsWith('choice_demonstrator_')) {
    img.src = `assets/${iconData.imageKey}`;
  } else {
    img.src = `assets/${iconData.imageKey}.png`;
  }
  img.alt = iconData.name || iconData.gameType;
  cellDiv.appendChild(img);

  if (iconData.name) {
    const nameLabel = document.createElement("div");
    nameLabel.className = "sb-name";
    nameLabel.textContent = iconData.name;
    if (iconData.nameColor) nameLabel.style.color = iconData.nameColor;
    cellDiv.appendChild(nameLabel);
  }

  // Reward slot — always rendered for height uniformity; pinned to the bottom.
  const rewardLabel = document.createElement("div");
  rewardLabel.className = "sb-reward";
  if (iconData.gameType === 'play' && typeof iconData.reward_earned === 'number') {
    rewardLabel.textContent = `+${iconData.reward_earned}`;
  } else {
    rewardLabel.innerHTML = "&nbsp;";
  }
  cellDiv.appendChild(rewardLabel);

  return cellDiv;
}

/*******************************************************
 * Setup Functions for Each Stage Type
 *******************************************************/
function setupProlificIdForm(stage) {
  // Hide controls during prolific ID form
  updateControlsDisplay("hidden");

  // The fixed overlay covers the page; hide the empty game frame behind it. The
  // partner row goes in #summary-bar (lifted above the overlay) so it sits in exactly
  // the same spot as on the introduction page, and the form is centred within the
  // frame's area so it lands just above the row.
  const frame = document.getElementById('game-frame');
  const overlay = document.getElementById('prolific-form-overlay');
  frame.style.visibility = 'hidden';
  overlay.style.visibility = 'visible';
  showPartnerRow('roster');
  raiseSummaryBarOverOverlay(true);
  const frameRect = frame.getBoundingClientRect();
  const content = document.getElementById('prolific-content');
  overlay.style.justifyContent = 'flex-start';
  overlay.style.paddingTop = `${Math.max(0, frameRect.top + (frameRect.height - content.offsetHeight) / 2)}px`;
  const msgEl = document.getElementById('prolific-form-message');
  msgEl.innerText = stage.message || "Please enter your Prolific ID:";

  const inputEl = document.getElementById('prolific-id-input');
  const errorEl = document.getElementById('prolific-form-error');
  const hintEl = document.getElementById('prolific-id-hint');

  // Prolific appends ?PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=… to the study URL.
  // Prefill (participants can still edit) and remember the study/session ids for logging.
  const params = new URLSearchParams(window.location.search);
  const pidFromUrl = (params.get('PROLIFIC_PID') || '').trim();
  prolificStudyID = params.get('STUDY_ID') || null;
  prolificSessionID = params.get('SESSION_ID') || null;
  if (pidFromUrl && !inputEl.value) {
    inputEl.value = pidFromUrl;
    hintEl.hidden = false;
  }

  const showError = (text) => { errorEl.textContent = text; errorEl.hidden = !text; };
  showError('');
  inputEl.oninput = () => showError('');
  inputEl.onkeydown = (e) => { if (e.key === 'Enter') submitBtn.click(); };
  setTimeout(() => inputEl.focus(), 0);

  // The button starts disabled ("Loading…") in index.html; the timeline is in hand now.
  const submitBtn = document.getElementById('prolific-submit-btn');
  submitBtn.disabled = false;
  submitBtn.textContent = 'Start';
  submitBtn.onclick = () => {
    prolificID = inputEl.value.trim();
    if (!prolificID) {
      showError("Please enter your Prolific ID to continue.");
      inputEl.focus();
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
  
  // Partner name under the image (element lives in index.html)
  const partnerNameDiv = document.getElementById('feedback-partner-name');
  if (choiceDemonstratorData && choiceDemonstratorData.demonstrator_name) {
    partnerNameDiv.textContent = choiceDemonstratorData.demonstrator_name;
    partnerNameDiv.style.color = partnerColor(choiceDemonstratorData) || '';
    partnerNameDiv.style.display = 'block';
  } else {
    partnerNameDiv.style.display = 'none';
  }

  // Clear previous text and errors
  const textInput = document.getElementById('feedback-text-input');
  textInput.value = '';
  const errorEl = document.getElementById('feedback-form-error');
  const showError = (text) => { errorEl.textContent = text; errorEl.hidden = !text; };
  showError('');
  textInput.oninput = () => showError('');
  setTimeout(() => textInput.focus(), 0);

  // Reset submit button state
  const submitBtn = document.getElementById('feedback-submit-btn');
  submitBtn.disabled = false;
  submitBtn.innerText = 'Submit';
  submitBtn.onclick = () => {
    const feedbackText = textInput.value.trim();
    if (!feedbackText) {
      showError("Please write a short answer before submitting.");
      textInput.focus();
      return;
    }

    // Disable button to prevent double submission
    submitBtn.disabled = true;
    submitBtn.innerText = 'Submitting...';

    // Queue the feedback row and move on. Delivery is handled by the retrying log
    // queue (in order, behind any earlier rows); the end screen waits for the queue
    // to drain and tells the participant if anything could not be saved. Awaiting
    // delivery here would hang the form for minutes whenever the server is down.
    logToMongoDB('feedback', {
      feedback_text: feedbackText
    });
    verboseLog('Feedback queued');

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
  };
}

/*******************************************************
 * DOM pages (introduction, how to play)
 * Shown instead of the canvas, in the same fixed-overlay style as the Prolific
 * form: #game-frame is hidden with visibility (layout and canvas size never
 * change) and the decorative partner row in #summary-bar is lifted above the
 * overlay. The game frame first appears on the practice transition slide.
 *******************************************************/
// The partner row is shown above the Prolific/intro/how-to overlays (z-index above
// the overlay's 9999). It is display-only there, so clicks must pass through it:
// on viewports shorter than ~945px the overlay's button sits under the row.
function raiseSummaryBarOverOverlay(on) {
  const bar = document.getElementById('summary-bar');
  bar.style.zIndex = on ? '10000' : '';
  bar.style.pointerEvents = on ? 'none' : '';
}

function restoreGameFrame() {
  document.getElementById('game-frame').style.visibility = '';
  document.getElementById('prolific-form-overlay').style.visibility = 'hidden';
  document.getElementById('page-overlay').style.visibility = 'hidden';
  raiseSummaryBarOverOverlay(false);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// html: the page body. buttonLabel/onNext: the single action button under it.
// partnerMode: 'roster' | 'prospector' row shown under the page (see showPartnerRow).
function showDomPage({ html, buttonLabel, onNext, partnerMode }) {
  updateControlsDisplay("hidden");
  const frame = document.getElementById('game-frame');
  const overlay = document.getElementById('page-overlay');
  const content = document.getElementById('page-content');
  frame.style.visibility = 'hidden';
  content.innerHTML = html;

  const actions = document.createElement('div');
  actions.className = 'page-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = buttonLabel;
  btn.onclick = () => { btn.disabled = true; onNext(); };
  actions.appendChild(btn);
  content.appendChild(actions);

  overlay.style.visibility = 'visible';
  showPartnerRow(partnerMode);
  raiseSummaryBarOverOverlay(true);
  // Centre the panel within the frame's area so it sits just above the partner row
  // (same placement as the Prolific form).
  const frameRect = frame.getBoundingClientRect();
  overlay.style.justifyContent = 'flex-start';
  overlay.style.paddingTop = `${Math.max(12, frameRect.top + (frameRect.height - content.offsetHeight) / 2)}px`;
  // The button is disabled on click; a page that advances in steps (How to Play)
  // re-enables it from onNext until the last step.
  return btn;
}

// Intro copy from models.py uses [BOLD]title[/BOLD], [RED_BOLD]warning[/RED_BOLD] and the
// inline highlights [BLUE]…[/BLUE] / [ORANGE]…[/ORANGE]. Rendered as title → paragraphs → warning.
function introMarkupToHtml(message) {
  let text = escapeHtml(message);
  let title = '';
  let warning = '';
  text = text.replace(/\[BOLD\]([\s\S]*?)\[\/BOLD\]/, (m, t) => { title = t.trim(); return ''; });
  text = text.replace(/\[RED_BOLD\]([\s\S]*?)\[\/RED_BOLD\]/, (m, t) => { warning = t.trim(); return ''; });
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(p =>
    `<p>${p.replace(/\[BLUE\]([\s\S]*?)\[\/BLUE\]/g, '<span class="intro-hl">$1</span>')
           .replace(/\[ORANGE\]([\s\S]*?)\[\/ORANGE\]/g, '<span class="intro-hl-orange">$1</span>')
           .replace(/\n/g, '<br>')}</p>`
  );
  return (title ? `<h2 class="page-title">${title}</h2>` : '')
    + `<div class="page-body">${paragraphs.join('')}</div>`
    + (warning ? `<p class="intro-warning">${warning}</p>` : '');
}

function setupIntroduction(stage) {
  const scene = this;
  showDomPage({
    html: introMarkupToHtml(stage.message || "Introduction"),
    buttonLabel: 'Begin Training',
    onNext: () => nextStage.call(scene),
    partnerMode: 'roster'
  });
}

// How-to-play layout: stage.instructions.panels ({ title, image, caption }) in a
// wrapping row, plus an optional closing note. Images come from assets/introduction
// (regenerated with `npm run capture-howto`; GIFs animate as plain <img>). Captions
// may mark key caps as [KEY]…[/KEY].
function howToPageHtml(stage) {
  const ins = stage.instructions;
  const caption = (s) => escapeHtml(s || '')
    .replace(/\[KEY\]([\s\S]*?)\[\/KEY\]/g, '<span class="howto-key">$1</span>')
    .replace(/\n/g, '<br>');
  const panel = (p) => '<div class="howto-item">'
    + (p.image ? `<img src="assets/introduction/${escapeHtml(p.image)}" alt="">` : '')
    + (p.title ? `<div class="howto-title">${escapeHtml(p.title)}</div>` : '')
    + `<div class="howto-caption">${caption(p.caption)}</div></div>`;
  return `<h2 class="page-title">${escapeHtml(stage.message || 'How to Play')}</h2>`
    + `<div class="howto-grid">${(ins.panels || []).map(panel).join('')}</div>`
    + (ins.note ? `<p class="howto-note">${caption(ins.note)}</p>` : '');
}

function setupInstructions(stage) {
  if (!stage.instructions) {
    console.error("Missing instructions data");
    return;
  }
  const scene = this;
  // Step-through: only the current panel is lit; each Next lights the following one,
  // and Next on the last panel leaves the page.
  const numSteps = (stage.instructions.panels || []).length;
  let step = 0;
  const showStep = () => {
    document.querySelectorAll('#page-content .howto-item')
      .forEach((el, i) => el.classList.toggle('howto-dim', i !== step));
  };
  const btn = showDomPage({
    html: howToPageHtml(stage),
    buttonLabel: 'Next',
    onNext: () => {
      step += 1;
      if (step >= numSteps) { nextStage.call(scene); return; }
      showStep();
      btn.disabled = false;
    },
    partnerMode: 'prospector'
  });
  showStep();
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
  const gridOriginX = (GAME_W - totalGridWidth) / 2;
  const gridOriginY = GRID_TOP_Y;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.zone_global_index, stage.session_index);

  // zone background
  createZoneBackgroundMask.call(this, stage, gridOriginX, gridOriginY, numRows, numCols, cellWidth, cellHeight);

  // Reward tank
  let pullOutcomes = [];
  let playActions = []; // Track cell indices for play games
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

  // Add "Prospector" name label below player sprite
  let userNameText = addText(this, 
    initX,
    initY + DEMO_SPRITE_SIZE / 2 + 15,
    'Prospector',
    { 
      font: `bold 14px ${THEME.fontBody}`, 
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
  let gameFinished = false; // end-of-game block (NEXT, trajectory log) runs exactly once
  
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
      
      // Track the cell index for trajectory logging (only for play games)
      if (currentGameType === 'play') {
        const cellIndex = row * numCols + col;
        playActions.push(cellIndex);
      }
      
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
          if (!(currentSessionIndex in sessionTotals)) sessionTotals[currentSessionIndex] = 0;
          sessionTotals[currentSessionIndex]++;
          updateTotalRewardDisplay();
        }
      }
      
      // Bullet from the ship to the asteroid, then a flash
      const target = getCellCenter(gridOriginX, gridOriginY, cellWidth, cellHeight, row, col);
      fireBullet(scene, userSprite.x, userSprite.y - DEMO_SPRITE_SIZE / 2, target.x, target.y);
    let g = scene.add.graphics();
      g.setAlpha(0);
      g.fillStyle(HIGHLIGHT_COLOR, 0.55);
      g.fillRect(
      gridOriginX + col*(cellWidth + CELL_PADDING),
      gridOriginY + row*(cellHeight + CELL_PADDING),
        cellWidth, cellHeight
      );
      
      // Fade out only to get a single flash
    scene.tweens.add({
        targets: g,
        alpha: { from: 1, to: 0 },
        delay: BULLET_FLIGHT_MS,
      duration: 200, // Reduced from 400 to 200
        onComplete: () => {
          g.destroy();
          
          // Record outcome and update tank
          pullOutcomes.push(outcome);
          if (currentGameType === 'play') ledgerRecordShot(outcome);
        drawMarkerDot.call(scene, gridOriginX, gridOriginY, cellWidth, cellHeight, row, col, outcome);
        drawRewardTank.call(scene, rewardTankContainer, num_arm_pulls, pullOutcomes);

      // Finish only when every outcome has been revealed. The shot debounce (200 ms)
      // is shorter than the flash (BULLET_FLIGHT_MS + 200), so the last two shots can
      // overlap; keying on pullsRemaining here created two stacked NEXT buttons and
      // logged trajectory_complete twice (the first time with a reward missing).
      if (pullOutcomes.length >= num_arm_pulls && !gameFinished) {
          gameFinished = true;
          // Log complete trajectory for play games
          if (currentGameType === 'play') {
            logToMongoDB('trajectory_complete', {
              play_actions: JSON.stringify(playActions),
              play_rewards: JSON.stringify(pullOutcomes)
            });
            // Surface the +X reward on the summary icon as soon as the final shot's
            // outcome is revealed, so the participant sees their per-game tally
            // before clicking Next. capturePreviousPlayReward is idempotent.
            capturePreviousPlayReward();
          }

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

  // Always inline now — generate trajectory via Thompson sampling.
  const bandit = stage.zone.zone_bandit;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  const flattenedPayoffs = bandit.flat();
  const numArmPulls = stage.num_arm_pulls || 6;

  const demoIdx = demoData.demonstrator_index ?? demoData.demonstrator_session_index;
  const experienceLevel = getDemoPriorExperience(demoData, demonstratorConfig);

  verboseLog('Bandit payoffs:', flattenedPayoffs);
  verboseLog('Demonstrator index:', demoIdx);
  verboseLog(`Generating demo-${demoIdx + 1} trajectory with ${experienceLevel} warmup iterations`);

  // Both partners' runs for this zone are drawn together (and optionally filtered)
  // the first time either is watched; see getZoneDemoTrajectory.
  const zoneRun = getZoneDemoTrajectory(stage, demoIdx, flattenedPayoffs, numArmPulls);
  const thompsonSampler = zoneRun.sampler;
  const trajectory = zoneRun.trajectory;
  const rewards = zoneRun.rewards;
  const trajectoryData = { trajectory, rewards };
  verboseLog('Generated trajectory:', trajectory);
  verboseLog('Generated rewards:', rewards);
  
  // Reset game tracking for watch phase
  resetGameTracking('watch', trajectory.length);
  
  // Hide controls during watch games - user is not actively playing
  updateControlsDisplay("hidden");
  
  // Show which demonstrator is being watched (zone is in the corner pill + border)
  const demoText = addText(this, 
    GAME_W / 2,
    34,
    demoData && demoData.demonstrator_name ? `WATCHING ${demoData.demonstrator_name.toUpperCase()}` : "WATCHING PARTNER",
    {
      font: `bold 20px ${THEME.fontDisplay}`,
      fill: partnerColor(demoData) || THEME.text,
      backgroundColor: 'rgba(5, 7, 12, 0.75)',
      padding: { x: 14, y: 6 }
    }
  ).setOrigin(0.5).setDepth(10000);
  
  // Use the larger fixed cell size
  let cellWidth = BASE_CELL_SIZE;
  let cellHeight = BASE_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (GAME_W - totalGridWidth) / 2;
  const gridOriginY = GRID_TOP_Y;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.zone_global_index, stage.session_index);
  
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
      dNameText = addText(this, 
        startPos.x,
        startPos.y + DEMO_SPRITE_SIZE / 2 + 15,
        stage.demonstrator.demonstrator_name,
        { 
          font: `bold 14px ${THEME.fontBody}`, 
          fill: partnerColor(stage.demonstrator) || '#ffffff',
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
              
              // Use the pre-generated reward from the inline Thompson sampler.
              outcome = trajectoryData.rewards[currentStep];
              
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
                  if (!(currentSessionIndex in sessionTotals)) sessionTotals[currentSessionIndex] = 0;
                  sessionTotals[currentSessionIndex]++;
                  updateTotalRewardDisplay();
                }
              }
              
              // Bullet from the partner's ship to the asteroid, then a flash
              const target = getCellCenter(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
              fireBullet(this, dSprite.x, dSprite.y - DEMO_SPRITE_SIZE / 2, target.x, target.y);
              let g = this.add.graphics();
              g.setAlpha(0);
              g.fillStyle(HIGHLIGHT_COLOR, 0.55);
              g.fillRect(
                gridOriginX + currentC*(cellWidth + CELL_PADDING),
                gridOriginY + currentR*(cellHeight + CELL_PADDING),
                cellWidth, cellHeight
              );
              
              // Fade out only
              this.tweens.add({
                targets: g,
                alpha: { from: 1, to: 0 },
                delay: BULLET_FLIGHT_MS,
                duration: 200,
                onComplete: () => {
                  g.destroy();
                  
                  // Record outcome and update tank
                  watchOutcomes.push(outcome);
                  drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                  drawRewardTank.call(this, rewardTankContainer, totalSteps, watchOutcomes);

                  currentStep++;
                  
                  // After the last step, log complete trajectory data
                  if (currentStep >= totalSteps) {
                    if (thompsonSampler) {
                      logToMongoDB('trajectory_complete', {
                        demonstrator_actions: JSON.stringify(thompsonSampler.allActions),
                        demonstrator_rewards: JSON.stringify(thompsonSampler.allRewards),
                        demonstrator_experience: getDemoPriorExperience(demoData, demonstratorConfig),
                        demonstrator_strategy: demonstratorConfig.demonstrator_sampling_strategy,
                        demonstrator_bandit_payoffs: JSON.stringify(demonstratorConfig.bandit_payoffs),
                        demonstrator_filter: zoneRun.filter,
                        demonstrator_filter_attempts: zoneRun.attempts,
                        demonstrator_filter_satisfied: zoneRun.satisfied
                      });
                    }
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

  // Always inline now — generate trajectory via Thompson sampling.
  const bandit = stage.zone.zone_bandit;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  const flattenedPayoffs = bandit.flat();
  const numArmPulls = stage.num_arm_pulls || 6;

  const demoIdx = demoData.demonstrator_index ?? demoData.demonstrator_session_index;
  const experienceLevel = getDemoPriorExperience(demoData, demonstratorConfig);

  verboseLog('Bandit payoffs:', flattenedPayoffs);
  verboseLog('Demonstrator index:', demoIdx);
  verboseLog(`Generating demo-${demoIdx + 1} trajectory with ${experienceLevel} warmup iterations`);

  const thompsonSampler = new ThompsonSampler(flattenedPayoffs.length, flattenedPayoffs);
  for (let i = 0; i < experienceLevel; i++) {
    thompsonSampler.step();
  }

  const trajectory = [];
  const rewards = [];
  for (let i = 0; i < numArmPulls; i++) {
    const stepResult = thompsonSampler.step();
    trajectory.push(stepResult.arm);
    rewards.push(stepResult.reward);
  }
  const trajectoryData = { trajectory, rewards };
  verboseLog('Generated trajectory:', trajectory);
  verboseLog('Generated rewards:', rewards);
  
  // Reset game tracking for indicate phase
  resetGameTracking('indicate', trajectory.length);
  
  // Hide controls during indicate games - user is not actively playing
  updateControlsDisplay("hidden");
  
  // Show which demonstrator is being watched (zone is in the corner pill + border)
  const demoText = addText(this, 
    GAME_W / 2,
    34,
    demoData && demoData.demonstrator_name ? `WATCHING ${demoData.demonstrator_name.toUpperCase()}` : "WATCHING PARTNER",
    {
      font: `bold 20px ${THEME.fontDisplay}`,
      fill: partnerColor(demoData) || THEME.text,
      backgroundColor: 'rgba(5, 7, 12, 0.75)',
      padding: { x: 14, y: 6 }
    }
  ).setOrigin(0.5).setDepth(10000);
  
  // Use the larger fixed cell size
  let cellWidth = BASE_CELL_SIZE;
  let cellHeight = BASE_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (GAME_W - totalGridWidth) / 2;
  const gridOriginY = GRID_TOP_Y;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.zone_global_index, stage.session_index);
  
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
      dNameText = addText(this, 
        startPos.x,
        startPos.y + DEMO_SPRITE_SIZE / 2 + 15,
        stage.demonstrator.demonstrator_name,
        { 
          font: `bold 14px ${THEME.fontBody}`, 
          fill: partnerColor(stage.demonstrator) || '#ffffff',
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
              
              // Use the pre-generated reward from the inline Thompson sampler.
              outcome = trajectoryData.rewards[currentStep];
              
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
                  if (!(currentSessionIndex in sessionTotals)) sessionTotals[currentSessionIndex] = 0;
                  sessionTotals[currentSessionIndex]++;
                  updateTotalRewardDisplay();
                }
              }
              
              // Bullet from the partner's ship to the asteroid, then a flash
              const target = getCellCenter(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
              fireBullet(this, dSprite.x, dSprite.y - DEMO_SPRITE_SIZE / 2, target.x, target.y);
              let g = this.add.graphics();
              g.setAlpha(0);
              g.fillStyle(HIGHLIGHT_COLOR, 0.55);
              g.fillRect(
                gridOriginX + currentC*(cellWidth + CELL_PADDING),
                gridOriginY + currentR*(cellHeight + CELL_PADDING),
                cellWidth, cellHeight
              );
              
              // Fade out only
              this.tweens.add({
                targets: g,
                alpha: { from: 1, to: 0 },
                delay: BULLET_FLIGHT_MS,
                duration: 200,
                onComplete: () => {
                  g.destroy();
                  
                  // Record outcome and update tank
                  indicateOutcomes.push(outcome);
                  drawMarkerDot.call(this, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                  drawRewardTank.call(this, rewardTankContainer, totalSteps, indicateOutcomes);

                  currentStep++;
                  
                  // After the last step, log complete trajectory data
                  if (currentStep >= totalSteps) {
                    if (thompsonSampler) {
                      logToMongoDB('trajectory_complete', {
                        demonstrator_actions: JSON.stringify(thompsonSampler.allActions),
                        demonstrator_rewards: JSON.stringify(thompsonSampler.allRewards),
                        demonstrator_experience: getDemoPriorExperience(demoData, demonstratorConfig),
                        demonstrator_strategy: demonstratorConfig.demonstrator_sampling_strategy,
                        demonstrator_bandit_payoffs: JSON.stringify(demonstratorConfig.bandit_payoffs)
                      });
                    }
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
  const order = displayOrderOf(stage); // cell i shows slot order[i]
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 60; // More space between partners
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (GAME_W - totalWidth) / 2;
  const gridY = 300;
  
  // Title (from Python: "EXPEDITION n · …") + body
  if (stage.title) {
    addText(this, GAME_W / 2, 56, stage.title, {
      font: `bold 24px ${THEME.fontDisplay}`,
      fill: THEME.text,
      align: 'center',
      wordWrap: { width: 820 }
    }).setOrigin(0.5);
  }
  // Partner names inside the paragraph take their ship's color.
  addRichText(this,
    GAME_W / 2,
    stage.title ? 100 : 150,
    stage.message || "You will now start a new expedition with several watch and play games. These two partner starships come along for the watch games:",
    {
      font: `20px ${THEME.fontBody}`,
      fill: THEME.text,
      wordWrap: { width: 760 },
      lineSpacing: 4
    },
    partnerHighlights(stage),
    0
  );
  
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
      THEME.panel
    ).setOrigin(0.5);
    
    // Create letter label
    const letter = String.fromCharCode(65 + i); // A, B
    const letterText = addText(this, 
      x,
      gridY - 30,
      `Partner ${letter}`,
      { 
        font: `18px ${THEME.fontBody}`, 
        fill: '#ffffff',
        backgroundColor: THEME.panelHex,
        padding: { x: 10, y: 5 }
      }
    ).setOrigin(0.5);
    
    // Load demonstrator image - include session_index to make keys unique per session
    const imageKey = `presentation_demonstrator_s${stage.session_index}_${i}`;
    this.load.image(imageKey, `assets/demonstrators/${demonstratorMappedImages[order[i]]}`);
    
    // Store cell info
    cells.push({
      x: x,
      y: y,
      letter: letter,
      background: cellBg,
      letterText: letterText,
      imageKey: imageKey,
      demonstrator: order[i] === 0 ? demonstrator1 : demonstrator2,
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
        const nameText = addText(currentScene, 
          cell.x,
          cell.y + cellHeight/2 - 15,
          cell.demonstrator.demonstrator_name,
          { 
            font: `bold 14px ${THEME.fontBody}`, 
            fill: partnerColor(cell.demonstrator) || '#ffffff',
            align: 'center',
            stroke: '#000000',
            strokeThickness: 3
          }
        ).setOrigin(0.5);
      }
    }
    
    // Add "Begin Session" button
    makeNextButton.call(currentScene, "Begin Expedition", () => {
      // Restore normal controls display before moving to next stage
      updateControlsDisplay("default");
      nextStage.call(currentScene);
    }, "overlay");
  });

  this.load.start();
}

/**
 * ROUND RECAP stage — between rounds within a session, summarize the reward
 * earned in each play game of the round just finished. Number of play games
 * is variable (read from roundPlayRewards[stage.round_index]).
 */
// Participants never see the word "round": in round_changing mode each round is a
// zone, so the recap talks about zones. Returns { title, body, button }.
// isLastRound: the recap after the session's final round wraps up the expedition
// (totals only, plain Continue) instead of pointing at a next zone.
function buildZoneRecapCopy(roundIdx, nextZone, isLastRound = false) {
  const rewardWord = (n) => `${n} reward${n === 1 ? '' : 's'}`;
  const sessionFixed = gameConfig && gameConfig.bandit_assignment_mode === 'session_fixed';
  const sums = [];
  for (let r = 0; r <= roundIdx; r++) {
    const entry = roundPlayRewards[r];
    if (entry) sums.push({ zone: entry.zone, total: entry.rewards.reduce((a, b) => a + b, 0) });
  }
  const current = sums.length ? sums[sums.length - 1] : { zone: null, total: 0 };
  const zoneName = (z) => (z === null || z === undefined) ? 'this zone' : `zone ${z}`;
  const expeditionTotal = sums.reduce((a, x) => a + x.total, 0);
  const completeTitle = current.zone !== null ? `ZONE ${current.zone} COMPLETE` : 'ZONE COMPLETE';

  if (sessionFixed) {
    if (isLastRound) {
      return {
        title: completeTitle,
        body: `Good job! You earned ${rewardWord(expeditionTotal)} in ${zoneName(current.zone)} this expedition.`,
        button: 'Continue'
      };
    }
    // Same zone continues next round: no "complete", no "next zone".
    return {
      title: current.zone !== null ? `ZONE ${current.zone} · KEEP GOING` : 'KEEP GOING',
      body: `You've earned ${rewardWord(expeditionTotal)} in ${zoneName(current.zone)} so far. Can you keep it up?`,
      button: 'Continue'
    };
  }

  const items = sums.map(x => `${rewardWord(x.total)} in ${zoneName(x.zone)}`);
  const list = items.length <= 1 ? (items[0] || 'your rewards')
    : items.length === 2 ? `${items[0]} and ${items[1]}`
    : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  if (isLastRound) {
    return {
      title: completeTitle,
      body: items.length <= 1
        ? `Good job! You earned ${list} this expedition.`
        : `Good job! You earned ${list}, ${rewardWord(expeditionTotal)} in total this expedition.`,
      button: 'Continue'
    };
  }
  const next = (nextZone === null || nextZone === undefined) ? 'the next zone' : `zone ${nextZone}`;
  return {
    title: completeTitle,
    body: `Good job! You earned ${list}. Can you beat that in ${next}?`,
    button: 'Continue to next zone'
  };
}

// Zone of the next gameplay stage after the current one in this session (or null).
function nextZoneAfterCurrentStage() {
  if (!timelineData || currentSessionIndex >= timelineData.length) return null;
  const flat = flattenSession(timelineData[currentSessionIndex]);
  for (let i = currentStageIndex + 1; i < flat.length; i++) {
    const st = flat[i];
    if (st.game && st.zone && st.zone.zone_global_index !== undefined && st.game !== 'choice') {
      return st.zone.zone_global_index;
    }
  }
  return null;
}

function setupRoundRecap(stage) {
  updateControlsDisplay("hidden");

  const W = GAME_W;
  const H = GAME_H;

  clearScene(this);

  const overlay = this.add.rectangle(0, 0, W, H, THEME.overlay, 0.85);
  overlay.setOrigin(0, 0);

  const isLastRound = typeof stage.session_total_rounds === 'number'
    && stage.round_index === stage.session_total_rounds - 1;
  const copy = buildZoneRecapCopy(stage.round_index, nextZoneAfterCurrentStage(), isLastRound);

  addText(this, W / 2, H / 2 - 110, copy.title, {
    font: `bold 26px ${THEME.fontDisplay}`,
    fill: THEME.text,
    align: 'center'
  }).setOrigin(0.5);

  addText(this, W / 2, H / 2 - 40, copy.body, {
    font: `22px ${THEME.fontBody}`,
    fill: THEME.text,
    align: 'center',
    wordWrap: { width: W - 200 },
    lineSpacing: 6
  }).setOrigin(0.5);

  makeButton(this, W / 2, H / 2 + 70, copy.button, () => {
    nextStage.call(this);
  }, { width: 300 });
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
      "demonstrator_index": 0,
      "demonstrator_session_index": 0,
      "demonstrator_global_index": 1
    };
  }
  
  if (!demonstrator2 || Object.keys(demonstrator2).length === 0 || demonstrator2.demonstrator_global_index === undefined) {
    console.warn("Missing or incomplete demonstrator2 data for choice stage. Creating default data.");
    demonstrator2 = {
      "demonstrator_index": 1,
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
  const order = displayOrderOf(stage); // cell i shows slot order[i]
  const cellWidth = 150;
  const cellHeight = 150;
  const cellPadding = 30;
  
  // Calculate total grid width
  const totalWidth = numDemonstrators * cellWidth + (numDemonstrators - 1) * cellPadding;
  
  // Position grid in center of screen
  const gridX = (GAME_W - totalWidth) / 2;
  const gridY = 200;
  
  // Create title text
  const titleText = addText(this,
    GAME_W / 2,
    60,
    "CHOOSE A PARTNER",
    {
      font: `bold 26px ${THEME.fontDisplay}`,
      fill: '#ffffff',
      align: 'center'
    }
  ).setOrigin(0.5);

  // Body: same wording as the transition slide (from Python), with a fallback.
  const transferText = stage.transfer === true ? "a brand-new zone" : "the same zone";
  const instructionText = addText(this,
    GAME_W / 2,
    118,
    stage["overlay-message"] ||
      `Imagine you are about to play again in ${transferText} and could watch only one of the partners from this expedition shoot in that zone first. Which partner would you choose to help you play better?`,
    {
      font: `18px ${THEME.fontBody}`,
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 640 }
    }
  ).setOrigin(0.5);

  // Create instruction for controls
  const controlsText = addText(this, 
    GAME_W / 2,
    gridY + cellHeight + 95,
    "Use the arrow keys to move and spacebar to select, or click a partner twice",
    { 
      font: `16px ${THEME.fontBody}`, 
      fill: THEME.textMuted,
      align: 'center'
    }
  ).setOrigin(0.5);
  
  // Update the control display section to show choice-specific controls
  updateControlsDisplay("choice");
  
  // Selection feedback text (initially hidden)
  const feedbackText = addText(this, 
    GAME_W / 2,
    gridY + cellHeight + 95,
    "",
    { 
      font: `20px ${THEME.fontBody}`, 
      fill: THEME.successHex,
      align: 'center',
      backgroundColor: THEME.panelHex,
      padding: { x: 15, y: 10 }
    }
  ).setOrigin(0.5).setVisible(false);
  
  // Track selection
  let selectedDemonstrator = null;
  let choicePosition = null; // no cell preselected: the first arrow key or click picks one
  
  // Initialize position tracking for logging  
  currentPosition = -1; // the log schema needs a number; nothing is selected yet
  
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
      THEME.panel
    ).setOrigin(0.5);
    
    // Create letter label
    const letter = String.fromCharCode(65 + i); // A, B, C, etc.
    const letterText = addText(this, 
      x,
      gridY - 30,
      `Partner ${letter}`,
      { 
        font: `18px ${THEME.fontBody}`, 
        fill: '#ffffff',
        backgroundColor: THEME.panelHex,
        padding: { x: 10, y: 5 }
      }
    ).setOrigin(0.5);
    
    // Load demonstrator image - use a unique key for the texture that includes session index
    const imageKey = `choice_s${sessionIndex}_demonstrator_${order[i]}`; // slot, not cell: addChoiceSelectionToSummary reads it back
    
    // Make sure the image path is correct

    
    this.load.image(imageKey, `assets/demonstrators/${demonstratorMappedImages[order[i]]}`);
    
    // Store cell info
    cells.push({
      x: x,
      y: y,
      letter: letter,
      slot: order[i],
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
      const demonstrator = cells[i].slot === 0 ? demonstrator1 : demonstrator2;
      if (demonstrator && demonstrator.demonstrator_name) {
        const nameText = addText(currentScene, 
          cell.x,
          cell.y + cellHeight/2 - 15, // Position below the image but above cell bottom
          demonstrator.demonstrator_name,
          { 
            font: `bold 14px ${THEME.fontBody}`, 
            fill: partnerColor(demonstrator) || '#ffffff',
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
    ).setOrigin(0.5).setAlpha(0.3).setVisible(false); // shown once a cell is picked
    
    // Position for user sprite (below the cells)
    const userY = gridY + cellHeight + 40;
    let userX = GAME_W / 2; // centred between the cells until one is picked
    
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
          highlightRect.setVisible(true);
          
          // Log movement action for regular choice
          const moveAction = oldPosition === null ? (choicePosition === 0 ? 'left' : 'right') : (choicePosition > oldPosition ? 'right' : 'left');
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
      const slot = cells[index].slot; // which demonstrator slot sits in the chosen cell
      if (slot === 0) {
        choiceDemonstratorId = mapDemonstratorImage(demonstrator1.demonstrator_global_index, demonstrator1.demonstrator_style, demonstrator1.demonstrator_color);
        choiceDemonstratorIndex = demonstrator1.demonstrator_index ?? demonstrator1.demonstrator_session_index;
        choiceDemonstratorData = demonstrator1;
      } else if (slot === 1) {
        choiceDemonstratorId = mapDemonstratorImage(demonstrator2.demonstrator_global_index, demonstrator2.demonstrator_style, demonstrator2.demonstrator_color);
        choiceDemonstratorIndex = demonstrator2.demonstrator_index ?? demonstrator2.demonstrator_session_index;
        choiceDemonstratorData = demonstrator2;
      }
      
      // Log the selection action
      logToMongoDB('shoot', {
        reward_generated: false,
        shot: true,
        choice_position: index,
        choice_letter: selectedDemonstrator,
        selected_demonstrator: selectedDemonstrator,
        choice_display_order: JSON.stringify(order)
      });
        
        // Show selection feedback
        feedbackText.setText(`You selected Partner ${selectedDemonstrator}`);
        feedbackText.setVisible(true);
        controlsText.setVisible(false);
        
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
        choicePosition = choicePosition === null ? 0 : Math.max(0, choicePosition - 1);
      }
      if (evt.code === 'ArrowRight') {
        choicePosition = choicePosition === null ? cells.length - 1 : Math.min(cells.length - 1, choicePosition + 1);
      }
      
      // If position changed, update user sprite and highlight
      if (oldPosition !== choicePosition) {
        currentPosition = choicePosition; // Update global position for logging
        userX = cells[choicePosition].x;
        userSprite.setPosition(userX, userY);
        highlightRect.setPosition(cells[choicePosition].x, cells[choicePosition].y);
        highlightRect.setVisible(true);
        
        // Log keyboard movement action
        const moveAction = oldPosition === null ? (choicePosition === 0 ? 'left' : 'right') : (choicePosition > oldPosition ? 'right' : 'left');
        logToMongoDB(moveAction, {
          reward_generated: false,
          shot: false,
          choice_position: choicePosition,
          choice_letter: cells[choicePosition].letter
        });
      }
      
      // Space to select
      if (evt.code === 'Space') {
        if (choicePosition === null) return; // nothing picked yet
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
      <div class="control-key">
        <div class="control-icon">←</div>
        <div>Move left</div>
      </div>
      <div class="control-key">
        <div class="control-icon">→</div>
        <div>Move right</div>
      </div>
      <div class="control-key">
        <div class="control-icon">Space</div>
        <div>Select partner<br><span style="opacity:.7">or click a partner</span></div>
      </div>
    `;
  } else if (type === "single-row") {
    // Controls for single-row games (asteroid mode) - no up/down arrows
    controlsDisplay.innerHTML = `
      <div class="control-key">
        <div class="control-icon">←</div>
        <div>Left</div>
      </div>
      <div class="control-key">
        <div class="control-icon">→</div>
        <div>Right</div>
      </div>
      <div class="control-key">
        <div class="control-icon">Space</div>
        <div>Shoot asteroid<br><span style="opacity:.7">or click an asteroid</span></div>
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
    let demoColor = null;

    if (stage && stage.demonstrator1 && stage.demonstrator2) {
      // Determine which demonstrator was selected based on the demoIndex
      if (demoIndex === '0' && stage.demonstrator1.demonstrator_global_index !== undefined) {
        const mappedImage = mapDemonstratorImage(stage.demonstrator1.demonstrator_global_index, stage.demonstrator1.demonstrator_style, stage.demonstrator1.demonstrator_color);
        demoImage = mappedImage.replace('.png', '');
        // Get demonstrator name if available
        if (stage.demonstrator1.demonstrator_name) {
          demoName = stage.demonstrator1.demonstrator_name;
          demoColor = partnerColor(stage.demonstrator1);
        }
      } else if (demoIndex === '1' && stage.demonstrator2.demonstrator_global_index !== undefined) {
        const mappedImage = mapDemonstratorImage(stage.demonstrator2.demonstrator_global_index, stage.demonstrator2.demonstrator_style, stage.demonstrator2.demonstrator_color);
        demoImage = mappedImage.replace('.png', '');
        // Get demonstrator name if available
        if (stage.demonstrator2.demonstrator_name) {
          demoName = stage.demonstrator2.demonstrator_name;
          demoColor = partnerColor(stage.demonstrator2);
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
      summaryIcons[choiceIconIndex].nameColor = demoColor;
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
  const gridX = (GAME_W - totalWidth) / 2;
  const gridY = 200;
  
  // Create title text (same as regular choice game)
  const titleText = addText(this, 
    GAME_W / 2,
    60,
    "Choose your preferred partner",
    {
      font: `bold 26px ${THEME.fontDisplay}`,
      fill: '#ffffff',
      align: 'center'
    }
  ).setOrigin(0.5);
  
  // Create instruction text (use transfer flag to determine message)
  const transferText = stage.transfer === true ? "in a new zone" : "in the same zone";
  const instructionText = addText(this, 
    GAME_W / 2,
    118,
    `Choose the starship you would watch before playing again to achieve higher rewards ${transferText}.`,
    { 
      font: `18px ${THEME.fontBody}`, 
      fill: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }
  ).setOrigin(0.5);
  
  // Create instruction for controls (same as regular choice game)
  const controlsText = addText(this, 
    GAME_W / 2,
    gridY + cellHeight + 95,
    "Use arrow keys to move and spacebar to select, or click a partner",
    { 
      font: `16px ${THEME.fontBody}`, 
      fill: THEME.textMuted,
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
      THEME.panel
    ).setOrigin(0.5);
    
    // Create letter label (same format as regular choice game)
    const letterText = addText(this, 
      x,
      gridY - 30,
      `Partner ${demo.letter}`,
      { 
        font: `18px ${THEME.fontBody}`, 
        fill: '#ffffff',
        backgroundColor: THEME.panelHex,
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
        const nameText = addText(currentScene, 
          cell.x,
          cell.y + cellHeight/2 - 15, // Position below the image but above cell bottom
          cell.data.demonstrator_name,
          { 
            font: `bold 14px ${THEME.fontBody}`, 
            fill: partnerColor(cell.data) || '#ffffff',
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
    const feedbackText = addText(currentScene, 
      GAME_W / 2,
      gridY + cellHeight + 95,
      "",
      { 
        font: `20px ${THEME.fontBody}`, 
        fill: THEME.successHex,
        align: 'center',
        backgroundColor: THEME.panelHex,
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
      choiceDemonstratorIndex = selectedCell.data.demonstrator_index ?? selectedCell.data.demonstrator_session_index;
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
        controlsText.setVisible(false);
        
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

  // Always inline now — generate trajectory via Thompson sampling.
  const bandit = stage.zone.zone_bandit;
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  const flattenedPayoffs = bandit.flat();
  const numArmPulls = stage.num_arm_pulls || 6;

  const demoIdx = demoData.demonstrator_index ?? demoData.demonstrator_session_index;
  const experienceLevel = getDemoPriorExperience(demoData, demonstratorConfig);

  verboseLog('Bandit payoffs:', flattenedPayoffs);
  verboseLog('Demonstrator index:', demoIdx);
  verboseLog(`Generating demo-${demoIdx + 1} trajectory with ${experienceLevel} warmup iterations`);

  const thompsonSampler = new ThompsonSampler(flattenedPayoffs.length, flattenedPayoffs);
  for (let i = 0; i < experienceLevel; i++) {
    thompsonSampler.step();
  }

  const trajectory = [];
  const rewards = [];
  for (let i = 0; i < numArmPulls; i++) {
    const stepResult = thompsonSampler.step();
    trajectory.push(stepResult.arm);
    rewards.push(stepResult.reward);
  }
  const trajectoryData = { trajectory, rewards };
  verboseLog('Generated trajectory:', trajectory);
  verboseLog('Generated rewards:', rewards);
  
  // Reset game tracking for watch phase  
  resetGameTracking('watch', trajectory.length);
  
  // Hide controls during online-choice watch phase - user is not actively playing
  updateControlsDisplay("hidden");
  
  // Show which demonstrator is being watched (zone is in the corner pill + border)
  const demoText = addText(this, 
    GAME_W / 2,
    34,
    `WATCHING PARTNER ${selectedDemo.letter}`,
    {
      font: `bold 20px ${THEME.fontDisplay}`,
      fill: THEME.text,
      backgroundColor: 'rgba(5, 7, 12, 0.75)',
      padding: { x: 14, y: 6 }
    }
  ).setOrigin(0.5).setDepth(10000);
  
  // Use the larger fixed cell size
  let cellWidth = BASE_CELL_SIZE;
  let cellHeight = BASE_CELL_SIZE;
  
  // Calculate total grid size based on fixed cell size
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  
  // Center the grid in the full container width
  const gridOriginX = (GAME_W - totalGridWidth) / 2;
  const gridOriginY = GRID_TOP_Y;
  const gridBottomY = gridOriginY + totalGridHeight;

  // Add zone labels
  addZoneLabels(this, stage.zone.zone_global_index, stage.session_index);
  
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
              
              // Use the pre-generated reward from the inline Thompson sampler.
              outcome = trajectoryData.rewards[currentStep];
              
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
                  if (!(currentSessionIndex in sessionTotals)) sessionTotals[currentSessionIndex] = 0;
                  sessionTotals[currentSessionIndex]++;
                  updateTotalRewardDisplay();
                }
              }
              
              // Bullet from the partner's ship to the asteroid, then a flash
              const target = getCellCenter(gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC);
              fireBullet(currentScene, dSprite.x, dSprite.y - DEMO_SPRITE_SIZE / 2, target.x, target.y);
              let g = currentScene.add.graphics();
              g.setAlpha(0);
              g.fillStyle(HIGHLIGHT_COLOR, 0.55);
              g.fillRect(
                gridOriginX + currentC*(cellWidth + CELL_PADDING),
                gridOriginY + currentR*(cellHeight + CELL_PADDING),
                cellWidth, cellHeight
              );
              
              // Fade out only
              currentScene.tweens.add({
                targets: g,
                alpha: { from: 1, to: 0 },
                delay: BULLET_FLIGHT_MS,
                duration: 200,
                onComplete: () => {
                  g.destroy();
                  
                  // Record outcome and update tank
                  watchOutcomes.push(outcome);
                  drawMarkerDot.call(currentScene, gridOriginX, gridOriginY, cellWidth, cellHeight, currentR, currentC, outcome);
                  drawRewardTank.call(currentScene, rewardTankContainer, totalSteps, watchOutcomes);

                  currentStep++;
                  
                  // After the last step, log complete trajectory data
                  if (currentStep >= totalSteps) {
                    if (thompsonSampler) {
                      logToMongoDB('trajectory_complete', {
                        demonstrator_actions: JSON.stringify(thompsonSampler.allActions),
                        demonstrator_rewards: JSON.stringify(thompsonSampler.allRewards),
                        demonstrator_experience: getDemoPriorExperience(demoData, demonstratorConfig),
                        demonstrator_strategy: demonstratorConfig.demonstrator_sampling_strategy,
                        demonstrator_bandit_payoffs: JSON.stringify(demonstratorConfig.bandit_payoffs)
                      });
                    }
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
  // The game just left is over: dim its ledger box and summary icon now, before any
  // transition slide.
  ledgerLiveKey = null;
  updateTotalRewardDisplay();
  summaryCurrentDone = true;
  redrawSummaryBarDOM();

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
  clearScene(this);

  // The end-of-game canvas renders its own total-reward summary, so hide the
  // always-on DOM running-total bar to avoid showing the value twice.
  const totalRewardEl = document.getElementById('total-reward-display');
  if (totalRewardEl) totalRewardEl.style.display = 'none';

  const W = GAME_W;
  const H = GAME_H;

  updateControlsDisplay("hidden");
  setGameBorderColor(THEME.neutralBorderHex);

  // Add a semi-transparent overlay
  const overlay = this.add.rectangle(0, 0, W, H, THEME.overlay, 0.85);
  overlay.setOrigin(0, 0);

  // Lay out vertically: header, optional reward lines, bonus, saving status, return
  // button. The header sits high so a three-expedition ledger, the total and the
  // bonus calculation all fit above the button.
  const lineHeight = 36;
  const headerY = 70;

  addText(this, W / 2, headerY, "ALL EXPEDITIONS COMPLETE", {
    font: `bold 30px ${THEME.fontDisplay}`,
    fill: THEME.text,
    align: 'center'
  }).setOrigin(0.5);

  let y = headerY + 60;
  const greenStyle = {
    font: `bold 24px ${THEME.fontBody}`,
    fill: THEME.successHex,
    stroke: '#000000',
    strokeThickness: 3,
    align: 'center'
  };

  if (displayRunningTotalReward) {
    const combined = Object.values(sessionTotals).reduce((a, b) => a + b, 0);
    if (rewardBreakdownDisplay === 'per_game') {
      // Same ledger as the in-game display, then the total underneath it.
      y += drawRewardLedgerCanvas(this, W / 2, y) + 6;
      addText(this, W / 2, y, `TOTAL REWARD ${combined}`, {
        font: `bold 40px ${THEME.fontDisplay}`, fill: THEME.successHex, stroke: '#000000', strokeThickness: 3
      }).setOrigin(0.5, 0);
      y += 56;
      y += drawBonusLines(this, W / 2, y, combined);
    } else if (totalRewardScope === 'across_sessions') {
      addText(this, W / 2, y, `Total Reward: ${combined}`, greenStyle).setOrigin(0.5);
      y += lineHeight;
    } else {
      const keys = Object.keys(sessionTotals).sort((a, b) => Number(a) - Number(b));
      keys.forEach(k => {
        addText(this, W / 2, y, `Expedition ${k} — Total Reward: ${sessionTotals[k]}`, greenStyle).setOrigin(0.5);
        y += lineHeight;
      });
      addText(this, W / 2, y, `Combined Total: ${combined}`, greenStyle).setOrigin(0.5);
      y += lineHeight;
    }
    if (rewardBreakdownDisplay !== 'per_game') {
      y += drawBonusLines(this, W / 2, y - lineHeight / 2 + 10, combined);
    }
  }

  // Completion URL comes from the YAML (prolific_completion_url) via /api/config.
  const returnUrl = (gameConfig && gameConfig.prolific_completion_url)
    || timelineData.return_url
    || "https://app.prolific.com/submissions/complete?cc=CTVM94DF";

  // Make sure every queued log row has reached the server before offering the link.
  const statusText = addText(this, W / 2, y + 16, "Please wait while we process your results…", {
    font: `16px ${THEME.fontBody}`,
    fill: THEME.textMuted,
    align: 'center',
    wordWrap: { width: 700 }
  }).setOrigin(0.5);
  const buttonY = y + 70;

  drainLogQueue(20000).then((drained) => {
    if (drained && logDeadLetters === 0) {
      statusText.setText("Your data has been saved. Thank you for playing!");
    } else {
      statusText.setText("Some of your data may not have been saved. Please return to Prolific and message the researcher.");
      statusText.setStyle({ fill: '#fbbf24' });
    }
    makeButton(this, W / 2, buttonY, "Return to Prolific", () => {
      window.location.href = returnUrl;
    }, { width: 280 });
  });
}

/**
 * Bonus calculation under the total on the end screen:
 *   BONUS $0.82
 *   41 rewards × $0.02 each
 * Reads bonus_per_reward / bonus_currency from the YAML (via /api/config); draws
 * nothing and returns 0 when no rate is configured. Returns the height used.
 */
function drawBonusLines(scene, x, y, totalReward) {
  const rate = bonusRate();
  if (rate === null) return 0;
  const money = bonusMoney;
  addText(scene, x, y, `BONUS ${money(totalReward * rate)}`, {
    font: `bold 28px ${THEME.fontDisplay}`, fill: THEME.text, stroke: '#000000', strokeThickness: 3
  }).setOrigin(0.5, 0);
  addText(scene, x, y + 38, `${totalReward} reward${totalReward === 1 ? '' : 's'} × ${money(rate)} each`, {
    font: `17px ${THEME.fontBody}`, fill: THEME.textMuted
  }).setOrigin(0.5, 0);
  return 70;
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
    const gameWidth = GAME_W;
    const gameHeight = GAME_H;
    
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
  // Outcome underline: one short line above each asteroid; that asteroid's hit/miss
  // pips are drawn above it, so it reads as an underline for the tally.
  const track = this.add.graphics().setDepth(2);
  track.lineStyle(1, 0xffffff, 0.45);
  for (let r = 0; r < numRows; r++) {
    const ly = gridY + r * (cellHeight + CELL_PADDING) - OUTCOME_TRACK_OFFSET;
    for (let c = 0; c < numCols; c++) {
      const lx = gridX + c * (cellWidth + CELL_PADDING);
      track.lineBetween(lx + 6, ly, lx + cellWidth - 6, ly);
    }
  }

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

  const slotW = TANK_SLOT_SIZE;
  const slotH = TANK_SLOT_SIZE * 0.6;
  const gap = TANK_SLOT_PADDING + 2;
  const totalWidth = totalSlots * (slotW + gap) - gap;
  const pad = 8;

  const g = this.add.graphics();
  // Housing
  g.fillStyle(THEME.panel, 0.9);
  g.fillRoundedRect(-totalWidth / 2 - pad, -slotH / 2 - pad, totalWidth + pad * 2, slotH + pad * 2, 8);
  g.lineStyle(1, 0xffffff, 0.18);
  g.strokeRoundedRect(-totalWidth / 2 - pad, -slotH / 2 - pad, totalWidth + pad * 2, slotH + pad * 2, 8);
  // Slots, left → right in pull order
  for (let i = 0; i < totalSlots; i++) {
    let color = THEME.slotEmpty;
    if (i < outcomes.length) {
      color = (outcomes[i] === 1) ? THEME.success : THEME.fail;
    }
    const x = -totalWidth / 2 + i * (slotW + gap);
    g.fillStyle(color, 1);
    g.fillRoundedRect(x, -slotH / 2, slotW, slotH, 4);
  }
  g.setDepth(1);
  container.add(g);

  // Title above the housing, shot counter below it
  const earned = outcomes.reduce((a, b) => a + b, 0);
  const tankTitle = addText(this, 0, -30, 'REWARD TANK', {
    font: `bold 14px ${THEME.fontDisplay}`,
    fill: THEME.text,
    stroke: '#000000',
    strokeThickness: 4
  });
  tankTitle.setOrigin(0.5, 0.5);
  tankTitle.setDepth(2);
  container.add(tankTitle);
  const tankCounter = addText(this, 0, 24, `${earned} earned  ·  ${outcomes.length} / ${totalSlots} shots`, {
    font: `600 14px ${THEME.fontBody}`,
    fill: THEME.text,
    stroke: '#000000',
    strokeThickness: 4
  });
  tankCounter.setOrigin(0.5, 0.5);
  tankCounter.setDepth(2);
  container.add(tankCounter);
}

/**
 * Outcome tally above the asteroid that was mined: two columns stacking upward
 * from the track line, rewards (green) on the left and misses (red) on the right,
 * so the count of each reads at a glance. One pip per pull; reset per stage.
 * White ring + green/red fill so it reads on any asteroid color and the space background.
 */
function drawMarkerDot(gridX, gridY, cellWidth, cellHeight, row, col, outcome) {
  const key = `${row},${col}`;
  const tally = outcomePips[key] || (outcomePips[key] = { hit: 0, miss: 0 });
  const hit = outcome === 1;
  const n = hit ? tally.hit++ : tally.miss++; // pips already in this column

  const cellCenterX = gridX + col * (cellWidth + CELL_PADDING) + cellWidth / 2;
  const cellTop = gridY + row * (cellHeight + CELL_PADDING);
  const x = cellCenterX + (hit ? -PIP_SPACING / 2 : PIP_SPACING / 2);
  const y = cellTop - OUTCOME_TRACK_OFFSET - 8 - PIP_RADIUS - n * PIP_SPACING;
  const color = hit ? THEME.success : THEME.fail;

  const pip = this.add.circle(x, y, PIP_RADIUS, color);
  pip.setStrokeStyle(1.5, 0xffffff, 1);
  pip.setDepth(99999);

  // Brief pop so the new pip draws the eye
  pip.setScale(0);
  this.tweens.add({ targets: pip, scale: 1, duration: 180, ease: 'Back.Out' });
}

/** 
 * place the sprite ~42px below the bottom edge of the cell
 */
function getCellBelow(gridX, gridY, cellWidth, cellHeight, row, col) {
  // Calculate position with padding
  const x = gridX + col * (cellWidth + CELL_PADDING) + (cellWidth/2);
  const cellBottom = gridY + row * (cellHeight + CELL_PADDING) + cellHeight;
  const y = cellBottom + 42;
  return { x, y };
}

/**
 * Grid placement for a bandit (rows x cols of payoffs): the same numbers
 * setupPlayOrPractice / setupWatch compute inline, for code that must draw the grid
 * in exactly the same place (the in-place transition slide).
 */
function gridGeometry(bandit) {
  const numRows = bandit.length;
  const numCols = bandit[0].length;
  const cellWidth = BASE_CELL_SIZE;
  const cellHeight = BASE_CELL_SIZE;
  const totalGridWidth = numCols * cellWidth + (numCols - 1) * CELL_PADDING;
  const totalGridHeight = numRows * cellHeight + (numRows - 1) * CELL_PADDING;
  const gridOriginX = (GAME_W - totalGridWidth) / 2;
  const gridOriginY = GRID_TOP_Y;
  return {
    numRows, numCols, cellWidth, cellHeight, totalGridWidth, totalGridHeight,
    gridOriginX, gridOriginY, gridBottomY: gridOriginY + totalGridHeight
  };
}

/**
 * Red bullet from the ship's nose to the asteroid, BULLET_FLIGHT_MS long. The
 * shot's flash/outcome is delayed by the same amount at the call sites.
 */
function fireBullet(scene, fromX, fromY, toX, toY) {
  const bullet = scene.add.container(fromX, fromY).setDepth(99990);
  const glow = scene.add.rectangle(0, 0, 8, 18, 0xff3b3b, 0.35);
  const core = scene.add.rectangle(0, 0, 4, 14, 0xff3b3b, 1);
  bullet.add([glow, core]);
  scene.tweens.add({
    targets: bullet,
    x: toX,
    y: toY,
    duration: BULLET_FLIGHT_MS,
    ease: 'Quad.In',
    onComplete: () => bullet.destroy()
  });
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
  // Translucent white square over the current asteroid (no outline).
  let highlightRect = this.add.rectangle(0, 0, cellWidth - 2, cellHeight - 2, HIGHLIGHT_COLOR, HIGHLIGHT_ALPHA);
  highlightRect.setDepth(9998).setOrigin(0.5);
  return highlightRect;
}

/**
 * Move highlightRect to (r,c).
 */
function highlightCurrentCell(highRect, r, c, gridX, gridY, cellWidth, cellHeight) {
  let x = gridX + c * (cellWidth + CELL_PADDING) + cellWidth/2;
  let y = gridY + r * (cellHeight + CELL_PADDING) + cellHeight/2;
  highRect.setPosition(x, y);
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
      yPosition = GAME_H - 100;
    } else {
      // Default position for intro/tutorial stages
      yPosition = GAME_H - 30;
    }
    return makeButton(this, GAME_W / 2, yPosition, label, callback);
  }

/**
 * The one button style used on every canvas screen: rounded accent-colored pill
 * with hover state; disables itself after the first click so callbacks can't fire
 * twice. Returns the container (so callers can reposition/destroy it).
 */
function makeButton(scene, x, y, label, onClick, opts = {}) {
  const text = label.toUpperCase();
  const width = opts.width || Math.max(170, Math.round(text.length * 11.5) + 56);
  const height = opts.height || 48;
  const radius = 10;

  const container = scene.add.container(x, y).setDepth(opts.depth ?? 20000);
  const g = scene.add.graphics();
  const draw = (fill) => {
    g.clear();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-width / 2, -height / 2 + 3, width, height, radius);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
  };
  draw(THEME.accent);

  const labelText = addText(scene, 0, 0, text, {
    font: `bold 16px ${THEME.fontBody}`,
    fill: '#ffffff',
    resolution: window.devicePixelRatio || 1
  }).setOrigin(0.5);

  const hit = scene.add.rectangle(0, 0, width, height, 0x000000, 0)
    .setInteractive({ useHandCursor: true });

  container.add([g, labelText, hit]);

  let clicked = false;
  hit.on('pointerover', () => { if (!clicked) draw(THEME.accentHover); });
  hit.on('pointerout', () => { if (!clicked) draw(THEME.accent); });
  hit.on('pointerdown', () => {
    if (clicked) return;
    clicked = true;
    draw(THEME.disabled);
    labelText.setAlpha(0.7);
    hit.disableInteractive();
    scene.game.canvas.style.cursor = 'default';
    // Small delay to prevent rapid clicking issues
    setTimeout(() => { if (onClick) onClick(); }, 100);
  });

  return container;
}

/**
 * Zone label pill in the top-left corner of the canvas (the colored border carries
 * the zone identity everywhere else).
 */
function addZoneLabels(scene, zoneIndex, sessionIndex) {
  const pill = {
    font: `bold 20px ${THEME.fontDisplay}`,
    fill: THEME.text,
    backgroundColor: 'rgba(5, 7, 12, 0.75)',
    padding: { x: 12, y: 6 }
  };
  const left = (sessionIndex === 0 || sessionIndex === undefined) ? 'PRACTICE' : `EXPEDITION ${sessionIndex}`;
  addText(scene, 16, 14, left, pill).setDepth(10000);
  addText(scene, GAME_W - 16, 14, `ZONE ${zoneIndex}`, pill).setOrigin(1, 0).setDepth(10000);
}

/**
 * Shows a transition overlay before starting a gameplay stage.
 * @param {object} scene - The Phaser scene
 * @param {object} nextStage - The stage that will be shown next
 * @param {function} startCallback - Function to call when the user clicks the button
 */
/**
 * Tear down the current stage completely. The display list's removeAll() only
 * unlinks objects: interactive objects stay hit-testable, timers and tweens keep
 * firing, and loader callbacks still run — so a stale button from an earlier
 * stage could advance the game while a watch trajectory kept playing.
 */
function clearScene(scene) {
  scene.children.list.slice().forEach(obj => obj.destroy());
  scene.time.removeAllEvents();
  scene.tweens.killAll();
  scene.load.off('complete');
  scene.input.keyboard.removeAllListeners('keydown');
}

function showTransitionOverlay(scene, nextStage, startCallback) {
  // Clear existing scene elements
  clearScene(scene);
  // A DOM page (intro / how to play) may have hidden the frame; bring it back before
  // the slide is drawn, so the canvas frame first appears on the practice slide.
  restoreGameFrame();
  
  // Hide controls during transition overlays
  updateControlsDisplay("hidden");
  
  const W = GAME_W;
  const H = GAME_H;

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
  // Title (display font) + body. Timelines generated before overlay-title existed
  // fall back to the body alone, centered where the old message sat.
  const overlayTitle = stageType === 'online-choice' ? null : (nextStage["overlay-title"] || null);

  // Secondary message (watch games only; experience_message_text in the YAML). No
  // fallback: null means the experimenter omitted it.
  let secondaryMessage = null;
  if (stageType === 'watch' || stageType === 'indicate') {
    secondaryMessage = nextStage["secondary-overlay-message"] || null;
  }

  // Same zone as the last grid stage drawn: keep the asteroids on screen and show the
  // copy in a panel below them, so the participant can see that the zone did not
  // change instead of having to remember it. Zone changes keep the blackout slide.
  const gridStages = ['practice', 'play', 'watch', 'indicate', 'blind'];
  const keepScene = gameConfig && gameConfig.same_zone_transition === 'keep_scene'
    && gridStages.includes(stageType)
    && nextStage.zone && nextStage.zone.zone_global_index === lastGridZone;
  if (keepScene) {
    showInPlaceTransition(scene, nextStage, overlayTitle, message, secondaryMessage, buttonText, startCallback);
    return;
  }

  // Dimmed zone background (if the next stage has a zone) under a dark overlay, so
  // the zone identity carries through the transition.
  const overlay = scene.add.rectangle(0, 0, W, H, THEME.overlay, 0.72);
  overlay.setOrigin(0, 0).setDepth(-1);
  if (nextStage.zone && nextStage.zone.zone_global_index !== undefined) {
    const bgKey = `zone_bg_${nextStage.zone.zone_global_index}`;
    const addBg = () => {
      if (!scene.textures.exists(bgKey)) return;
      scene.add.image(0, 0, bgKey).setOrigin(0, 0).setDisplaySize(W, H).setDepth(-2);
    };
    if (scene.textures.exists(bgKey)) {
      addBg();
    } else {
      scene.load.image(bgKey, `assets/zone_backgrounds/${mapZoneBackground(nextStage.zone.zone_global_index)}`);
      scene.load.once('complete', addBg);
      scene.load.start();
    }
  }
  
  if (overlayTitle) {
    addText(scene, GAME_W / 2, 64, overlayTitle, {
      font: `bold 24px ${THEME.fontDisplay}`,
      fill: THEME.text,
      align: 'center',
      wordWrap: { width: 820 }
    }).setOrigin(0.5);
  }
  // Partner names inside the body take their ship's color.
  addRichText(scene,
    GAME_W / 2,
    150,
    message,
    {
      font: `21px ${THEME.fontBody}`,
      fill: THEME.text,
      wordWrap: { width: 680 },
      lineSpacing: 4
    },
    partnerHighlights(nextStage),
    0.5
  );
  
  // Update the game container border color immediately to match the next stage's zone
  if (nextStage.zone) {
    setGameBorderColor(generateZoneColor(nextStage.zone.zone_global_index));
  }

  // Create the button early so it always appears
  makeButton(scene, W / 2, H - 100, buttonText, startCallback, { width: 220 });
  
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
  
}

/**
 * Same-zone transition slide. The asteroid grid and the EXPEDITION/ZONE pills are
 * redrawn where they were (same cached textures, same geometry, so nothing moves),
 * the pips and Reward Tank are gone, and the title/body sit in a panel in the band
 * below the grid where the ship and tank normally live. Used instead of the blackout
 * slide when same_zone_transition is "keep_scene" and the next stage's zone equals
 * lastGridZone. Copy is the same overlay-title / overlay-message from models.py.
 */
function showInPlaceTransition(scene, nextStage, title, message, secondaryMessage, buttonText, startCallback) {
  const stageType = nextStage.stage_type || nextStage.game;
  const zone = nextStage.zone;
  const g = gridGeometry(zone.zone_bandit);

  addZoneLabels(scene, zone.zone_global_index, nextStage.session_index);
  createZoneBackgroundMask.call(scene, nextStage, g.gridOriginX, g.gridOriginY, g.numRows, g.numCols, g.cellWidth, g.cellHeight);

  if (title) {
    addText(scene, GAME_W / 2, 64, title, {
      font: `bold 24px ${THEME.fontDisplay}`,
      fill: THEME.text,
      align: 'center',
      backgroundColor: 'rgba(5, 7, 12, 0.75)',
      padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setDepth(10000);
  }

  // Message panel: from just under the grid to just above the button.
  const panelX = 90;
  const panelW = GAME_W - 2 * panelX;
  const panelTop = g.gridBottomY + 20;
  const panelBottom = GAME_H - 100 - 48;
  const panelH = panelBottom - panelTop;
  const panel = scene.add.graphics().setDepth(100);
  panel.fillStyle(THEME.panel, 0.88);
  panel.fillRoundedRect(panelX, panelTop, panelW, panelH, 12);
  panel.lineStyle(1, 0xffffff, 0.18);
  panel.strokeRoundedRect(panelX, panelTop, panelW, panelH, 12);

  // Who is up next (ship or partner) with its name, on the left of the panel.
  const spriteX = panelX + 70;
  const spriteY = panelTop + panelH / 2 - 12;
  const isWatch = stageType === 'watch' || stageType === 'indicate';
  const demo = isWatch ? nextStage.demonstrator : null;
  const name = demo ? (demo.demonstrator_name || '') : 'Prospector';
  const nameColor = demo ? (partnerColor(demo) || THEME.text) : THEME.text;
  const placeSprite = (key) => {
    const img = scene.add.image(spriteX, spriteY, key).setOrigin(0.5).setDepth(101);
    setSpriteDisplaySizeWithAspectRatio(img, DEMO_SPRITE_SIZE);
  };
  if (demo && demo.demonstrator_global_index !== undefined) {
    // Same key setupWatch uses, so a load here is not repeated when the stage starts.
    const key = `watch_${demo.demonstrator_global_index}`;
    if (scene.textures.exists(key)) {
      placeSprite(key);
    } else {
      scene.load.image(key, `assets/demonstrators/${mapDemonstratorImage(demo.demonstrator_global_index, demo.demonstrator_style, demo.demonstrator_color)}`);
      scene.load.once('complete', () => placeSprite(key));
      scene.load.start();
    }
  } else {
    placeSprite('user');
  }
  if (name) {
    addText(scene, spriteX, spriteY + DEMO_SPRITE_SIZE / 2 + 15, name, {
      font: `bold 14px ${THEME.fontBody}`,
      fill: nameColor,
      align: 'center',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(101);
  }

  // Body (partner names in their ship color), centered in the panel to the right of
  // the sprite. Drops one font step if the longest copy would overflow the panel.
  const textLeft = panelX + 140;
  const textW = panelW - 140 - 30;
  const textCx = textLeft + textW / 2;
  const textCy = panelTop + panelH / 2;
  const body = secondaryMessage ? `${message}\n\n${secondaryMessage}` : message;
  const render = (px) => addRichText(scene, textCx, textCy, body, {
    font: `${px}px ${THEME.fontBody}`,
    fill: THEME.text,
    wordWrap: { width: textW },
    lineSpacing: 4
  }, partnerHighlights(nextStage), 0.5);
  let rich = render(21);
  if (rich.height > panelH - 40) {
    rich.destroy();
    rich = render(19);
  }
  rich.objects.forEach(o => o.setDepth(101));

  makeButton(scene, GAME_W / 2, GAME_H - 100, buttonText, startCallback, { width: 220 });
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
    const container = scene.add.container(GAME_W / 2, 340); // Moved down to avoid overlap with text
    
    // Create a graphics object for drawing the border
    const border = scene.add.graphics();
    
    // Set fill style to zone color
    border.fillStyle(colorHex, 1);
    
    // Draw the outer rectangle (this is the border)
    border.fillRoundedRect(
        -iconWidth/2 - borderThickness, 
        -iconHeight/2 - borderThickness, 
        iconWidth + borderThickness*2, 
        iconHeight + borderThickness*2, 16
    );
    
    // Set fill style to dark background
    border.fillStyle(THEME.panel, 1);
    
    // Draw the inner rectangle (creates border effect)
    border.fillRoundedRect(
        -iconWidth/2, 
        -iconHeight/2, 
        iconWidth, 
        iconHeight, 8
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
    const zoneText = addText(scene, 
        0,
        iconHeight/2 - 40,
        `Zone ${zoneIndex}`,
        { 
            font: `bold 26px ${THEME.fontDisplay}`, 
            fill: '#ffffff',
            align: 'center' 
        }
    ).setOrigin(0.5);
    container.add(zoneText);
    
    // Add secondary message below the zone text if it exists
    if (secondaryMessage) {
        const secondaryText = addText(scene, 
            0,
            iconHeight/2 + 80,
            secondaryMessage,
            { 
                font: `24px ${THEME.fontBody}`, 
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
        let nameColor = '#ffffff';
        if (stageType === 'practice' || stageType === 'play' || stageType === 'blind') {
            nameText = 'Prospector';
        } else if ((stageType === 'watch' || stageType === 'indicate') &&
                   nextStage.demonstrator && nextStage.demonstrator.demonstrator_name) {
            nameText = nextStage.demonstrator.demonstrator_name;
            nameColor = partnerColor(nextStage.demonstrator) || nameColor;
        }
        
        if (nameText) {
            const nameLabel = addText(scene, 
                0,
                30, // Position below the image
                nameText,
                { 
                    font: `bold 14px ${THEME.fontBody}`, 
                    fill: nameColor,
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
    const container = scene.add.container(GAME_W / 2, 340); // Moved down to avoid overlap with text
    
    // Create a graphics object for drawing the border
    const border = scene.add.graphics();
    
    // Set fill style to zone color
    border.fillStyle(colorHex, 1);
    
    // Draw the outer rectangle (this is the border)
    border.fillRoundedRect(
        -iconWidth/2 - borderThickness, 
        -iconHeight/2 - borderThickness, 
        iconWidth + borderThickness*2, 
        iconHeight + borderThickness*2, 16
    );
    
    // Set fill style to dark background
    border.fillStyle(THEME.panel, 1);
    
    // Draw the inner rectangle (creates border effect)
    border.fillRoundedRect(
        -iconWidth/2, 
        -iconHeight/2, 
        iconWidth, 
        iconHeight, 8
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
        const zoneText = addText(scene, 
            0,
            50,
            "Choice Zone",
            { font: `bold 26px ${THEME.fontDisplay}`, fill: '#ffffff' }
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
    const container = scene.add.container(GAME_W / 2, 340); // Moved down to avoid overlap with text
    
    // Create a graphics object for drawing the border
    const border = scene.add.graphics();
    
    // Set fill style to zone color
    border.fillStyle(colorHex, 1);
    
    // Draw the outer rectangle (this is the border)
    border.fillRoundedRect(
        -iconWidth/2 - borderThickness, 
        -iconHeight/2 - borderThickness, 
        iconWidth + borderThickness*2, 
        iconHeight + borderThickness*2, 16
    );
    
    // Set fill style to dark background
    border.fillStyle(THEME.panel, 1);
    
    // Draw the inner rectangle (creates border effect)
    border.fillRoundedRect(
        -iconWidth/2, 
        -iconHeight/2, 
        iconWidth, 
        iconHeight, 8
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
        const zoneText = addText(scene, 
            0,
            50,
            `Zone ${zoneIndex}`,
            { font: `bold 26px ${THEME.fontDisplay}`, fill: '#ffffff' }
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
