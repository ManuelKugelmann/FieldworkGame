import type { Game, Move } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

export type Terrain = 'grassland' | 'jungle' | 'rocky' | 'ruins' | 'water' | 'void';  // roads are an edge overlay on a land base, not a terrain; ruins = arch-rich dig site; void = off-board
export type Bridge = 'road' | 'foot';
export type DType = 'geo' | 'zoo' | 'bot' | 'arch';
export interface Discovery { type: DType; color: number; }
// player specialists: a permanent catalogue bonus for their discipline (cosmetic colour = their preferred biome's lean)
export type Role = 'geologist' | 'zoologist' | 'botanist' | 'archaeologist';
export const ROLE_DISC: Record<Role, DType> = { geologist: 'geo', zoologist: 'zoo', botanist: 'bot', archaeologist: 'arch' };
export const ROLES: Role[] = ['botanist', 'zoologist', 'geologist', 'archaeologist'];
// some cards in a terrain's stack are tile EVENTS (hazards/boons) — they fire on tile ENTER (when revealed), they're never collectible finds
export type TileEventKind = 'rockslide' | 'animalAttack' | 'bushthieves' | 'helpfulNative';
export interface TileEvent { event: TileEventKind; }
export type Card = Discovery | TileEvent;                          // a stack holds specimens + events mixed
const isEvent = (c: Card): c is TileEvent => 'event' in c;
export type Hotspot = 'base' | 'remote' | 'village' | 'riverVillage';  // POIs: road base (market + research), frontier (remote) research site, road market (village), little river-bank village (market; home of the shared boat)
export type EquipKind = 'gear' | 'boat';              // carryable items cached on a tile (droppable/pickup-able)
export interface Equip { kind: EquipKind; gear?: GearItem; }   // a cached item: a boat, or a gear kit (carries its full GearItem)
export type VehicleKind = 'car' | 'motorboat';   // car = positioned road vehicle; motorboat = positioned LARGE-RIVER vehicle (fast channel travel, board from the bank / dock to the bank)
export interface Vehicle { pos: number; driver: string | null; kind: VehicleKind; }  // a positioned entity you board/leave; drive moves both
// GEAR: typed kit that shares the carry slots with specimens. generic g1/g2/g3 = +1/+2/+3 to every catalogue roll; a FIELD kit = bigger bonus but only for its discipline.
export type GearKind = 'g1' | 'g2' | 'g3' | 'field';
export interface GearItem { kind: GearKind; field?: DType; }   // field = the discipline a 'field' kit boosts
export interface Tile { terrain: Terrain; bridge?: Bridge; roads: number; paths: number; smallRivers: number; blocked: number; rivers: number; hotspot?: Hotspot; richness: number; revealed: boolean; finds: Discovery[]; equipment: Equip[]; cache: Discovery[]; }  // cache = discoveries DROPPED here (face-up, free to pick up); roads/paths/smallRivers(brooks)/blocked(cliffs)/rivers(channel linkage) = edge bitmasks N1 E2 S4 W8
export interface PlayerS { ap: number; pos: number; money: number; samples: Discovery[]; published: Discovery[]; prestige: number; pubs: number; pubTurn: number; gear: GearItem[]; boat: boolean; role: Role; }  // pubTurn = ctx.turn of last publish (≤ 1 publish/turn); role = specialist (permanent catalogue bonus for its discipline)
export interface GState {
  players: Record<string, PlayerS>;
  map: Tile[]; cols: number; rows: number; base: number;   // main hub (road) — helilift target
  vehicles: Vehicle[];                                     // shared cars on the board (start at base)
  pools: Partial<Record<Terrain, Card[]>>;
  goals: Pattern[];                                        // the open research questions on the board (shared, consumed on publish)
  goalDeck: Pattern[];                                     // remaining projects; the pool refills from here on a claim
  events: string[]; monsoon: number; epilogue: boolean; labLeft: number; log: string[];   // epilogue = indoor lab season
  roundEvent: string;   // the ONE global event drawn by the start player this round (affects every player); '' = none
}

let N = 10;                  // grid dimension (square), chosen per-match in [10..15]
const DIM_MIN = 10, DIM_MAX = 18, ACTIVE_TILES = 200, START_AP = 4,  // 4 AP/turn; in round 1 only it ramps UP by play order (start player least) to offset first-mover advantage
  COLORS = 3, MAP_SEED = 1, MAX_CITE = 0, CAR_STEPS = 4, BOAT_STEPS = 4, FIND_CHANCE = 0.75, HELILIFT_COST = 12, FIELD_BONUS = 3, MOTORBOAT_STEPS = 4;  // vehicles cover 4 road/river tiles per AP = 0.25 AP/tile

// gear catalogue: generic kits boost every roll; a field kit boosts only its discipline (but more, and cheaper than the equivalent generic)
export const GEAR_MAX = 3;   // max gear pieces a player carries (discoveries are uncapped)
export const ROLE_BONUS = 3;   // a specialist's permanent catalogue bonus for their own discipline
export const MONSOON_END = 4;   // field season ends (epilogue begins) after this many monsoon events
// LAB tuning — fairest config measured over 700-match sweeps (win rates 23/24/25/28% by seat, 5-pt spread):
//   frontier 'all' = merge the frontier pool into the lab pool at lab start (available to everyone), not just the last player.
//   dump 'roundrobin' = each lab player dumps their hand on their own turn (dump-as-you-go). NB 'upfront' (pool everything before P0)
//   over-corrects badly — P0 cherry-picks the full pool and wins ~62% — so it is NOT used.
export const LAB_CFG: { frontier: 'last' | 'all' | 'none'; dump: 'roundrobin' | 'upfront' } = { frontier: 'all', dump: 'roundrobin' };
export const BAL = { wander: true, seasonBenign: 26, round0Ramp: false, labInverse: false };   // wander = rotating start; seasonBenign ≈ field rounds; round0Ramp = handicap round-1 opener; labInverse = lab publishes in REVERSE seat order (P{N-1} first)
export const GEAR_PRICE: Record<GearKind, number> = { g1: 3, g2: 6, g3: 10, field: 4 };
export const gearBonus = (gear: GearItem[], t: DType) => gear.reduce((s, g) => s + (g.kind === 'g1' ? 1 : g.kind === 'g2' ? 2 : g.kind === 'g3' ? 3 : g.field === t ? FIELD_BONUS : 0), 0);
// catalogue difficulty by colour tier — bare 2d6 success: easy ~83%, mid ~42%, hard 0% (needs gear). Gear/specialist bonuses push the hard ones over.
const COL_DC = [5, 8, 13];   // 🟪 easy · ⬜ mid · 🟦 hard
export const catDC = (color: number) => COL_DC[color] ?? 8;
const gearTag = (g: GearItem) => g.kind === 'field' ? `${g.field} kit` : g.kind;   // log label for a gear kit
const hasRoom = (p: PlayerS) => p.gear.length < GEAR_MAX;   // can take one more gear piece (discoveries are uncapped)

