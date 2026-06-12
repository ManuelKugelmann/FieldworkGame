# Expedition: Verdant Prime — Game Design

## Concept
A Euro action-point **logistics frame** wrapping a roguelite **push-your-luck field layer**. You lead a scientific expedition into a monsoon-threatened wilderness: explore, collect specimens, and race to publish your research before the storm ends the season. The hard AP cap makes the game about **efficiency toward a fixed ceiling**, not engine-building.

- Players: 2+ (built and balanced at 2).
- Length: ~36 field turns, then a one-turn-per-player **indoor lab season**, then scoring.
- End is **telegraphed** by monsoon cards surfacing from the bottom of the event deck.

---

## Map (10×10, procedural, per-match seed)

A **branching river system** carves the board:
- **Trunk** — a vertical wandering channel (full barrier).
- **Big branch** — a major fork off the trunk to an edge (full barrier).
- **Thin side arms** — narrow offshoots that are *fordable on foot* and act as *boat highways*.

Terrains: **road** (fast, sparse finds), **wild** (rich), **forest** (medium), **rocky** (passable, no finds), **water**.

**Crossings (organic):** exactly **1 central road bridge** (the only *defined* crossing — river cell nearest map centre, on the road network) + **2 foot bridges** on random river tiles. Some sections may end up **boat-only** or fully **isolated** — that's allowed; the play area simply shrinks.

**Generation guarantees** (else reseed, up to 96×, then fail loudly): water is one connected body; the road is one network attached to the centre bridge; the **main hub sits on the road**; the base-reachable area has enough forage to play; no boat-unreachable rocky islands. Isolated pockets/hubs are acceptable.

---

## Movement (AP-budgeted; `START_AP = 4`)

Edge-based on a weighted graph:
- **On-path** (road or foot edge) **or arm↔arm** boat-highway = **1 AP**.
- **Bushwhack / ford / open water** = **2 AP**.

Modes:
- **Foot** — anywhere except plain main-river water (cross only at bridges).
- **Car (`drive`)** — up to **3 road tiles per AP**, road edges only.
- **Boat** — water is a costly overlay; **main-river↔rocky exit-block** (can't board/disembark at rocky banks). Thin arms are fordable (2 AP) and boat-fast (1 AP).

Validation uses a **dry graph** (river = hard barrier) so the centre crossing stays load-bearing; play uses the **wet graph** (boats included).

---

## Core pipeline

1. **Discover** — entering a tile reveals **finds** drawn from that terrain's **fixed, finite pool** (without replacement). Carry is capped at `CARRY_SLOTS = 4`.
2. **Catalogue** — 1 AP + **2d6 ≥ `CATALOGUE_DC` (7)** (+ gear bonus). Success → a sample in your carry; failure → the find is lost (field attrition is the only failure).
3. **Publish (research)** — at a **hub** (or *anywhere* during the lab season): assemble a **set** from your owned samples; you may **cite at most `MAX_CITE` (1)** missing discovery from another player's published pool. Owned samples used move into **your published pool** (citable by others). Reward is **flat** — no citation penalty, no standalone bonus.

**Patterns:** `triple` (3 of one discipline → 4 prestige / 2 money), `rainbow` (1 of each of the 4 disciplines → 7 / 3).

---

## Economy & scoring

- **Prestige** is a single **signed accumulation**: research tokens (+) and negative tokens (−).
- **Money** has three competing sinks: **bank** it (→ VP), buy **gear**, or pay for **helilift**.
- **Score:** `vp = prestige + floor(money / 4)`.

---

## Events (one deck, 1 draw/turn)

Mostly benign (spare AP / money) with rare hazards:
- **Rockslide** — mutates a wild/forest tile to rocky (loses its finds).
- **Washout** — severs a random crossing's edges (never the last intact one).
- **Monsoon** — `MONSOON_END = 4` copies stacked at the deck **bottom**; as they surface the storm telegraphs, then the game enters the epilogue.

---

## Helilift (safety valve)

Airlift to the main hub. Costs `HELILIFT_COST = 12` money; any **shortfall converts to negative-prestige tokens** (4 money ≈ 1 prestige). This makes isolation and boat-traps survivable, and is the current source of the accumulation's negative half.

---

## Epilogue — indoor lab season

At the monsoon peak, fieldwork stops. Each player gets **one indoor turn** to publish carried samples **anywhere** (no hub needed), then the game scores. Models the research calendar: collect in the field season, write up in the off-season — so a last-minute scramble to fill carry slots still pays off.

---

## Tunables (balance knobs)

| Knob | Value | Notes |
|---|---|---|
| `MAX_CITE` | **1** | **Master knob.** Sweep-confirmed: 2 nearly doubles publishes (almost all cited) → runaway ~22-pt games. |
| `CATALOGUE_DC` | 7 | Minor dial on publish rate. |
| `CARRY_SLOTS` | 4 | Carry scarcity; = exactly a rainbow. |
| `START_AP` | 4 | AP/turn; ~2 bushwhack steps. |
| `MONSOON_END` | 4 | Game length. |
| `HELILIFT_COST` | 12 | Escape price (cash or negative prestige). |
| `GEAR_COST` / `GEAR_MAX` | 5 / 2 | +1 catalogue roll per level. |
| `CAR_STEPS` | 3 | Road tiles per AP by car. |
| money→VP | /4 | Conversion rate. |

Current tunables yield ~3.5–4 publishes/match, ~50/50 standalone-vs-cited, close ~12–14-point finishes.

---

## Extension (m6 — not built)

Opt-in **exploitation / conservation** cash-out channels with a **region-health slider** and **thresholds** — a richer, more thematic source of negative/reputation tokens than helilift alone.

---

## Status

- **Implemented & verified** (strict `tsc` + real boardgame.io `Client` + headless sweeps over hundreds of maps): map, movement, pipeline, economy, events, vehicles, gear, helilift, epilogue.
- **Pending:** m6 extension; wider parameter tuning; optional networked multiplayer (currently hotseat / static).
