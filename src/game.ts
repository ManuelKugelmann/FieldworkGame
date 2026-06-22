import type { Game, Move } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

export type Terrain = 'grassland' | 'jungle' | 'rocky' | 'ruins' | 'water' | 'void';  // roads are an edge overlay on a land base, not a terrain; ruins = arch-rich dig site; void = off-board
export type Bridge = 'road' | 'foot';
export type DType = 'geo' | 'zoo' | 'bot' | 'arch';
export interface Discovery { type: DType; color: number; }
// some cards in a terrain's stack are tile EVENTS (hazards/boons) — they fire on tile ENTER (when revealed), they're never collectible finds
export type TileEventKind = 'rockslide' | 'animalAttack' | 'bushthieves' | 'helpfulNative';
export interface TileEvent { event: TileEventKind; }
export type Card = Discovery | TileEvent;                          // a stack holds specimens + events mixed
const isEvent = (c: Card): c is TileEvent => 'event' in c;
export type Hotspot = 'base' | 'remote' | 'village' | 'riverVillage';  // POIs: road base (market + research), frontier (remote) research site, road market (village), little river-bank village (market; home of the shared boat)
export type EquipKind = 'gear' | 'boat';              // carryable items cached on a tile / in a car trunk (droppable/pickup-able)
export interface Equip { kind: EquipKind; gear?: GearItem; }   // a cached item: a boat, or a gear kit (carries its full GearItem)
export type VehicleKind = 'car' | 'motorboat';   // car = positioned road vehicle; motorboat = positioned LARGE-RIVER vehicle (fast channel travel, board from the bank / dock to the bank)
export interface Vehicle { pos: number; driver: string | null; trunk: Equip[]; kind: VehicleKind; }  // a positioned entity you board/leave; drive moves both; trunk rides along (shared, ≤ TRUNK_SLOTS)
// GEAR: typed kit that shares the carry slots with specimens. generic g1/g2/g3 = +1/+2/+3 to every catalogue roll; a FIELD kit = bigger bonus but only for its discipline.
export type GearKind = 'g1' | 'g2' | 'g3' | 'field';
export interface GearItem { kind: GearKind; field?: DType; }   // field = the discipline a 'field' kit boosts
export interface Tile { terrain: Terrain; bridge?: Bridge; roads: number; paths: number; smallRivers: number; blocked: number; rivers: number; hotspot?: Hotspot; richness: number; revealed: boolean; finds: Discovery[]; equipment: Equip[]; cache: Discovery[]; }  // cache = discoveries DROPPED here (face-up, free to pick up); roads/paths/smallRivers(brooks)/blocked(cliffs)/rivers(channel linkage) = edge bitmasks N1 E2 S4 W8
export interface PlayerS { ap: number; pos: number; money: number; samples: Discovery[]; published: Discovery[]; prestige: number; pubs: number; gear: GearItem[]; boat: boolean; }  // samples (carried discoveries) are UNLIMITED; gear capped at GEAR_MAX; pubs = publish count (drives rising AP cost); boat = carrying the shared boat
export interface GState {
  players: Record<string, PlayerS>;
  map: Tile[]; cols: number; rows: number; base: number;   // main hub (road) — helilift target
  vehicles: Vehicle[];                                     // shared cars on the board (start at base)
  pools: Partial<Record<Terrain, Card[]>>;
  goals: Pattern[];                                        // the open research questions on the board (shared, consumed on publish)
  goalDeck: Pattern[];                                     // remaining projects; the pool refills from here on a claim
  events: string[]; monsoon: number; epilogue: boolean; labLeft: number; log: string[];   // epilogue = indoor lab season
}

let N = 10;                  // grid dimension (square), chosen per-match in [10..15]
const DIM_MIN = 10, DIM_MAX = 18, ACTIVE_TILES = 200, START_AP = 4,  // fixed 18×18 footprint, ~200 tiles kept active (rest void gaps) → built-out-from-network spread  // 4 AP/round
  COLORS = 4, CATALOGUE_DC = 6, MAP_SEED = 1, MONSOON_END = 4, MAX_CITE = 0, CAR_STEPS = 3, BOAT_STEPS = 2, FIND_CHANCE = 0.75, HELILIFT_COST = 12, PUBLISH_STEP = 2, FIELD_BONUS = 3, BOAT_PRICE = 5, CAR_PRICE = 8, TRUNK_SLOTS = 3, MOTORBOAT_STEPS = 4;  // MOTORBOAT_STEPS = large-river channel tiles a motorboat covers per AP (faster than the portable canoe's BOAT_STEPS)  // discoveries are UNLIMITED in hand (the rush back to base is driven by the first-come-first-serve research pool, not a carry cap)  // TRUNK_SLOTS = items a car can carry in its trunk  // GEAR_MAX = max gear pieces carried (gear has its own cap, separate from discoveries)  // FIELD_BONUS: a field kit's catalogue bonus (its discipline only)  // BOAT_PRICE/CAR_PRICE: buy a personal boat / spawn a car at a market  // MAX_CITE 0 = no citation  // PUBLISH_STEP: publish AP cost = 1 + floor(pubCount/STEP)

// gear catalogue: generic kits boost every roll; a field kit boosts only its discipline (but more, and cheaper than the equivalent generic)
export const GEAR_MAX = 3;   // max gear pieces a player carries (discoveries are uncapped)
export const GEAR_PRICE: Record<GearKind, number> = { g1: 3, g2: 6, g3: 10, field: 4 };
export const gearBonus = (gear: GearItem[], t: DType) => gear.reduce((s, g) => s + (g.kind === 'g1' ? 1 : g.kind === 'g2' ? 2 : g.kind === 'g3' ? 3 : g.field === t ? FIELD_BONUS : 0), 0);
export const catDC = (color: number) => CATALOGUE_DC + color;   // difficulty = colour tier: the number on a discovery (red 0 … violet 3) IS its catalogue DC (6–9)
const DIFF_REWARD = 0.33;   // prestige premium per unit of pinned-colour difficulty a goal demands (so harder colours pay more)
const gearTag = (g: GearItem) => g.kind === 'field' ? `${g.field} kit` : g.kind;   // log label for a gear kit
const hasRoom = (p: PlayerS) => p.gear.length < GEAR_MAX;   // can take one more gear piece (discoveries are uncapped)

const RICH: Record<Terrain, number> = { grassland: 2, jungle: 4, rocky: 3, ruins: 4, water: 2, void: 0 };  // max potential tokens; ruins = deep dig site; water = aquatic biome (forage by canoe/boat)
const plainRiver = (t: Tile) => t.terrain === 'water' && !t.bridge;  // river = hard barrier (1-tile-wide)
const isLandT = (t: Tile) => t.terrain !== 'water' && t.terrain !== 'void';  // any walkable land terrain
const isVoid = (t: Tile) => t.terrain === 'void';                   // off-board cell (irregular edges) — impassable, no finds
const grass = (map: Tile[], a: number, b: number) => map[a].terrain === 'grassland' || map[b].terrain === 'grassland';  // grassland = fast going (path-like)
const dirBit = (a: number, b: number) => b === a - N ? 1 : b === a + N ? 4 : b === a + 1 ? 2 : 8;  // N1 E2 S4 W8
// every link type (roads / footpaths / brooks / cliffs / river channel) is one edge bitmask on the tile; the only difference is which mask + tile prerequisite a mover reads
type EdgeKind = 'roads' | 'paths' | 'smallRivers' | 'blocked' | 'rivers';
const hasEdge = (map: Tile[], a: number, b: number, k: EdgeKind) => (map[a][k] & dirBit(a, b)) !== 0;
const onPath = (map: Tile[], a: number, b: number) => hasEdge(map, a, b, 'roads') || hasEdge(map, a, b, 'paths');  // road OR foot edge
const onBlocked = (map: Tile[], a: number, b: number) => hasEdge(map, a, b, 'blocked');  // cliff edge: uncrossable by anyone (foot/car/boat)
// board/leave a bridge only via an edge; land↔land always allowed; cliffs + void hard-block everyone
const canMoveDry = (map: Tile[], a: number, b: number) => onBlocked(map, a, b) || isVoid(map[a]) || isVoid(map[b]) || plainRiver(map[a]) || plainRiver(map[b]) ? false : (map[a].bridge || map[b].bridge) ? onPath(map, a, b) : true;  // river = hard barrier (map validation)
const canMove = (map: Tile[], a: number, b: number) => {           // FOOT graph: bridges via edge; open water needs a boat; cliffs/void block all
  if (onBlocked(map, a, b) || isVoid(map[a]) || isVoid(map[b])) return false;   // cliff / off-board = hard barrier
  if (map[a].bridge || map[b].bridge) return onPath(map, a, b);    // bridge: board/leave via an edge
  if (plainRiver(map[a]) || plainRiver(map[b])) return false;      // open water — boat only (no foot-ford)
  return true;                                                     // land↔land / land↔brook (no rocky exit constraint)
};
const cost = (map: Tile[], a: number, b: number) => (onPath(map, a, b) || grass(map, a, b)) ? 1 : 2;  // road/foot edge OR grassland = 1 AP; bushwhack/ford = 2 (brook discount is boat-only)
const canBoat = (map: Tile[], a: number, b: number) => {           // BOAT graph (player carrying the boat): water + brooks, and still walks dry land
  if (onBlocked(map, a, b) || isVoid(map[a]) || isVoid(map[b])) return false;
  if (map[a].bridge || map[b].bridge) return onPath(map, a, b);
  return true;                                                     // land↔land, land↔water, water↔water
};
const boatCost = (map: Tile[], a: number, b: number) =>             // water / brook / path / grassland step = 1 AP; portaging the boat over rough dry land = 2
  (plainRiver(map[a]) || plainRiver(map[b]) || onPath(map, a, b) || grass(map, a, b) || (map[a].smallRivers & dirBit(a, b))) ? 1 : 2;