const RICH: Record<Terrain, number> = { grassland: 2, jungle: 4, rocky: 3, ruins: 4, water: 2, void: 0 };  // max potential tokens; ruins = deep dig site; water = aquatic biome (forage by canoe/boat)
const plainRiver = (t: Tile) => t.terrain === 'water' && !t.bridge;  // river = hard barrier (1-tile-wide)
const isLandT = (t: Tile) => t.terrain !== 'water' && t.terrain !== 'void';  // any walkable land terrain
const isVoid = (t: Tile) => t.terrain === 'void';                   // off-board cell (irregular edges) — impassable, no finds
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
const cost = (map: Tile[], a: number, b: number) => onPath(map, a, b) ? 0.5 : 1;  // path/road edge = 0.5 AP; any other (regular) tile = 1 AP
const canBoat = (map: Tile[], a: number, b: number) => {           // BOAT graph (player carrying the boat): water + brooks, and still walks dry land
  if (onBlocked(map, a, b) || isVoid(map[a]) || isVoid(map[b])) return false;
  if (map[a].bridge || map[b].bridge) return onPath(map, a, b);
  return true;                                                     // land↔land, land↔water, water↔water
};
const boatCost = (map: Tile[], a: number, b: number) =>             // by canoe: river/brook tile = 0.25 AP; otherwise foot cost (0.5 path / 1 regular)
  (plainRiver(map[a]) || plainRiver(map[b]) || (map[a].smallRivers & dirBit(a, b))) ? 0.25 : (onPath(map, a, b) ? 0.5 : 1);
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
const isResearch = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'remote';  // base AND frontier are research terminals — BUT both read/write ONE shared pool (the base cache; comms established between the sites)
// the open pool you publish from: the lab season pools everything at base; in the field it's the site you stand on (or none)
// the pool you publish from: in the LAB season the shared base pool (you dumped your hand into it on entry, and publish ONE hand from it); in the field the open pool at the research site you're on
const pubPool = (G: GState, p: PlayerS): Discovery[] | null => (G.epilogue || isResearch(G.map[p.pos])) ? G.map[G.base].cache : null;   // the single shared pool (base cache), reachable from base OR frontier
// NB: the hand is NOT stashed on arrival anymore — your FIRST publish of the turn dumps it into the shared pool (see publish), so unused cards linger as community cards
function landAt(_G: GState, _cur: string) { /* no-op (stash moved to first publish) */ }
const isMarket = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'village' || t.hotspot === 'riverVillage';  // buy gear/boat/car here (base + road village + river village)

