# Expedition: Verdant Prime — Game Design

## Concept
A Euro action-point **logistics frame** wrapping a push-your-luck **field-science layer**. You lead a scientific expedition into a monsoon-threatened wilderness: explore, dig up specimens, and **race rivals to publish research** before the storm ends the season. The AP budget makes the game about **efficiency toward a fixed ceiling**; the shared research pools make it a **first-come-first-served race**, not solitaire engine-building.

- **Players:** 2–4 (hotseat; one human seat by default, the rest bot-played).
- **Length:** a field season of event-deck turns, then a one-turn-per-player **indoor lab season**, then scoring.
- **End is telegraphed:** monsoon cards stacked at the bottom of the event deck surface near the end; a "**N turns to end of field season**" warning shows once the first monsoon hits.

---

## Map (fixed 18×18 footprint, ~200 active tiles, per-match seed)

A minimally-branching **1-tile-wide river** carves the board (no large open water):
- **Trunk + one big branch** — a wandering channel (full barrier; crossable only by a **bridge** or a **boat**), with exactly **one 3-way fork**.
- **Brooks** — narrow boat-only side-channels, drawn as **edge overlays on land** (`smallRivers`), mouthing at a river. "Paths, but for boats": **1 AP/step when boated**; on foot a brook is just terrain.

Everything that moves is an **edge link on a base tile** — bitmasks (`N1 E2 S4 W8`): `roads`, `paths` (footpaths), `smallRivers` (brooks), `rivers` (channel), `blocked` (cliffs). **One connector per edge** — roads/paths/brooks/rivers never overlap on the same edge. Links render as **curved paths** (bends round off through the tile centre).

**Terrains** (each leans toward a discipline mix and a signature discovery colour):

| Terrain | Discipline mix | Colour lean | Notes |
|---|---|---|---|
| grassland | even sampler | mixed (no lean) | fast 1-AP going, sparse |
| jungle | bot + zoo heavy | green | the bulk of the wild |
| rocky | geo heavy, some arch | blue | 2-AP bushwhack |
| **ruins** | **archaeology motherlode** | yellow | rare dig sites — **guaranteed 3/board** |
| **water** | aquatic (zoo/bot) | blue | a forageable biome — dig it by canoe/boat |
| void | — | — | off-board gaps (ragged edges) |

