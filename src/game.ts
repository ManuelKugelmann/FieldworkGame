import type { Game, Move } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

export type Terrain = 'grassland' | 'jungle' | 'rocky' | 'water' | 'void';  // roads are an edge overlay on a land base, not a terrain; void = off-board
export type Bridge = 'road' | 'foot';
export type DType = 'geo' | 'zoo' | 'bot' | 'arch';
export interface Discovery { type: DType; color: number; }
export type Hotspot = 'base' | 'remote' | 'village' | 'remoteVillage' | 'commStation';  // POIs: road base, frontier hub (remote), road market (village), jungle market (remote village), road publish station (comm station)
export type EquipKind = 'gear' | 'boat';              // carryable items cached on a tile (droppable/pickup-able)
export interface Equip { kind: EquipKind; }
export interface Vehicle { pos: number; driver: string | null; }  // car: a positioned entity you board/leave; drive moves both
export interface Tile { terrain: Terrain; bridge?: Bridge; roads: number; paths: number; smallRivers: number; blocked: number; rivers: number; hotspot?: Hotspot; richness: number; revealed: boolean; finds: Discovery[]; equipment: Equip[]; }  // roads/paths/smallRivers(brooks)/blocked(cliffs)/rivers(channel linkage) = edge bitmasks N1 E2 S4 W8
export interface PlayerS { ap: number; pos: number; money: number; samples: Discovery[]; stash: Discovery[]; published: Discovery[]; prestige: number; gear: number; boat: boolean; }  // samples = carried (capped); stash = banked at base (uncapped); gear = catalogue-roll bonus; boat = carrying the shared boat
export interface GState {
  players: Record<string, PlayerS>;
  map: Tile[]; cols: number; rows: number; base: number;   // main hub (road) — helilift target
  vehicles: Vehicle[];                                     // shared cars on the board (start at base)
  pools: Partial<Record<Terrain, Discovery[]>>;
  goals: Pattern[];                                        // the open research questions on the board (shared, consumed on publish)
  goalDeck: Pattern[];                                     // remaining projects; the pool refills from here on a claim
  events: string[]; monsoon: number; epilogue: boolean; labLeft: number; log: string[];   // epilogue = indoor lab season
}

let N = 10;                  // grid dimension (square), chosen per-match in [10..15]
const DIM_MIN = 10, DIM_MAX = 18, ACTIVE_TILES = 200, START_AP = 4,  // fixed 18×18 footprint, ~200 tiles kept active (rest void gaps) → built-out-from-network spread  // 4 AP/round
  COLORS = 4, CATALOGUE_DC = 7, MAP_SEED = 1, CARRY_SLOTS = 5, MONSOON_END = 4, MAX_CITE = 0, GEAR_MAX = 3, GEAR_COST = 5, CAR_STEPS = 3, BOAT_STEPS = 2, FIND_CHANCE = 0.75, HELILIFT_COST = 12, PRESTIGE_STEP = 6;  // MAX_CITE 0 = no citation (hands fully owned)  // PRESTIGE_STEP: publish AP cost = 1 + floor(prestige/STEP) — rising costs more effort (rubber-band catch-up)  // CARRY_SLOTS 5 = a full house / flush fits  // FIND_CHANCE: each potential slot yields a discovery on reveal  // CAR_STEPS / BOAT_STEPS tiles per AP  // gear: +1 catalogue roll/level

const RICH: Record<Terrain, number> = { grassland: 2, jungle: 4, rocky: 3, water: 0, void: 0 };  // max potential tokens; rolled 0..max, skewed so 0–1 is common and the max is rare
const plainRiver = (t: Tile) => t.terrain === 'water' && !t.bridge;  // river = hard barrier (1-tile-wide)
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
  if (a.move === 'drive') { const car = myVehicle(G, pid); const d = car ? roadStepDist(G.map, car.pos, a.args![0] as number) : Infinity; return Number.isFinite(d) ? d / CAR_STEPS : 1; }
  if (a.move === 'boatRun') { const d = riverStepDist(G.map, p.pos, a.args![0] as number); return Number.isFinite(d) ? d / BOAT_STEPS : 1; }   // 1 AP buys BOAT_STEPS channel tiles
  if (a.move === 'move') return apCost(G, p.pos, a.args![0] as number, p.boat);
  return 0;
}
// m4 vehicles: a car moves up to 3 road tiles per AP (road edges only) — not yet implemented
const isHub = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'remote' || t.hotspot === 'commStation';  // research+publish hubs (base / frontier / comm station)
const isMarket = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'village' || t.hotspot === 'remoteVillage';  // buy gear here (base / road village / jungle remote village)