const WEIGHTS: Partial<Record<Terrain, Record<DType, number>>> = {
  grassland: { geo: 1, arch: 1, zoo: 1, bot: 1 },   // low everything
  jungle:    { bot: 4, zoo: 4, arch: 2, geo: 1 },   // dense flora + fauna (botany & zoology rich)
  rocky:     { geo: 2, arch: 3, zoo: 1, bot: 1 },   // geology + archaeology (geo trimmed further — minerals are scarcer now, worth more on publish)
  ruins:     { arch: 8, geo: 2, bot: 1, zoo: 1 },   // a dig site — archaeology dominates the stack
  water:     { zoo: 4, bot: 2, geo: 1, arch: 1 },   // aquatic life — fish/fauna heavy, some flora
};
export const BIOME_COLOR: Partial<Record<Terrain, number>> = { jungle: 0, rocky: 1, ruins: 2, water: 1 };  // signature colour per biome pool (0 green · 1 blue · 2 yellow) — drives the colour bias + catalogue-DC lean. grassland omitted = MIXED (no lean); water leans blue like rocky
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
  const set = (i: number, t: Terrain, bridge?: Bridge) => { const max = RICH[t], richness = (max === 0 || (t !== 'ruins' && rand() < 0.5)) ? 0 : 1 + Math.floor(max * rand() ** 2); g[i] = { terrain: t, bridge, roads: 0, paths: 0, smallRivers: 0, blocked: 0, rivers: 0, richness, revealed: false, finds: [], equipment: [], cache: [] }; };  // 0 vs 1+ is 50:50 — except RUINS, which always bear a find (richness ≥ 1); within 1..max skewed toward 1 (max rare)
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
  for (let k = 0; k < 4 && cand.length; k++) { const i = cand.splice(Math.floor(rand() * cand.length), 1)[0]; g[i].bridge = 'foot'; bridges.push(i); }   // 4 foot crossings: the nearest 2 become river villages, the other 2 are plain footbridges

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
  for (const dd of [-1, 1]) { const c = bcol + dd; if (c < 0 || c >= N) continue; const fi = ix(baseRow, c); if (g[fi] && g[fi].roads !== 0 && !g[fi].bridge) growArm(fi, [0, dd], 2 + Math.floor(rand() * 2)); }
  // TWO road 3-way junctions (Y/T splits, mirroring the river's one 3-way): each junction cell carries three road edges — one back to the network, two outward arms
  const freeDir = (i: number, d: [number, number]) => { const r = ((i / N) | 0) + d[0], c = (i % N) + d[1]; return r >= 0 && r < N && c >= 0 && c < N && !g[ix(r, c)]; };
  for (let b = 0; b < 1; b++) {   // ONE 3-way junction (was 2) → fewer road T-junctions, less road
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
    for (const d of pick.arms) growArm(pick.j, d, 3 + Math.floor(rand() * 3));    // shorter outward arms complete the 3-way
  }

  // flood jungle, carve rocky + grassland patches (all passable land; rocky/jungle = 2 AP bushwhack)
  for (let i = 0; i < N * N; i++) if (!g[i]) set(i, 'jungle');
  const carve = (terr: Terrain, p: number, sz: number) => { for (let k = 0; k < p; k++) { let i = Math.floor(rand() * N * N); for (let s = 0; s < sz; s++) { if (g[i].terrain === 'jungle' && g[i].roads === 0) set(i, terr); const ns = nbrs(i).filter(j => g[j].terrain === 'jungle' && g[j].roads === 0); if (!ns.length) break; i = ns[Math.floor(rand() * ns.length)]; } } };   // never carve over a road overlay (set() would wipe its edges)
  const scale = (N * N) / 100;   // patch counts scale with board area (10×10 … 15×15)
  carve('rocky', Math.round(5 * scale), 3); carve('grassland', Math.round(9 * scale), 4);   // less rock (smaller, fewer patches) → more forest (jungle is the remainder); grass unchanged
  carve('ruins', Math.max(1, Math.round(scale)), 2);   // a few small arch-rich dig sites (topped up to RUINS_N below)
  // CLIFFS: 1–2 uncrossable edges on some land tiles (plain land↔land only — never roads/water/bridges, so the laid networks stay intact)
  const isLand = (i: number) => { const t = g[i].terrain; return t === 'jungle' || t === 'rocky' || t === 'grassland' || t === 'ruins'; };
  for (let i = 0; i < N * N; i++) {
    if (!isLand(i) || rand() >= 0.22) continue;                    // more cliffs: ~22% of land tiles get a cliff edge (was 14%)
    const cand = nbrs(i).filter(j => isLand(j) && !(g[i].roads & dirBit(i, j)) && !(g[i].blocked & dirBit(i, j)));
    const k = 1 + (rand() < 0.5 ? 0 : 1);
    for (let n2 = 0; n2 < k && cand.length; n2++) block(i, cand.splice(Math.floor(rand() * cand.length), 1)[0]);
  }
  // exactly ONE WATERFALL: a single cliff edge crossing the river channel (blocks boats past it)
  { const wf: [number, number][] = [];
    for (let i = 0; i < N * N; i++) if (g[i].terrain === 'water' && !g[i].bridge)
      for (const j of [i + 1, i + N]) if (j < N * N && g[j] && g[j].terrain === 'water' && !g[j].bridge && (g[i].rivers & dirBit(i, j))) wf.push([i, j]);
    if (wf.length) { const [wa, wb] = wf[Math.floor(rand() * wf.length)]; block(wa, wb); }
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
  // guarantee exactly RUINS_N ruins survive in the active area (carve can lose them to the void step)
  { const RUINS_N = 3; let rn = 0; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'ruins') rn++;
    const cand: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'jungle' && g[i].roads === 0 && !g[i].bridge) cand.push(i);
    while (rn < RUINS_N && cand.length) { set(cand.splice(Math.floor(rand() * cand.length), 1)[0], 'ruins'); rn++; } }
  placeHotspots(g, base);   // within the kept area; before footpaths so the remote base seeds trails
  for (let i = 0; i < N * N; i++) if (g[i].hotspot && g[i].blocked) {   // no cliffs on location tiles — clear any cliff edges on a hotspot (and the reciprocal edge on neighbours)
    for (const j of nbrs(i)) g[j].blocked &= ~dirBit(j, i);
    g[i].blocked = 0;
  }

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
  for (let k = 0; k < 9 && roadAll.length; k++) junctions.push(roadAll[Math.floor(rand() * roadAll.length)]);   // more trail seeds anywhere on the roads
  for (let i = 0; i < N * N; i++) if (g[i].hotspot) junctions.push(i);   // every special location
  const linked = (a: number, b: number) => { const bit = dirBit(a, b); return ((g[a].roads | g[a].paths | g[a].smallRivers | g[a].rivers) & bit) !== 0; };   // any connector already on this edge? (one connector per edge)
  for (const sd of junctions) {
    const o0 = nbrs(sd).filter(j => g[j].terrain === 'jungle' && !(g[sd].blocked & dirBit(sd, j)) && !linked(sd, j)); if (!o0.length) continue;
    let i = o0[Math.floor(rand() * o0.length)]; linkP(sd, i);
    for (let s = 0; s < 7; s++) { const opts = nbrs(i).filter(j => g[j].terrain === 'jungle' && !(g[i].blocked & dirBit(i, j)) && !linked(i, j)); if (!opts.length) break; const j = opts[Math.floor(rand() * opts.length)]; linkP(i, j); i = j; } }   // longer trails (up to 8 tiles) that fizzle into the jungle

  // BROOKS: boat-only side-channels — mouth at a river tile, then link consecutive land cells inward (laid as edge overlays, not water)
  let brooksMade = 0; const brookN = 2 + (rand() < 0.5 ? 0 : 1);   // more brooks (2–3)
  for (let att = 0; att < 22 && brooksMade < brookN; att++) {
    const rt = allRiver[Math.floor(rand() * allRiver.length)];
    const mouths = nbrs(rt).filter(j => g[j].terrain === 'jungle' && !(g[rt].blocked & dirBit(rt, j)) && !linked(rt, j));
    if (!mouths.length) continue;
    let i = mouths[Math.floor(rand() * mouths.length)]; linkS(rt, i); let len = 1;
    for (let s = 0; s < 4; s++) {
      const opts = nbrs(i).filter(j => g[j].terrain === 'jungle' && !(g[i].blocked & dirBit(i, j)) && !linked(i, j));
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
  const fbs: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].bridge === 'foot' && free(i)) fbs.push(i);   // foot-bridge tiles (their crossing paths are laid just after — so reachable; reach can't see them yet)
  fbs.sort((a, b) => dist(a, base) - dist(b, base)).slice(0, 2).forEach(i => g[i].hotspot = 'riverVillage');   // BOTH foot crossings become river villages — each sits ON the river, home of a canoe + motorboat
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
    G.log.push(`⛏ rockslide @${t} — tile sealed${n ? `, ${n} find${n > 1 ? 's' : ''} buried` : ''}, Player ${+cur + 1} bumped back`);
  }
  else if (kind === 'animalAttack') G.log.push(`🐗 animal attack — Player ${+cur + 1} loses ${loseItem(p, random)}`);
  else if (kind === 'bushthieves') { const take = Math.min(p.money, BUSHTHIEF_TAKE); p.money -= take; G.log.push(`🏴 bushthieves @${t} — Player ${+cur + 1} -${take}$`); }
  else { const ty = dominantType(tile.terrain); p.samples.push({ type: ty, color: 0 }); G.log.push(`🧭 helpful native — Player ${+cur + 1} gains ${ty}0`); }   // a free easy specimen of the local discipline
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
  if (tile.terrain === 'ruins' && tile.finds.length < cap) {      // RUINS always bear a discovery — if the trials came up empty/event-only, force one real specimen
    const di = pool.findIndex(c => !isEvent(c)); if (di >= 0) tile.finds.push(pool.splice(di, 1)[0] as Discovery);
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
  if (G.epilogue || myVehicle(G, ctx.currentPlayer) || !nbrs(p.pos).includes(t)) return INVALID_MOVE;   // must explicitly `leave` the car/boat before a foot move
  const ok = p.boat ? canBoat(G.map, p.pos, t) : canMove(G.map, p.pos, t);   // boating opens water + cheap brooks
  if (!ok) return INVALID_MOVE;
  const c = p.boat ? boatCost(G.map, p.pos, t) : cost(G.map, p.pos, t);
  if (p.ap < c) return INVALID_MOVE;
  const from = p.pos; p.ap -= c; p.pos = t; reveal(G, t, random, ctx.currentPlayer, from); landAt(G, ctx.currentPlayer);
  G.log.push(`Player ${+ctx.currentPlayer + 1} → ${t} (-${c}ap${p.boat ? ' 🛶' : ''})`);
};
// generic link-ride: travel up to `steps` tiles along link `k` for 1 AP. car→roads, boat→river channel — same code, different prerequisite.
function ride(G: GState, ctx: any, random: any, dest: number, from: number, steps: number, k: EdgeKind, allowed: boolean, arrive: () => void, log: string) {
  const p = G.players[ctx.currentPlayer];
  const reach = Math.floor(p.ap * steps);   // tiles affordable with current AP (1/steps AP per tile)
  if (G.epilogue || p.ap <= 0 || !allowed || !linkReach(G.map, from, reach, k).includes(dest)) return INVALID_MOVE;
  const d = linkDist(G.map, from, dest, k); p.ap -= d / steps;
  p.pos = dest; arrive(); reveal(G, dest, random, ctx.currentPlayer, from); landAt(G, ctx.currentPlayer);
  G.log.push(`${log} (-${d / steps}ap)`);
}
const drive: Move<GState> = ({ G, ctx, random }, dest: number) => {   // drive the boarded vehicle: a car along roads (CAR_STEPS), a motorboat along the large river (MOTORBOAT_STEPS) — player + vehicle travel together
  const v = myVehicle(G, ctx.currentPlayer); if (!v) return INVALID_MOVE;
  const boat = v.kind === 'motorboat';
  return ride(G, ctx, random, dest, v.pos, boat ? MOTORBOAT_STEPS : CAR_STEPS, boat ? 'rivers' : 'roads', true, () => { v.pos = dest; }, `drive ${boat ? '🛥' : '🚗'}→${dest}`);
};
const boatRun: Move<GState> = ({ G, ctx, random }, dest: number) => {   // boat: up to BOAT_STEPS river-channel tiles per AP
  const p = G.players[ctx.currentPlayer], car = myVehicle(G, ctx.currentPlayer);
  return ride(G, ctx, random, dest, p.pos, BOAT_STEPS, 'rivers', p.boat, () => { if (car) car.driver = null; }, `Player ${+ctx.currentPlayer + 1} 🛶→ ${dest}`);
};
const BOARD_COST = 1;   // money to climb into a vehicle (a small hire fee)
const board: Move<GState> = ({ G, ctx }, v = 0) => {   // climb into an unoccupied vehicle (costs BOARD_COST$): a car you're stood on, or a motorboat moored on an adjacent river tile (hop aboard from the bank)
  const p = G.players[ctx.currentPlayer], car = G.vehicles[v];
  if (G.epilogue || !car || car.driver !== null || p.money < BOARD_COST) return INVALID_MOVE;
  const aboard = car.pos === p.pos, hop = car.kind === 'motorboat' && nbrs(p.pos).includes(car.pos);
  if (!aboard && !hop) return INVALID_MOVE;
  p.money -= BOARD_COST; car.driver = ctx.currentPlayer; if (hop) p.pos = car.pos;   // pay the fee, step off the bank onto the moored motorboat
  G.log.push(`Player ${+ctx.currentPlayer + 1} board ${car.kind}@${car.pos} (-${BOARD_COST}$)`);
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
  G.log.push(`Player ${+ctx.currentPlayer + 1} leave ${car.kind}@${car.pos}`);
};
// drop/pickup cache items (boat or any gear kit) on the current tile (free). At the BASE this tile is the communal lab stash.
const drop: Move<GState> = ({ G, ctx }, sel: 'boat' | number = 'boat') => {   // sel: 'boat', or an index into your gear
  const p = G.players[ctx.currentPlayer], eq = G.map[p.pos].equipment, where = p.pos === G.base ? 'lab' : `@${p.pos}`;
  if (G.epilogue) return INVALID_MOVE;
  if (sel === 'boat') { if (!p.boat) return INVALID_MOVE; p.boat = false; eq.push({ kind: 'boat' }); G.log.push(`Player ${+ctx.currentPlayer + 1} drop boat ${where}`); return; }
  if (sel < 0 || sel >= p.gear.length) return INVALID_MOVE;
  const g = p.gear.splice(sel, 1)[0]; eq.push({ kind: 'gear', gear: g });
  G.log.push(`Player ${+ctx.currentPlayer + 1} drop ${gearTag(g)} ${where}`);
};
const pickup: Move<GState> = ({ G, ctx }, sel: 'boat' | number = 'boat') => {   // sel: 'boat' (first boat), or an index into the tile's cached items
  const p = G.players[ctx.currentPlayer], eq = G.map[p.pos].equipment, where = p.pos === G.base ? 'lab' : `@${p.pos}`;
  if (G.epilogue) return INVALID_MOVE;
  const idx = sel === 'boat' ? eq.findIndex(e => e.kind === 'boat') : sel;
  if (idx < 0 || idx >= eq.length) return INVALID_MOVE;
  const it = eq[idx];
  if (it.kind === 'boat') { if (p.boat) return INVALID_MOVE; p.boat = true; eq.splice(idx, 1); G.log.push(`Player ${+ctx.currentPlayer + 1} pickup boat ${where}`); return; }
  if (!hasRoom(p)) return INVALID_MOVE;
  const g = eq.splice(idx, 1)[0].gear!; p.gear.push(g);
  G.log.push(`Player ${+ctx.currentPlayer + 1} pickup ${gearTag(g)} ${where}`);
};
// (discoveries are NOT droppable — a carried hand only leaves you by being force-stashed at a research site, then consumed by research)

