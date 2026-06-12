# CLAUDE.md

Guidance for Claude Code working on **Expedition: Verdant Prime**. Read `game_design.md` for the design intent; this file is how to build, verify, and extend the code.

## What this is
A **serverless** (static, GitHub Pages) digital implementation of the board game, built on **boardgame.io**. Sim-first: **one rules codebase** (`src/game.ts`) drives the UI, a real-engine smoke test, and headless balance sweeps.

## Stack
- **boardgame.io `^0.50.2`** — game engine. The `Game` object exposes `setup`, `moves`, `turn.onBegin`/`onEnd`, `endIf`, `ai.enumerate`, and uses the `random` plugin (`random.D6/Die/Number`). Move signature: `({ G, ctx, random, events }, ...args)`, immer mutation, return `INVALID_MOVE` to reject.
- **React 18 + Vite 5** (UI), **TypeScript 5** (strict).
- **tsx** — run TS scripts headless (`scripts/*.ts`).
- Deploy: static `vite build` → gh-pages (set `base: '/<repo>/'` in `vite.config.ts`).

## Layout
- `src/game.ts` — **ALL rules** (single source of truth): map generation + validation, the movement graph, moves (`move` / `drive` / `catalogue` / `publish` / `buy` / `helilift`), event deck, `turn` + `endIf`, `ai.enumerate`, and the heuristic `botAction`. Exports `Expedition` (the `Game`), `enumerate`, `botAction`.
- `src/bot.ts` — seeded RNG + `pickAction = botAction` (UI self-play).
- `src/Board.tsx` — ASCII/monospace renderer, legal-move panel, self-play controls, live invariant checker.
- `src/App.tsx`, `src/main.tsx`, `index.html` — boardgame.io `Client` wiring.
- `scripts/smoke.ts` — real-`Client` end-to-end gate (`npm run smoke`).
- `scripts/sweep.ts` — headless balance metrics (`npm run sweep [n]`).
- `.github/workflows/deploy.yml` — gh-pages.

(The complete file contents live in the starter doc `Expedition_Verdant_Prime_serverless_starter.md`; `game.ts` here is the current verified rules file.)

## Commands
- `npm run dev` — local UI.
- `npm run build` / `npm run preview` — production build.
- `npm run smoke` — 20 matches through the **real engine**; each must reach a valid `gameover`. **CI gate.**
- `npm run sweep [n]` — `n` self-play matches; prints publishes / cited / drives / boats / helilifts / gear / score spread.
- `npx tsc --noEmit` — strict type-check.

## How to work here (verification loop)
Rules live in `game.ts` **only**. After **any** change, run all three before trusting it:
1. `npx tsc --noEmit` (strict — this has caught real bugs: a comment swallowing constants, a stale union type, a `never`-narrow).
2. `npm run smoke` (must stay green).
3. `npm run sweep` (scores should stay sane — winner ~12–15 at current tunables; a big jump means you moved a balance knob).

## Architecture notes (don't break these)
- **Two movement predicates:** `canMoveDry` (validation — river is a hard barrier) vs `canMove` (play — boats overlay + main-river↔rocky exit-block). Validation must keep the **centre road bridge load-bearing**; do not validate on the wet graph. *(m6 reworks this — see Movement redesign.)*
- **Edge-based movement:** `roads` / `paths` bitmasks (`N1 E2 S4 W8`). `cost` = 1 on-path or `arm↔arm`, else 2. *(m6: add `smallRivers` + `blocked` edge masks; drop `arm`.)*
- **Two-phase map gen:** lay river → big branch → thin arms → crossings → roads **first**, then flood land, carve forest/rocky, repair rocky islands. Reseed up to **96×**, then **throw** (fail-early). Per-match seed comes from bgio `random` in `setup`.
- **Prestige** is one **signed** accumulation (research + negative tokens); `vp = prestige + floor(money/4)`.
- **Epilogue** is a plain phase flag (`G.epilogue` / `G.labLeft`) decremented in `turn.onEnd`, not bgio `phases`.

