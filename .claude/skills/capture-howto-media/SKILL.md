---
name: capture-howto-media
description: Regenerate the How to Play page media (assets/introduction/move.gif, shoot.gif, reward.png, no_reward.png) by capturing the live game with scripts/capture_howto_media.mjs, review the result and wire it into the page. Use this whenever the user asks to update, refresh, re-record or re-screenshot the how-to-play GIFs or images, says the instructions page looks outdated, wants a new panel on that page, or changes anything the captures show (asteroid grid, ship sprite, Reward Tank, outcome pips, shot animation, key hints), even if they never say "screenshot".
---

# Capture How to Play media

The How to Play page (`instructions` stage) shows cropped captures of the real game, so
every visual change to the practice/play screen makes them stale. The capture is scripted;
your job is to run it, look at what came out, fix the script when the game moved under it,
and keep the page wired to the files.

## Run it

Prerequisites: the server running (`npm start`), `ffmpeg` on PATH, Google Chrome installed
(`playwright-core` launches it via `channel: 'chrome'`, no browser download). A stopped
MongoDB is fine: `/api/log` answers 503 and the client just queues.

Capture into the scratchpad first so the committed files only change once you have looked:

```bash
npm run capture-howto -- --out <scratchpad>/howto     # ~20 s, headless
npm run capture-howto -- --headed                      # watch it drive the game
```

Then copy the four files into `assets/introduction/`.

## Review before copying

Extract frames and look at them (the Read tool renders PNGs):

```bash
python3 -c "
from PIL import Image
for n in ['move','shoot']:
    im = Image.open(f'{n}.gif'); d = []
    for i in range(im.n_frames):
        im.seek(i); d.append(im.info['duration']); im.convert('RGB').save(f'{n}_f{i:02d}.png')
    print(n, im.n_frames, im.size, d)"
```

Check each file for what it is supposed to teach:

- `move.gif`: ship jumps right twice and left twice; the ← / → key cap shows for each press
  and disappears during the holds; the last frame holds (no stray 40 ms frame at the end).
- `shoot.gif`: Space key cap, red bullet in flight, white flash, then a green pip above the
  asteroid plus a green tank slot ("1 earned · 1 / 6 shots"), then a second shot that comes
  up red ("1 earned · 2 / 6 shots").
- `reward.png` / `no_reward.png`: one green or red pip above the ship's asteroid and the
  matching first slot in the tank.
- Nothing outside the crop leaks in (no header pills, no Next button), and the crop still
  shows the ship with its name, four asteroids and the whole tank with its counter.
- Sizes: GIFs a few hundred KB, PNGs under ~500 KB. Widen the hold merge or drop
  `GIF_WIDTH` to 480 if a GIF balloons.

Asteroid art and the zone background differ between the four files because each capture
reloads the game and the practice zone is drawn fresh. That is expected.

## When the game changed and the script needs work

Everything lives in `scripts/capture_howto_media.mjs`. It drives the DOM pages with
Playwright, then talks to Phaser through `page.evaluate`, which can reach `main.js`
top-level names (`game`, `DPR`, `THEME`, `addText`, `currentPosition`, `currentGameType`,
`timelineData`) because main.js is a classic script.

| Symptom | Where to look |
|---|---|
| Crop shows the wrong region | `CROP` (game units, 1000×600 space). It is centred on the Reward Tank (x=500) and spans asteroid columns 4–7; grid geometry is `gridOriginX = 75`, cell `BASE_CELL_SIZE` + `CELL_PADDING`, row at `GRID_TOP_Y`, tank at `tankY`. Changing `CROP.w`/`h` changes the image size: update `.howto-item img { aspect-ratio }` in index.html to match (see below). |
| Times out waiting for the PRACTICE button | `startPractice` looks for a canvas text object reading `PRACTICE` on the transition slide, then clicks game coords (500, 500), the `makeButton` position in `showTransitionOverlay`. |
| Times out waiting for the practice scene | `waitForFunction` keys on `currentGameType === 'practice'`, an image with texture key `user`, and `numCols` images whose key starts with `asteroid_`. |
| Shots are not green/red as intended | `setOutcome` patches `Math.random` because `pullArm` does `outcome = Math.random() < payoff`. Green needs a column whose payoff is > 0 (one practice payoff is 0.0), which is why `[5, 6, 4, 7].find(...)` reads `timelineData[0]`'s practice stage. |
| Animation cut off or badge timing wrong | `shoot()` records 800 ms (bullet `BULLET_FLIGHT_MS` 150 + flash 200 + pip pop 180). Holds are in `captureMove` / `captureShoot`; `KEY_BADGE_MS` is how long a key cap stays up. |
| Key cap looks off | `showKey` draws it in Phaser (rect `0x161a23` + white stroke, Inter 600 16 px) to mirror `.control-icon` in index.html, at the crop's top-left. |
| Last GIF frame flashes by | The gif muxer ignores the concat duration of the final frame; `writeGif` passes `-final_delay`. Keep that if you touch the ffmpeg command. |

Frames are snapshots from `game.renderer.snapshotArea` at `DPR` (2 in the script's
context), so a 290×322 crop is a 580×644 image. Identical consecutive frames are merged
into one longer frame, which is why a hold costs nothing.

## Keep the page wired

- The filenames and captions come from `howto_panels` in `timeline_models/models.py`
  (the `instructions` stage). `main.js` `howToPageHtml` renders whatever panels it gets;
  `[KEY]…[/KEY]` in a caption becomes a key cap. A new panel = a new capture in the
  script + a new entry there. The intro stage carries no instruction data.
- `index.html` `.howto-item img` has `aspect-ratio: 580 / 644`. `showDomPage` measures
  the page height to centre it over the frame area, and without a reserved box the
  images measure 0 before they load and the Next button ends up under the Prospector
  row. If the capture dimensions change, change that ratio.
- Four panels at 200 px fit on one row inside the 900 px page; check the page in Chrome
  afterwards: step through the Prolific form → Begin Training, confirm the GIFs animate,
  the Next button clears the Prospector row with no scrolling, and Next starts practice.
- README.md documents the `panels` / `note` shape of the `instructions` stage.
