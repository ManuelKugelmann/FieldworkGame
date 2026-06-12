import type { Game, Move } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';

export type Terrain = 'road' | 'wild' | 'forest' | 'rocky' | 'water';
export type Bridge = 'road' | 'foot';
export type DType = 'geo' | 'zoo' | 'bot' | 'arch';
export interface Discovery { type: DType; color: number; }
export type Hotspot = 'base' | 'remote' | 'village';  // POIs: road base, remote base (frontier hub), village (market)
export type EquipKind = 'gear';                       // m4 entity: gear cached on a tile (droppable/pickup-able)
export interface Equip { kind: EquipKind; }
export interface Vehicle { pos: number; driver: string | null; }  // car: a positioned entity you board/leave; drive moves both
export interface Tile { terrain: Terrain; bridge?: Bridge; arm?: boolean; roads: number; paths: number; hotspot?: Hotspot; richness: number; revealed: boolean; finds: Discovery[]; equipment: Equip[]; }  // roads = bitmask N1 E2 S4 W8
export interface PlayerS { ap: number; pos: number; money: number; samples: Discovery[]; published: Discovery[]; prestige: number; gear: number; }  // gear = catalogue-roll bonus
export interface GState {
  players: Record<string, PlayerS>;
  map: Tile[]; cols: number; rows: number; base: number;   // main hub (road) — helilift target
  vehicles: Vehicle[];                                     // shared cars on the board (start at base)
  pools: Partial<Record<Terrain, Discovery[]>>;
  events: string[]; monsoon: number; epilogue: boolean; labLeft: number; log: string[];   // epilogue = indoor lab season
}

const N = 10, START_AP = 4,  // 4 AP/round
  COLORS = 4, CATALOGUE_DC = 7, MAP_SEED = 1, CARRY_SLOTS = 4, MONSOON_END = 4, MAX_CITE = 1, GEAR_MAX = 2, GEAR_COST = 5, CAR_STEPS = 3, HELILIFT_COST = 12;  // helilift: airlift to base; cash or, if short, negative-prestige tokens  // gear: +1 catalogue roll/level, bought with money at a market

const RICH: Record<Terrain, number> = { road: 1, wild: 3, forest: 2, rocky: 0, water: 0 };
const plainRiver = (t: Tile) => t.terrain === 'water' && !t.bridge && !t.arm;  // main river = hard barrier
const isArm = (t: Tile) => t.terrain === 'water' && !!t.arm;                    // thin side arm: fordable + boat highway
const dirBit = (a: number, b: number) => b === a - N ? 1 : b === a + N ? 4 : b === a + 1 ? 2 : 8;  // N1 E2 S4 W8
const onPath = (map: Tile[], a: number, b: number) => ((map[a].roads | map[a].paths) & dirBit(a, b)) !== 0;  // road OR foot edge
// board/leave a bridge only via an edge; land↔land always allowed (boat↔rocky exit-block = m4)
const canMoveDry = (map: Tile[], a: number, b: number) => plainRiver(map[a]) || plainRiver(map[b]) ? false : (map[a].bridge || map[b].bridge) ? onPath(map, a, b) : true;  // river = hard barrier (map validation)
const canMove = (map: Tile[], a: number, b: number) => {           // play graph: arms fordable/boatable, main river by boat
  const ta = map[a], tb = map[b];
  if (ta.bridge || tb.bridge) return onPath(map, a, b);            // bridge: board/leave via an edge
  const aR = plainRiver(ta), bR = plainRiver(tb);                  // main-river water (not arm)
  if (aR !== bR && (aR ? tb : ta).terrain === 'rocky') return false;  // boat↔rocky exit-block (main river only)
  return true;                                                     // land↔land/arm, arm↔arm, river↔river/non-rocky
};
const cost = (map: Tile[], a: number, b: number) => (onPath(map, a, b) || (isArm(map[a]) && isArm(map[b]))) ? 1 : 2;  // path or arm-highway = 1 AP; ford/bushwhack/open-water = 2
// m4 vehicles: a car moves up to 3 road tiles per AP (road edges only) — not yet implemented
const isHub = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'remote';  // research+publish hubs (road base ≡ remote base)
const isMarket = (t: Tile) => t.hotspot === 'base' || t.hotspot === 'village';  // buy gear here (road-network services)

