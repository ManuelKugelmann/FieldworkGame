import type { Game, Move } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

export type Terrain = 'grassland' | 'jungle' | 'rocky' | 'water' | 'void';  // roads are an edge overlay on a land base, not a terrain; void = off-board
export type Bridge = 'road' | 'foot';
export type DType = 'geo' | 'zoo' | 'bot' | 'arch';
export interface Discovery { type: DType; color: number; }
export type Hotspot = 'base' | 'remote' | 'village';  // POIs: road base, remote base (frontier hub), village (market)
export type EquipKind = 'gear' | 'boat';              // carryable items cached on a tile (droppable/pickup-able)
export interface Equip { kind: EquipKind; }
export interface Vehicle { pos: number; driver: string | null; }  // car: a positioned entity you board/leave; drive moves both
export interface Tile { terrain: Terrain; bridge?: Bridge; roads: number; paths: number; smallRivers: number; blocked: number; rivers: number; hotspot?: Hotspot; richness: number; revealed: boolean; finds: Discovery[]; equipment: Equip[]; }  // roads/paths/smallRivers(brooks)/blocked(cliffs)/rivers(channel linkage) = edge bitmasks N1 E2 S4 W8
export interface PlayerS { ap: number; pos: number; money: number; samples: Discovery[]; published: Discovery[]; prestige: number; gear: number; boat: boolean; }  // gear = catalogue-roll bonus; boat = carrying the shared boat (enables water crossing)
export interface GState {
  players: Record<string, PlayerS>;
  map: Tile[]; cols: number; rows: number; base: number;   // main hub (road) — helilift target
  vehicles: Vehicle[];                                     // shared cars on the board (start at base)
  pools: Partial<Record<Terrain, Discovery[]>>;
  events: string[]; monsoon: number; epilogue: boolean; labLeft: number; log: string[];   // epilogue = indoor lab season
}

let N = 10;                  // grid dimension (square), chosen per-match in [10..15]
const DIM_MIN = 10, DIM_MAX = 15, ACTIVE_TILES = 110, START_AP = 4,  // fixed 15×15 footprint, ~110 tiles kept active (rest void) → consistent size + spread  // 4 AP/round
  COLORS = 4, CATALOGUE_DC = 7, MAP_SEED = 1, CARRY_SLOTS = 4, MONSOON_END = 4, MAX_CITE = 1, GEAR_MAX = 2, GEAR_COST = 5, CAR_STEPS = 3, BOAT_STEPS = 2, FIND_CHANCE = 0.75, HELILIFT_COST = 12;  // FIND_CHANCE: each potential slot (gray dot) yields a discovery on reveal, else empty  // CAR_STEPS road tiles / BOAT_STEPS river-channel tiles per AP  // helilift: airlift to base; cash or, if short, negative-prestige tokens  // gear: +1 catalogue roll/level, bought with money at a market