const WEIGHTS: Partial<Record<Terrain, Record<DType, number>>> = {
  grassland: { geo: 1, arch: 1, zoo: 1, bot: 1 },   // low everything
  jungle:    { bot: 4, zoo: 4, arch: 2, geo: 1 },   // dense flora + fauna (botany & zoology rich)
  rocky:     { geo: 6, arch: 3, zoo: 1, bot: 1 },   // lots of geology, mid archaeology, low zoo/botany
};
const BIOME_COLOR: Partial<Record<Terrain, number>> = { grassland: 2, jungle: 2, rocky: 3 };  // each biome leans toward a signature colour
function buildPool(t: Terrain, rand: () => number): Discovery[] {
  const out: Discovery[] = [], w = WEIGHTS[t]!, bias = BIOME_COLOR[t];
  (Object.keys(w) as DType[]).forEach(k => {
    for (let i = 0; i < w[k] * 4; i++) {
      const color = (bias !== undefined && rand() < 0.35) ? bias : Math.floor(rand() * COLORS);   // colour is independent of type, only slightly biome-leaning
      out.push({ type: k, color });
    }
  });
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
  const set = (i: number, t: Terrain, bridge?: Bridge) => { const max = RICH[t], richness = (max === 0 || rand() < 0.5) ? 0 : 1 + Math.floor(max * rand() ** 2); g[i] = { terrain: t, bridge, roads: 0, paths: 0, smallRivers: 0, blocked: 0, rivers: 0, richness, revealed: false, finds: [], equipment: [] }; };  // 0 vs 1+ is 50:50; within 1..max skewed toward 1 (max rare)
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
  // TWO road 3-way junctions (Y/T splits, mirroring the river's one 3-way): each junction cell carries three road edges — one back to the network, two outward arms
  const freeDir = (i: number, d: [number, number]) => { const r = ((i / N) | 0) + d[0], c = (i % N) + d[1]; return r >= 0 && r < N && c >= 0 && c < N && !g[ix(r, c)]; };
  const juncCells: number[] = [];
  for (let b = 0; b < 2; b++) {
    type Cand = { a: number; j: number; arms: [number, number][]; score: number };
    const viable: Cand[] = [];
    for (const a of roadCells()) {                                                // gather every spot that yields a clean 3-way…
      for (const j of nbrs(a).filter(j => !g[j])) {
        const back: [number, number] = [((a / N) | 0) - ((j / N) | 0), (a % N) - (j % N)];   // direction back to the network (excluded from the arms)
        const fa = CARD.filter(d => !(d[0] === back[0] && d[1] === back[1]) && freeDir(j, d))
                       .sort((p, q) => distCtr(((j / N) | 0) + q[0], (j % N) + q[1]) - distCtr(((j / N) | 0) + p[0], (j % N) + p[1]));   // outward arms first
        if (fa.length < 2) continue;
        const jr = (j / N) | 0, jc = j % N;
        // …scored to SPREAD: outward from centre, and far from any junction already placed (so the two don't clump)
        const spread = juncCells.length ? Math.min(...juncCells.map(p => Math.abs(((p / N) | 0) - jr) + Math.abs((p % N) - jc))) : 0;
        viable.push({ a, j, arms: fa.slice(0, 2), score: spread * 2 + distCtr(jr, jc) });
      }
    }
    if (!viable.length) break;
    viable.sort((x, y) => y.score - x.score);
    const pick = viable[Math.floor(rand() * Math.max(1, Math.ceil(viable.length * 0.25)))];   // random among the top quarter (spread, but varied)
    set(pick.j, roadBase()); link(pick.a, pick.j); juncCells.push(pick.j);        // edge back to the network
    for (const d of pick.arms) growArm(pick.j, d, 5 + Math.floor(rand() * 4));    // two outward arms (a little longer → more reach) complete the 3-way
  }

  // flood jungle, carve rocky + grassland patches (all passable land; rocky/jungle = 2 AP bushwhack)
  for (let i = 0; i < N * N; i++) if (!g[i]) set(i, 'jungle');
  const carve = (terr: Terrain, p: number, sz: number) => { for (let k = 0; k < p; k++) { let i = Math.floor(rand() * N * N); for (let s = 0; s < sz; s++) { if (g[i].terrain === 'jungle' && g[i].roads === 0) set(i, terr); const ns = nbrs(i).filter(j => g[j].terrain === 'jungle' && g[j].roads === 0); if (!ns.length) break; i = ns[Math.floor(rand() * ns.length)]; } } };   // never carve over a road overlay (set() would wipe its edges)
  const scale = (N * N) / 100;   // patch counts scale with board area (10×10 … 15×15)
  carve('rocky', Math.round(6 * scale), 4); carve('grassland', Math.round(8 * scale), 5);
  // CLIFFS: 1–2 uncrossable edges on some land tiles (plain land↔land only — never roads/water/bridges, so the laid networks stay intact)
  const isLand = (i: number) => { const t = g[i].terrain; return t === 'jungle' || t === 'rocky' || t === 'grassland'; };
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
    for (let s = 0; s < 4; s++) { const opts = nbrs(i).filter(j => g[j].terrain === 'jungle' && !(g[i].paths & dirBit(i, j)) && !(g[i].blocked & dirBit(i, j))); if (!opts.length) break; const j = opts[Math.floor(rand() * opts.length)]; linkP(i, j); i = j; } }

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
  const popc = (b: number) => (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1) + ((b >> 3) & 1);
  const free = (i: number | undefined) => i !== undefined && !g[i].hotspot;
  const byFar = (arr: number[]) => arr.slice().sort((a, b) => dist(b, base) - dist(a, base));
  const rds = roads.filter(i => i !== base);                       // market sits MID-road, not at the far end
  const maxD = Math.max(0, ...rds.map(i => dist(i, base))), mid = maxD / 2;
  const village = rds.slice().sort((a, b) => Math.abs(dist(a, base) - mid) - Math.abs(dist(b, base) - mid))[0];
  if (free(village)) g[village].hotspot = 'village';              // road market, near the middle of the road
  const station = rds.filter(i => free(i) && popc(g[i].roads) >= 3)[0] ?? byFar(rds.filter(free))[0];
  if (free(station)) g[station].hotspot = 'commStation';         // comm station — a road junction (else far road): publish hub
  if (free(byFar(allLand.filter(free))[0])) g[byFar(allLand.filter(free))[0]].hotspot = 'remote';   // farthest frontier — may be isolated (reach by boat or skip)
  const rvillage = byFar(land.filter(free))[0];
  if (free(rvillage)) g[rvillage].hotspot = 'remoteVillage';     // remote village — farthest REACHABLE jungle: a market in the wilds
  return true;
}
function generateMap(seed: number, dim: number): { map: Tile[]; start: number } {
  N = dim;   // set the grid dimension for this match (all helpers read the module-level N)
  for (let a = 0; a < 160; a++) { const { g, bridges, base } = genOnce(seed + a * 7919); if (!validate(g, bridges)) return { map: g, start: base }; }
  throw new Error('map generation failed validation');   // fail-early
}