export const apCost = (G: GState, from: number, to: number, boat: boolean) => (boat ? boatCost : cost)(G.map, from, to);  // AP for a foot/boat step (UI cost hint)
// ---- generic link traversal: a vehicle rides ONE edge kind up to N steps/AP. roads→car, river channel→boat — same code, different `k`. ----
function linkReach(map: Tile[], from: number, maxSteps: number, k: EdgeKind): number[] {   // cells within maxSteps along link `k`
  const seen = new Map<number, number>([[from, 0]]); const q = [from]; const out: number[] = [];
  while (q.length) { const u = q.shift()!; const d = seen.get(u)!; if (d >= maxSteps) continue;
    for (const v of nbrs(u)) if (!seen.has(v) && hasEdge(map, u, v, k) && !onBlocked(map, u, v)) { seen.set(v, d + 1); out.push(v); q.push(v); } }
  return out;
}
function linkDist(map: Tile[], from: number, to: number, k: EdgeKind): number {            // BFS distance along link `k` (fractional vehicle cost)
  if (from === to) return 0;
  const seen = new Map<number, number>([[from, 0]]); const q = [from];
  while (q.length) { const u = q.shift()!; const d = seen.get(u)!; for (const v of nbrs(u)) if (!seen.has(v) && hasEdge(map, u, v, k) && !onBlocked(map, u, v)) { if (v === to) return d + 1; seen.set(v, d + 1); q.push(v); } }
  return Infinity;
}
const roadReach = (map: Tile[], from: number, s: number) => linkReach(map, from, s, 'roads');    // car
const riverReach = (map: Tile[], from: number, s: number) => linkReach(map, from, s, 'rivers');  // boat (river channel)
const roadStepDist = (map: Tile[], from: number, to: number) => linkDist(map, from, to, 'roads');
const riverStepDist = (map: Tile[], from: number, to: number) => linkDist(map, from, to, 'rivers');
// AP a legal target costs, for the UI. Foot/boat = the step cost; car = fractional (1 AP buys CAR_STEPS road tiles)
export function targetAP(G: GState, pid: string, a: { move?: string; args?: unknown[] }): number {
  const p = G.players[pid];
  if (a.move === 'drive') { const car = myVehicle(G, pid); if (!car) return 1; const boat = car.kind === 'motorboat'; const d = (boat ? riverStepDist : roadStepDist)(G.map, car.pos, a.args![0] as number); return Number.isFinite(d) ? d / (boat ? MOTORBOAT_STEPS : CAR_STEPS) : 1; }
  if (a.move === 'boatRun') { const d = riverStepDist(G.map, p.pos, a.args![0] as number); return Number.isFinite(d) ? d / BOAT_STEPS : 1; }   // 1 AP buys BOAT_STEPS channel tiles
  if (a.move === 'move') return apCost(G, p.pos, a.args![0] as number, p.boat);
  return 0;
}
// m4 vehicles: a car moves up to 3 road tiles per AP (road edges only) — not yet implemented
const isResearch = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'remote';  // the TWO research sites: base lab + frontier (remote) research site. Each holds a SHARED, face-up open pool (tile.cache) — Texas Hold'em community cards.
// the open pool you publish from: the lab season pools everything at base; in the field it's the site you stand on (or none)
const researchPool = (G: GState, pos: number): Discovery[] | null => G.epilogue ? G.map[G.base].cache : (isResearch(G.map[pos]) ? G.map[pos].cache : null);
// entering a research site force-stashes your whole hand into that site's shared pool — open for ANY player's research, consumed when used
function landAt(G: GState, cur: string) {
  const p = G.players[cur], t = G.map[p.pos];
  if (!G.epilogue && isResearch(t) && p.samples.length) {
    t.cache.push(...p.samples); G.log.push(`P${cur} stash ${p.samples.length} → ${t.hotspot === 'base' ? 'lab' : 'frontier'} pool`); p.samples.length = 0;
  }
}
const isMarket = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'village' || t.hotspot === 'riverVillage';  // buy gear/boat/car here (base + road village + river village)

const WEIGHTS: Partial<Record<Terrain, Record<DType, number>>> = {
  grassland: { geo: 1, arch: 1, zoo: 1, bot: 1 },   // low everything
  jungle:    { bot: 4, zoo: 4, arch: 2, geo: 1 },   // dense flora + fauna (botany & zoology rich)
  rocky:     { geo: 6, arch: 3, zoo: 1, bot: 1 },   // lots of geology, mid archaeology, low zoo/botany
  ruins:     { arch: 8, geo: 2, bot: 1, zoo: 1 },   // a dig site — archaeology dominates the stack
  water:     { zoo: 4, bot: 2, geo: 1, arch: 1 },   // aquatic life — fish/fauna heavy, some flora
};
export const BIOME_COLOR: Partial<Record<Terrain, number>> = { grassland: 0, jungle: 1, rocky: 2, ruins: 3, water: 1 };  // signature colour index per biome pool (0 red … 3 violet) — drives the pool's colour bias + catalogue-DC lean (water leans green like jungle)
// tile-event deck mixed into each terrain stack: a base weighting, with a per-terrain lean toward its signature hazard
const EVENT_RATE = 0.12;            // ~ this fraction of a terrain stack is events (the rest are specimens)
const BUSHTHIEF_TAKE = 3;           // $ a bushthief camp robs from the entering player
const EVENT_W: Record<TileEventKind, number> = { rockslide: 2, animalAttack: 2, bushthieves: 1, helpfulNative: 2 };
const EVENT_LEAN: Partial<Record<Terrain, TileEventKind>> = { rocky: 'rockslide', jungle: 'animalAttack', ruins: 'bushthieves' };  // looters guard the ruins
const dominantType = (terr: Terrain): DType => { const w = WEIGHTS[terr]; return w ? (Object.keys(w) as DType[]).reduce((a, b) => w[b] > w[a] ? b : a) : 'geo'; };
function pickEvent(t: Terrain, rand: () => number): TileEventKind {
  const w = { ...EVENT_W }; const lean = EVENT_LEAN[t]; if (lean) w[lean] += 3;
  const kinds = Object.keys(w) as TileEventKind[]; let r = rand() * kinds.reduce((s, k) => s + w[k], 0);
  for (const k of kinds) { r -= w[k]; if (r < 0) return k; } return 'helpfulNative';
}
function buildPool(t: Terrain, rand: () => number): Card[] {
  const out: Card[] = [], w = WEIGHTS[t]!, bias = BIOME_COLOR[t];
  (Object.keys(w) as DType[]).forEach(k => {
    for (let i = 0; i < w[k] * 4; i++) {
      const color = (bias !== undefined && rand() < 0.35) ? bias : Math.floor(rand() * COLORS);   // colour is independent of type, only slightly biome-leaning
      out.push({ type: k, color });
    }
  });
  const nev = Math.max(1, Math.round(out.length * EVENT_RATE));   // salt the stack with tile events (fire on enter)
  for (let i = 0; i < nev; i++) out.push({ event: pickEvent(t, rand) });
  return out;
}