// ---- research projects: a SHARED, CONSUMED pool of open questions (first to publish CLAIMS it; the pool refills from a per-match deck).
// Poker grammar (discipline = rank, colour = suit) made CONCRETE: each project pins specific values, so two players can race the same question.
// A project is a list of PARTS; each part needs `count` discoveries pinned by discipline and/or colour. Owned fill first; ≤MAX_CITE shortfall cites others' published. Discoveries used are CONSUMED into the publisher's pool.
const DTYPES: DType[] = ['geo', 'zoo', 'bot', 'arch'];
// discipline rarity (≈ inverse of measured supply: arch most abundant 0 · geo/zoo mid 1 · bot rarest 2) — feeds the rarity-skewed payout
const DISC_RARITY: Record<DType, number> = { arch: 0, geo: 2, zoo: 1, bot: 2 };   // minerals (geo) are scarce → premium payout, on par with botany
const COL_NAME = ['purple', 'grey', 'navy'];   // the 3 colours (match DCOLOR in render)
export interface GoalPart { count: number; type?: DType; color?: number; }   // undefined axis = free (any)
export interface Pattern { id: string; label: string; parts: GoalPart[]; prestige: number; money: number; }
export const publishCost = (_pubs: number) => 1;   // publishing costs 1 AP — so cards linger in the shared pool (a real community pool)
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
function buildGoalDeck(_rand: () => number): Pattern[] {
  const colors = Array.from({ length: COLORS }, (_, i) => i);
  // PAYOUT = difficulty × rarity × combo: each card's value = colour difficulty × discipline rarity; the project scales that by its combo size (bigger matching sets cost super-linearly)
  const cdiff = [1, 2, 5];   // colour difficulty (multiplicative; no-colour part = 1) — tracks the catalogue DCs 5/8/13
  const cardVal = (p: GoalPart) => (p.color !== undefined ? cdiff[p.color] : 1) * (1 + (p.type ? DISC_RARITY[p.type] : 0));
  const PRESTIGE_K = 0.22, MONEY_K = 0.12;
  let n = 0;
  const mk = (label: string, parts: GoalPart[]): Pattern => {
    const cards = parts.reduce((s, pt) => s + pt.count, 0);
    const raw = parts.reduce((s, pt) => s + pt.count * cardVal(pt), 0) * (1 + (cards - 2) * 0.3);   // (Σ difficulty×rarity) × a DAMPENED combo factor (not fully multiplicative)
    return { id: `g${n++}`, label, parts, prestige: Math.max(1, Math.round(raw * PRESTIGE_K)), money: Math.max(1, Math.round(raw * MONEY_K)) };
  };
  const pairs = DTYPES.flatMap((a, i) => DTYPES.slice(i + 1).map(b => [a, b] as [DType, DType]));   // unordered discipline pairs
  const ordered = DTYPES.flatMap(a => DTYPES.filter(b => b !== a).map(b => [a, b] as [DType, DType]));   // ordered pairs (full house a-over-b)
  // table: every DISTINCT combo is ALWAYS available to publish (no deck, no open-5 slots, no claiming) — one entry each
  return [
    // entry-level: symbol pairs, colour pairs, colour+symbol pairs, pair combos, triples
    ...DTYPES.map(t => mk(`${t} pair`, [{ count: 2, type: t }])),
    ...colors.map(c => mk(`${COL_NAME[c]} pair`, [{ count: 2, color: c }])),
    ...DTYPES.flatMap(t => colors.map(c => mk(`${COL_NAME[c]} ${t} pair`, [{ count: 2, type: t, color: c }]))),   // coloured symbol pairs (both axes pinned)
    ...DTYPES.flatMap(t => colors.map(c => mk(`${COL_NAME[c]} ${t} pair combo`, [{ count: 2, color: c }, { count: 2, type: t }]))),
    ...DTYPES.map(t => mk(`${t} three of a kind`, [{ count: 3, type: t }])),
    ...colors.map(c => mk(`${COL_NAME[c]} triple`, [{ count: 3, color: c }])),
    // higher-paying hands
    ...pairs.map(([a, b]) => mk(`${a} + ${b} two pair`, [{ count: 2, type: a }, { count: 2, type: b }])),
    ...ordered.map(([a, b]) => mk(`${a} full house over ${b}`, [{ count: 3, type: a }, { count: 2, type: b }])),
    ...DTYPES.map(t => mk(`${t} four of a kind`, [{ count: 4, type: t }])),
    ...colors.map(c => mk(`${COL_NAME[c]} flush`, [{ count: 5, color: c }])),
    ...DTYPES.flatMap(t => colors.map(c => mk(`${COL_NAME[c]} ${t} triple`, [{ count: 3, type: t, color: c }]))),   // both-axes
    mk('discipline straight', DTYPES.map(t => ({ count: 1, type: t }))),
    mk('colour straight', colors.map(c => ({ count: 1, color: c }))),
  ];
}
const citablePool = (G: GState, self: string) => { const out: Discovery[] = []; for (const id in G.players) if (id !== self) out.push(...G.players[id].published); return out; };