function reveal(G: GState, t: number, random: any) {
  const tile = G.map[t]; if (tile.revealed) return;
  tile.revealed = true;
  const pool = G.pools[tile.terrain]; if (!pool) return;
  for (let k = 0; k < tile.richness && pool.length; k++) if (random.Number() < FIND_CHANCE) tile.finds.push(pool.splice(random.Die(pool.length) - 1, 1)[0]);   // each potential slot resolves to a find or comes up empty
  G.log.push(`reveal ${t} (${tile.terrain}): ${tile.finds.length}`);
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
  p.ap -= c; p.pos = t; reveal(G, t, random);
  G.log.push(`P${ctx.currentPlayer} → ${t} (-${c}ap${p.boat ? ' ⛵' : ''})`);
};
// generic link-ride: travel up to `steps` tiles along link `k` for 1 AP. car→roads, boat→river channel — same code, different prerequisite.
function ride(G: GState, ctx: any, random: any, dest: number, from: number, steps: number, k: EdgeKind, allowed: boolean, arrive: () => void, log: string) {
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || p.ap < 1 || !allowed || !linkReach(G.map, from, steps, k).includes(dest)) return INVALID_MOVE;
  p.ap -= 1; p.pos = dest; arrive(); reveal(G, dest, random);
  G.log.push(log);
}
const drive: Move<GState> = ({ G, ctx, random }, dest: number) => {   // car: up to CAR_STEPS road tiles per AP (player + car travel together)
  const car = myVehicle(G, ctx.currentPlayer);
  return ride(G, ctx, random, dest, car ? car.pos : -1, CAR_STEPS, 'roads', !!car, () => { if (car) car.pos = dest; }, `drive→${dest}`);
};
const boatRun: Move<GState> = ({ G, ctx, random }, dest: number) => {   // boat: up to BOAT_STEPS river-channel tiles per AP
  const p = G.players[ctx.currentPlayer], car = myVehicle(G, ctx.currentPlayer);
  return ride(G, ctx, random, dest, p.pos, BOAT_STEPS, 'rivers', p.boat, () => { if (car) car.driver = null; }, `P${ctx.currentPlayer} ⛵→ ${dest} (-1ap)`);
};
const board: Move<GState> = ({ G, ctx }, v = 0) => {   // climb into a co-located, unoccupied car (free)
  const p = G.players[ctx.currentPlayer], car = G.vehicles[v];
  if (G.epilogue || !car || car.pos !== p.pos || car.driver !== null) return INVALID_MOVE;
  car.driver = ctx.currentPlayer;
  G.log.push(`P${ctx.currentPlayer} board car@${car.pos}`);
};
const leave: Move<GState> = ({ G, ctx }) => {   // step out; the car stays where it is (free)
  const car = myVehicle(G, ctx.currentPlayer);
  if (G.epilogue || !car) return INVALID_MOVE;
  car.driver = null;
  G.log.push(`P${ctx.currentPlayer} leave car@${car.pos}`);
};
const drop: Move<GState> = ({ G, ctx }, kind: EquipKind = 'gear') => {   // cache a carried item on the current tile (free)
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue) return INVALID_MOVE;
  if (kind === 'boat') { if (!p.boat) return INVALID_MOVE; p.boat = false; }
  else { if (p.gear < 1) return INVALID_MOVE; p.gear -= 1; }
  G.map[p.pos].equipment.push({ kind });
  G.log.push(`P${ctx.currentPlayer} drop ${kind}@${p.pos}`);
};
const pickup: Move<GState> = ({ G, ctx }, kind: EquipKind = 'gear') => {   // reclaim a cached item from the current tile (free)
  const p = G.players[ctx.currentPlayer], eq = G.map[p.pos].equipment, idx = eq.findIndex(e => e.kind === kind);
  if (G.epilogue || idx < 0) return INVALID_MOVE;
  if (kind === 'boat') { if (p.boat) return INVALID_MOVE; p.boat = true; }   // one boat per player
  else { if (p.gear >= GEAR_MAX) return INVALID_MOVE; p.gear += 1; }
  eq.splice(idx, 1);
  G.log.push(`P${ctx.currentPlayer} pickup ${kind}@${p.pos}`);
};
const stashMove: Move<GState> = ({ G, ctx }) => {   // bank all carried specimens at the base lab (free) — collect toward a project across trips, beyond the carry cap
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || p.pos !== G.base || p.samples.length === 0) return INVALID_MOVE;
  const n = p.samples.length; p.stash.push(...p.samples); p.samples.length = 0;
  G.log.push(`P${ctx.currentPlayer} stash ${n} @base (banked ${p.stash.length})`);
};