// ---- map gen: river + roads FIRST (single connected networks, centred crossing), then flood land; validate + reseed ----
function prng(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ix = (r: number, c: number) => r * N + c;
function nbrs(i: number): number[] { const r = (i / N) | 0, c = i % N, o: number[] = []; if (r > 0) o.push(i - N); if (r < N - 1) o.push(i + N); if (c > 0) o.push(i - 1); if (c < N - 1) o.push(i + 1); return o; }
function compMove(map: Tile[], nodes: number[]): number {            // components under the movement rule
  const set = new Set(nodes), seen = new Set<number>(); let c = 0;
  for (const s of nodes) { if (seen.has(s)) continue; c++; const st = [s]; seen.add(s); while (st.length) { const x = st.pop()!; for (const y of nbrs(x)) if (set.has(y) && !seen.has(y) && canMoveDry(map, x, y)) { seen.add(y); st.push(y); } } }
  return c;
}
function compTerrain(map: Tile[], pred: (t: Tile) => boolean) {       // plain 4-adjacency components of one terrain
  const cells: number[] = []; for (let i = 0; i < N * N; i++) if (pred(map[i])) cells.push(i);
  const set = new Set(cells), seen = new Set<number>(); let c = 0;
  for (const s of cells) { if (seen.has(s)) continue; c++; const st = [s]; seen.add(s); while (st.length) { const x = st.pop()!; for (const y of nbrs(x)) if (set.has(y) && !seen.has(y)) { seen.add(y); st.push(y); } } }
  return { c, cells };
}

function genOnce(seed: number) {
  const rand = prng(seed), g: Tile[] = new Array(N * N).fill(null as any);
  const set = (i: number, t: Terrain, bridge?: Bridge) => { const max = RICH[t], richness = (max === 0 || rand() < 0.5) ? 0 : 1 + Math.floor(max * rand() ** 2); g[i] = { terrain: t, bridge, roads: 0, paths: 0, smallRivers: 0, blocked: 0, rivers: 0, richness, revealed: false, finds: [], equipment: [], cache: [] }; };  // 0 vs 1+ is 50:50; within 1..max skewed toward 1 (max rare)
  const join = (a: number, b: number, k: EdgeKind) => { g[a][k] |= dirBit(a, b); g[b][k] |= dirBit(b, a); };   // lay one edge of link kind `k` (symmetric)
  const link = (a: number, b: number) => join(a, b, 'roads');         // road edge
  const linkP = (a: number, b: number) => join(a, b, 'paths');        // foot edge
  const linkS = (a: number, b: number) => join(a, b, 'smallRivers');  // brook edge (boat-only highway)
  const block = (a: number, b: number) => join(a, b, 'blocked');      // cliff edge (uncrossable)

  // Y RIVER: a junction near the centre + 3 arms at ~120° in a random orientation; each arm runs to an edge → a 3-section barrier in any orientation
  const river: number[] = []; const water = new Set<number>(); const branch: number[] = [];
  const addW = (i: number) => { if (!water.has(i)) { set(i, 'water'); river.push(i); water.add(i); } };
  const cmid = (N - 1) / 2;
  let jr = Math.max(2, Math.min(N - 3, Math.round(cmid + (rand() * 2 - 1)))), jc = Math.max(2, Math.min(N - 3, Math.round(cmid + (rand() * 2 - 1))));
  addW(ix(jr, jc));
  const baseAng = rand() * Math.PI * 2;
  const riverNbrs = (i: number, excl: number) => nbrs(i).filter(j => water.has(j) && j !== excl).length;   // river neighbours other than the predecessor
  const perp = (d: [number, number]): [number, number][] => d[0] === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];   // the two 90° turns of a direction
  const CARD: [number, number][] = [[-1, 0], [1, 0], [0, 1], [0, -1]];   // N,S,E,W
  const used = [false, false, false, false], armDirs: [number, number][] = [];
  for (let a = 0; a < 3; a++) {                                    // 3 DISTINCT launch directions → exactly one 3-way split (no fixed Y shape)
    const ang = baseAng + a * (Math.PI * 2 / 3), sr = Math.sin(ang), sc = Math.cos(ang);
    let k = Math.abs(sr) >= Math.abs(sc) ? (sr < 0 ? 0 : 1) : (sc >= 0 ? 2 : 3);
    if (used[k]) k = used.findIndex(u => !u);
    used[k] = true; armDirs.push(CARD[k]);
  }
  // place all 3 launch cells FIRST (the junction is the only 3-way tile), then grow the arms in ALTERNATION (round-robin), each meandering 50:50 straight / 90° turn
  const arms = armDirs.map(dir0 => { const fr = jr + dir0[0], fc = jc + dir0[1]; addW(ix(fr, fc)); return { r: fr, c: fc, prev: ix(fr, fc), dir: dir0, dir0, active: true }; });
  for (let step = 0; step < N * N; step++) {
    const live = arms.filter(a => a.active); if (!live.length) break;
    const arm = live[Math.floor(rand() * live.length)];          // extend a RANDOMLY chosen arm each step
    if (arm.r === 0 || arm.r === N - 1 || arm.c === 0 || arm.c === N - 1) { arm.active = false; continue; }   // reached the boundary
    let chosen = arm.dir;
    if (rand() < 0.5) {                                          // balanced 50:50 turn/straight; the turn only MILDLY biased outward
      const ps = perp(arm.dir);
      const out = (ps[0][0] * arm.dir0[0] + ps[0][1] * arm.dir0[1]) >= (ps[1][0] * arm.dir0[0] + ps[1][1] * arm.dir0[1]) ? ps[0] : ps[1];
      chosen = rand() < 0.3 ? out : ps[Math.floor(rand() * 2)];
    }
    let moved = false;
    for (const d of [chosen, arm.dir, ...perp(arm.dir)]) {
      const nr = arm.r + d[0], nc = arm.c + d[1]; if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const cand = ix(nr, nc); if (water.has(cand) || riverNbrs(cand, arm.prev) > 0) continue;
      addW(cand); arm.prev = cand; arm.r = nr; arm.c = nc; arm.dir = d; moved = true; break;
    }
    if (!moved) arm.active = false;
  }

  // (brooks are land-cell edge overlays now — laid after the land flood, near the footpaths)

  // CROSSINGS: only the CENTRE road bridge is defined; foot bridges land on RANDOM river tiles (some cuts get none → boat-only)
  const allRiver = [...river, ...branch];
  const dc = (i: number) => Math.abs(((i / N) | 0) - N / 2) + Math.abs((i % N) - N / 2);
  const centralRow = river.filter(i => { const r = (i / N) | 0; return r >= N / 3 && r <= 2 * N / 3; });   // pin the bridge to the centre quadrant
  const notWater = (j: number) => !g[j] || g[j].terrain !== 'water';
  const straightX = (i: number) => { const c = i % N; return c > 0 && c < N - 1 && notWater(i - 1) && notWater(i + 1); };   // land W&E → road crosses straight (W-E)
  const straightAny = (i: number) => { const r = (i / N) | 0, c = i % N; return (c > 0 && c < N - 1 && notWater(i - 1) && notWater(i + 1)) || (r > 0 && r < N - 1 && notWater(i - N) && notWater(i + N)); };   // land on two opposite sides → a straight crossing (either axis)
  const ctrPool = centralRow.filter(straightX);
  const ctr = (ctrPool.length ? ctrPool : centralRow.length ? centralRow : river).slice().sort((a, b) => dc(a) - dc(b))[0];   // on the TRUNK, a straight road crossing where possible
  g[ctr].bridge = 'road'; const bridges = [ctr];
  const cand = allRiver.filter(i => i !== ctr && straightAny(i));  // foot crossings also on STRAIGHT river tiles (perpendicular land both sides)
  for (let k = 0; k < 2 && cand.length; k++) { const i = cand.splice(Math.floor(rand() * cand.length), 1)[0]; g[i].bridge = 'foot'; bridges.push(i); }

  // roads: built OUTWARD from the central bridge (overlay on a land base grass/wild/rock); a road cell = one carrying a road edge
  const roadBase = (): Terrain => (['grassland', 'jungle', 'rocky'] as Terrain[])[Math.floor(rand() * 3)];
  const baseRow = (bridges[0] / N) | 0, bcol = bridges[0] % N;
  for (const dd of [-1, 1]) {                                         // flank the bridge W & E to span both banks (the river crossing)
    const c = bcol + dd; if (c < 0 || c >= N) continue;
    const i = ix(baseRow, c); if (g[i] && g[i].terrain === 'water') continue;
    if (!g[i]) set(i, roadBase()); link(bridges[0], i);
  }
  const roadCells = () => { const a: number[] = []; for (let i = 0; i < N * N; i++) if (g[i] && g[i].roads !== 0 && !g[i].bridge) a.push(i); return a; };
  const distCtr = (r: number, c: number) => Math.abs(r - N / 2) + Math.abs(c - N / 2);
  // grow a meandering road run from `i` heading `dir0` for `len` steps (balanced 50:50 turn/straight, the turn mildly nudged outward)
  const growArm = (i: number, dir0: [number, number], len: number): void => {
    let dir = dir0;
    for (let s = 0; s < len; s++) {
      let chosen = dir;
      if (rand() < 0.5) {                                          // balanced 50:50 turn/straight, the turn mildly nudged outward (away from centre)
        const ps = perp(dir), cr = (i / N) | 0, cc = i % N;
        const out = distCtr(cr + ps[0][0], cc + ps[0][1]) >= distCtr(cr + ps[1][0], cc + ps[1][1]) ? ps[0] : ps[1];
        chosen = rand() < 0.3 ? out : ps[Math.floor(rand() * 2)];
      }
      let moved = false;
      for (const d of [chosen, dir, ...perp(dir)]) {
        const r = ((i / N) | 0) + d[0], c = (i % N) + d[1]; if (r < 0 || r >= N || c < 0 || c >= N) continue;
        const j = ix(r, c); if (g[j]) continue;
        set(j, roadBase()); link(i, j); i = j; dir = d; moved = true; break;
      }
      if (!moved) break;
    }
  };
  // grow a road run out along BOTH banks from the bridge flanks → substantial road on each side of the river (not just one cell)
  for (const dd of [-1, 1]) { const c = bcol + dd; if (c < 0 || c >= N) continue; const fi = ix(baseRow, c); if (g[fi] && g[fi].roads !== 0 && !g[fi].bridge) growArm(fi, [0, dd], 4 + Math.floor(rand() * 3)); }
  // TWO road 3-way junctions (Y/T splits, mirroring the river's one 3-way): each junction cell carries three road edges — one back to the network, two outward arms
  const freeDir = (i: number, d: [number, number]) => { const r = ((i / N) | 0) + d[0], c = (i % N) + d[1]; return r >= 0 && r < N && c >= 0 && c < N && !g[ix(r, c)]; };
  for (let b = 0; b < 2; b++) {
    type Cand = { a: number; j: number; arms: [number, number][] };
    const viable: Cand[] = [];
    for (const a of roadCells()) {                                                // gather every spot that yields a clean 3-way…
      for (const j of nbrs(a).filter(j => !g[j])) {
        const back: [number, number] = [((a / N) | 0) - ((j / N) | 0), (a % N) - (j % N)];   // direction back to the network (excluded from the arms)
        const fa = CARD.filter(d => !(d[0] === back[0] && d[1] === back[1]) && freeDir(j, d))
                       .sort((p, q) => distCtr(((j / N) | 0) + q[0], (j % N) + q[1]) - distCtr(((j / N) | 0) + p[0], (j % N) + p[1]));   // outward arms first
        if (fa.length < 2) continue;
        viable.push({ a, j, arms: fa.slice(0, 2) });
      }
    }
    if (!viable.length) break;
    const pick = viable[Math.floor(rand() * viable.length)];   // uniformly choose the junction endpoint among all viable spots (more varied lacing)
    set(pick.j, roadBase()); link(pick.a, pick.j);                                // edge back to the network
    for (const d of pick.arms) growArm(pick.j, d, 5 + Math.floor(rand() * 4));    // two outward arms (a little longer → more reach) complete the 3-way
  }

  // flood jungle, carve rocky + grassland patches (all passable land; rocky/jungle = 2 AP bushwhack)
  for (let i = 0; i < N * N; i++) if (!g[i]) set(i, 'jungle');
  const carve = (terr: Terrain, p: number, sz: number) => { for (let k = 0; k < p; k++) { let i = Math.floor(rand() * N * N); for (let s = 0; s < sz; s++) { if (g[i].terrain === 'jungle' && g[i].roads === 0) set(i, terr); const ns = nbrs(i).filter(j => g[j].terrain === 'jungle' && g[j].roads === 0); if (!ns.length) break; i = ns[Math.floor(rand() * ns.length)]; } } };   // never carve over a road overlay (set() would wipe its edges)
  const scale = (N * N) / 100;   // patch counts scale with board area (10×10 … 15×15)
  carve('rocky', Math.round(6 * scale), 4); carve('grassland', Math.round(8 * scale), 5);
  carve('ruins', Math.max(1, Math.round(2 * scale)), 2);   // a few small arch-rich dig sites carved out of the jungle
  // CLIFFS: 1–2 uncrossable edges on some land tiles (plain land↔land only — never roads/water/bridges, so the laid networks stay intact)
  const isLand = (i: number) => { const t = g[i].terrain; return t === 'jungle' || t === 'rocky' || t === 'grassland' || t === 'ruins'; };
  for (let i = 0; i < N * N; i++) {
    if (!isLand(i) || rand() >= 0.14) continue;                    // only some land tiles get cliffs
    const cand = nbrs(i).filter(j => isLand(j) && !(g[i].roads & dirBit(i, j)) && !(g[i].blocked & dirBit(i, j)));
    const k = 1 + (rand() < 0.5 ? 0 : 1);
    for (let n2 = 0; n2 < k && cand.length; n2++) block(i, cand.splice(Math.floor(rand() * cand.length), 1)[0]);
  }
  // BUILD OUT from the road + river network: keep the land hugging it (1-cell margin → no bare roads/rivers), then grow outward up to ACTIVE_TILES; void the rest
  const passable = (a: number, b: number) => {                          // land/bridge connectivity; open water blocks (banks reached as seeds, not crossed)
    if (onBlocked(g, a, b) || isVoid(g[a]) || isVoid(g[b])) return false;
    if (g[a].bridge || g[b].bridge) return true;
    return !(plainRiver(g[a]) || plainRiver(g[b]));
  };
  const netSeeds: number[] = [];
  for (let i = 0; i < N * N; i++) if (g[i].roads !== 0 || (isLand(i) && nbrs(i).some(j => g[j].terrain === 'water'))) netSeeds.push(i);   // road cells + river-bank land
  const netDist = new Map<number, number>(); const nq = [...netSeeds]; for (const s of netSeeds) netDist.set(s, 0);
  for (let qi = 0; qi < nq.length; qi++) { const u = nq[qi]; for (const v of nbrs(u)) if (!netDist.has(v) && passable(u, v)) { netDist.set(v, netDist.get(u)! + 1); nq.push(v); } }   // BFS order = nearest-to-network first
  let fixed = 0; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'water' || g[i].roads !== 0 || g[i].bridge) fixed++;   // water + roads + bridges always kept
  const keepLand = new Set<number>();
  for (let i = 0; i < N * N; i++) if (isLand(i) && g[i].roads === 0 && nbrs(i).some(j => g[j].roads !== 0 || g[j].terrain === 'water')) keepLand.add(i);   // margin: every land cell hugging the network (no bare roads/rivers)
  let budget = ACTIVE_TILES - fixed - keepLand.size;
  for (const u of nq) { if (budget <= 0) break; if (isLand(u) && g[u].roads === 0 && !keepLand.has(u)) { keepLand.add(u); budget--; } }   // then build outward from the network (nearest-first) to the ACTIVE_TILES cap
  for (let i = 0; i < N * N; i++) if (isLand(i) && g[i].roads === 0 && !keepLand.has(i)) set(i, 'void');   // never void a road cell
  // road ENDS point into the void: void the single cell just ahead of each road dead-end (no land token beyond)
  for (let i = 0; i < N * N; i++) { const b = g[i].roads, r = (i / N) | 0, c = i % N;
    let j = -1;                                                       // dead-end = exactly one road edge; ahead = opposite of it
    if (b === 1 && r < N - 1) j = i + N; else if (b === 4 && r > 0) j = i - N; else if (b === 2 && c > 0) j = i - 1; else if (b === 8 && c < N - 1) j = i + 1;
    if (j >= 0 && isLand(j) && g[j].roads === 0) set(j, 'void');
  }
  // NO INNER VOID: flood void inward from the grid border; any void cell that border-flood can't reach is enclosed by active land → reclaim it as land (the map stays a solid blob, no holes)
  const outerVoid = new Set<number>(); const vq: number[] = [];
  for (let i = 0; i < N * N; i++) { const r = (i / N) | 0, c = i % N; if ((r === 0 || c === 0 || r === N - 1 || c === N - 1) && isVoid(g[i])) { outerVoid.add(i); vq.push(i); } }
  for (let qi = 0; qi < vq.length; qi++) { const u = vq[qi]; for (const v of nbrs(u)) if (isVoid(g[v]) && !outerVoid.has(v)) { outerVoid.add(v); vq.push(v); } }
  for (let i = 0; i < N * N; i++) if (isVoid(g[i]) && !outerVoid.has(i)) set(i, roadBase());   // enclosed hole → fresh land
  // the BASE hub sits a few road-tiles out from the bridge (road-distance ≈ 3), not right beside it
  const bdist = new Map<number, number>([[bridges[0], 0]]); const bq2 = [bridges[0]];
  while (bq2.length) { const u = bq2.shift()!; const d = bdist.get(u)!; for (const v of nbrs(u)) if (!bdist.has(v) && (g[u].roads & dirBit(u, v))) { bdist.set(v, d + 1); bq2.push(v); } }
  let base = bridges[0], bestS = Infinity;
  for (const [i, d] of bdist) if (g[i].roads !== 0 && !g[i].bridge) { const s = Math.abs(d - 3); if (s < bestS) { bestS = s; base = i; } }
  placeHotspots(g, base);   // within the kept area; before footpaths so the remote base seeds trails

  // FOOTPATH JUNCTIONS: trails seed from foot bridges, anywhere on the roads, and every special location; they fizzle out in the jungle
  const footBr = bridges.filter(b => g[b].bridge === 'foot');
  for (const fb of footBr) {                                       // link a STRAIGHT crossing: the two opposite land banks (perpendicular to the river arm)
    const r = (fb / N) | 0, c = fb % N;
    const axes: [number, number, boolean][] = [[fb - 1, fb + 1, c > 0 && c < N - 1], [fb - N, fb + N, r > 0 && r < N - 1]];
    for (const [a, b, ok] of axes) {
      const land = (j: number) => g[j].terrain !== 'water' && g[j].terrain !== 'void';
      if (ok && land(a) && land(b) && !(g[fb].blocked & dirBit(fb, a)) && !(g[fb].blocked & dirBit(fb, b))) { linkP(fb, a); linkP(fb, b); break; }
    }
  }
  const roadAll: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].roads !== 0) roadAll.push(i);
  const junctions = [...footBr];
  for (let k = 0; k < 5 && roadAll.length; k++) junctions.push(roadAll[Math.floor(rand() * roadAll.length)]);   // anywhere on the roads
  for (let i = 0; i < N * N; i++) if (g[i].hotspot) junctions.push(i);   // every special location
  for (const sd of junctions) {
    const o0 = nbrs(sd).filter(j => g[j].terrain === 'jungle' && !(g[sd].blocked & dirBit(sd, j))); if (!o0.length) continue;
    let i = o0[Math.floor(rand() * o0.length)]; linkP(sd, i);
    for (let s = 0; s < 7; s++) { const opts = nbrs(i).filter(j => g[j].terrain === 'jungle' && !(g[i].paths & dirBit(i, j)) && !(g[i].blocked & dirBit(i, j))); if (!opts.length) break; const j = opts[Math.floor(rand() * opts.length)]; linkP(i, j); i = j; } }   // longer trails (up to 8 tiles) that fizzle into the jungle

  // BROOKS: boat-only side-channels — mouth at a river tile, then link consecutive land cells inward (laid as edge overlays, not water)
  let brooksMade = 0; const brookN = 1 + (rand() < 0.5 ? 0 : 1);
  for (let att = 0; att < 14 && brooksMade < brookN; att++) {
    const rt = allRiver[Math.floor(rand() * allRiver.length)];
    const mouths = nbrs(rt).filter(j => g[j].terrain === 'jungle' && !(g[rt].blocked & dirBit(rt, j)));
    if (!mouths.length) continue;
    let i = mouths[Math.floor(rand() * mouths.length)]; linkS(rt, i); let len = 1;
    for (let s = 0; s < 4; s++) {
      const opts = nbrs(i).filter(j => g[j].terrain === 'jungle' && !(g[i].smallRivers & dirBit(i, j)) && !(g[i].blocked & dirBit(i, j)));
      if (!opts.length) break;
      const j = opts[Math.floor(rand() * opts.length)]; linkS(i, j); i = j; len++;
    }
    if (len >= 2) brooksMade++;
  }

  // RIVER LINKAGE: link adjacent water tiles into a channel (like roads); the unlinked water edges are the banks — gives the river an orientation
  for (let i = 0; i < N * N; i++) if (g[i].terrain === 'water') for (const j of nbrs(i)) if (g[j].terrain === 'water') join(i, j, 'rivers');

  return { g, bridges, base };
}

