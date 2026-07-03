# Expedition: Verdant Prime — Game Design

## Concept
A Euro action-point **logistics frame** wrapping a push-your-luck **field-science layer**. You lead a scientific expedition into a monsoon-threatened wilderness: explore, dig up specimens, and **race rivals to publish research** before the storm ends the season. The AP budget makes the game about **efficiency toward a fixed ceiling**; the shared research pool makes it a **first-come-first-served race**, not solitaire engine-building.

- **Players:** 2–4 (hotseat; one human seat by default, the rest bot-played).
- **Length:** a field season of event-deck rounds, then a one-turn-per-player **indoor lab season**, then scoring.
- **End is telegraphed:** monsoon cards stacked at the bottom of the event deck surface near the end; the field season closes once `MONSOON_END = 4` monsoons have hit **and** the round count is a whole multiple of the player count (every seat starts the same number of rounds).

---

## Map (fixed 18×18 footprint, ~200 active tiles, per-match seed)

A minimally-branching **1-tile-wide river** carves the board (no large open water):
- **Y-river** — a junction near the centre launches **three meandering arms** (~120° apart) that each run to a board edge: a full barrier crossable only by a **bridge** or a **boat**, with exactly **one 3-way fork**.
- **Brooks** — 2–3 narrow boat-only side-channels, drawn as **edge overlays on land** (`smallRivers`), mouthing at the river. "Paths, but for boats": **0.25 AP/step when boated**; on foot a brook is just terrain.
- **One waterfall** — a single `blocked` edge across the river channel: boats cannot pass it (rendered as white foam).

Everything that moves is an **edge link on a base tile** — bitmasks (`N1 E2 S4 W8`): `roads`, `paths` (footpaths), `smallRivers` (brooks), `rivers` (channel linkage), `blocked` (cliffs). **One connector per edge** — roads/paths/brooks/rivers never overlap on the same edge. Links render as **curved paths** (bends round off through the tile centre).

**Terrains** (each leans toward a discipline mix and a signature discovery colour):

| Terrain | Discipline mix | Colour lean | Notes |
|---|---|---|---|
| grassland | even sampler | mixed (no lean) | fast going, sparse |
| jungle | bot + zoo heavy | purple | the bulk of the wild |
| rocky | arch + geo | grey | geo scarce → premium payout |
| **ruins** | **archaeology motherlode** | navy | rare dig sites — **guaranteed 3/board, always bear a find** |
| **water** | aquatic (zoo/bot) | grey | a forageable biome — dig it by canoe/boat |
| void | — | — | off-board gaps (ragged edges) |