// ---- research projects: a SHARED, CONSUMED pool of open questions (first to publish CLAIMS it; the pool refills from a per-match deck).
// Poker grammar (discipline = rank, colour = suit) made CONCRETE: each project pins specific values, so two players can race the same question.
// A project is a list of PARTS; each part needs `count` discoveries pinned by discipline and/or colour. Owned fill first; ≤MAX_CITE shortfall cites others' published. Discoveries used are CONSUMED into the publisher's pool.
const DTYPES: DType[] = ['geo', 'zoo', 'bot', 'arch'];
const COL_NAME = ['red', 'green', 'gold', 'violet'];   // the 4 colours (match DCOLOR in render)
export interface GoalPart { count: number; type?: DType; color?: number; }   // undefined axis = free (any)
export interface Pattern { id: string; label: string; parts: GoalPart[]; prestige: number; money: number; }
const POOL_SIZE = 8;   // open research questions on the board at once
export const publishCost = (prestige: number) => 1 + Math.floor(Math.max(0, prestige) / PRESTIGE_STEP);   // rising prestige → each publish takes more AP (catch-up handicap)
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
  let n = 0; const mk = (label: string, parts: GoalPart[], prestige: number, money: number): Pattern => ({ id: `g${n++}`, label, parts, prestige, money });
  const next = (t: DType) => DTYPES[(DTYPES.indexOf(t) + 1) % 4];
  const deck: Pattern[] = [
    // attainable 3-card / 4-card bread-and-butter (the bulk of the pool)
    ...DTYPES.map(t => mk(`${t} three of a kind`, [{ count: 3, type: t }], 6, 2)),
    ...colors.map(c => mk(`${COL_NAME[c]} triple`, [{ count: 3, color: c }], 6, 2)),
    ...DTYPES.map(t => mk(`${t} + ${next(t)} two pair`, [{ count: 2, type: t }, { count: 2, type: next(t) }], 6, 2)),
    // premium 5-card / both-axes (rarer, high value)
    ...DTYPES.map(t => mk(`${t} full house`, [{ count: 3, type: t }, { count: 2, type: next(t) }], 8, 3)),
    ...colors.map(c => mk(`${COL_NAME[c]} flush`, [{ count: 5, color: c }], 8, 3)),
    ...DTYPES.map(t => mk(`${t} four of a kind`, [{ count: 4, type: t }], 8, 3)),
    ...colors.map(c => mk(`${COL_NAME[c]} ${DTYPES[c % 4]} triple`, [{ count: 3, type: DTYPES[c % 4], color: c }], 7, 2)),   // both-axes
    mk('discipline straight', DTYPES.map(t => ({ count: 1, type: t })), 5, 2),
    mk('colour straight', colors.map(c => ({ count: 1, color: c })), 5, 2),
  ];
  return shuf(deck);
}
const citablePool = (G: GState, self: string) => { const out: Discovery[] = []; for (const id in G.players) if (id !== self) out.push(...G.players[id].published); return out; };