const RICH: Record<Terrain, [number, number]> = { grassland: [0, 2], jungle: [2, 4], rocky: [2, 4], water: [0, 0], void: [0, 0] };  // [min,max] potential tokens — rolled per tile
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
const isHub = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'remote';  // research+publish hubs (road base ≡ remote base)
const isMarket = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'village';  // buy gear here (road-network services)

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
  const set = (i: number, t: Terrain, bridge?: Bridge) => { const [lo, hi] = RICH[t]; g[i] = { terrain: t, bridge, roads: 0, paths: 0, smallRivers: 0, blocked: 0, rivers: 0, richness: lo + Math.floor(rand() * (hi - lo + 1)), revealed: false, finds: [], equipment: [] }; };
  const join = (a: number, b: number, k: EdgeKind) => { g[a][k] |= dirBit(a, b); g[b][k] |= dirBit(b, a); };   // lay one edge of link kind `k` (symmetric)
  const link = (a: number, b: number) => join(a, b, 'roads');         // road edge
  const linkP = (a: number, b: number) => join(a, b, 'paths');        // foot edge
  const linkS = (a: number, b: number) => join(a, b, 'smallRivers');  // brook edge (boat-only highway)
  const block = (a: number, b: number) => join(a, b, 'blocked');      // cliff edge (uncrossable)

  // river: 4-connected vertical path; trunk kept in the central column band so the road bridge lands in the centre quadrant
  const wlo = Math.max(1, Math.ceil(N / 3)), whi = Math.min(N - 2, Math.floor(2 * N / 3));
  let col = Math.max(wlo, Math.min(whi, Math.floor(N / 2) - 1 + Math.floor(rand() * 3))); const river: number[] = [];
  for (let r = 0; r < N; r++) { set(ix(r, col), 'water'); river.push(ix(r, col)); if (r < N - 1) { let nc = col + (rand() < 0.62 ? 0 : (rand() < 0.5 ? -1 : 1)); nc = Math.max(wlo, Math.min(whi, nc)); if (nc !== col) { set(ix(r, nc), 'water'); river.push(ix(r, nc)); } col = nc; } }

  // BIG BRANCH: a major fork off the trunk to an edge — full barrier (own crossing) → carves a 3rd section
  const branch: number[] = [];
  for (let att = 0; att < 14 && !branch.length; att++) {
    const bp = river[3 + Math.floor(rand() * Math.max(1, river.length - 6))];
    const dir = (bp % N) < N / 2 ? 1 : -1; let pr = bp; const blen = 3 + Math.floor(rand() * 2); const cells: number[] = [];
    for (let s = 0; s < blen; s++) {
      const prow = (pr / N) | 0, pc = pr % N; let nr = prow, ncl = pc + dir;
      if (s > 0 && rand() < 0.35) { ncl = pc; nr = prow + (rand() < 0.5 ? -1 : 1); }   // 4-connected bend
      if (ncl <= 0 || ncl >= N - 1 || nr < 0 || nr >= N) break;
      const i = ix(nr, ncl); if (g[i]) break; cells.push(i); pr = i;
    }
    if (cells.length >= 3) { cells.forEach(i => set(i, 'water')); branch.push(...cells); }   // commit only a real branch
  }

  // (brooks are land-cell edge overlays now — laid after the land flood, near the footpaths)

  // CROSSINGS: only the CENTRE road bridge is defined; foot bridges land on RANDOM river tiles (some cuts get none → boat-only)
  const allRiver = [...river, ...branch];
  const dc = (i: number) => Math.abs(((i / N) | 0) - N / 2) + Math.abs((i % N) - N / 2);
  const centralRow = river.filter(i => { const r = (i / N) | 0; return r >= N / 3 && r <= 2 * N / 3; });   // pin the bridge to the centre quadrant
  const ctr = (centralRow.length ? centralRow : river).slice().sort((a, b) => dc(a) - dc(b))[0];   // on the TRUNK (road gen assumes a vertical cut)
  g[ctr].bridge = 'road'; const bridges = [ctr];
  const cand = allRiver.filter(i => i !== ctr);                    // exactly 2 foot crossings on random river tiles
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
  const branchN = 3 + Math.round((N - 10) / 3);   // a few road branches grown outward from the centre
  for (let b = 0; b < branchN; b++) { const rc = roadCells(); if (!rc.length) break; let i = rc[Math.floor(rand() * rc.length)]; const len = 3 + Math.floor(rand() * 3); for (let s = 0; s < len; s++) { const opts = nbrs(i).filter(j => !g[j]); if (!opts.length) break; const j = opts[Math.floor(rand() * opts.length)]; set(j, roadBase()); link(i, j); i = j; } }

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
  // STATIC SIZE: keep ~ACTIVE_TILES cells in a round-robin blob grown from the centre bridge (water/roads always kept); void the rest of the land → consistent size, 15×15 spread, gaps
  const passable = (a: number, b: number) => {                          // anticipates play connectivity: bridges connect, open water blocks
    if (onBlocked(g, a, b) || isVoid(g[a]) || isVoid(g[b])) return false;
    if (g[a].bridge || g[b].bridge) return true;
    return !(plainRiver(g[a]) || plainRiver(g[b]));
  };
  let fixed = 0; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'water' || g[i].roads !== 0 || g[i].bridge) fixed++;   // water + roads (overlay) + bridges are always kept
  let budget = ACTIVE_TILES - fixed;
  const keepLand = new Set<number>(), bq = [bridges[0]], bseen = new Set<number>([bridges[0]]);   // BFS = even round-robin growth from the centre
  while (bq.length) {
    const u = bq.shift()!;
    if (isLand(u) && g[u].roads === 0 && budget > 0 && !keepLand.has(u)) { keepLand.add(u); budget--; }   // off-road land fills the budget
    for (const v of nbrs(u)) if (!bseen.has(v) && passable(u, v)) { bseen.add(v); bq.push(v); }
  }
  for (let i = 0; i < N * N; i++) if (isLand(i) && g[i].roads === 0 && !keepLand.has(i)) set(i, 'void');   // never void a road cell
  // the BASE hub sits a few road-tiles out from the bridge (road-distance ≈ 3), not right beside it
  const bdist = new Map<number, number>([[bridges[0], 0]]); const bq2 = [bridges[0]];
  while (bq2.length) { const u = bq2.shift()!; const d = bdist.get(u)!; for (const v of nbrs(u)) if (!bdist.has(v) && (g[u].roads & dirBit(u, v))) { bdist.set(v, d + 1); bq2.push(v); } }
  let base = bridges[0], bestS = Infinity;
  for (const [i, d] of bdist) if (g[i].roads !== 0 && !g[i].bridge) { const s = Math.abs(d - 3); if (s < bestS) { bestS = s; base = i; } }
  placeHotspots(g, base);   // within the kept area; before footpaths so the remote base seeds trails

  // FOOTPATHS: foot bridges link to land banks (boardable); seeds = foot bridges + some road trailheads; trails fizzle out anywhere
  const footBr = bridges.filter(b => g[b].bridge === 'foot');
  for (const fb of footBr) for (const j of nbrs(fb)) if (g[j].terrain !== 'water' && g[j].terrain !== 'void' && !(g[fb].blocked & dirBit(fb, j))) linkP(fb, j);
  const roadAll: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].roads !== 0) roadAll.push(i);
  const seeds = [...footBr]; for (let k = 0; k < 4 && roadAll.length; k++) seeds.push(roadAll[Math.floor(rand() * roadAll.length)]);   // more road trailheads
  for (const hs of ['base', 'village', 'remote'] as const) { const i = g.findIndex(t => t && t.hotspot === hs); if (i >= 0) seeds.push(i); }   // trails also leave the base, market & remote
  for (const sd of seeds) {
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
  const rds = roads.filter(i => i !== base);                       // market sits MID-road, not at the far end
  const maxD = Math.max(0, ...rds.map(i => dist(i, base))), mid = maxD / 2;
  g[rds.slice().sort((a, b) => Math.abs(dist(a, base) - mid) - Math.abs(dist(b, base) - mid))[0]].hotspot = 'village';   // road-reachable market, near the middle of the road
  g[allLand.slice().sort((a, b) => dist(b, base) - dist(a, base))[0]].hotspot = 'remote';   // farthest frontier — may be isolated (reach by boat or skip)
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

// ---- research set-patterns. assemble() uses owned samples first, cites others' published pools for any shortfall ----
const PATTERNS = [
  { name: 'triple', prestige: 4, money: 2 },   // 3 of one discipline
  { name: 'rainbow', prestige: 7, money: 3 },  // 1 of each of the 4 disciplines
];
const DTYPES: DType[] = ['geo', 'zoo', 'bot', 'arch'];
function assemble(name: string, owned: Discovery[], citable: Discovery[]): { ownedIdx: number[]; cited: number } | null {
  if (name === 'triple') {
    let best: { ownedIdx: number[]; cited: number } | null = null;
    for (const T of DTYPES) {
      const oIdx: number[] = []; owned.forEach((d, i) => { if (d.type === T) oIdx.push(i); });
      const cAvail = citable.filter(d => d.type === T).length;
      if (oIdx.length + cAvail >= 3) { const useOwned = Math.min(3, oIdx.length); const cand = { ownedIdx: oIdx.slice(0, useOwned), cited: 3 - useOwned }; if (!best || cand.cited < best.cited) best = cand; }
    }
    return best && best.cited <= MAX_CITE ? best : null;   // own all but MAX_CITE
  }
  if (name === 'rainbow') {
    const ownedIdx: number[] = [], used = new Set<number>(); let cited = 0;
    for (const T of DTYPES) {
      let oi = -1; for (let i = 0; i < owned.length; i++) if (owned[i].type === T && !used.has(i)) { oi = i; break; }
      if (oi >= 0) { ownedIdx.push(oi); used.add(oi); } else if (citable.some(d => d.type === T)) cited++; else return null;
    }
    return cited <= MAX_CITE ? { ownedIdx, cited } : null;   // own all but MAX_CITE
  }
  return null;
}
const citablePool = (G: GState, self: string) => { const out: Discovery[] = []; for (const id in G.players) if (id !== self) out.push(...G.players[id].published); return out; };

const catalogue: Move<GState> = ({ G, ctx, random }, find: number) => {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || p.ap < 1 || !tile.revealed || find < 0 || find >= tile.finds.length || p.samples.length >= CARRY_SLOTS) return INVALID_MOVE;  // carry cap
  p.ap -= 1;
  const roll = random.D6() + random.D6() + p.gear;   // gear steadies the dice
  const d = tile.finds[find], tag = `${d.type}${d.color}`;
  if (roll >= CATALOGUE_DC) { tile.finds.splice(find, 1); p.samples.push(d); G.log.push(`catalogue ${tag} ${roll} ✓ collected`); }
  else if (roll === CATALOGUE_DC - 1) G.log.push(`catalogue ${tag} ${roll} ◦ stayed`);   // just missed — the find stays for another attempt
  else { tile.finds.splice(find, 1); G.log.push(`catalogue ${tag} ${roll} ✗ ${d.type === 'zoo' ? 'fled' : 'destroyed'}`); }   // fauna flees, the rest is destroyed
};