Biomes are **balanced** (grassland/rocky carved generously so jungle doesn't dominate); the active area grows outward from the road + river network to the 200-tile cap, with no interior holes and road dead-ends pointing into the void.

**Hotspots (5 kinds):**
- 🏢 **research base** — road hub ~3 road-tiles from the bridge: a market **and** a research terminal; helilift target.
- ⛺ **frontier base** — the farthest wild research terminal (may be boat-only to reach).
- 🏘️ **village** — a road market, near the middle of the road network.
- 🏠 **river village** (×2) — sits **on the river at a foot crossing**; a market and home of a shared **canoe + motorboat** each.
- 🏕️ **field camp** — player-deployed forward research terminal (see items below).

**Crossings:** exactly **1 central road bridge** (load-bearing) + **4 foot crossings** on straight river tiles — the two nearest the base become the river villages. **Cliffs:** 1–2 impassable `blocked` edges on ~22% of land tiles (uncrossable by foot/car/boat), placed only on plain land↔land edges and never on hotspots; rendered as a **jagged dark band** covering a third of the affected tile side.

**Generation guarantees** (else reseed, up to 160×, then fail loudly): one connected river; one road network on the central bridge; base/village/frontier placed; no hotspot on the road bridge; enough base-reachable forage; ≥3 ruins. Isolated pockets are allowed.

---

## Movement (`START_AP = 4`/turn)

- **Foot** — **0.5 AP** on a path/road edge, **1 AP** off-path. Open water is impassable without a boat — except **wading** one step onto/off a water tile holding a beached boat (canoe or moored motorboat), at normal foot cost.
- **Canoe** (the shared carried **boat**, 🛶) — while carried: enter water tiles, and river/brook steps cost **0.25 AP**; a **boat run** covers `BOAT_STEPS = 4` river-channel tiles per AP. Boats pass freely **under bridges** (water↔water is always open channel — climbing between a bridge deck and land still needs the crossing edge). Carryable, droppable on any tile, one starts at each river village.
- **Car** (🚗) — positioned road vehicle: board for **1 money**, drive up to `CAR_STEPS = 4` road tiles/AP (0.25 AP/tile), leave free (a foot move auto-dismounts). Two on the board (base + village). **Not buyable.**
- **Motorboat** (🛥) — positioned **large-river** vehicle: board from the bank (1 money), drive `MOTORBOAT_STEPS = 4` channel tiles/AP, dock ashore on leave (free). One moored at each river village. Stopped by the waterfall.
- **Helilift** (🚁) — 1 AP: airlift to base for `HELILIFT_COST = 12` money; any shortfall converts to **negative prestige** (4 money ≈ 1 prestige). The escape valve for isolation/traps.

Cliffs (and rockslide-sealed tiles) hard-block every mover. A **dry validation graph** (river = hard barrier) keeps the centre crossing load-bearing.

---

## Discoveries & cataloguing

- Each tile holds **at most one discovery**; roads and hotspots hold **none**. The chance a tile bears its find scales with its terrain **richness** (`FIND_CHANCE = 0.75` per richness trial; ruins always deliver).
- **Flip on enter (free):** entering a tile turns its discovery face-up — you see its discipline + colour. (Tile events resolve here too, see below.)
- **Catalogue (1 AP + roll):** **2d6 + gear + specialist bonus ≥ difficulty**. Difficulty by colour — 🟪 purple **5** (~83% bare) · ⬜ grey **8** (~42%) · 🟦 navy **13** (impossible bare — needs gear/specialist). Tiers: **snake eyes (1+1) → botched** — the find flees (fauna) / is destroyed regardless of bonuses, the *only* way an attempt loses it; **≥ DC → collected** into your hand; **any other miss → stays** (try again).
- **Hand cap:** `SPECIMEN_MAX = 8` carried specimens — a full hand blocks cataloguing until you publish or deposit at a research site. Opponents see only the **discipline** of your carried specimens, never the colour (a concealed poker hand).

**Tile-event cards** are mixed into each terrain's stack (~12%, with a per-terrain lean: rocky→rockslide, jungle→animal attack, ruins→bushthieves) and fire **on enter**, at most one of each kind per tile:
- ⛏ **rockslide** — buries the tile's find **and seals the whole tile** (all edges); you're **bumped back** to where you came from (hotspots are spared the seal).
- 🐗 **animal attack** — lose **1** carried item (specimen, else gear, else 1 AP).
- 🏴 **bushthieves** — robbed of 3 money.
- 🧭 **helpful native** — gain **1** easy (purple) specimen of the local discipline.

**Specialists:** each player is a **botanist / zoologist / geologist / archaeologist** — a permanent **+3 catalogue** bonus on their own discipline. Roles are shuffled per match (not fixed by seat); a player's pawn colour follows their discipline (geo blue · zoo red · bot green · arch yellow).

---

## Research (one shared open pool — "Texas Hold'em")

All research terminals — the **base**, the **frontier base**, and every deployed **field camp** — read and write **ONE shared, face-up open pool** (comms link the sites; the pool physically lives at base).

1. **Publish (free action, ≤ 1/turn)** — at any research terminal (or anywhere during the lab season): your carried hand is **first dumped entirely into the shared pool**, then you assemble an open **project** from the pool — anyone's cards are fair game — and the cards used are **consumed** into your public published record. First to publish wins the cards; unused cards linger as community cards. No citation (`MAX_CITE = 0`).
2. **Deposit** (free) — at a research terminal, move one carried specimen into the pool to free a hand slot without publishing.
3. **Field camp** (🏕️) — each player starts with **one undeployed camp**: deploy it (free) on any empty land tile to create a forward research terminal **usable by everyone**. One-shot — consumed on deploy.

**Projects** are a fixed, always-available **table** of concrete poker-style patterns (discipline = rank, colour = suit): pairs (discipline / colour / both-axes / pair-combos), triples, two-pair, full house, four-of-a-kind, colour flush, both-axes triples, and discipline/colour straights — 77 combos in all. Only the shared **cards** are consumed; the combo stays on the table.

**Reward** = prestige + money, scaled by **difficulty × rarity × combo size**: colour difficulty (purple 1 · grey 2 · navy 5) × discipline rarity (arch common 1× · zoo 2× · geo/bot scarce 3×) summed over the cards, times a dampened combo factor — so hard colours and scarce disciplines pay a premium.

---

## Economy & scoring

- **Prestige** — one signed accumulation: research rewards (+) and negative tokens (−, from helilift shortfall).
- **Money** (shown ×10 as "k$") sinks: bank it (→ VP), buy **gear**, pay vehicle **boarding fees**, or pay for **helilift**.
- **Score:** `Σ = prestige + ⌊money / 5⌋`.

**Gear** (its own 3 slots — `GEAR_MAX = 3`; separate from specimen slots): generic lab kits 🔬 = **+1 / +2 / +3** to every catalogue roll (3 / 6 / 10 money); a **field kit** 🔬+icon = **+3** for one discipline (4 money). Buyable at any market (base, village, river villages) as a free action. Gear and the canoe are droppable **items** — cache them on any tile (the base tile doubles as a communal stash) for anyone to pick up. Cars and motorboats are positioned vehicles, not inventory, and are **not buyable**.

---

## Events & end

One global event **per round**, drawn by the round's start player and affecting everyone: mostly benign (🌬️ tailwind +1 AP all · 💰 cache +2 · 🎓 grant +3 · ☀️ calm) with rare hazards (⛏ rockslide mutates a jungle tile to rocky · 🌊 washout severs a crossing — never the last intact one; anyone standing on the bridge is washed ashore, never trapped). Six ⛈ monsoon cards sit at the deck bottom (`BAL.seasonBenign = 26` benign rounds before them); as they surface the storm telegraphs, and after the 4th — on a whole rotation — the **epilogue** begins: the frontier pool merges into the base lab, then each player gets **one indoor lab turn** (P0 first) to dump their hand and publish once, then the game scores.

**Fairness machinery** (each match fair on its own, no cross-match randomisation): a **wandering start player** (each field round begins with the next seat), a **round-1 AP ramp** (4p: 2/3/3/4 by play order) countering the irreducible first-mover edge, and the whole-rotation season end.

---

## Tunables (top-of-file consts)

| Knob | Value | Notes |
|---|---|---|
| `START_AP` | 4 | AP/turn (round 1 ramps up by play order) |
| `COL_DC` | 5 / 8 / 13 | catalogue DC by colour (purple / grey / navy) |
| `COLORS` | 3 | purple / grey / navy |
| `SPECIMEN_MAX` | 8 | carried-specimen hand cap |
| `GEAR_MAX` | 3 | gear slots |
| `ROLE_BONUS` | 3 | specialist catalogue bonus |
| `FIND_CHANCE` | 0.75 | per-richness-trial find chance |
| `MONSOON_END` | 4 | monsoons that end the field season |
| `BAL.seasonBenign` | 26 | benign event rounds before the monsoon tail |
| `MAX_CITE` | 0 | no citation (shared pool instead) |
| `CAR_STEPS` / `BOAT_STEPS` / `MOTORBOAT_STEPS` | 4 / 4 / 4 | tiles per AP |
| `BOARD_COST` | 1 | money to board a vehicle |
| `HELILIFT_COST` | 12 | escape price (cash, shortfall → −prestige at /4) |
| `PRESTIGE_K` / `MONEY_K` | 0.22 / 0.12 | project payout scaling |
| money→VP | /5 | conversion rate |

Current tunables yield winner **Σ ~15–25** in bot self-play.

---

## Status

- **Implemented & verified** (strict `tsc` + real boardgame.io `Client` smoke + headless sweeps over hundreds of maps): map gen (Y-river, brooks, cliffs, waterfall), curved-link movement (foot/canoe/car/motorboat/helilift), 1-find tiles + flip/catalogue, tile events, specialists, single shared-pool research with deposit + field camps, gear/items/stash, 3-colour palette, economy, round events, monsoon/epilogue, fairness machinery, up to 4 players.
- **Pending:** an exploitation/conservation cash-out channel (richer negative-token source than helilift), wider parameter tuning, optional networked multiplayer.