const catalogue: Move<GState> = ({ G, ctx, random }, find: number) => {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || p.ap < 1 || !tile.revealed || find < 0 || find >= tile.finds.length) return INVALID_MOVE;  // discoveries are uncapped in hand
  p.ap -= 1;
  const d = tile.finds[find], tag = `${d.type}${d.color}`, dc = catDC(d.color);   // higher-colour finds are harder to catalogue
  const roll = random.D6() + random.D6() + gearBonus(p.gear, d.type) + (ROLE_DISC[p.role] === d.type ? ROLE_BONUS : 0);   // gear + specialist bonus (role only for its discipline)
  if (roll >= dc) { tile.finds.splice(find, 1); p.samples.push(d); G.log.push(`catalogue ${tag} ${roll}/${dc} ✓ collected`); }
  else if (roll >= dc - 2) G.log.push(`catalogue ${tag} ${roll}/${dc} ◦ stayed`);   // a near miss (within 2) leaves the find for another attempt — fewer rolls destroy it
  else { tile.finds.splice(find, 1); G.log.push(`catalogue ${tag} ${roll}/${dc} ✗ ${d.type === 'zoo' ? 'fled' : 'destroyed'}`); }   // fauna flees, the rest is destroyed
};

const publish: Move<GState> = ({ G, ctx }, patternName: string) => {  // research from the SHARED community pool at this research site (or the lab pool in the epilogue)
  const p = G.players[ctx.currentPlayer], pool = pubPool(G, p);
  if (!pool || p.pubTurn === ctx.turn) return INVALID_MOVE;          // at a research site, and at most ONE publish per turn (no AP cost)
  const pat = G.goals.find(x => x.id === patternName); if (!pat) return INVALID_MOVE;
  if (p.samples.length) { pool.push(...p.samples); G.log.push(`Player ${+ctx.currentPlayer + 1} dump ${p.samples.length} → pool`); p.samples.length = 0; }   // your publish dumps your hand into the pool — unused cards linger as community cards
  const res = assemble(G, pat.id, pool, []); if (!res) return INVALID_MOVE;   // assemble from the pool — anyone's cards are fair game (immer rolls back the dump if this fails)
  p.pubTurn = ctx.turn;                                              // used your one publish this turn
  const used = res.ownedIdx.map(i => pool[i]);
  res.ownedIdx.slice().sort((a, b) => b - a).forEach(i => pool.splice(i, 1));   // consume the used cards from the SHARED pool
  p.published.push(...used);                                          // → your published pool (public record)
  p.prestige += pat.prestige; p.money += pat.money; p.pubs += 1;     // research token → prestige
  G.log.push(`publish ${pat.label} +${pat.prestige}P +${pat.money}$`);
  // the combo stays in the table (always available) — only the shared CARDS are consumed
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
  const p = G.players[ctx.currentPlayer];
  const myCar = G.vehicles.find(v => v.driver === ctx.currentPlayer && v.kind === 'car');   // the heuristic only drives ground cars (motorboats are a human tool)
  if (myCar) {                                                          // driving → ALWAYS drive or leave (never fall through to a foot move while behind the wheel)
    if (p.ap <= 0 || !goals.length) return { move: 'leave', args: [] };   // out of AP or nothing to chase → step out so foot moves are possible
    const here = nearestDist(goals, p.pos);
    let best = -1, bd = here;
    for (const c of roadReach(G.map, myCar.pos, Math.floor(p.ap * CAR_STEPS))) { const d = nearestDist(goals, c); if (d < bd) { bd = d; best = c; } }
    return best >= 0 ? { move: 'drive', args: [best] } : { move: 'leave', args: [] };
  }
  if (!goals.length || p.ap < 1) return null;
  const here = nearestDist(goals, p.pos);
  if (here < 3) return null;   // on foot: only bother boarding when the goal is far enough that roads save real distance
  const vi = p.money >= BOARD_COST ? G.vehicles.findIndex(v => v.pos === p.pos && v.driver === null && v.kind === 'car') : -1;   // parked car underfoot → board if roads lead closer (and the fee is affordable)
  if (vi >= 0 && roadReach(G.map, G.vehicles[vi].pos, CAR_STEPS).some(c => nearestDist(goals, c) < here)) return { move: 'board', args: [vi] };
  return null;
}
// the bot ignores cheap PLAIN pairs (one axis only) — its minimum target is a colour+symbol pair (both axes pinned)
const botPursue = (g: Pattern) => !(g.parts.length === 1 && g.parts[0].count === 2 && (g.parts[0].type === undefined || g.parts[0].color === undefined));
// heuristic policy: publish at a hub; grab the boat when it unlocks water-bound forage; drive roads + boat water toward the goal
export function botAction(G: GState, ctx: any, rand: () => number): { move?: string; args?: unknown[]; event?: string } {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos], cit = citablePool(G, ctx.currentPlayer);
  // publish from the shared open pool at a research site — claim the most valuable open question the pool can complete (your hand was force-stashed here on arrival)
  const pool = pubPool(G, p);
  if (pool && p.pubTurn !== ctx.turn) { const avail = pool.concat(p.samples);   // ≤1 publish/turn; publish proportional to payout: the most valuable assemblable combo (ignoring cheap plain pairs)
    for (const pat of [...G.goals].sort((a, b) => b.prestige - a.prestige)) if (botPursue(pat) && assemble(G, pat.id, avail, [])) return { move: 'publish', args: [pat.id] }; }
  if (G.epilogue) return { event: 'endTurn' };   // lab: only publishing
  if (isMarket(tile) && p.gear.length < GEAR_MAX) {   // invest spare money in gear: best affordable generic kit
    const buyable = (['g3', 'g2', 'g1'] as GearKind[]).find(k => p.money >= GEAR_PRICE[k] + 4);
    if (buyable) return { move: 'buy', args: [buyable] };
  }
  if (!p.boat && tile.equipment.some(e => e.kind === 'boat') && reachGoals(G, p.pos, true, forageTarget) > reachGoals(G, p.pos, false, forageTarget))
    return { move: 'pickup', args: ['boat'] };   // grab the shared boat only when water is actually fencing off forage
  if (p.ap >= 1 && tile.finds.length) {   // catalogue the find that best builds toward a HIGH-PAYOUT combo (value-weighted, not just any completion) — and, early, lean on your specialty
    const myDisc = ROLE_DISC[p.role], early = p.samples.length < 4 ? 4 : 1;   // focus own discipline early (where the +3 pays off), fade later
    let bestI = 0, bestScore = -1;
    for (let i = 0; i < tile.finds.length; i++) {
      const trial = [...p.samples, tile.finds[i]];
      let goal = 0;
      for (const g of G.goals) {   // value of progress toward g = its prestige scaled by completion + a completion bonus → build valuable hands; plain pairs are ignored (min target = colour+symbol pair)
        if (!botPursue(g)) continue;
        const r = evalGoal(g, trial, cit);
        const have = r.slots.filter(s => s.state === 'have').length, need = g.parts.reduce((s, pt) => s + pt.count, 0);
        goal = Math.max(goal, g.prestige * (have / need) + (r.ok ? g.prestige : 0));
      }
      const score = goal + (tile.finds[i].type === myDisc ? early : 0);   // prefer your specialty (more so while your hand is still small)
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    return { move: 'catalogue', args: [bestI] };
  }
  const hasHand = G.goals.some(g => botPursue(g) && assemble(G, g.id, p.samples, cit));   // hand makes a worthwhile (≥ colour+symbol pair) project → head to a base to publish it; else forage
  const goalPred = hasHand ? isResearch : forageTarget;   // forage toward the nearest finds (the per-tile catalogue choice is already value-weighted) — NO biome bias, which over-concentrated specialists on uneven-abundance biomes and broke role balance
  if (!(hasHand && isResearch(tile))) {
    const goals = goalCells(G, goalPred);
    const cs = carStep(G, ctx, goals); if (cs) return cs;                                   // car: zip along roads toward the goal
    const nx = stepToward(G, p.pos, goalPred, p.boat);                                      // foot/boat: weighted step toward the goal
    if (nx >= 0) { if (p.ap >= (p.boat ? boatCost : cost)(G.map, p.pos, nx)) return { move: 'move', args: [nx] }; }   // reachable — step now, else wait for AP next turn
    else if (hasHand && p.ap >= 1 && p.pos !== G.base) return { move: 'helilift', args: [] };  // genuinely no hub reachable → fly home
  }
  if (myVehicle(G, ctx.currentPlayer)) return { move: 'leave', args: [] };                   // still driving with nothing better → step out (never foot-move behind the wheel)
  const can = p.boat ? canBoat : canMove, wt = p.boat ? boatCost : cost;                    // fallback: any affordable step (don't stall)
  const opts = nbrs(p.pos).filter(t => can(G.map, p.pos, t) && p.ap >= wt(G.map, p.pos, t));
  if (!hasHand && opts.length) return { move: 'move', args: [opts[Math.floor(rand() * opts.length)]] };
  if (!nbrs(p.pos).some(t => canMove(G.map, p.pos, t) || canBoat(G.map, p.pos, t)) && p.ap >= 1 && p.pos !== G.base) return { move: 'helilift', args: [] };  // sealed in by a rockslide → fly out
  return { event: 'endTurn' };
}

