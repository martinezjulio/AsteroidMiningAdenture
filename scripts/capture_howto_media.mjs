#!/usr/bin/env node
/**
 * Regenerates the How to Play media in assets/introduction/ from the live game:
 *
 *   move.gif       ← / → moving the ship between asteroids
 *   shoot.gif      Space: a rewarded shot, then an unrewarded one
 *   reward.png     the state right after a rewarded shot
 *   no_reward.png  the state right after an unrewarded shot
 *
 * It drives the real game in the installed Google Chrome (playwright-core with
 * channel "chrome", so no browser download), steps through the Prolific form, the
 * intro and the how-to page into the practice round, then crops Phaser renderer
 * snapshots to the ship, four asteroids and the Reward Tank. Shot outcomes are
 * forced by patching Math.random around each shot. GIFs are assembled with ffmpeg.
 *
 * Prerequisites: the server running (npm start) and ffmpeg on PATH.
 *
 *   npm run capture-howto [-- --base-url http://localhost:8080 --headed --out assets/introduction]
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const GAME_W = 1000;
const GAME_H = 600;
// Crop in game units: asteroid columns 4–7, the outcome pips above them, the ship
// with its name, and the Reward Tank with its counter (grid geometry in main.js).
const CROP = { x: 355, y: 140, w: 290, h: 322 };
const GIF_WIDTH = 580; // the crop at DPR 2, i.e. 1:1 with the captured pixels
const CAPTURE_FPS = 25;
const KEY_BADGE_MS = 350;
const PROLIFIC_ID = 'HOWTO_CAPTURE';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { baseUrl: 'http://localhost:8080', headed: false, out: path.join(repoRoot, 'assets', 'introduction') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--headed') args.headed = true;
    else if (a === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, cmdArgs, cwd) {
  const res = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')}\n${res.stderr}`);
}

/* ---------- page-side helpers (everything inside page.evaluate runs in the game) ---------- */