const publish: Move<GState> = ({ G, ctx }, patternName: string) => {  // research+publish; may cite others' published discoveries
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (p.ap < 1 || (!G.epilogue && !isHub(tile))) return INVALID_MOVE;   // lab season = publish anywhere
  const pat = PATTERNS.find(x => x.name === patternName); if (!pat) return INVALID_MOVE;
  const res = assemble(pat.name, p.samples, citablePool(G, ctx.currentPlayer)); if (!res) return INVALID_MOVE;
  p.ap -= 1;
  const used = res.ownedIdx.map(i => p.samples[i]);
  res.ownedIdx.slice().sort((a, b) => b - a).forEach(i => p.samples.splice(i, 1));
  p.published.push(...used);                                          // owned discoveries → your published pool (citable by others)
  const prestige = pat.prestige, money = pat.money;                  // flat — cited (≤1) is a top-up, no bonus or penalty
  p.prestige += prestige; p.money += money;                          // research token → unified prestige accumulation
  G.log.push(`publish ${pat.name}${res.cited ? ` (cited ${res.cited})` : ''} +${prestige}P +${money}$`);
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
  if (p.ap >= 1 && (G.epilogue || isHub(tile))) for (const pat of [...PATTERNS].sort((a, b) => b.prestige - a.prestige)) if (assemble(pat.name, p.samples, cit)) return { move: 'publish', args: [pat.name] };
  if (G.epilogue) return { event: 'endTurn' };   // lab: only publishing
  if (p.ap >= 1 && isMarket(tile) && p.gear < GEAR_MAX && p.money >= GEAR_COST) return { move: 'buy', args: [] };  // invest spare money
  if (!p.boat && tile.equipment.some(e => e.kind === 'boat') && reachGoals(G, p.pos, true, forageTarget) > reachGoals(G, p.pos, false, forageTarget))
    return { move: 'pickup', args: ['boat'] };   // grab the shared boat only when water is actually fencing off forage
  const full = p.samples.length >= CARRY_SLOTS;
  if (!full && p.ap >= 1 && tile.finds.length) return { move: 'catalogue', args: [0] };   // claim a token underfoot
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

const buy: Move<GState> = ({ G, ctx }) => {                          // upgrade gear at a market (money → catalogue capability)
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos];
  if (G.epilogue || p.ap < 1 || !isMarket(tile) || p.gear >= GEAR_MAX || p.money < GEAR_COST) return INVALID_MOVE;
  p.ap -= 1; p.money -= GEAR_COST; p.gear += 1;
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
    if (p.ap >= 1 && isMarket(tile) && p.gear < GEAR_MAX && p.money >= GEAR_COST) out.push({ move: 'buy', args: [] });
    if (p.gear >= 1) out.push({ move: 'drop', args: ['gear'] });
    if (p.boat) out.push({ move: 'drop', args: ['boat'] });
    if (tile.equipment.some(e => e.kind === 'gear') && p.gear < GEAR_MAX) out.push({ move: 'pickup', args: ['gear'] });
    if (tile.equipment.some(e => e.kind === 'boat') && !p.boat) out.push({ move: 'pickup', args: ['boat'] });
    if (p.ap >= 1 && p.pos !== G.base) out.push({ move: 'helilift', args: [] });
  }
  if (p.ap >= 1 && (G.epilogue || isHub(tile))) { const cit = citablePool(G, ctx.currentPlayer); PATTERNS.forEach(pat => { if (assemble(pat.name, p.samples, cit)) out.push({ move: 'publish', args: [pat.name] }); }); }  // lab research = publish anywhere
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
        [String(i), { ap: START_AP, pos: start, money: 0, samples: [], published: [], prestige: 0, gear: 0, boat: false }])),
      map, cols: N, rows: N, base: start,
      vehicles: [{ pos: start, driver: null }],   // one shared car parked at base
      pools: { grassland: buildPool('grassland', colorRand), jungle: buildPool('jungle', colorRand), rocky: buildPool('rocky', colorRand) },
      events: buildDeck(seed), monsoon: 0, epilogue: false, labLeft: 0, log: ['setup'],
    };
  },
  moves: { move, catalogue, publish, buy, drive, boatRun, helilift, board, leave, drop, pickup },
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