const catalogue: Move<GState> = ({ G, ctx, random }, find: number) => {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || p.ap < 1 || !tile.revealed || find < 0 || find >= tile.finds.length || p.samples.length >= CARRY_SLOTS) return INVALID_MOVE;  // carry cap
  p.ap -= 1;
  const roll = random.D6() + random.D6() + p.gear;   // gear steadies the dice
  const d = tile.finds[find], tag = `${d.type}${d.color}`;
  if (roll >= CATALOGUE_DC) { tile.finds.splice(find, 1); p.samples.push(d); G.log.push(`catalogue ${tag} ${roll} ✓ collected`); }
  else if (roll >= CATALOGUE_DC - 2) G.log.push(`catalogue ${tag} ${roll} ◦ stayed`);   // a near miss (within 2) leaves the find for another attempt — fewer rolls destroy it
  else { tile.finds.splice(find, 1); G.log.push(`catalogue ${tag} ${roll} ✗ ${d.type === 'zoo' ? 'fled' : 'destroyed'}`); }   // fauna flees, the rest is destroyed
};

const publish: Move<GState> = ({ G, ctx }, patternName: string) => {  // research+publish (hands fully owned; no citation)
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos], apCost = publishCost(p.prestige);
  if (p.ap < apCost || (!G.epilogue && !isHub(tile))) return INVALID_MOVE;   // lab season = publish anywhere; cost rises with prestige
  const pat = G.goals.find(x => x.id === patternName); if (!pat) return INVALID_MOVE;
  const atBase = p.pos === G.base, sLen = p.samples.length;            // at base the banked stash is in reach of the lab too
  const owned = atBase ? [...p.samples, ...p.stash] : p.samples;
  const res = assemble(G, pat.id, owned, citablePool(G, ctx.currentPlayer)); if (!res) return INVALID_MOVE;
  p.ap -= apCost;
  const used = res.ownedIdx.map(i => owned[i]);
  const sIdx = res.ownedIdx.filter(i => i < sLen).sort((a, b) => b - a);          // remove the used cards from carry…
  const tIdx = res.ownedIdx.filter(i => i >= sLen).map(i => i - sLen).sort((a, b) => b - a);   // …and the stash
  sIdx.forEach(i => p.samples.splice(i, 1)); tIdx.forEach(i => p.stash.splice(i, 1));
  p.published.push(...used);                                          // owned discoveries → your published pool (citable by others)
  const prestige = pat.prestige, money = pat.money;                  // flat — cited (≤1) is a top-up, no bonus or penalty
  p.prestige += prestige; p.money += money;                          // research token → unified prestige accumulation
  G.log.push(`publish ${pat.label}${res.cited ? ` (cited ${res.cited})` : ''} +${prestige}P +${money}$`);
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
  const myCar = G.vehicles.find(v => v.driver === ctx.currentPlayer);
  if (myCar) {                                                          // driving → hop to the best closer road cell, else step out
    let best = -1, bd = here;
    for (const c of roadReach(G.map, myCar.pos, CAR_STEPS)) { const d = nearestDist(goals, c); if (d < bd) { bd = d; best = c; } }
    return best >= 0 ? { move: 'drive', args: [best] } : { move: 'leave', args: [] };
  }
  const vi = G.vehicles.findIndex(v => v.pos === p.pos && v.driver === null);   // parked car underfoot → board if roads lead closer
  if (vi >= 0 && roadReach(G.map, G.vehicles[vi].pos, CAR_STEPS).some(c => nearestDist(goals, c) < here)) return { move: 'board', args: [vi] };
  return null;
}
// heuristic policy: publish at a hub; grab the boat when it unlocks water-bound forage; drive roads + boat water toward the goal
export function botAction(G: GState, ctx: any, rand: () => number): { move?: string; args?: unknown[]; event?: string } {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos], cit = citablePool(G, ctx.currentPlayer);
  const atBase = p.pos === G.base, ownedPub = atBase ? [...p.samples, ...p.stash] : p.samples;
  // publish at a hub — claim the most valuable open question you can complete (projects are scarce/contested, so grab them)
  if (p.ap >= publishCost(p.prestige) && (G.epilogue || isHub(tile))) for (const pat of [...G.goals].sort((a, b) => b.prestige - a.prestige)) if (assemble(G, pat.id, ownedPub, cit)) return { move: 'publish', args: [pat.id] };
  if (G.epilogue) return { event: 'endTurn' };   // lab: only publishing
  if (atBase && p.samples.length > 0 && (p.samples.length >= CARRY_SLOTS || tile.finds.length === 0)) return { move: 'stash', args: [] };   // bank carried specimens at base to keep collecting toward a project
  if (isMarket(tile) && p.gear < GEAR_MAX && p.money >= GEAR_COST) return { move: 'buy', args: [] };  // invest spare money (free action)
  if (!p.boat && tile.equipment.some(e => e.kind === 'boat') && reachGoals(G, p.pos, true, forageTarget) > reachGoals(G, p.pos, false, forageTarget))
    return { move: 'pickup', args: ['boat'] };   // grab the shared boat only when water is actually fencing off forage
  const full = p.samples.length >= CARRY_SLOTS;
  if (!full && p.ap >= 1 && tile.finds.length) {   // catalogue the find that best advances an open project (build a hand toward a question)
    let bestI = 0, bestScore = -1;
    for (let i = 0; i < tile.finds.length; i++) {
      const trial = [...p.samples, tile.finds[i]];
      let score = 0;
      for (const g of G.goals) { const r = evalGoal(g, trial, cit); score = Math.max(score, (r.ok ? 1000 : 0) + r.slots.filter(s => s.state === 'have').length * 10 + g.prestige); }
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    return { move: 'catalogue', args: [bestI] };
  }
  const goalPred = full ? isHub : forageTarget;   // full carry → head to a hub; else explore/forage
  if (!(full && isHub(tile))) {
    const goals = goalCells(G, goalPred);
    const cs = carStep(G, ctx, goals); if (cs) return cs;                                   // car: zip along roads toward the goal
    const nx = stepToward(G, p.pos, goalPred, p.boat);                                      // foot/boat: weighted step toward the goal
    if (nx >= 0) { if (p.ap >= (p.boat ? boatCost : cost)(G.map, p.pos, nx)) return { move: 'move', args: [nx] }; }   // reachable — step now, else wait for AP next turn
    else if (full && p.ap >= 1 && p.pos !== G.base) return { move: 'helilift', args: [] };  // genuinely no hub reachable → fly home
  }
  const can = p.boat ? canBoat : canMove, wt = p.boat ? boatCost : cost;                    // fallback: any affordable step (don't stall)
  const opts = nbrs(p.pos).filter(t => can(G.map, p.pos, t) && p.ap >= wt(G.map, p.pos, t));
  if (!full && opts.length) return { move: 'move', args: [opts[Math.floor(rand() * opts.length)]] };
  return { event: 'endTurn' };
}