async function snap(page) {
  const dataUrl = await page.evaluate(({ x, y, w, h }) => new Promise((resolve) => {
    game.renderer.snapshotArea(
      Math.round(x * DPR), Math.round(y * DPR), Math.round(w * DPR), Math.round(h * DPR),
      (img) => resolve(img.src)
    );
  }), CROP);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function clickGame(page, gx, gy) {
  const r = await page.evaluate(() => {
    const b = game.canvas.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  await page.mouse.click(r.left + (gx * r.width) / GAME_W, r.top + (gy * r.height) / GAME_H);
}

// Practice-stage facts from the timeline: payoff per column and the column count.
async function practiceInfo(page) {
  return page.evaluate(() => {
    const stage = timelineData[0].find((s) => s.game === 'practice');
    const payoffs = stage.zone.zone_bandit[0];
    return { payoffs, numCols: payoffs.length };
  });
}

async function shipCol(page, numCols) {
  return page.evaluate((n) => currentPosition % n, numCols);
}

async function moveTo(page, col, numCols) {
  let cur = await shipCol(page, numCols);
  while (cur !== col) {
    await page.keyboard.press(cur < col ? 'ArrowRight' : 'ArrowLeft');
    await sleep(60);
    cur = await shipCol(page, numCols);
  }
}

// 'hit' | 'miss' force the next shots' outcome (main.js: outcome = Math.random() < payoff);
// null restores the real RNG.
async function setOutcome(page, mode) {
  await page.evaluate((m) => {
    if (!window.__origRandom) window.__origRandom = Math.random;
    if (m === 'hit') Math.random = () => 0;
    else if (m === 'miss') Math.random = () => 0.9999;
    else Math.random = window.__origRandom;
  }, mode);
}

// Key-cap badge drawn inside the game (so it uses the game's fonts and lands in the
// snapshot), styled like the .control-icon key caps under the canvas.
async function showKey(page, label) {
  await page.evaluate(({ label, x, y }) => {
    const scene = game.scene.scenes[0];
    if (window.__keyBadge) { window.__keyBadge.destroy(); window.__keyBadge = null; }
    const h = 34;
    const text = addText(scene, 0, 0, label, { font: `600 16px ${THEME.fontBody}`, fill: THEME.text }).setOrigin(0.5);
    const w = Math.max(40, Math.ceil(text.width) + 22);
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 0.28);
    g.fillRoundedRect(0, 0, w, h + 3, 7); // border, thicker at the bottom
    g.fillStyle(0x161a23, 1);
    g.fillRoundedRect(1, 1, w - 2, h - 2, 6);
    text.setPosition(w / 2, h / 2);
    window.__keyBadge = scene.add.container(x, y, [g, text]).setDepth(1e6);
  }, { label, x: CROP.x + 12, y: CROP.y + 8 });
}

async function hideKey(page) {
  await page.evaluate(() => {
    if (window.__keyBadge) { window.__keyBadge.destroy(); window.__keyBadge = null; }
  });
}

/* ---------- driving the game into the practice round ---------- */

async function startPractice(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'load' });
  const input = page.locator('#prolific-id-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(PROLIFIC_ID);
  await page.locator('#prolific-submit-btn:not([disabled])').click();
  await page.getByRole('button', { name: /begin training/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();

  // The transition slide is drawn on the canvas; wait for its PRACTICE button.
  await page.waitForFunction(() => {
    const scene = game.scene.scenes[0];
    return scene.children.list.some((o) => o.list && o.list.some((c) => c.text === 'PRACTICE'));
  }, null, { timeout: 15000 });
  await sleep(300);
  await clickGame(page, GAME_W / 2, GAME_H - 100);

  const info = await practiceInfo(page);
  await page.waitForFunction((n) => {
    if (typeof currentGameType === 'undefined' || currentGameType !== 'practice') return false;
    const list = game.scene.scenes[0].children.list;
    const hasUser = list.some((o) => o.texture && o.texture.key === 'user');
    const asteroids = list.filter((o) => o.texture && String(o.texture.key).startsWith('asteroid_')).length;
    return hasUser && asteroids >= n;
  }, info.numCols, { timeout: 20000 });
  await sleep(600);
  return info;
}

/* ---------- frame recording and encoding ---------- */

class Recorder {
  constructor(page) { this.page = page; this.frames = []; }

  // One frame shown for `ms` (the game is static, so no wall-clock wait is needed).
  async hold(ms) { this.push(await snap(this.page), ms); }

  // Snapshots at up to CAPTURE_FPS for `ms` of wall-clock time.
  async record(ms) {
    const interval = 1000 / CAPTURE_FPS;
    const t0 = Date.now();
    let last = null;
    for (;;) {
      const t = Date.now();
      if (t - t0 >= ms) break;
      const buf = await snap(this.page);
      if (last) this.push(last.buf, t - last.t);
      last = { buf, t };
      const spent = Date.now() - t;
      if (spent < interval) await sleep(interval - spent);
    }
    if (last) this.push(last.buf, Math.max(interval, Date.now() - last.t));
  }

  push(buf, ms) {
    const prev = this.frames[this.frames.length - 1];
    if (prev && prev.buf.equals(buf)) prev.ms += ms;
    else this.frames.push({ buf, ms });
  }
}

function writeGif(frames, outPath, width) {
  const dir = mkdtempSync(path.join(tmpdir(), 'howto-frames-'));
  const name = (i) => `f${String(i).padStart(4, '0')}.png`;
  const lines = [];
  frames.forEach((f, i) => {
    writeFileSync(path.join(dir, name(i)), f.buf);
    lines.push(`file '${name(i)}'`, `duration ${(f.ms / 1000).toFixed(3)}`);
  });
  writeFileSync(path.join(dir, 'list.txt'), lines.join('\n') + '\n');
  // The gif muxer ignores the concat duration of the last frame; set it explicitly (centiseconds).
  const finalDelay = String(Math.round(frames[frames.length - 1].ms / 10));

  const scale = `scale=${width}:-1:flags=lanczos`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
    '-vf', `${scale},palettegen=stats_mode=diff`, 'palette.png'], dir);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'palette.png',
    '-lavfi', `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-loop', '0', '-final_delay', finalDelay, outPath], dir);
  rmSync(dir, { recursive: true, force: true });
}

// Lossless PNG re-encode (RGB, max compression): about a third smaller than the raw snapshot.
function writePng(buf, outPath) {
  const dir = mkdtempSync(path.join(tmpdir(), 'howto-still-'));
  writeFileSync(path.join(dir, 'raw.png'), buf);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', 'raw.png', '-pix_fmt', 'rgb24', '-compression_level', '100', '-pred', 'mixed', outPath], dir);
  rmSync(dir, { recursive: true, force: true });
}

/* ---------- the four captures ---------- */

// Fires one shot with a forced outcome; resolves once the pip and tank have updated.
async function shoot(page, outcome, rec) {
  await setOutcome(page, outcome);
  await page.keyboard.press('Space');
  if (rec) await rec.record(800); // bullet 150 ms, flash 200 ms, pip pop ~180 ms
  else await sleep(800);
  await setOutcome(page, null);
}

async function captureMove(page, baseUrl, out) {
  const { numCols } = await startPractice(page, baseUrl);
  await moveTo(page, 5, numCols);
  const rec = new Recorder(page);
  await rec.hold(700);
  for (const [key, label] of [['ArrowRight', '→'], ['ArrowRight', '→'], ['ArrowLeft', '←'], ['ArrowLeft', '←']]) {
    await showKey(page, label);
    await page.keyboard.press(key);
    await sleep(80);
    await rec.hold(KEY_BADGE_MS);
    await hideKey(page);
    await sleep(50);
    await rec.hold(550);
  }
  await rec.hold(400);
  writeGif(rec.frames, path.join(out, 'move.gif'), GIF_WIDTH);
}

async function captureShoot(page, baseUrl, out) {
  const { numCols, payoffs } = await startPractice(page, baseUrl);
  const col = [5, 6, 4, 7].find((c) => payoffs[c] > 0);
  await moveTo(page, col, numCols);
  const rec = new Recorder(page);
  await rec.hold(700);
  for (const outcome of ['hit', 'miss']) {
    await showKey(page, 'Space');
    await sleep(50);
    await shoot(page, outcome, rec);
    await hideKey(page);
    await sleep(50);
    await rec.hold(outcome === 'hit' ? 1300 : 1700);
  }
  writeGif(rec.frames, path.join(out, 'shoot.gif'), GIF_WIDTH);
}

async function captureStill(page, baseUrl, out, outcome, file) {
  const { numCols, payoffs } = await startPractice(page, baseUrl);
  const col = outcome === 'hit' ? [5, 6, 4, 7].find((c) => payoffs[c] > 0) : 5;
  await moveTo(page, col, numCols);
  await shoot(page, outcome, null);
  await sleep(200);
  writePng(await snap(page), path.join(out, file));
}

/* ---------- main ---------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const health = await fetch(`${args.baseUrl}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(`No game server at ${args.baseUrl} (start it with: npm start)`);
    process.exit(1);
  }
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('ffmpeg not found on PATH');
    process.exit(1);
  }
  mkdirSync(args.out, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    // The Prolific Start button asks for fullscreen; keep the viewport fixed instead.
    await context.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.resolve(); });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn('[page error]', e.message));

    console.log('move.gif …');      await captureMove(page, args.baseUrl, args.out);
    console.log('shoot.gif …');     await captureShoot(page, args.baseUrl, args.out);
    console.log('reward.png …');    await captureStill(page, args.baseUrl, args.out, 'hit', 'reward.png');
    console.log('no_reward.png …'); await captureStill(page, args.baseUrl, args.out, 'miss', 'no_reward.png');
  } finally {
    await browser.close();
  }

  for (const f of ['move.gif', 'shoot.gif', 'reward.png', 'no_reward.png']) {
    const kb = Math.round(statSync(path.join(args.out, f)).size / 1024);
    console.log(`${f.padEnd(14)} ${kb} KB`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