## Movement redesign (m6 — agreed, in progress)
Everything that moves is **edges (links) on a base tile**; non-link movement uses base-terrain rules. Four edge bitmasks (`N1 E2 S4 W8`): `roads`, `paths`, **`smallRivers`** (new), **`blocked`** (new).
- **No large water bodies.** Water = **1-tile-wide rivers** only (the existing minimally-branching trunk/branch). Crossable solely by a **bridge** (foot/road) or a **boat** — foot `move` no longer wades onto water (today it does at 2 AP).
- **Brooks** replace river *arms*: a `smallRivers` edge overlay on **land** cells — "paths, but for boats." A player **with a boat** travels along a brook at **1 AP/step**; on foot a brook edge is plain terrain (ford ≈ 2). Drop `arm`/`isArm`/`mkArm`.
- **Boat = portable inventory item** (not a positioned ride like the car). One shared boat, a droppable/pick-up-able frontier resource (mirrors the gear `drop`/`pickup` machinery). **Carrying the boat = being boated:** you may enter water tiles and travel brook edges at boat-rate; drop it at any non-`blocked` bank for another player to grab. Without the boat, water is impassable.
- **Cliffs = generalized `blocked` edges:** uncrossable by foot **and** car **and** boat, placeable on **any** edge. The old hardcoded boat↔rocky-shore exit-block becomes one instance (a `block()`ed water↔rocky edge at gen); plus **1–2 random cliff edges per land tile** (on plain land↔land edges only, so they can't orphan the road/water/footpath networks). Thread `onBlocked` through `canMove`/`canMoveDry`/`compRoad`/`roadReach`; the existing `placeHotspots` forage guard + reseed keeps the base area playable.

Build in two verified commits (run the loop after each): **(1)** brooks + `blocked`/cliffs + render + validation; **(2)** portable boat + boat-only water + bot/enumerate + legends. Then update `game_design.md` and this file's Status/notes.

## Tunables (top-of-file consts)
`MAX_CITE` (1), `CATALOGUE_DC` (7), `CARRY_SLOTS` (4), `START_AP` (4), `MONSOON_END` (4), `HELILIFT_COST` (12), `GEAR_COST` (5) / `GEAR_MAX` (2), `CAR_STEPS` (3), money→VP `/4`. To tune, change a const → recompile → `npm run sweep`. For many values, parameterize via `setupData` rather than editing consts.

## Known findings
- **`MAX_CITE = 1` is correct** — the sweep shows `2` nearly doubles publishes (the extra almost all *cited*) and inflates winning scores ~12→~22. Keep `1` unless re-swept.
- **Boats matter** on varied maps (~1.5 water-steps/match) because organic crossings leave some sections boat-only; on a single fixed map they look inert.
- **MCTS:** bgio's `MCTSBot` is interface-compatible (same `enumerate`) but **full playouts run to terminal (~minutes/match)** and shallow playouts play badly (it helilifts into negative prestige). Stronger-than-heuristic tuning is an **offline** job, or needs game-specific `objectives`. The heuristic sweep is the practical in-loop tool.

## Status
- **Done & verified:** m1 map, m2 economy + citations, m3 events/monsoon/hazards, m4 gear/car/boat/helilift, epilogue (lab season), m5 smoke + sweep tooling.
- **Pending:** **m6 movement redesign** (brooks-as-edges + 1-wide rivers + portable boat + generalized cliff/`blocked` edges — see section above; the active task); m7 extension (exploitation/conservation cash-out + region-health slider + thresholds — the richer negative-token source); wider parameter tuning; optional networked multiplayer.

## Guardrails
- Keep it **serverless/static** — no server-authoritative multiplayer without discussion.
- Preserve the **dry/wet validation split** and the **load-bearing centre road bridge**.
- Every rules change must keep `smoke` green and `sweep` scores sane.
- Child- and content-safety, licensing: original work only; no copyrighted board-game assets/text.