const buy: Move<GState> = ({ G, ctx }) => {                          // upgrade gear at a market (money → catalogue capability) — free action, no AP
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || !isMarket(tile) || p.gear >= GEAR_MAX || p.money < GEAR_COST) return INVALID_MOVE;
  p.money -= GEAR_COST; p.gear += 1;
  G.log.push(`buy gear L${p.gear} (-${GEAR_COST}$)`);
};
const helilift: Move<GState> = ({ G, ctx }) => {   // airlift to the main hub; pay cash, cover any shortfall with negative-prestige tokens
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || p.ap < 1 || p.pos === G.base) return INVALID_MOVE;
  p.ap -= 1;
  const car = myVehicle(G, ctx.currentPlayer); if (car) car.driver = null;   // airlift leaves the car behind
  const pay = Math.min(p.money, HELILIFT_COST); p.money -= pay;
  const neg = Math.ceil((HELILIFT_COST - pay) / 4);   // 4$ ≈ 1 prestige (matches money→VP rate)
  if (neg > 0) p.prestige -= neg;                      // negative-prestige tokens (reputation hit)
  p.pos = G.base;
  G.log.push(`helilift→base (-${pay}$${neg ? ` -${neg}P` : ''})`);
};
export const enumerate = (G: GState, ctx: any) => {
  const p = G.players[ctx.currentPlayer], out: any[] = [], tile = G.map[p.pos];
  if (!G.epilogue) {                                                  // field season
    const myCar = G.vehicles.find(v => v.driver === ctx.currentPlayer);
    nbrs(p.pos).forEach(t => { const ok = p.boat ? canBoat(G.map, p.pos, t) : canMove(G.map, p.pos, t); const c = p.boat ? boatCost(G.map, p.pos, t) : cost(G.map, p.pos, t); if (ok && p.ap >= c) out.push({ move: 'move', args: [t] }); });
    if (p.ap >= 1 && myCar) roadReach(G.map, myCar.pos, CAR_STEPS).forEach(d => out.push({ move: 'drive', args: [d] }));
    if (p.ap >= 1 && p.boat) riverReach(G.map, p.pos, BOAT_STEPS).forEach(d => out.push({ move: 'boatRun', args: [d] }));   // fast river-channel boating
    G.vehicles.forEach((v, i) => { if (v.pos === p.pos && v.driver === null) out.push({ move: 'board', args: [i] }); });
    if (myCar) out.push({ move: 'leave', args: [] });
    if (p.ap >= 1 && p.samples.length < CARRY_SLOTS) tile.finds.forEach((_, i) => out.push({ move: 'catalogue', args: [i] }));
    if (isMarket(tile) && p.gear < GEAR_MAX && p.money >= GEAR_COST) out.push({ move: 'buy', args: [] });   // free action (no AP)
    if (p.gear >= 1) out.push({ move: 'drop', args: ['gear'] });
    if (p.boat) out.push({ move: 'drop', args: ['boat'] });
    if (tile.equipment.some(e => e.kind === 'gear') && p.gear < GEAR_MAX) out.push({ move: 'pickup', args: ['gear'] });
    if (tile.equipment.some(e => e.kind === 'boat') && !p.boat) out.push({ move: 'pickup', args: ['boat'] });
    if (p.pos === G.base && p.samples.length > 0) out.push({ move: 'stash', args: [] });   // bank specimens at the base lab
    if (p.ap >= 1 && p.pos !== G.base) out.push({ move: 'helilift', args: [] });
  }
  if (p.ap >= publishCost(p.prestige) && (G.epilogue || isHub(tile))) {   // publish: at base the banked stash is in reach too
    const cit = citablePool(G, ctx.currentPlayer), owned = p.pos === G.base ? [...p.samples, ...p.stash] : p.samples;
    G.goals.forEach(pat => { if (assemble(G, pat.id, owned, cit)) out.push({ move: 'publish', args: [pat.id] }); });
  }
  out.push({ event: 'endTurn' });
  return out;
};