const buy: Move<GState> = ({ G, ctx }, kind: GearKind = 'g1', field?: DType) => {   // buy a gear kit at a market (free action, no AP) — cars and boats are NOT buyable
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || !isMarket(tile)) return INVALID_MOVE;
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
    if (!myCar) nbrs(p.pos).forEach(t => { const ok = p.boat ? canBoat(G.map, p.pos, t) : canMove(G.map, p.pos, t); const c = p.boat ? boatCost(G.map, p.pos, t) : cost(G.map, p.pos, t); if (ok && p.ap >= c) out.push({ move: 'move', args: [t] }); });   // foot moves only when NOT driving (must leave first)
    if (p.ap > 0 && myCar) (myCar.kind === 'motorboat' ? riverReach(G.map, myCar.pos, Math.floor(p.ap * MOTORBOAT_STEPS)) : roadReach(G.map, myCar.pos, Math.floor(p.ap * CAR_STEPS))).forEach(d => out.push({ move: 'drive', args: [d] }));
    if (p.ap > 0 && p.boat) riverReach(G.map, p.pos, Math.floor(p.ap * BOAT_STEPS)).forEach(d => out.push({ move: 'boatRun', args: [d] }));   // fast river-channel boating
    if (p.money >= BOARD_COST) G.vehicles.forEach((v, i) => { if (v.pos === p.pos && v.driver === null) out.push({ move: 'board', args: [i] }); });
    if (myCar) out.push({ move: 'leave', args: [] });
    if (p.ap >= 1) tile.finds.forEach((_, i) => out.push({ move: 'catalogue', args: [i] }));   // discoveries are uncapped in hand
    if (isMarket(tile) && p.gear.length < GEAR_MAX) {   // buy a chosen gear kit (cars/boats are not buyable)
      (['g1', 'g2', 'g3'] as GearKind[]).forEach(k => { if (p.money >= GEAR_PRICE[k]) out.push({ move: 'buy', args: [k] }); });
      if (p.money >= GEAR_PRICE.field) DTYPES.forEach(t => out.push({ move: 'buy', args: ['field', t] }));
    }
    if (p.boat) out.push({ move: 'drop', args: ['boat'] });                                   // cache items on this tile (lab stash at base)
    p.gear.forEach((_, i) => out.push({ move: 'drop', args: [i] }));
    tile.equipment.forEach((e, i) => {                                                        // reclaim cached items here
      if (e.kind === 'boat' && !p.boat) out.push({ move: 'pickup', args: [i] });
      if (e.kind === 'gear' && hasRoom(p)) out.push({ move: 'pickup', args: [i] });
    });
    if (p.ap >= 1 && p.pos !== G.base) out.push({ move: 'helilift', args: [] });
  }
  const pool = pubPool(G, p);   // publish from the shared open pool at a research site (or the lab pool in the epilogue)
  if (pool && p.pubTurn !== ctx.turn) { const avail = pool.concat(p.samples); G.goals.forEach(pat => { if (assemble(G, pat.id, avail, [])) out.push({ move: 'publish', args: [pat.id] }); }); }
  out.push({ event: 'endTurn' });
  return out;
};