function compRoad(g: Tile[]) {                                       // road components via EXPLICIT edges (not adjacency)
  const cells: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].roads !== 0 || g[i].bridge === 'road') cells.push(i);
  const set = new Set(cells), seen = new Set<number>(); let c = 0;
  for (const s of cells) { if (seen.has(s)) continue; c++; const st = [s]; seen.add(s); while (st.length) { const x = st.pop()!; for (const y of nbrs(x)) if (set.has(y) && !seen.has(y) && (g[x].roads & dirBit(x, y)) && !onBlocked(g, x, y)) { seen.add(y); st.push(y); } } }
  return { c, cells };
}
function validate(g: Tile[], bridges: number[]): string | null {
  if (compTerrain(g, t => t.terrain === 'water').c !== 1) return 'orphan-river';
  const rd = compRoad(g);
  if (rd.c !== 1) return 'orphan-road';
  if (!rd.cells.includes(bridges[0])) return 'road-not-attached-to-centre';
  const hs = g.map(t => t.hotspot).filter(Boolean);
  if (!hs.includes('base') || !hs.includes('village') || !hs.includes('remote')) return 'hotspots';
  return null;
}
function placeHotspots(g: Tile[], base: number): boolean {       // hubs must sit in the base-reachable area (isolated pockets are just unused)
  const reach = new Set<number>([base]); const stk = [base];
  while (stk.length) { const u = stk.pop()!; for (const v of nbrs(u)) if (!reach.has(v) && canMove(g, u, v)) { reach.add(v); stk.push(v); } }
  const roads: number[] = [], land: number[] = [];
  for (const i of reach) { if (g[i].roads !== 0) roads.push(i); else if (g[i].terrain === 'jungle') land.push(i); }
  if (roads.length < 2 || land.length < 6) return false;          // base area must have enough forage to play
  const allLand: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'jungle' && g[i].roads === 0) allLand.push(i);
  const dist = (a: number, b: number) => Math.abs(((a / N) | 0) - ((b / N) | 0)) + Math.abs((a % N) - (b % N));
  g[base].hotspot = 'base';                                        // main hub — on the road
  const free = (i: number | undefined) => i !== undefined && !g[i].hotspot;
  const byFar = (arr: number[]) => arr.slice().sort((a, b) => dist(b, base) - dist(a, base));
  const rds = roads.filter(i => i !== base);                       // market sits MID-road, not at the far end
  const maxD = Math.max(0, ...rds.map(i => dist(i, base))), mid = maxD / 2;
  const village = rds.slice().sort((a, b) => Math.abs(dist(a, base) - mid) - Math.abs(dist(b, base) - mid))[0];
  if (free(village)) g[village].hotspot = 'village';              // road market, near the middle of the road
  if (free(byFar(allLand.filter(free))[0])) g[byFar(allLand.filter(free))[0]].hotspot = 'remote';   // farthest frontier — the wild 2nd research site (may be isolated → reach by boat)
  const bank = [...reach].filter(i => free(i) && g[i].terrain !== 'water' && g[i].roads === 0 && nbrs(i).some(j => g[j].terrain === 'water'));   // reachable off-road land hugging the river
  if (bank.length) g[bank.sort((a, b) => dist(a, base) - dist(b, base))[0]].hotspot = 'riverVillage';   // a little river-bank village (nearest reachable bank) — home of the shared boat
  return true;
}
function generateMap(seed: number, dim: number): { map: Tile[]; start: number } {
  N = dim;   // set the grid dimension for this match (all helpers read the module-level N)
  for (let a = 0; a < 160; a++) { const { g, bridges, base } = genOnce(seed + a * 7919); if (!validate(g, bridges)) return { map: g, start: base }; }
  throw new Error('map generation failed validation');   // fail-early
}

