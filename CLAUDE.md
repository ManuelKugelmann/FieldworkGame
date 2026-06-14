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
- **Movement predicates (three graphs):** `canMoveDry` (validation — river is a hard barrier) · `canMove`/`cost` (FOOT play graph — **water impassable without a boat**, no foot-ford of open water) · `canBoat`/`boatCost` (BOAT graph when `p.boat` — water + brooks at 1 AP). `onBlocked` (cliffs) hard-stops every graph. `move` picks foot-vs-boat by `p.boat`. Validation must keep the **centre road bridge load-bearing**; the foot graph also excludes water, so the base area must be foot/bridge-reachable.
- **Edge-based movement:** four bitmasks (`N1 E2 S4 W8`) — `roads`, `paths`, `smallRivers` (brooks), `blocked` (cliffs). Foot `cost` = 1 on-path else 2 (brooks give **no** foot discount); `boatCost` = 1 on water/brook/path else 2.
- **Two-phase map gen:** lay river → big branch → crossings → roads **first**, then flood land, carve forest/rocky, scatter **cliffs** (`blocked` edges), place hotspots, then footpaths **and brooks** (`smallRivers` overlays on land). Reseed up to **96×**, then **throw** (fail-early). Per-match seed comes from bgio `random` in `setup`.
- **Prestige** is one **signed** accumulation (research + negative tokens); `vp = prestige + floor(money/4)`.
- **Epilogue** is a plain phase flag (`G.epilogue` / `G.labLeft`) decremented in `turn.onEnd`, not bgio `phases`.

## Movement redesign (m6 — done & verified)
Everything that moves is **edges (links) on a base tile**; non-link movement uses base-terrain rules. Four edge bitmasks (`N1 E2 S4 W8`): `roads`, `paths`, **`smallRivers`** (new), **`blocked`** (new).
- **No large water bodies.** Water = **1-tile-wide rivers** only (the existing minimally-branching trunk/branch). Crossable solely by a **bridge** (foot/road) or a **boat** — foot `move` no longer wades onto water (today it does at 2 AP).
- **Brooks** replace river *arms*: a `smallRivers` edge overlay on **land** cells — "paths, but for boats." A player **with a boat** travels along a brook at **1 AP/step**; on foot a brook edge is plain terrain — fording costs the **underlying terrain cost, no surcharge** (i.e. `cost` is unchanged: `onPath ? 1 : 2`, with `smallRivers` discount applying only when boated). Drop `arm`/`isArm`/`mkArm`.
- **Boat = portable inventory item** (not a positioned ride like the car). One shared boat, a droppable/pick-up-able frontier resource (mirrors the gear `drop`/`pickup` machinery). **Carrying the boat = being boated:** you may enter water tiles and travel brook edges at boat-rate; drop it on **any tile** for another player to grab. Without the boat, water is impassable. Term of art is **boating** (never "sailing") across moves/logs/UI.
- **Unified item model.** Gear, boat, and car are all board *items*. **Gear** and **boat** are **inventoryable** (carried). The **car** is **not** inventoryable — it stays a positioned entity (`board`/`leave`/`drive`) and is usable **only on the road network** (roads + base/village), never off-road; this matches its current `roadReach` restriction, now framed as the item's usage constraint. Boat is the water counterpart: carried, usable only on water tiles + brook edges. **All carryable gear/items can be `drop`ped** on the current tile (and `pickup`ed) — uniform, no location restriction; a dropped item just caches on the tile until reclaimed.
- **No rocky exit constraints.** Drop the boat↔rocky-shore exit-block entirely (`canMove` line ~36) — rocky tiles no longer gate boat launch/landing. The rocky-island repair at gen (line ~132) is then unnecessary too (a water-locked rocky tile is reachable by boat).
- **Cliffs = generalized `blocked` edges:** uncrossable by foot **and** car **and** boat, placeable on **any** edge. The *only* enter/exit barriers; sourced purely from **1–2 random cliff edges per land tile** (on plain land↔land edges only, so they can't orphan the road/water/footpath networks). Thread `onBlocked` through `canMove`/`canMoveDry`/`compRoad`/`roadReach`; the existing `placeHotspots` forage guard + reseed keeps the base area playable.

Shipped in three verified commits: **(1)** brooks + `blocked`/cliffs + render + validation; **(2)** portable boat + boat-only water + enumerate + legends; **(3)** boat-and-car-aware `botAction`. `stepToward`/`reachGoals` take a `boat` flag (route on `canBoat`/`boatCost` vs `canMove`/`cost`). The bot grabs the shared boat only when `reachGoals(boat) > reachGoals(foot)` (water actually fences off forage), then routes on the boat graph; `carStep` boards/drives the car along roads toward a goal **≥3 tiles away** (so it doesn't churn on ubiquitous nearby forage), dismounting when roads stop helping. **Watch the helilift guard:** only fly home when the hub is *unreachable* (`nx < 0`), never merely unaffordable-this-turn (that bug cost ~1 helilift/match and ~2 VP). Cliff density knob: `rand() >= 0.14` in `genOnce` (≈13 cliff edges/map); brooks: `brookN` 1–2.

## Tunables (top-of-file consts)
`MAX_CITE` (1), `CATALOGUE_DC` (7), `CARRY_SLOTS` (4), `START_AP` (4), `MONSOON_END` (4), `HELILIFT_COST` (12), `GEAR_COST` (5) / `GEAR_MAX` (2), `CAR_STEPS` (3), money→VP `/4`. To tune, change a const → recompile → `npm run sweep`. For many values, parameterize via `setupData` rather than editing consts.

## Known findings
- **`MAX_CITE = 1` is correct** — the sweep shows `2` nearly doubles publishes (the extra almost all *cited*) and inflates winning scores ~12→~22. Keep `1` unless re-swept.
- **The bot uses both items, and it pays off.** Boat-aware routing lifts reachable forage → publishes ~3.5/match and **winner VP ~12** (above the foot-only ~10.5), with **boats ~17 water-steps/match**, **drives ~0.6** (car only for far goals), helilifts ~0. One shared boat means P0 (first mover) usually grabs it → slightly wider score spread (~3); that's the intended race for a scarce resource. Boat crossing is also covered by a white-box check (footed blocked, boated allowed).
- **MCTS:** bgio's `MCTSBot` is interface-compatible (same `enumerate`) but **full playouts run to terminal (~minutes/match)** and shallow playouts play badly (it helilifts into negative prestige). Stronger-than-heuristic tuning is an **offline** job, or needs game-specific `objectives`. The heuristic sweep is the practical in-loop tool.

## Status
- **Done & verified:** m1 map, m2 economy + citations, m3 events/monsoon/hazards, m4 gear/car/helilift, epilogue (lab season), m5 smoke + sweep tooling, **m6 movement redesign** (brooks-as-edges + 1-wide rivers + portable boat + generalized cliff/`blocked` edges — see section above).
- **Pending:** m7 extension (exploitation/conservation cash-out + region-health slider + thresholds — the richer negative-token source); wider parameter tuning; optional networked multiplayer.

## Guardrails
- Keep it **serverless/static** — no server-authoritative multiplayer without discussion.
- Preserve the **dry/wet validation split** and the **load-bearing centre road bridge**.
- Every rules change must keep `smoke` green and `sweep` scores sane.
- Child- and content-safety, licensing: original work only; no copyrighted board-game assets/text.