Biomes are **balanced** (grassland/rocky carved generously so jungle doesn't dominate).

**Hotspots (4 kinds):**
- 🏢 **research base** — road hub: a market **and** a research pool; helilift target.
- ⛺ **frontier base** — the farthest wild research pool (may be boat-only to reach).
- 🏘️ **village** — a road market.
- 🏠 **river village** — sits **on the river at a foot crossing**; a market and home of the shared **canoe + motorboat**.

**Crossings:** exactly **1 central road bridge** (load-bearing) + **2 foot bridges** on straight river tiles. **Cliffs:** 1–2 impassable `blocked` edges on some land tiles (uncrossable by foot/car/boat), placed only on plain land↔land edges; rendered as a **jagged dark band** covering a third of the affected tile side.

**Generation guarantees** (else reseed, up to 96×, then fail loudly): one connected river; one road network on the central bridge; the base on the road; enough base-reachable forage; ≥3 ruins. Isolated pockets are allowed.

---

## Movement (`START_AP = 4`/turn)

- **Foot** — **1 AP** on a path/road edge, **2 AP** off-path. Open water is impassable without a boat.
- **Canoe** (the shared carried **boat**, 🛶) — enter water tiles and run brooks at **1 AP/step**; fast river-channel runs cover `BOAT_STEPS = 2` tiles/AP. Carryable, droppable on any tile, starts at the river village.
- **Car** (🚗) — positioned road vehicle: `board`/`leave`/`drive` up to `CAR_STEPS = 3` road tiles/AP. One shared car **per player** at base; buyable at markets (`CAR_PRICE = 8`). Has a **trunk** (`TRUNK_SLOTS = 3`).
- **Motorboat** (🛥) — positioned **large-river** vehicle: board from the bank, drive `MOTORBOAT_STEPS = 4` channel tiles/AP, dock to a bank on leave. One moored at the river village.
- **Helilift** (🚁) — airlift to base for `HELILIFT_COST = 12` money; any shortfall converts to **negative prestige** (~4 money ≈ 1 prestige). The escape valve for isolation/traps.

A **dry validation graph** (river = hard barrier) keeps the centre crossing load-bearing.

---

## Discoveries & cataloguing

- Each tile holds **at most one discovery**; roads and hotspots hold **none**. The chance a tile bears its find scales with its terrain **richness** (relative probabilities preserved).
- **Flip on enter (free):** entering a tile turns its discovery face-up — you see its discipline + colour. (Hazards resolve here too, see below.)
- **Catalogue (1 AP + roll):** **2d6 + gear + specialist bonus ≥ difficulty**. Difficulty = **6 + colour** → 🟩 6 · 🟦 7 · 🟨 8. Tiers: **≥ diff → taken** into your hand; **= diff−1 → stayed** (try again); **below → fled** (fauna) / **destroyed**.
- Carried discoveries are **unlimited** (no carry cap — the pressure to return is the research race, not a slot limit).

**Tile-event cards** are mixed into each terrain's stack (~12%) and fire **on enter**:
- ⛏ **rockslide** — buries the tile's find **and seals the whole tile** (all edges); you're **bumped back** to where you came from.
- 🐗 **animal attack** — lose **1** carried item.
- 🏴 **bushthieves** — robbed of a few money.
- 🧭 **helpful native** — gain **1** easy specimen of the local discipline.

(Loss/gain capped at 1 per tile.)

**Specialists:** each player is a **botanist / zoologist / geologist / archaeologist** — a permanent **+3 catalogue** bonus on their own discipline (assigned by seat; cosmetic colour = their preferred biome's lean).

---

## Research (shared open pools — "Texas Hold'em")

There are **two research sites**, each holding a **shared, face-up open pool** of discoveries: the **research base** and the **frontier base**.

1. **Stash on arrival** — entering a research site **force-stashes your whole hand** into that site's pool (community cards).
2. **Publish** — at a research site (or anywhere during the lab season), assemble an open **project** from that site's pool; the cards used are **consumed** from the shared pool. Since anyone can use anyone's stashed cards, it's **first to publish wins** — a true race. No citation (`MAX_CITE = 0`).
3. **Cost** — `publishCost = min(4, 1 + ⌊pubs/2⌋)` AP, rising with each paper you publish.

**Projects** are concrete poker-style patterns drawn from a shared, consumed deck (refilled from a per-match deck): three/four-of-a-kind, two-pair, full house, flush, both-axes triples, discipline/colour straights. **Reward** = prestige + money, with a **difficulty premium**: prestige rises with the hard (pinned) colours a project demands.

---

## Economy & scoring

- **Prestige** — one signed accumulation: research rewards (+) and negative tokens (−, from helilift shortfall).
- **Money** sinks: bank it (→ VP), buy **gear / boat / car**, or pay for **helilift**.
- **Score:** `Σ = prestige + ⌊money / 4⌋`.

**Gear** (shares nothing with discoveries; capped at `GEAR_MAX = 3`): generic lab kits 🔍 / 🔬 / ⚗️ = +1/+2/+3 to every catalogue roll (3/6/10 money); 🧪 **field kit** = +3 for one discipline (4 money). Gear, boat and car are all board **items** — buyable at markets, droppable on a tile, stashable in a vehicle trunk, or left in a base's communal stash for a teammate.

---

## Events & end

One event deck, **1 draw/turn**, mostly benign (spare AP/money) with rare hazards (rockslide mutation, washout severing a crossing). `MONSOON_END = 4` monsoon copies sit at the deck bottom; as they surface the storm telegraphs ("N turns to end of field season"), then the **epilogue** begins: each player gets **one indoor lab turn** to publish (everything pools at the base lab), then the game scores.

---

## Tunables (top-of-file consts)

| Knob | Value | Notes |
|---|---|---|
| `START_AP` | 4 | AP/turn |
| `CATALOGUE_DC` | 6 | base difficulty; +colour → 6/7/8 |
| `COLORS` | 3 | green / blue / yellow |
| `MONSOON_END` | 4 | field-season length |
| `MAX_CITE` | 0 | no citation (shared pools instead) |
| `GEAR_MAX` | 3 | gear pieces carried |
| `ROLE_BONUS` | 3 | specialist catalogue bonus |
| `CAR_STEPS` / `BOAT_STEPS` / `MOTORBOAT_STEPS` | 3 / 2 / 4 | tiles per AP |
| `HELILIFT_COST` | 12 | escape price (cash or −prestige) |
| `PUBLISH_STEP` | 2 | publish-cost ramp |
| `DIFF_REWARD` | 0.33 | prestige premium per pinned-colour difficulty |
| money→VP | /4 | conversion rate |

Current tunables yield winner **Σ ~16–22** depending on specialist/yield settings.

---

## Status

- **Implemented & verified** (strict `tsc` + real boardgame.io `Client` smoke + headless sweeps over hundreds of maps): map gen, curved-link movement (foot/canoe/car/motorboat/helilift), 1-find tiles + flip/catalogue, tile events, specialists, shared-pool research, gear/items/trunks/stash, 3-colour palette, economy, monsoon/epilogue, up to 4 players.
- **Pending:** an exploitation/conservation cash-out channel (richer negative-token source than helilift), wider parameter tuning, optional networked multiplayer.