// lose exactly ONE carried item: a specimen, else a gear piece, else 1 AP
function loseItem(p: PlayerS, random: any): string {
  if (p.samples.length) { const d = p.samples.splice(random.Die(p.samples.length) - 1, 1)[0]; return `${d.type}${d.color}`; }
  if (p.gear.length) { const g = p.gear.splice(random.Die(p.gear.length) - 1, 1)[0]; return gearTag(g); }
  p.ap = Math.max(0, p.ap - 1); return '1AP';
}
// fire a tile event on enter — hazards/boons hit the entering player or the tile itself
function fireEvent(G: GState, t: number, kind: TileEventKind, random: any, cur: string, from: number) {
  const p = G.players[cur], tile = G.map[t];
  if (kind === 'rockslide') {   // PASSIVE full-tile hazard: bury this tile's finds AND seal the WHOLE tile (every edge → impassable obstacle; not a single cliff edge). Hotspots are spared; the entering player is bumped back to where they came from.
    const n = tile.finds.length; tile.finds.length = 0;
    if (!tile.hotspot) for (const j of nbrs(t)) { tile.blocked |= dirBit(t, j); G.map[j].blocked |= dirBit(j, t); }
    if (from >= 0 && from !== t) { p.pos = from; const car = myVehicle(G, cur); if (car && car.pos === t) car.pos = from; }   // bump the player (and a car they drove in) back to the entry tile
    G.log.push(`⛏ rockslide @${t} — tile sealed${n ? `, ${n} find${n > 1 ? 's' : ''} buried` : ''}, P${cur} bumped back`);
  }
  else if (kind === 'animalAttack') G.log.push(`🐗 animal attack — P${cur} loses ${loseItem(p, random)}`);
  else if (kind === 'bushthieves') { const take = Math.min(p.money, BUSHTHIEF_TAKE); p.money -= take; G.log.push(`🏴 bushthieves @${t} — P${cur} -${take}$`); }
  else { const ty = dominantType(tile.terrain); p.samples.push({ type: ty, color: 0 }); G.log.push(`🧭 helpful native — P${cur} gains ${ty}0`); }   // a free easy specimen of the local discipline
}
function reveal(G: GState, t: number, random: any, cur: string, from: number) {
  const tile = G.map[t]; if (tile.revealed) return;
  tile.revealed = true;
  const pool = G.pools[tile.terrain]; if (!pool) return;
  const cap = (tile.roads || tile.hotspot) ? 0 : 1;    // at most ONE find per tile; roads AND special locations (hotspots) bear no finds; the richness-many trials below still gate the CHANCE, so richer terrain is likelier to bear its single find — relative probabilities preserved
  const events: TileEventKind[] = [];
  for (let k = 0; k < tile.richness && pool.length; k++) if (random.Number() < FIND_CHANCE) {
    const c = pool.splice(random.Die(pool.length) - 1, 1)[0];      // each potential slot resolves to a card or comes up empty
    if (isEvent(c)) events.push(c.event);                          // events fire on enter (below); never become finds
    else if (tile.finds.length < cap) tile.finds.push(c);         // specimen — kept up to the tile's find cap
  }
  const kinds = new Set(events);                                  // collapse duplicates: at most ONE of each effect per tile
  if (kinds.has('rockslide')) fireEvent(G, t, 'rockslide', random, cur, from);      // bury finds + seal the whole tile + bump back
  if (kinds.has('animalAttack')) fireEvent(G, t, 'animalAttack', random, cur, from);      // lose at most 1 inventory item
  if (kinds.has('helpfulNative')) fireEvent(G, t, 'helpfulNative', random, cur, from);    // gain at most 1 specimen
  if (kinds.has('bushthieves')) fireEvent(G, t, 'bushthieves', random, cur, from);
  G.log.push(`reveal ${t} (${tile.terrain}): ${tile.finds.length}${kinds.size ? ` +${kinds.size}⚡` : ''}`);
}

const myVehicle = (G: GState, id: string) => G.vehicles.find(v => v.driver === id);
const move: Move<GState> = ({ G, ctx, random }, t: number) => {
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || !nbrs(p.pos).includes(t)) return INVALID_MOVE;
  const ok = p.boat ? canBoat(G.map, p.pos, t) : canMove(G.map, p.pos, t);   // boating opens water + cheap brooks
  if (!ok) return INVALID_MOVE;
  const c = p.boat ? boatCost(G.map, p.pos, t) : cost(G.map, p.pos, t);
  if (p.ap < c) return INVALID_MOVE;
  const car = myVehicle(G, ctx.currentPlayer); if (car) car.driver = null;   // step out on foot — car stays put
  const from = p.pos; p.ap -= c; p.pos = t; reveal(G, t, random, ctx.currentPlayer, from); landAt(G, ctx.currentPlayer);
  G.log.push(`P${ctx.currentPlayer} → ${t} (-${c}ap${p.boat ? ' 🛶' : ''})`);
};
// generic link-ride: travel up to `steps` tiles along link `k` for 1 AP. car→roads, boat→river channel — same code, different prerequisite.
function ride(G: GState, ctx: any, random: any, dest: number, from: number, steps: number, k: EdgeKind, allowed: boolean, arrive: () => void, log: string) {
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || p.ap < 1 || !allowed || !linkReach(G.map, from, steps, k).includes(dest)) return INVALID_MOVE;
  p.ap -= 1; p.pos = dest; arrive(); reveal(G, dest, random, ctx.currentPlayer, from); landAt(G, ctx.currentPlayer);
  G.log.push(log);
}
const drive: Move<GState> = ({ G, ctx, random }, dest: number) => {   // drive the boarded vehicle: a car along roads (CAR_STEPS), a motorboat along the large river (MOTORBOAT_STEPS) — player + vehicle travel together
  const v = myVehicle(G, ctx.currentPlayer); if (!v) return INVALID_MOVE;
  const boat = v.kind === 'motorboat';
  return ride(G, ctx, random, dest, v.pos, boat ? MOTORBOAT_STEPS : CAR_STEPS, boat ? 'rivers' : 'roads', true, () => { v.pos = dest; }, `drive ${boat ? '🛥' : '🚗'}→${dest}`);
};
const boatRun: Move<GState> = ({ G, ctx, random }, dest: number) => {   // boat: up to BOAT_STEPS river-channel tiles per AP
  const p = G.players[ctx.currentPlayer], car = myVehicle(G, ctx.currentPlayer);
  return ride(G, ctx, random, dest, p.pos, BOAT_STEPS, 'rivers', p.boat, () => { if (car) car.driver = null; }, `P${ctx.currentPlayer} 🛶→ ${dest} (-1ap)`);
};
const board: Move<GState> = ({ G, ctx }, v = 0) => {   // climb into an unoccupied vehicle (free): a car you're stood on, or a motorboat moored on an adjacent river tile (hop aboard from the bank)
  const p = G.players[ctx.currentPlayer], car = G.vehicles[v];
  if (G.epilogue || !car || car.driver !== null) return INVALID_MOVE;
  const aboard = car.pos === p.pos, hop = car.kind === 'motorboat' && nbrs(p.pos).includes(car.pos);
  if (!aboard && !hop) return INVALID_MOVE;
  car.driver = ctx.currentPlayer; if (hop) p.pos = car.pos;   // step off the bank onto the moored motorboat
  G.log.push(`P${ctx.currentPlayer} board ${car.kind}@${car.pos}`);
};
const leave: Move<GState> = ({ G, ctx }) => {   // step out (free): a car stays where it is; a motorboat docks you to an adjacent bank tile
  const p = G.players[ctx.currentPlayer], car = myVehicle(G, ctx.currentPlayer);
  if (G.epilogue || !car) return INVALID_MOVE;
  if (car.kind === 'motorboat') {
    const dock = nbrs(p.pos).find(j => isLandT(G.map[j]) && !onBlocked(G.map, p.pos, j));   // step ashore
    if (dock === undefined) return INVALID_MOVE;   // mid-river with no reachable bank → drive to a dockable spot first
    p.pos = dock;
  }
  car.driver = null;
  G.log.push(`P${ctx.currentPlayer} leave ${car.kind}@${car.pos}`);
};
// drop/pickup cache items (boat or any gear kit) on the current tile (free). At the BASE this tile is the communal lab stash.
const carHere = (G: GState, pos: number) => G.vehicles.find(v => v.pos === pos);   // a co-located car (for trunk stash/unstash)
const drop: Move<GState> = ({ G, ctx }, sel: 'boat' | number = 'boat') => {   // sel: 'boat', or an index into your gear
  const p = G.players[ctx.currentPlayer], eq = G.map[p.pos].equipment, where = p.pos === G.base ? 'lab' : `@${p.pos}`;
  if (G.epilogue) return INVALID_MOVE;
  if (sel === 'boat') { if (!p.boat) return INVALID_MOVE; p.boat = false; eq.push({ kind: 'boat' }); G.log.push(`P${ctx.currentPlayer} drop boat ${where}`); return; }
  if (sel < 0 || sel >= p.gear.length) return INVALID_MOVE;
  const g = p.gear.splice(sel, 1)[0]; eq.push({ kind: 'gear', gear: g });
  G.log.push(`P${ctx.currentPlayer} drop ${gearTag(g)} ${where}`);
};
const pickup: Move<GState> = ({ G, ctx }, sel: 'boat' | number = 'boat') => {   // sel: 'boat' (first boat), or an index into the tile's cached items
  const p = G.players[ctx.currentPlayer], eq = G.map[p.pos].equipment, where = p.pos === G.base ? 'lab' : `@${p.pos}`;
  if (G.epilogue) return INVALID_MOVE;
  const idx = sel === 'boat' ? eq.findIndex(e => e.kind === 'boat') : sel;
  if (idx < 0 || idx >= eq.length) return INVALID_MOVE;
  const it = eq[idx];
  if (it.kind === 'boat') { if (p.boat) return INVALID_MOVE; p.boat = true; eq.splice(idx, 1); G.log.push(`P${ctx.currentPlayer} pickup boat ${where}`); return; }
  if (!hasRoom(p)) return INVALID_MOVE;
  const g = eq.splice(idx, 1)[0].gear!; p.gear.push(g);
  G.log.push(`P${ctx.currentPlayer} pickup ${gearTag(g)} ${where}`);
};
// stash/unstash items into a co-located car's trunk (free) — items ride with the car when driven
const stash: Move<GState> = ({ G, ctx }, sel: 'boat' | number = 'boat') => {   // sel: 'boat', or an index into your gear
  const p = G.players[ctx.currentPlayer], car = carHere(G, p.pos);
  if (G.epilogue || !car || car.trunk.length >= TRUNK_SLOTS) return INVALID_MOVE;
  if (sel === 'boat') { if (!p.boat) return INVALID_MOVE; p.boat = false; car.trunk.push({ kind: 'boat' }); G.log.push(`P${ctx.currentPlayer} stash boat → trunk`); return; }
  if (sel < 0 || sel >= p.gear.length) return INVALID_MOVE;
  const g = p.gear.splice(sel, 1)[0]; car.trunk.push({ kind: 'gear', gear: g });
  G.log.push(`P${ctx.currentPlayer} stash ${gearTag(g)} → trunk`);
};
const unstash: Move<GState> = ({ G, ctx }, i = 0) => {   // i = index into the co-located car's trunk
  const p = G.players[ctx.currentPlayer], car = carHere(G, p.pos);
  if (G.epilogue || !car || i < 0 || i >= car.trunk.length) return INVALID_MOVE;
  const it = car.trunk[i];
  if (it.kind === 'boat') { if (p.boat) return INVALID_MOVE; p.boat = true; car.trunk.splice(i, 1); G.log.push(`P${ctx.currentPlayer} take boat ← trunk`); return; }
  if (!hasRoom(p)) return INVALID_MOVE;
  const g = car.trunk.splice(i, 1)[0].gear!; p.gear.push(g);
  G.log.push(`P${ctx.currentPlayer} take ${gearTag(g)} ← trunk`);
};
// (discoveries are NOT droppable — a carried hand only leaves you by being force-stashed at a research site, then consumed by research)