const WEIGHTS: Partial<Record<Terrain, Record<DType, number>>> = {
  road:   { geo: 5, arch: 2, zoo: 1, bot: 1 },
  forest: { bot: 4, zoo: 3, arch: 2, geo: 1 },
  wild:   { bot: 5, zoo: 4, arch: 2, geo: 1 },
};
function buildPool(t: Terrain): Discovery[] {
  const out: Discovery[] = [], w = WEIGHTS[t]!;
  (Object.keys(w) as DType[]).forEach(k => { for (let i = 0; i < w[k] * 4; i++) out.push({ type: k, color: i % COLORS }); });
  return out;
}

// ---- map gen: river + roads FIRST (single connected networks, centred crossing), then flood land; validate + reseed ----
function prng(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ix = (r: number, c: number) => r * N + c;
function nbrs(i: number): number[] { const r = (i / N) | 0, c = i % N, o: number[] = []; if (r > 0) o.push(i - N); if (r < N - 1) o.push(i + N); if (c > 0) o.push(i - 1); if (c < N - 1) o.push(i + 1); return o; }
function roadReach(map: Tile[], from: number, maxSteps: number): number[] {   // car: road cells within maxSteps road edges
  const seen = new Map<number, number>([[from, 0]]); const q = [from]; const out: number[] = [];
  while (q.length) { const u = q.shift()!; const d = seen.get(u)!; if (d >= maxSteps) continue;
    for (const v of nbrs(u)) if (!seen.has(v) && (map[u].roads & dirBit(u, v))) { seen.set(v, d + 1); out.push(v); q.push(v); } }
  return out;
}
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
  const set = (i: number, t: Terrain, bridge?: Bridge) => { g[i] = { terrain: t, bridge, roads: 0, paths: 0, richness: RICH[t], revealed: false, finds: [], equipment: [] }; };
  const link = (a: number, b: number) => { g[a].roads |= dirBit(a, b); g[b].roads |= dirBit(b, a); };   // road edge
  const linkP = (a: number, b: number) => { g[a].paths |= dirBit(a, b); g[b].paths |= dirBit(b, a); };  // foot edge
  const mkArm = (i: number) => { set(i, 'water'); g[i].arm = true; };   // thin side-arm cell

  // river: 4-connected vertical path (compact wander)
  let col = 3 + Math.floor(rand() * 4); const river: number[] = [];
  for (let r = 0; r < N; r++) { set(ix(r, col), 'water'); river.push(ix(r, col)); if (r < N - 1) { let nc = col + (rand() < 0.5 ? 0 : (rand() < 0.5 ? -1 : 1)); nc = Math.max(1, Math.min(N - 2, nc)); if (nc !== col) { set(ix(r, nc), 'water'); river.push(ix(r, nc)); } col = nc; } }

  // BIG BRANCH: a major fork off the trunk to an edge — full barrier (own crossing) → carves a 3rd section
  const branch: number[] = [];
  for (let att = 0; att < 14 && !branch.length; att++) {
    const bp = river[3 + Math.floor(rand() * Math.max(1, river.length - 6))];
    const dir = (bp % N) < N / 2 ? 1 : -1; let pr = bp; const blen = 4 + Math.floor(rand() * 3); const cells: number[] = [];
    for (let s = 0; s < blen; s++) {
      const prow = (pr / N) | 0, pc = pr % N; let nr = prow, ncl = pc + dir;
      if (s > 0 && rand() < 0.35) { ncl = pc; nr = prow + (rand() < 0.5 ? -1 : 1); }   // 4-connected bend
      if (ncl <= 0 || ncl >= N - 1 || nr < 0 || nr >= N) break;
      const i = ix(nr, ncl); if (g[i]) break; cells.push(i); pr = i;
    }
    if (cells.length >= 3) { cells.forEach(i => set(i, 'water')); branch.push(...cells); }   // commit only a real branch
  }

  // thin side ARMS: branch off the river into a bank to isolate sections (fordable @2 AP; arm↔arm boat-highway @1 AP)
  const armN = 1 + (rand() < 0.5 ? 0 : 1); let armsMade = 0;
  for (let att = 0; att < 14 && armsMade < armN; att++) {
    const br = river[2 + Math.floor(rand() * Math.max(1, river.length - 4))]; let r = (br / N) | 0, cc = br % N;
    const dir = cc < N / 2 ? 1 : -1, len = 4 + Math.floor(rand() * 3), cells: number[] = [];
    for (let s = 0; s < len; s++) { cc += dir; if (cc <= 0 || cc >= N - 1) break; if (rand() < 0.3) r = Math.max(0, Math.min(N - 1, r + (rand() < 0.5 ? -1 : 1))); const i = ix(r, cc); if (g[i]) break; cells.push(i); }
    if (cells.length >= 2) { cells.forEach(mkArm); armsMade++; }   // keep only real-length arms
  }

  // CROSSINGS: only the CENTRE road bridge is defined; foot bridges land on RANDOM river tiles (some cuts get none → boat-only)
  const allRiver = [...river, ...branch];
  const dc = (i: number) => Math.abs(((i / N) | 0) - N / 2) + Math.abs((i % N) - N / 2);
  const ctr = river.slice().sort((a, b) => dc(a) - dc(b))[0];   // road crossing must be on the TRUNK (road gen assumes a vertical cut)
  g[ctr].bridge = 'road'; const bridges = [ctr];
  const cand = allRiver.filter(i => i !== ctr);                    // exactly 2 foot crossings on random river tiles
  for (let k = 0; k < 2 && cand.length; k++) { const i = cand.splice(Math.floor(rand() * cand.length), 1)[0]; g[i].bridge = 'foot'; bridges.push(i); }

  // roads: ONE connected edge-graph — base(left, centre row) → road bridge (+ east stub) + branches; edges explicit (adjacency ≠ connection)
  const baseRow = (bridges[0] / N) | 0, bcol = bridges[0] % N, base = ix(baseRow, 0); set(base, 'road');
  let prev = base;
  for (let c = 1; c < bcol; c++) { const i = ix(baseRow, c); if (g[i] && g[i].terrain === 'water') break; if (!g[i]) set(i, 'road'); link(prev, i); prev = i; }
  link(prev, bridges[0]);                                            // road onto the central bridge (W edge)
  const eastC = bcol + 1; if (eastC < N && !g[ix(baseRow, eastC)]) { set(ix(baseRow, eastC), 'road'); link(bridges[0], ix(baseRow, eastC)); }
  const roadCells = () => { const a: number[] = []; for (let i = 0; i < N * N; i++) if (g[i] && g[i].terrain === 'road') a.push(i); return a; };
  for (let b = 0; b < 3; b++) { const rc = roadCells(); let i = rc[Math.floor(rand() * rc.length)]; for (let s = 0; s < 3; s++) { const opts = nbrs(i).filter(j => !g[j]); if (!opts.length) break; const j = opts[Math.floor(rand() * opts.length)]; set(j, 'road'); link(i, j); i = j; } }

  // flood wild, carve forest + rocky (both passable; rocky only gates river exit, so no connectivity guard needed)
  for (let i = 0; i < N * N; i++) if (!g[i]) set(i, 'wild');
  const carve = (terr: Terrain, p: number, sz: number) => { for (let k = 0; k < p; k++) { let i = Math.floor(rand() * N * N); for (let s = 0; s < sz; s++) { if (g[i].terrain === 'wild') set(i, terr); const ns = nbrs(i).filter(j => g[j].terrain === 'wild'); if (!ns.length) break; i = ns[Math.floor(rand() * ns.length)]; } } };
  carve('forest', 5, 5); carve('rocky', 6, 4);
  for (let i = 0; i < N * N; i++) if (g[i].terrain === 'rocky' && nbrs(i).every(j => g[j].terrain === 'water')) set(i, 'wild');  // no boat-unreachable rocky islands
  placeHotspots(g, base);   // before footpaths so the remote base seeds trails

  // FOOTPATHS: foot bridges link to land banks (boardable); seeds = foot bridges + some road trailheads; trails fizzle out anywhere
  const footBr = bridges.filter(b => g[b].bridge === 'foot');
  for (const fb of footBr) for (const j of nbrs(fb)) if (g[j].terrain !== 'water') linkP(fb, j);
  const roadAll: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'road') roadAll.push(i);
  const seeds = [...footBr]; for (let k = 0; k < 2 && roadAll.length; k++) seeds.push(roadAll[Math.floor(rand() * roadAll.length)]);
  const remote = g.findIndex(t => t && t.hotspot === 'remote'); if (remote >= 0) seeds.push(remote);
  for (const sd of seeds) {
    const o0 = nbrs(sd).filter(j => g[j].terrain === 'wild' || g[j].terrain === 'forest'); if (!o0.length) continue;
    let i = o0[Math.floor(rand() * o0.length)]; linkP(sd, i);
    for (let s = 0; s < 4; s++) { const opts = nbrs(i).filter(j => (g[j].terrain === 'wild' || g[j].terrain === 'forest') && !(g[i].paths & dirBit(i, j))); if (!opts.length) break; const j = opts[Math.floor(rand() * opts.length)]; linkP(i, j); i = j; } }

  return { g, bridges, base };
}