// ---- event deck: mostly benign; monsoon stacked at the BOTTOM = telegraphed end ----
function buildDeck(seed: number): string[] {
  // ONE event drawn per ROUND: the benign deck is sized in rounds (BAL.seasonBenign) + a 6-monsoon tail; field ends as monsoons surface
  const mix: [string, number][] = [['tailwind', 0.3], ['cache', 0.2], ['grant', 0.1], ['calm', 0.2], ['rockslide', 0.1], ['washout', 0.1]];
  const top: string[] = [];
  for (const [id, frac] of mix) for (let k = 0; k < Math.round(BAL.seasonBenign * frac); k++) top.push(id);
  let z = seed >>> 0; const rnd = () => (z = (z * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = top.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [top[i], top[j]] = [top[j], top[i]]; }
  return [...top, ...Array(6).fill('monsoon')];                       // drawn last (field ends when the MONSOON_END-th monsoon surfaces)
}
const intactCrossings = (map: Tile[]) => map.filter(t => t.bridge && (t.roads || t.paths)).length;
function applyEvent(G: GState, id: string, random: any) {
  const players = Object.values(G.players);
  if (id === 'tailwind') { /* +1 AP for everyone this round — applied per-turn via G.roundEvent in onBegin */ }
  else if (id === 'cache') players.forEach(p => p.money += 2);        // global windfall — every player banks it
  else if (id === 'grant') players.forEach(p => p.money += 3);
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
const vp = (p: PlayerS) => p.prestige + Math.floor(p.money / 5);  // unified prestige + money/5 → 5$ (= 50k$ shown) per 1 prestige

export const Expedition: Game<GState> = {
  name: 'expedition',
  minPlayers: 2, maxPlayers: 4,
  setup: ({ ctx, random }: any) => {
    const seed = random ? (Math.floor(random.Number() * 1e9) || MAP_SEED) : MAP_SEED;   // per-match map+deck variety
    const dim = DIM_MAX;   // fixed 15×15 footprint; ~ACTIVE_TILES tiles kept active for a consistent size + spread
    const { map, start } = generateMap(seed, dim);
    const colorRand = prng((seed ^ 0x5bd1e995) >>> 0);   // deterministic per-match colour stream (independent of type)
    map[start].revealed = true;
    const village = map.findIndex(t => t.hotspot === 'village');   // a road market
    const vehicles: Vehicle[] = [
      { pos: start, driver: null, kind: 'car' as const },                          // 1 car at the research base
      { pos: village >= 0 ? village : start, driver: null, kind: 'car' as const },  // 1 car at a village (fallback: base)
    ];
    const rvs: number[] = []; map.forEach((t, i) => { if (t.hotspot === 'riverVillage') rvs.push(i); });   // each river village starts with 1 canoe + 1 motorboat, both ON its (water) tile
    if (rvs.length) for (const rvi of rvs) { map[rvi].equipment.push({ kind: 'boat' }); vehicles.push({ pos: rvi, driver: null, kind: 'motorboat' }); }
    else map[start].equipment.push({ kind: 'boat' });   // fallback: a canoe at base if no river village exists
    const roleBag = [...ROLES]; { const rr = prng((seed ^ 0x2545f491) >>> 0); for (let i = roleBag.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [roleBag[i], roleBag[j]] = [roleBag[j], roleBag[i]]; } }   // specialist roles shuffled per match (not fixed by seat)
    return {
      players: Object.fromEntries(Array.from({ length: ctx.numPlayers }, (_, i) =>
        [String(i), { ap: START_AP, pos: start, money: 0, samples: [], published: [], prestige: 0, pubs: 0, pubTurn: -1, gear: [], boat: false, role: roleBag[i % roleBag.length] }])),
      map, cols: N, rows: N, base: start,
      vehicles,
      pools: { grassland: buildPool('grassland', colorRand), jungle: buildPool('jungle', colorRand), rocky: buildPool('rocky', colorRand), ruins: buildPool('ruins', colorRand), water: buildPool('water', colorRand) },
      goals: buildGoalDeck(prng((seed ^ 0x9e3779b1) >>> 0)), goalDeck: [],   // the full TABLE of combos — all always available to publish
      events: buildDeck(seed), monsoon: 0, epilogue: false, labLeft: 0, log: ['setup'], roundEvent: '',
    };
  },
  moves: { move, catalogue, publish, buy, drive, boatRun, helilift, board, leave, drop, pickup },
  // EXPERIMENTAL knob — lab-season frontier merge: 'last' (only last player), 'all' (at lab start, everyone), 'none'
  turn: {
    onBegin: ({ G, ctx, random }) => {
      if (!G.epilogue && (ctx.turn - 1) % ctx.numPlayers === 0) {   // ROUND start: the start player draws ONE global event for the whole round (affects every player)
        const id = G.events.shift() ?? ''; G.roundEvent = id; if (id) applyEvent(G, id, random);
      }
      const p = G.players[ctx.currentPlayer];
      if (G.epilogue) {
        // LAB SEASON, round-robin: each player in turn (P0 first) dumps their hand into the shared base pool and publishes ONE research; leftovers pass to the next. The frontier pool merges into the base pool just before the LAST player.
        const lab = G.map[G.base].cache;
        if (LAB_CFG.dump === 'upfront') {
          if (G.labLeft === ctx.numPlayers) {   // FIRST lab turn (P0): pool EVERYTHING — all hands + frontier — so every player publishes from the same full base pool; P0 picks first
            G.map.forEach(t => { if (t.hotspot === 'remote' && t.cache.length) { lab.push(...t.cache); t.cache.length = 0; } });
            for (const pl of Object.values(G.players)) { if (pl.samples.length) { lab.push(...pl.samples); pl.samples.length = 0; } }
            G.log.push(`📚 lab pool assembled (${lab.length})`);
          }
        } else {
          const mergeNow = LAB_CFG.frontier === 'all' ? G.labLeft === ctx.numPlayers : LAB_CFG.frontier === 'last' ? G.labLeft === 1 : false;
          if (mergeNow) G.map.forEach(t => { if (t.hotspot === 'remote' && t.cache.length) { lab.push(...t.cache); t.cache.length = 0; } });
          if (p.samples.length) { G.log.push(`Player ${+ctx.currentPlayer + 1} dump ${p.samples.length} → lab pool`); lab.push(...p.samples); p.samples.length = 0; }
        }
        p.ap = 1;   // exactly enough AP for ONE publish this lab turn
      } else {
        const round = Math.floor((ctx.turn - 1) / ctx.numPlayers), pos = (ctx.turn - 1) % ctx.numPlayers;
        const base = (BAL.round0Ramp && round === 0) ? Math.max(1, START_AP - (ctx.numPlayers - 1 - pos)) : START_AP;   // optional round-1 ramp: the opener gets the fewest AP
        p.ap = base + (G.roundEvent === 'tailwind' ? 1 : 0);
      }
    },
    order: {
      first: () => 0,
      // field season: wandering start player (each round begins with a different player) so the first-mover advantage rotates.
      // lab season: a fixed, fair order — P0 always opens, P{N-1} always closes (driven by labLeft so the frontier-merge target is deterministic).
      next: ({ G, ctx }: any) => {
        if (G.epilogue) return BAL.labInverse ? (G.labLeft - 1) : (ctx.numPlayers - G.labLeft) % ctx.numPlayers;   // normal: P0 first; inverse: P{N-1} first
        const N = ctx.numPlayers, k = ctx.turn;
        return BAL.wander ? (Math.floor(k / N) + (k % N)) % N : k % N;   // wander: rotating start; else fixed P0-first round-robin
      },
    },
    onEnd: ({ G, ctx }) => {
      if (G.epilogue) { G.labLeft -= 1; return; }   // each player gets exactly one lab turn
      // field season ends on a ROUND BOUNDARY (after the round's last seat) — equal field turns for everyone — then the lab opens at P0 next turn
      const pos = (ctx.turn - 1) % ctx.numPlayers;
      if (pos === ctx.numPlayers - 1 && ctx.turn > 1 && (G.monsoon >= MONSOON_END || !G.events.length)) {
        G.epilogue = true; G.labLeft = ctx.numPlayers; G.log.push('🌧️ monsoon — indoor lab season');
      }
    },
  },
  endIf: ({ G }) => {
    if (!(G.epilogue && G.labLeft <= 0)) return;              // play through the indoor lab season, then score
    const e = Object.entries(G.players);
    const winner = e.reduce((a, b) => vp(b[1]) > vp(a[1]) ? b : a)[0];
    return { winner, scores: Object.fromEntries(e.map(([id, p]) => [id, vp(p)])) };
  },
  ai: { enumerate },
};