// ---- research projects: a SHARED, CONSUMED pool of open questions (first to publish CLAIMS it; the pool refills from a per-match deck).
// Poker grammar (discipline = rank, colour = suit) made CONCRETE: each project pins specific values, so two players can race the same question.
// A project is a list of PARTS; each part needs `count` discoveries pinned by discipline and/or colour. Owned fill first; ≤MAX_CITE shortfall cites others' published. Discoveries used are CONSUMED into the publisher's pool.
const DTYPES: DType[] = ['geo', 'zoo', 'bot', 'arch'];
const COL_NAME = ['red', 'green', 'gold', 'violet'];   // the 4 colours (match DCOLOR in render)
export interface GoalPart { count: number; type?: DType; color?: number; }   // undefined axis = free (any)
export interface Pattern { id: string; label: string; parts: GoalPart[]; prestige: number; money: number; }
const POOL_SIZE = 8;   // open research questions on the board at once
export const publishCost = (pubs: number) => Math.min(4, 1 + Math.floor(Math.max(0, pubs) / PUBLISH_STEP));   // each successive publish costs more AP (capped at 4 = one full turn) → maximise value per publish; a volume-leader self-handicaps but is never fully locked out
export interface GoalSlot { type?: DType; color?: number; state: 'have' | 'cite' | 'need'; }
// fit a project: assign distinct owned discoveries to each part; cover ≤MAX_CITE shortfall from the citable pool. Returns the slot-by-slot state for the planner.
export function evalGoal(pat: Pattern, owned: Discovery[], citable: Discovery[]): { ok: boolean; cited: number; ownedIdx: number[]; slots: GoalSlot[] } {
  const used = new Set<number>(); const ownedIdx: number[] = []; const slots: GoalSlot[] = []; let cited = 0, ok = true;
  for (const part of pat.parts) {
    const match = (d: Discovery) => (part.type === undefined || d.type === part.type) && (part.color === undefined || d.color === part.color);
    let citLeft = citable.filter(match).length;
    for (let k = 0; k < part.count; k++) {
      let oi = -1; for (let i = 0; i < owned.length; i++) if (!used.has(i) && match(owned[i])) { oi = i; break; }
      if (oi >= 0) { used.add(oi); ownedIdx.push(oi); slots.push({ type: part.type, color: part.color, state: 'have' }); }
      else if (cited < MAX_CITE && citLeft > 0) { cited++; citLeft--; slots.push({ type: part.type, color: part.color, state: 'cite' }); }
      else { slots.push({ type: part.type, color: part.color, state: 'need' }); ok = false; }
    }
  }
  return { ok, cited, ownedIdx, slots };
}
function assemble(G: GState, id: string, owned: Discovery[], citable: Discovery[]): { ownedIdx: number[]; cited: number } | null {
  const pat = G.goals.find(p => p.id === id); if (!pat) return null;
  const r = evalGoal(pat, owned, citable); return r.ok ? { ownedIdx: r.ownedIdx, cited: r.cited } : null;
}
// build the per-match project DECK: concrete poker hands with pinned values (shuffled). The pool is dealt from the top, refilled on claim.
function buildGoalDeck(rand: () => number): Pattern[] {
  const colors = Array.from({ length: COLORS }, (_, i) => i);
  const shuf = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // reward reflects difficulty: a part pinned to colour c demands DC (6+c) finds, so add a premium for the hard colours it forces (free-colour parts → forage the easy red, no premium)
  let n = 0; const mk = (label: string, parts: GoalPart[], prestige: number, money: number): Pattern => {
    const diff = parts.reduce((s, pt) => s + pt.count * (pt.color ?? 0), 0);
    return { id: `g${n++}`, label, parts, prestige: prestige + Math.round(diff * DIFF_REWARD), money };
  };
  const next = (t: DType) => DTYPES[(DTYPES.indexOf(t) + 1) % 4];
  const half = <T>(a: T[]) => a.filter((_, i) => i % 2 === 0);   // ~half the premium variants → simple targets dominate the pool more
  const deck: Pattern[] = [
    // attainable 3-card / 4-card bread-and-butter — favoured, but low value (a steep gradient discourages spamming small hands)
    ...DTYPES.map(t => mk(`${t} three of a kind`, [{ count: 3, type: t }], 4, 1)),
    ...colors.map(c => mk(`${COL_NAME[c]} triple`, [{ count: 3, color: c }], 4, 1)),
    ...DTYPES.map(t => mk(`${t} + ${next(t)} two pair`, [{ count: 2, type: t }, { count: 2, type: next(t) }], 4, 1)),
    // premium 5-card / both-axes — only ~half as many copies, worth chasing
    ...half(DTYPES).map(t => mk(`${t} full house`, [{ count: 3, type: t }, { count: 2, type: next(t) }], 6, 2)),
    ...half(colors).map(c => mk(`${COL_NAME[c]} flush`, [{ count: 5, color: c }], 6, 2)),
    ...half(DTYPES).map(t => mk(`${t} four of a kind`, [{ count: 4, type: t }], 6, 2)),
    ...half(colors).map(c => mk(`${COL_NAME[c]} ${DTYPES[c % 4]} triple`, [{ count: 3, type: DTYPES[c % 4], color: c }], 5, 2)),   // both-axes
    mk('discipline straight', DTYPES.map(t => ({ count: 1, type: t })), 3, 1),
    mk('colour straight', colors.map(c => ({ count: 1, color: c })), 3, 1),
  ];
  return shuf(deck);
}
const citablePool = (G: GState, self: string) => { const out: Discovery[] = []; for (const id in G.players) if (id !== self) out.push(...G.players[id].published); return out; };

const catalogue: Move<GState> = ({ G, ctx, random }, find: number) => {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || p.ap < 1 || !tile.revealed || find < 0 || find >= tile.finds.length) return INVALID_MOVE;  // discoveries are uncapped in hand
  p.ap -= 1;
  const d = tile.finds[find], tag = `${d.type}${d.color}`, dc = catDC(d.color);   // higher-colour finds are harder to catalogue
  const roll = random.D6() + random.D6() + gearBonus(p.gear, d.type);   // gear steadies the dice (field kit only for its discipline)
  if (roll >= dc) { tile.finds.splice(find, 1); p.samples.push(d); G.log.push(`catalogue ${tag} ${roll}/${dc} ✓ collected`); }
  else if (roll >= dc - 2) G.log.push(`catalogue ${tag} ${roll}/${dc} ◦ stayed`);   // a near miss (within 2) leaves the find for another attempt — fewer rolls destroy it
  else { tile.finds.splice(find, 1); G.log.push(`catalogue ${tag} ${roll}/${dc} ✗ ${d.type === 'zoo' ? 'fled' : 'destroyed'}`); }   // fauna flees, the rest is destroyed
};