function compRoad(g: Tile[]) {                                       // road components via EXPLICIT edges (not adjacency)
  const cells: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'road' || g[i].bridge === 'road') cells.push(i);
  const set = new Set(cells), seen = new Set<number>(); let c = 0;
  for (const s of cells) { if (seen.has(s)) continue; c++; const st = [s]; seen.add(s); while (st.length) { const x = st.pop()!; for (const y of nbrs(x)) if (set.has(y) && !seen.has(y) && (g[x].roads & dirBit(x, y))) { seen.add(y); st.push(y); } } }
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
  for (const i of reach) { if (g[i].terrain === 'road') roads.push(i); else if (g[i].terrain === 'wild' || g[i].terrain === 'forest') land.push(i); }
  if (roads.length < 2 || land.length < 6) return false;          // base area must have enough forage to play
  const allLand: number[] = []; for (let i = 0; i < N * N; i++) if (g[i].terrain === 'wild' || g[i].terrain === 'forest') allLand.push(i);
  const dist = (a: number, b: number) => Math.abs(((a / N) | 0) - ((b / N) | 0)) + Math.abs((a % N) - (b % N));
  g[base].hotspot = 'base';                                        // main hub — on the road
  g[roads.filter(i => i !== base).sort((a, b) => dist(b, base) - dist(a, base))[0]].hotspot = 'village';   // road-reachable market
  g[allLand.slice().sort((a, b) => dist(b, base) - dist(a, base))[0]].hotspot = 'remote';   // farthest frontier — may be isolated (reach by boat or skip)
  return true;
}
function generateMap(seed: number): { map: Tile[]; start: number } {
  for (let a = 0; a < 96; a++) { const { g, bridges, base } = genOnce(seed + a * 7919); if (!validate(g, bridges)) return { map: g, start: base }; }
  throw new Error('map generation failed validation after 25 tries');   // fail-early
}

