# Same-zone transition without the blackout

Approved 2026-10-15. Keep the blackout slide for zone changes; when the next grid stage
is in the same zone as the last one drawn, keep the asteroid grid and zone pills on
screen, drop the pips/Reward Tank, and show the same overlay copy in a panel below the
grid with the next actor's sprite. Gated by `same_zone_transition` in the YAML.

- [x] 1. Config knob `same_zone_transition: blackout | keep_scene`
  - [x] 1.1 `configs/pilot_E.yaml` — set `keep_scene` (~3 lines)
  - [x] 1.2 `server.js` `/api/config` — expose the flag, default `blackout` (~1 line)
  - [x] 1.3 `CONFIG.md` — field entry (~7 lines)
  - [x] 1.4 `npm run build-config` — regenerate `config.json`
- [x] 2. `lastGridZone` tracker — `main.js` (declaration near `outcomePips`; set in `loadStage` for grid stages) (~7 lines)
- [x] 3. `gridGeometry(bandit)` helper — `main.js` next to `getCellBelow` (~18 lines)
- [x] 4. `showTransitionOverlay` branch — compute `secondaryMessage` early, `keepScene` gate, move the dim-overlay block below it (~20 lines)
- [x] 5. `showInPlaceTransition()` — zone pills, grid via `createZoneBackgroundMask`, title pill, panel, sprite+name, `addRichText` body with 21→19px fallback, button (~90 lines)
- [x] 6. Plan checklist copy — this file

## Findings
- Longest copy ("LAST SHOTS IN THIS ZONE", 5 lines at 21px) fit the panel with ~10px margins; lowered the font-drop threshold from `panelH - 24` to `panelH - 40` so 5-line bodies render at 19px.
- Verified in Chrome: practice/new-zone/choice slides stay blackout; watch→play, play→watch (partner sprite loaded on demand), watch→play(last shots) use the in-place slide; grid does not move on Play/Watch; setting the flag to `blackout` restores the old slide.