const publish: Move<GState> = ({ G, ctx }, patternName: string) => {  // research from the SHARED open pool at this research site (or the lab pool in the epilogue)
  const p = G.players[ctx.currentPlayer], apCost = publishCost(p.pubs), pool = researchPool(G, p.pos);
  if (!pool || p.ap < apCost) return INVALID_MOVE;                   // must be at a research site (base / frontier) — cost rises with publish count
  const pat = G.goals.find(x => x.id === patternName); if (!pat) return INVALID_MOVE;
  const res = assemble(G, pat.id, pool, []); if (!res) return INVALID_MOVE;   // assemble from the open pool — anyone's stashed cards are fair game
  p.ap -= apCost;
  const used = res.ownedIdx.map(i => pool[i]);
  res.ownedIdx.slice().sort((a, b) => b - a).forEach(i => pool.splice(i, 1));   // consume the used cards from the SHARED pool
  p.published.push(...used);                                          // → your published pool (public record)
  p.prestige += pat.prestige; p.money += pat.money; p.pubs += 1;     // research token → prestige; bump publish count (raises next publish's AP cost)
  G.log.push(`publish ${pat.label} +${pat.prestige}P +${pat.money}$`);
  const gi = G.goals.findIndex(x => x.id === pat.id);                // CLAIM the question: remove it and refill the pool from the deck
  if (gi >= 0) { G.goals.splice(gi, 1); if (G.goalDeck.length) G.goals.push(G.goalDeck.shift()!); }
};


// ---- Dijkstra over the weighted move-graph (foot or boat) → first step toward the nearest goal cell ----
function stepToward(G: GState, from: number, goal: (t: Tile) => boolean, boat: boolean): number {
  const ok = boat ? canBoat : canMove, wt = boat ? boatCost : cost;
  const dist = new Map<number, number>([[from, 0]]), prev = new Map<number, number>();
  const pq: [number, number][] = [[0, from]];
  while (pq.length) {
    let bi = 0; for (let k = 1; k < pq.length; k++) if (pq[k][0] < pq[bi][0]) bi = k;
    const [d, u] = pq.splice(bi, 1)[0];
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u !== from && goal(G.map[u])) { let c = u; while (prev.get(c) !== from) c = prev.get(c)!; return c; }
    for (const v of nbrs(u)) if (ok(G.map, u, v)) { const nd = d + wt(G.map, u, v); if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); pq.push([nd, v]); } }
  }
  return -1;
}
const forageTarget = (t: Tile) => t.finds.length > 0 || (!t.revealed && t.richness > 0);  // unclaimed token, or unexplored find-bearing terrain
// how many goal-cells are reachable from `from` on the foot vs boat graph (used to decide if grabbing the shared boat is worth it)
function reachGoals(G: GState, from: number, boat: boolean, goal: (t: Tile) => boolean): number {
  const ok = boat ? canBoat : canMove, seen = new Set<number>([from]), st = [from]; let n = 0;
  while (st.length) { const u = st.pop()!; if (goal(G.map[u])) n++; for (const v of nbrs(u)) if (!seen.has(v) && ok(G.map, u, v)) { seen.add(v); st.push(v); } }
  return n;
}
const manhattan = (a: number, b: number) => Math.abs(((a / N) | 0) - ((b / N) | 0)) + Math.abs((a % N) - (b % N));
const goalCells = (G: GState, goal: (t: Tile) => boolean) => { const a: number[] = []; for (let i = 0; i < N * N; i++) if (goal(G.map[i])) a.push(i); return a; };
const nearestDist = (cells: number[], from: number) => cells.reduce((m, c) => Math.min(m, manhattan(from, c)), Infinity);
// car: board a co-located idle car / drive to the road cell nearest the goal / dismount once roads stop helping
function carStep(G: GState, ctx: any, goals: number[]): { move: string; args: unknown[] } | null {
  const p = G.players[ctx.currentPlayer]; if (p.ap < 1 || !goals.length) return null;
  const here = nearestDist(goals, p.pos);
  if (here < 3) return null;   // only bother with the car when the goal is far enough that roads save real distance
  const myCar = G.vehicles.find(v => v.driver === ctx.currentPlayer && v.kind === 'car');   // the heuristic only drives ground cars (motorboats are a human tool)
  if (myCar) {                                                          // driving → hop to the best closer road cell, else step out
    let best = -1, bd = here;
    for (const c of roadReach(G.map, myCar.pos, CAR_STEPS)) { const d = nearestDist(goals, c); if (d < bd) { bd = d; best = c; } }
    return best >= 0 ? { move: 'drive', args: [best] } : { move: 'leave', args: [] };
  }
  const vi = G.vehicles.findIndex(v => v.pos === p.pos && v.driver === null && v.kind === 'car');   // parked car underfoot → board if roads lead closer
  if (vi >= 0 && roadReach(G.map, G.vehicles[vi].pos, CAR_STEPS).some(c => nearestDist(goals, c) < here)) return { move: 'board', args: [vi] };
  return null;
}
// heuristic policy: publish at a hub; grab the boat when it unlocks water-bound forage; drive roads + boat water toward the goal
export function botAction(G: GState, ctx: any, rand: () => number): { move?: string; args?: unknown[]; event?: string } {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos], cit = citablePool(G, ctx.currentPlayer);
  // publish from the shared open pool at a research site — claim the most valuable open question the pool can complete (your hand was force-stashed here on arrival)
  const pool = researchPool(G, p.pos);
  if (pool && p.ap >= publishCost(p.pubs)) for (const pat of [...G.goals].sort((a, b) => b.prestige - a.prestige)) if (assemble(G, pat.id, pool, [])) return { move: 'publish', args: [pat.id] };
  if (G.epilogue) return { event: 'endTurn' };   // lab: only publishing
  if (isMarket(tile) && p.gear.length < GEAR_MAX) {   // invest spare money in gear: best affordable generic kit
    const buyable = (['g3', 'g2', 'g1'] as GearKind[]).find(k => p.money >= GEAR_PRICE[k] + 4);
    if (buyable) return { move: 'buy', args: [buyable] };
  }
  if (!p.boat && tile.equipment.some(e => e.kind === 'boat') && reachGoals(G, p.pos, true, forageTarget) > reachGoals(G, p.pos, false, forageTarget))
    return { move: 'pickup', args: ['boat'] };   // grab the shared boat only when water is actually fencing off forage
  if (p.ap >= 1 && tile.finds.length) {   // catalogue the find that best advances an open project (build a hand toward a question)
    let bestI = 0, bestScore = -1;
    for (let i = 0; i < tile.finds.length; i++) {
      const trial = [...p.samples, tile.finds[i]];
      let score = 0;
      for (const g of G.goals) { const r = evalGoal(g, trial, cit); score = Math.max(score, (r.ok ? 1000 : 0) + r.slots.filter(s => s.state === 'have').length * 10 + g.prestige); }
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    return { move: 'catalogue', args: [bestI] };
  }
  const hasHand = G.goals.some(g => assemble(G, g.id, p.samples, cit));   // hand completes a project → head to a research site to stash + cash it; else forage
  const goalPred = hasHand ? isResearch : forageTarget;
  if (!(hasHand && isResearch(tile))) {
    const goals = goalCells(G, goalPred);
    const cs = carStep(G, ctx, goals); if (cs) return cs;                                   // car: zip along roads toward the goal
    const nx = stepToward(G, p.pos, goalPred, p.boat);                                      // foot/boat: weighted step toward the goal
    if (nx >= 0) { if (p.ap >= (p.boat ? boatCost : cost)(G.map, p.pos, nx)) return { move: 'move', args: [nx] }; }   // reachable — step now, else wait for AP next turn
    else if (hasHand && p.ap >= 1 && p.pos !== G.base) return { move: 'helilift', args: [] };  // genuinely no hub reachable → fly home
  }
  const can = p.boat ? canBoat : canMove, wt = p.boat ? boatCost : cost;                    // fallback: any affordable step (don't stall)
  const opts = nbrs(p.pos).filter(t => can(G.map, p.pos, t) && p.ap >= wt(G.map, p.pos, t));
  if (!hasHand && opts.length) return { move: 'move', args: [opts[Math.floor(rand() * opts.length)]] };
  if (!nbrs(p.pos).some(t => canMove(G.map, p.pos, t) || canBoat(G.map, p.pos, t)) && p.ap >= 1 && p.pos !== G.base) return { move: 'helilift', args: [] };  // sealed in by a rockslide → fly out
  return { event: 'endTurn' };
}