// ---- event deck: mostly benign; monsoon stacked at the BOTTOM = telegraphed end ----
function buildDeck(seed: number): string[] {
  const top = [...Array(10).fill('tailwind'), ...Array(6).fill('cache'), ...Array(4).fill('grant'),
    ...Array(6).fill('calm'), ...Array(3).fill('rockslide'), ...Array(3).fill('washout')];  // 32 benign+hazard
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
    map[start].equipment.push({ kind: 'boat' });   // one shared boat, cached at base (pick it up to cross water)
    return {
      players: Object.fromEntries(Array.from({ length: ctx.numPlayers }, (_, i) =>
        [String(i), { ap: START_AP, pos: start, money: 0, samples: [], stash: [], published: [], prestige: 0, gear: 0, boat: false }])),
      map, cols: N, rows: N, base: start,
      vehicles: [{ pos: start, driver: null }],   // one shared car parked at base
      pools: { grassland: buildPool('grassland', colorRand), jungle: buildPool('jungle', colorRand), rocky: buildPool('rocky', colorRand) },
      ...(() => { const deck = buildGoalDeck(prng((seed ^ 0x9e3779b1) >>> 0)); return { goals: deck.slice(0, POOL_SIZE), goalDeck: deck.slice(POOL_SIZE) }; })(),   // deal the open-question pool; rest is the refill deck
      events: buildDeck(seed), monsoon: 0, epilogue: false, labLeft: 0, log: ['setup'],
    };
  },
  moves: { move, catalogue, publish, buy, drive, boatRun, helilift, board, leave, drop, pickup, stash: stashMove },
  turn: {
    onBegin: ({ G, ctx, random }) => {
      if (!G.epilogue) {
        const id = G.events.shift(); if (id) applyEvent(G, id, random, ctx.currentPlayer);   // field season: 1 event/turn
        if (G.monsoon >= MONSOON_END || !G.events.length) { G.epilogue = true; G.labLeft = ctx.numPlayers; G.log.push('🌧️ monsoon — indoor lab season'); }
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