function reveal(G: GState, t: number, random: any) {
  const tile = G.map[t]; if (tile.revealed) return;
  tile.revealed = true;
  const pool = G.pools[tile.terrain]; if (!pool) return;
  for (let k = 0; k < tile.richness && pool.length; k++) tile.finds.push(pool.splice(random.Die(pool.length) - 1, 1)[0]);
  G.log.push(`reveal ${t} (${tile.terrain}): ${tile.finds.length}`);
}

const myVehicle = (G: GState, id: string) => G.vehicles.find(v => v.driver === id);
const move: Move<GState> = ({ G, ctx, random }, t: number) => {
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || !nbrs(p.pos).includes(t) || !canMove(G.map, p.pos, t)) return INVALID_MOVE;
  const c = cost(G.map, p.pos, t);
  if (p.ap < c) return INVALID_MOVE;
  const car = myVehicle(G, ctx.currentPlayer); if (car) car.driver = null;   // step out on foot — car stays put
  p.ap -= c; p.pos = t; reveal(G, t, random);
  G.log.push(`P${ctx.currentPlayer} → ${t} (-${c}ap)`);
};
const drive: Move<GState> = ({ G, ctx, random }, dest: number) => {   // car: up to CAR_STEPS road tiles per AP (road edges only)
  const p = G.players[ctx.currentPlayer], car = myVehicle(G, ctx.currentPlayer);
  if (G.epilogue || p.ap < 1 || !car || !roadReach(G.map, car.pos, CAR_STEPS).includes(dest)) return INVALID_MOVE;
  p.ap -= 1; p.pos = dest; car.pos = dest; reveal(G, dest, random);   // player + car travel together
  G.log.push(`drive→${dest}`);
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
const drop: Move<GState> = ({ G, ctx }) => {   // cache a gear level on the current tile (free)
  const p = G.players[ctx.currentPlayer];
  if (G.epilogue || p.gear < 1) return INVALID_MOVE;
  p.gear -= 1; G.map[p.pos].equipment.push({ kind: 'gear' });
  G.log.push(`P${ctx.currentPlayer} drop gear@${p.pos}`);
};
const pickup: Move<GState> = ({ G, ctx }) => {   // reclaim cached gear from the current tile (free, up to GEAR_MAX)
  const p = G.players[ctx.currentPlayer], eq = G.map[p.pos].equipment, idx = eq.findIndex(e => e.kind === 'gear');
  if (G.epilogue || idx < 0 || p.gear >= GEAR_MAX) return INVALID_MOVE;
  eq.splice(idx, 1); p.gear += 1;
  G.log.push(`P${ctx.currentPlayer} pickup gear@${p.pos}`);
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
  const d = tile.finds.splice(find, 1)[0];
  if (roll >= CATALOGUE_DC) { p.samples.push(d); G.log.push(`catalogue ${d.type}${d.color} ${roll} ✓`); }
  else G.log.push(`catalogue ${d.type}${d.color} ${roll} ✗ lost`);
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


// ---- A* (Dijkstra over the weighted move-graph) → first step toward the nearest goal cell ----
function stepToward(G: GState, from: number, goal: (t: Tile) => boolean): number {
  const dist = new Map<number, number>([[from, 0]]), prev = new Map<number, number>();
  const pq: [number, number][] = [[0, from]];
  while (pq.length) {
    let bi = 0; for (let k = 1; k < pq.length; k++) if (pq[k][0] < pq[bi][0]) bi = k;
    const [d, u] = pq.splice(bi, 1)[0];
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u !== from && goal(G.map[u])) { let c = u; while (prev.get(c) !== from) c = prev.get(c)!; return c; }
    for (const v of nbrs(u)) if (canMove(G.map, u, v)) { const nd = d + cost(G.map, u, v); if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); pq.push([nd, v]); } }
  }
  return -1;
}
const forageTarget = (t: Tile) => t.finds.length > 0 || (!t.revealed && t.richness > 0);  // unclaimed token, or unexplored find-bearing terrain
// heuristic policy: publish at a hub; else explore+catalogue at random until carry is full, then A* to the nearest hub
export function botAction(G: GState, ctx: any, rand: () => number) {
  const p = G.players[ctx.currentPlayer], tile = G.map[p.pos], cit = citablePool(G, ctx.currentPlayer);
  if (p.ap >= 1 && (G.epilogue || isHub(tile))) for (const pat of [...PATTERNS].sort((a, b) => b.prestige - a.prestige)) if (assemble(pat.name, p.samples, cit)) return { move: 'publish', args: [pat.name] };
  if (G.epilogue) return { event: 'endTurn' };   // lab: only publishing
  if (p.ap >= 1 && isMarket(tile) && p.gear < GEAR_MAX && p.money >= GEAR_COST) return { move: 'buy', args: [] };  // invest spare money
  if (p.samples.length >= CARRY_SLOTS) {                       // inventory full → A* to nearest hub to publish
    if (!isHub(tile)) {
      const myCar = G.vehicles.find(v => v.driver === ctx.currentPlayer);
      if (myCar && p.ap >= 1) { const hub = roadReach(G.map, myCar.pos, CAR_STEPS).find(c => isHub(G.map[c])); if (hub !== undefined) return { move: 'drive', args: [hub] }; }  // driving: zip to a hub on roads
      else if (!myCar) { const vi = G.vehicles.findIndex(v => v.pos === p.pos && v.driver === null && roadReach(G.map, v.pos, CAR_STEPS).some(c => isHub(G.map[c]))); if (vi >= 0) return { move: 'board', args: [vi] }; }  // a car is here and a hub is drivable → hop in
      const nx = stepToward(G, p.pos, isHub);
      if (nx >= 0) { if (p.ap >= cost(G.map, p.pos, nx)) return { move: 'move', args: [nx] }; }   // hub reachable — walk (or wait for AP next turn)
      else if (p.ap >= 1 && p.pos !== G.base) return { move: 'helilift', args: [] };               // genuinely no hub reachable → fly home
    }
  } else {                                                     // room left → claim a token here, else A* to nearest unexplored/unclaimed
    if (p.ap >= 1 && tile.finds.length) return { move: 'catalogue', args: [0] };
    const nx = stepToward(G, p.pos, forageTarget); if (nx >= 0 && p.ap >= cost(G.map, p.pos, nx)) return { move: 'move', args: [nx] };
    const opts = nbrs(p.pos).filter(t => canMove(G.map, p.pos, t) && p.ap >= cost(G.map, p.pos, t));  // fallback: don't stall
    if (opts.length) return { move: 'move', args: [opts[Math.floor(rand() * opts.length)]] };
  }
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
    nbrs(p.pos).forEach(t => { if (canMove(G.map, p.pos, t) && p.ap >= cost(G.map, p.pos, t)) out.push({ move: 'move', args: [t] }); });
    if (p.ap >= 1 && myCar) roadReach(G.map, myCar.pos, CAR_STEPS).forEach(d => out.push({ move: 'drive', args: [d] }));
    G.vehicles.forEach((v, i) => { if (v.pos === p.pos && v.driver === null) out.push({ move: 'board', args: [i] }); });
    if (myCar) out.push({ move: 'leave', args: [] });
    if (p.ap >= 1 && p.samples.length < CARRY_SLOTS) tile.finds.forEach((_, i) => out.push({ move: 'catalogue', args: [i] }));
    if (p.ap >= 1 && isMarket(tile) && p.gear < GEAR_MAX && p.money >= GEAR_COST) out.push({ move: 'buy', args: [] });
    if (p.gear >= 1) out.push({ move: 'drop', args: [] });
    if (tile.equipment.some(e => e.kind === 'gear') && p.gear < GEAR_MAX) out.push({ move: 'pickup', args: [] });
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
  else if (id === 'rockslide') {                                      // mutate a wild/forest tile → rocky (loses its finds)
    const land = G.map.map((t, i) => ({ t, i })).filter(({ t }) => (t.terrain === 'wild' || t.terrain === 'forest') && !t.hotspot);
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
    const { map, start } = generateMap(seed);
    map[start].revealed = true;
    return {
      players: Object.fromEntries(Array.from({ length: ctx.numPlayers }, (_, i) =>
        [String(i), { ap: START_AP, pos: start, money: 0, samples: [], published: [], prestige: 0, gear: 0 }])),
      map, cols: N, rows: N, base: start,
      vehicles: [{ pos: start, driver: null }],   // one shared car parked at base
      pools: { road: buildPool('road'), wild: buildPool('wild'), forest: buildPool('forest') },
      events: buildDeck(seed), monsoon: 0, epilogue: false, labLeft: 0, log: ['setup'],
    };
  },
  moves: { move, catalogue, publish, buy, drive, helilift, board, leave, drop, pickup },
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