const buy: Move<GState> = ({ G, ctx }, kind: GearKind | 'boat' | 'car' = 'g1', field?: DType) => {   // buy a kit / boat / car at a market (free action, no AP)
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || !isMarket(tile)) return INVALID_MOVE;
  if (kind === 'boat') { if (p.boat || p.money < BOAT_PRICE) return INVALID_MOVE; p.money -= BOAT_PRICE; p.boat = true; G.log.push(`buy boat (-${BOAT_PRICE}$)`); return; }
  if (kind === 'car') { if (p.money < CAR_PRICE) return INVALID_MOVE; p.money -= CAR_PRICE; G.vehicles.push({ pos: p.pos, driver: null, trunk: [], kind: 'car' }); G.log.push(`buy car@${p.pos} (-${CAR_PRICE}$)`); return; }
  const price = GEAR_PRICE[kind];
  if (p.gear.length >= GEAR_MAX || p.money < price) return INVALID_MOVE;
  if (kind === 'field' && !field) return INVALID_MOVE;
  p.money -= price; p.gear.push(kind === 'field' ? { kind, field } : { kind });
  G.log.push(`buy ${kind === 'field' ? `${field} kit` : kind} (-${price}$)`);
};
const helilift: Move<GState> = ({ G, ctx }) => {   // airlift to the main hub; pay cash, cover any shortfall with negative-prestige tokens
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || p.ap < 1 || p.pos === G.base) return INVALID_MOVE;
  p.ap -= 1;
  const car = myVehicle(G, ctx.currentPlayer); if (car) car.driver = null;   // airlift leaves the car behind
  const pay = Math.min(p.money, HELILIFT_COST); p.money -= pay;
  const neg = Math.ceil((HELILIFT_COST - pay) / 4);   // 4$ ≈ 1 prestige (matches money→VP rate)
  if (neg > 0) p.prestige -= neg;                      // negative-prestige tokens (reputation hit)
  p.pos = G.base; landAt(G, ctx.currentPlayer);
  G.log.push(`helilift→base (-${pay}$${neg ? ` -${neg}P` : ''})`);
};
export const enumerate = (G: GState, ctx: any) => {
  const p = G.players[ctx.currentPlayer], out: any[] = [], tile = G.map[p.pos];
  if (!G.epilogue) {                                                  // field season
    const myCar = G.vehicles.find(v => v.driver === ctx.currentPlayer);
    nbrs(p.pos).forEach(t => { const ok = p.boat ? canBoat(G.map, p.pos, t) : canMove(G.map, p.pos, t); const c = p.boat ? boatCost(G.map, p.pos, t) : cost(G.map, p.pos, t); if (ok && p.ap >= c) out.push({ move: 'move', args: [t] }); });
    if (p.ap >= 1 && myCar) (myCar.kind === 'motorboat' ? riverReach(G.map, myCar.pos, MOTORBOAT_STEPS) : roadReach(G.map, myCar.pos, CAR_STEPS)).forEach(d => out.push({ move: 'drive', args: [d] }));
    if (p.ap >= 1 && p.boat) riverReach(G.map, p.pos, BOAT_STEPS).forEach(d => out.push({ move: 'boatRun', args: [d] }));   // fast river-channel boating
    G.vehicles.forEach((v, i) => { if (v.pos === p.pos && v.driver === null) out.push({ move: 'board', args: [i] }); });
    if (myCar) out.push({ move: 'leave', args: [] });
    if (p.ap >= 1) tile.finds.forEach((_, i) => out.push({ move: 'catalogue', args: [i] }));   // discoveries are uncapped in hand
    if (isMarket(tile)) {   // buy a chosen gear kit / boat / car (selectable)
      if (p.gear.length < GEAR_MAX) {
        (['g1', 'g2', 'g3'] as GearKind[]).forEach(k => { if (p.money >= GEAR_PRICE[k]) out.push({ move: 'buy', args: [k] }); });
        if (p.money >= GEAR_PRICE.field) DTYPES.forEach(t => out.push({ move: 'buy', args: ['field', t] }));
      }
      if (!p.boat && p.money >= BOAT_PRICE) out.push({ move: 'buy', args: ['boat'] });
      if (p.money >= CAR_PRICE) out.push({ move: 'buy', args: ['car'] });
    }
    if (p.boat) out.push({ move: 'drop', args: ['boat'] });                                   // cache items on this tile (lab stash at base)
    p.gear.forEach((_, i) => out.push({ move: 'drop', args: [i] }));
    tile.equipment.forEach((e, i) => {                                                        // reclaim cached items here
      if (e.kind === 'boat' && !p.boat) out.push({ move: 'pickup', args: [i] });
      if (e.kind === 'gear' && hasRoom(p)) out.push({ move: 'pickup', args: [i] });
    });
    const car = carHere(G, p.pos);                                                            // co-located car → trunk stash/unstash
    if (car) {
      if (car.trunk.length < TRUNK_SLOTS) { if (p.boat) out.push({ move: 'stash', args: ['boat'] }); p.gear.forEach((_, i) => out.push({ move: 'stash', args: [i] })); }
      car.trunk.forEach((e, i) => {
        if (e.kind === 'boat' && !p.boat) out.push({ move: 'unstash', args: [i] });
        if (e.kind === 'gear' && hasRoom(p)) out.push({ move: 'unstash', args: [i] });
      });
    }
    if (p.ap >= 1 && p.pos !== G.base) out.push({ move: 'helilift', args: [] });
  }
  const pool = researchPool(G, p.pos);   // publish from the shared open pool at a research site (or the lab pool in the epilogue)
  if (pool && p.ap >= publishCost(p.pubs)) G.goals.forEach(pat => { if (assemble(G, pat.id, pool, [])) out.push({ move: 'publish', args: [pat.id] }); });
  out.push({ event: 'endTurn' });
  return out;
};

// ---- event deck: mostly benign; monsoon stacked at the BOTTOM = telegraphed end ----
function buildDeck(seed: number): string[] {
  const top = [...Array(15).fill('tailwind'), ...Array(9).fill('cache'), ...Array(6).fill('grant'),
    ...Array(9).fill('calm'), ...Array(5).fill('rockslide'), ...Array(5).fill('washout')];  // 49 benign+hazard → longer field season
  let z = seed >>> 0; const rnd = () => (z = (z * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = top.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [top[i], top[j]] = [top[j], top[i]]; }
  return [...top, ...Array(6).fill('monsoon')];                       // drawn last (game ends at MONSOON_END)
}
const intactCrossings = (map: Tile[]) => map.filter(t => t.bridge && (t.roads || t.paths)).length;
function applyEvent(G: GState, id: string, random: any, cur: string) {
  const p = G.players[cur];
  if (id === 'tailwind') p.ap += 1;                                   // gust of energy this turn
  else if (id === 'cache') p.money += 2;
  else if (id === 'grant') p.money += 3;
  else if (id === 'calm') { /* no-op filler */ }
  else if (id === 'rockslide') {                                      // mutate a jungle tile → rocky (loses its finds)
    const land = G.map.map((t, i) => ({ t, i })).filter(({ t }) => t.terrain === 'jungle' && !t.hotspot);
    if (land.length) { const { i } = land[random.Die(land.length) - 1]; G.map[i].terrain = 'rocky'; G.map[i].richness = 0; G.map[i].finds = []; }
  } else if (id === 'washout') {                                      // sever a bridge crossing — never the last intact one
    if (intactCrossings(G.map) > 1) {
      const br = G.map.map((t, i) => ({ t, i })).filter(({ t }) => t.bridge && (t.roads || t.paths));
      const { i } = br[random.Die(br.length) - 1];
      for (const j of nbrs(i)) { const rev = dirBit(j, i); G.map[j].roads &= ~rev; G.map[j].paths &= ~rev; }
      G.map[i].roads = 0; G.map[i].paths = 0;                         // no edge to board → crossing unusable
    }
  } else if (id === 'monsoon') G.monsoon += 1;
  G.log.push(`event:${id}${id === 'monsoon' ? ` ⛈${G.monsoon}/${MONSOON_END}` : ''}`);
}
const vp = (p: PlayerS) => p.prestige + Math.floor(p.money / 4);  // unified prestige (research − negative tokens) + money/4

export const Expedition: Game<GState> = {
  name: 'expedition',
  minPlayers: 2, maxPlayers: 4,
  setup: ({ ctx, random }: any) => {
    const seed = random ? (Math.floor(random.Number() * 1e9) || MAP_SEED) : MAP_SEED;   // per-match map+deck variety
    const dim = DIM_MAX;   // fixed 15×15 footprint; ~ACTIVE_TILES tiles kept active for a consistent size + spread
    const { map, start } = generateMap(seed, dim);
    const colorRand = prng((seed ^ 0x5bd1e995) >>> 0);   // deterministic per-match colour stream (independent of type)
    map[start].revealed = true;
    const rv = map.findIndex(t => t.hotspot === 'riverVillage');   // the shared canoe waits at the little river village (falls back to base if the river isn't reachable on foot)
    map[rv >= 0 ? rv : start].equipment.push({ kind: 'boat' });
    const moor = rv >= 0 ? nbrs(rv).find(j => map[j] && map[j].terrain === 'water') : undefined;   // moor a shared motorboat on the large river beside the village
    const vehicles: Vehicle[] = Array.from({ length: ctx.numPlayers }, () => ({ pos: start, driver: null, trunk: [], kind: 'car' as const }));   // one shared car per player, at base
    if (moor !== undefined) vehicles.push({ pos: moor, driver: null, trunk: [], kind: 'motorboat' });
    return {
      players: Object.fromEntries(Array.from({ length: ctx.numPlayers }, (_, i) =>
        [String(i), { ap: START_AP, pos: start, money: 0, samples: [], published: [], prestige: 0, pubs: 0, gear: [], boat: false }])),
      map, cols: N, rows: N, base: start,
      vehicles,
      pools: { grassland: buildPool('grassland', colorRand), jungle: buildPool('jungle', colorRand), rocky: buildPool('rocky', colorRand), ruins: buildPool('ruins', colorRand), water: buildPool('water', colorRand) },
      ...(() => { const deck = buildGoalDeck(prng((seed ^ 0x9e3779b1) >>> 0)); return { goals: deck.slice(0, POOL_SIZE), goalDeck: deck.slice(POOL_SIZE) }; })(),   // deal the open-question pool; rest is the refill deck
      events: buildDeck(seed), monsoon: 0, epilogue: false, labLeft: 0, log: ['setup'],
    };
  },
  moves: { move, catalogue, publish, buy, drive, boatRun, helilift, board, leave, drop, pickup, stash, unstash },
  turn: {
    onBegin: ({ G, ctx, random }) => {
      if (!G.epilogue) {
        const id = G.events.shift(); if (id) applyEvent(G, id, random, ctx.currentPlayer);   // field season: 1 event/turn
        if (G.monsoon >= MONSOON_END || !G.events.length) {
          G.epilogue = true; G.labLeft = ctx.numPlayers;
          const lab = G.map[G.base].cache;   // lab season: every hand + the frontier pool all consolidate into the base lab pool
          for (const id in G.players) { const pl = G.players[id]; if (pl.samples.length) { lab.push(...pl.samples); pl.samples.length = 0; } }
          G.map.forEach(t => { if (t.hotspot === 'remote' && t.cache.length) { lab.push(...t.cache); t.cache.length = 0; } });
          G.log.push('🌧️ monsoon — indoor lab season');
        }
      }
      G.players[ctx.currentPlayer].ap = START_AP;        // refill (field AP, or lab-research AP)
    },
    onEnd: ({ G }) => { if (G.epilogue) G.labLeft -= 1; },   // each player gets exactly one lab turn
  },
  endIf: ({ G }) => {
    if (!(G.epilogue && G.labLeft <= 0)) return;              // play through the indoor lab season, then score
    const e = Object.entries(G.players);
    const winner = e.reduce((a, b) => vp(b[1]) > vp(a[1]) ? b : a)[0];
    return { winner, scores: Object.fromEntries(e.map(([id, p]) => [id, vp(p)])) };
  },
  ai: { enumerate },
};
