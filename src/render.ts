// Shared board rendering + small UI helpers, used by BOTH frontends (the lean
// Canvas viewer in main.ts and the bgio React board). Drawing the car and
// dropped equipment lives here once so the two stay in visual sync.
import type { GState, Tile, Discovery, Pattern, GearItem, PlayerS, Vehicle } from './game';
import { targetAP, evalGoal, GEAR_PRICE, catDC } from './game';

export type Action = { move?: string; args?: unknown[]; event?: string };

// ---- toasts: classify fresh G.log lines into transient success/fail/info notices ----
export interface Toast { text: string; kind: 'good' | 'bad' | 'info'; }
const EVENT_TEXT: Record<string, string> = {
  tailwind: 'Tailwind · +1 AP', cache: 'Cache · +2$', grant: 'Grant · +3$', calm: 'Calm',
  rockslide: 'Rockslide!', washout: 'Washout · bridge severed', monsoon: 'Monsoon brewing',
};
export function classifyLog(line: string): Toast | null {
  const mv = line.match(/→ \d+ \(-(\d+)ap/);   // foot/boat move: toast the AP it cost
  if (mv) return { text: `${line.includes('🛶') ? 'Canoe' : 'Move'} · −${mv[1]} AP`, kind: 'info' };
  if (line.startsWith('catalogue ')) {
    const p = line.split(' '), tag = p[1], res = p[p.length - 1];
    if (res === 'collected') return { text: `Catalogued ${prettyTag(tag)} · −1 AP`, kind: 'good' };
    if (res === 'stayed') return { text: `${prettyTag(tag)} stayed · −1 AP`, kind: 'info' };
    if (res === 'fled') return { text: `${prettyTag(tag)} fled · −1 AP`, kind: 'bad' };
    if (res === 'destroyed') return { text: `${prettyTag(tag)} destroyed · −1 AP`, kind: 'bad' };
    return null;
  }
  if (line.startsWith('publish ')) { const m = line.match(/(\+\d+P)/); return { text: `Published${m ? ` ${m[1]}` : ''} · −1 AP`, kind: 'good' }; }
  if (line.startsWith('buy gear')) return { text: 'Bought gear', kind: 'info' };
  if (line.startsWith('drive')) return { text: 'Drove · −1 AP', kind: 'info' };
  if (line.startsWith('helilift')) return { text: 'Helilift → base · −1 AP', kind: 'info' };
  if (line.startsWith('event:')) { const id = line.slice(6).split(' ')[0]; const bad = id === 'rockslide' || id === 'washout' || id === 'monsoon'; return { text: EVENT_TEXT[id] ?? id, kind: bad ? 'bad' : 'info' }; }
  return null;
}
export function logToasts(fromIdx: number, log: string[]): Toast[] {
  const out: Toast[] = [];
  for (let i = Math.max(0, fromIdx); i < log.length; i++) { const t = classifyLog(log[i]); if (t) out.push(t); }
  return out;
}

export let CELL = 46;              // CSS px per tile — recomputed responsively in fitCanvas()
export const MIN_CELL = 16;        // floor so the board stays usable on tiny viewports
export const PLAYER_COLOR = ['#ffd24a', '#4ad2ff', '#ff7a4a', '#b07aff'];
const PAWN_DIAG = [[-1, -1], [1, -1], [-1, 1], [1, 1]];   // per-player off-centre diagonal: P0 TL · P1 TR · P2 BL · P3 BR
const hash01 = (i: number, k: number) => { let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(k + 1, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h >>> 8) & 0xffff) / 0xffff; };   // deterministic per-tile jitter
export const DTYPE_COLOR: Record<Discovery['type'], string> = { geo: '#ffc844', zoo: '#ff6f5c', bot: '#57e466', arch: '#bb9cff' };   // brighter, stronger discovery colours
export const DTYPE_SYMBOL: Record<Discovery['type'], string> = { geo: '💎', zoo: '🐾', bot: '🌿', arch: '🏺' };   // type icon — used everywhere instead of the geo/zoo/bot/arch words
const isDType = (s: string): s is Discovery['type'] => s === 'geo' || s === 'zoo' || s === 'bot' || s === 'arch';
export const prettyFind = (d: Discovery) => `${DTYPE_SYMBOL[d.type]}${d.color}`;                     // e.g. 💎3
const prettyTag = (tag: string) => { const m = tag.match(/^([a-z]+)(\d+)$/); return m && isDType(m[1]) ? DTYPE_SYMBOL[m[1]] + m[2] : tag; };   // "geo3" → "💎3"
export const prettyLog = (line: string) => line.replace(/\b(geo|zoo|bot|arch)(\d)/g, (_m, t, c) => DTYPE_SYMBOL[t as Discovery['type']] + c);   // swap type words for icons in a log line
const COL_SQUARE = ['🟥', '🟩', '🟨', '🟪'];   // the 4 discovery colours as squares (red green gold violet)
// compact iconic project label: e.g. "3 💎", "2 💎 + 2 🐾", "5 🟥" (no "of a kind" prose)
export const goalLabel = (g: Pattern) => g.parts.map(p => `${p.count} ${p.type ? DTYPE_SYMBOL[p.type] : ''}${p.color !== undefined ? COL_SQUARE[p.color] : ''}`).join(' + ');

const TERRAIN_FILL: Record<Tile['terrain'], string> = {
  grassland: '#6f7a30', jungle: '#1f5247', rocky: '#5e5e68', ruins: '#6e603a', water: '#244a5c', void: '#0b0f0a',  // grass yellow-green · forest teal-green · rock silver-grey · ruins beige-gold · water swampy blue
};
// grayish biome tint for the potential-discovery dots (the token pool is biome-specific, so the dots hint at the biome)
function grayishBiome(hex: string): string {
  const n = parseInt(hex.slice(1), 16), mix = (c: number) => Math.round(c * 0.42 + 168 * 0.58);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}
const GRAY_BIOME = Object.fromEntries(
  (Object.keys(TERRAIN_FILL) as Tile['terrain'][]).map(t => [t, grayishBiome(TERRAIN_FILL[t])]),
) as Record<Tile['terrain'], string>;
const BROOK_LINE = '#4aa3d2';      // brook (boat-only) edge
const RIVER_LINE = '#8fd0ef';      // river channel linkage (between water tiles) — banks are the unlinked edges
const CLIFF_LINE = '#000000';      // impassable cliff edge — bold black bar along the full edge
const CLIFF_FILL = 'rgba(20,18,16,0.5)';   // cliff band — covers ~1/3 of the affected tile side (matches printed tiles)
const EQUIP_COLOR = '#cfd6c8';
const HOTSPOT_LABEL: Record<NonNullable<Tile['hotspot']>, string> = { base: '🔬', remote: '⛺', village: '🏘️', riverVillage: '🏠' };   // lab · frontier · village (market) · little river house
const BIOME_ICON: Partial<Record<Tile['terrain'], string>> = { grassland: '🌾', jungle: '🌴', rocky: '🪨', ruins: '🏛️', water: '🌊' };   // small per-tile biome marker (corner)
// discovery BACK-SIDE / pool colour — a brighter tint of the biome's tile colour (so the back reads as "from this biome")
const BIOME_POOL: Partial<Record<Tile['terrain'], string>> = { grassland: '#b2c43f', jungle: '#2e8f74', rocky: '#b6b6c2', ruins: '#cbb46a', water: '#3f7593' };  // brighter biome tints (grass yellow-green · forest greenish-teal · rock silver · ruins beige-gold · water swampy blue)

export const dpr = () => Math.max(1, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));

// the active (non-void) bounding box — the canvas is cropped to this so the void margins
// around the blob aren't drawn as empty space above/below/beside the board
export function activeBounds(G: GState) {
  let minR = G.rows, maxR = -1, minC = G.cols, maxC = -1;
  for (let i = 0; i < G.map.length; i++) {
    if (G.map[i].terrain === 'void') continue;
    const r = (i / G.cols) | 0, c = i % G.cols;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (c < minC) minC = c; if (c > maxC) maxC = c;
  }
  if (maxR < 0) { minR = 0; maxR = G.rows - 1; minC = 0; maxC = G.cols - 1; }   // all-void fallback (shouldn't happen)
  return { minR, minC, rows: maxR - minR + 1, cols: maxC - minC + 1 };
}

export function fitCanvas(canvas: HTMLCanvasElement, G: GState): CanvasRenderingContext2D {
  // size a square tile to fill the board's container width and the remaining viewport height
  const b = activeBounds(G);
  const wrap = canvas.parentElement;
  const availW = (wrap ? wrap.clientWidth : window.innerWidth) || window.innerWidth;
  const top = canvas.getBoundingClientRect().top;          // stable: set by the chrome above, not by the canvas's own height
  const availH = window.innerHeight - top - 132;           // reserve more below the board (legend + controls + footer link) so it never forces a vertical scroll
  CELL = Math.max(MIN_CELL, Math.floor(Math.min(availW / b.cols, availH / b.rows)));
  const d = dpr();
  canvas.style.width = `${b.cols * CELL}px`;
  canvas.style.height = `${b.rows * CELL}px`;
  canvas.width = b.cols * CELL * d;
  canvas.height = b.rows * CELL * d;
  const cctx = canvas.getContext('2d')!;
  cctx.setTransform(d, 0, 0, d, -b.minC * CELL * d, -b.minR * CELL * d);   // shift so the bounding box's top-left is the canvas origin
  return cctx;
}

export const tileAt = (px: number, py: number, G: GState): number => {
  const b = activeBounds(G);
  const c = Math.floor(px / CELL) + b.minC, r = Math.floor(py / CELL) + b.minR;   // CSS px are relative to the cropped (bbox) top-left
  if (c < 0 || r < 0 || c >= G.cols || r >= G.rows) return -1;
  return r * G.cols + c;
};

// tile index -> the CHEAPEST spatial action (move/drive) that lands there (e.g. a 0.3-AP car hop beats a 1-AP foot step)
export function spatialTargets(actions: Action[], G: GState, pid: string): Map<number, Action> {
  const best = new Map<number, { a: Action; ap: number }>();
  for (const a of actions) {
    if (a.move !== 'move' && a.move !== 'drive' && a.move !== 'boatRun') continue;
    const t = a.args![0] as number, ap = targetAP(G, pid, a);
    const cur = best.get(t);
    if (!cur || ap < cur.ap) best.set(t, { a, ap });   // lower AP cost takes precedence
  }
  const m = new Map<number, Action>();
  for (const [t, v] of best) m.set(t, v.a);
  return m;
}

// label for a non-spatial action button (move/drive are board clicks -> null)
export function actionLabel(a: Action, tile: Tile, goals?: Pattern[], p?: PlayerS, car?: Vehicle): string | null {
  if (a.move === 'catalogue') { const d = tile.finds[a.args![0] as number]; return d ? `Catalogue ${prettyFind(d)} (DC ${catDC(d.color)})` : null; }
  if (a.move === 'publish') { const g = goals?.find(x => x.id === a.args![0]); return g ? `Publish ${goalLabel(g)} (+${g.prestige}P)` : 'Publish'; }
  if (a.move === 'buy') { const k = a.args![0] as string, f = a.args![1] as Discovery['type'] | undefined;
    if (k === 'boat') return 'Buy boat (−5$)'; if (k === 'car') return 'Buy car (−8$)';
    return k === 'field' ? `Buy 🧪${DTYPE_SYMBOL[f!]} (−${GEAR_PRICE.field}$)` : `Buy ${GEAR_GLYPH[k]}+${k[1]} (−${GEAR_PRICE[k as GearItem['kind']]}$)`; }
  if (a.move === 'board') return 'Board';
  if (a.move === 'leave') return 'Leave';
  if (a.move === 'drop') { const s = a.args![0]; return s === 'boat' ? 'Drop boat' : `Drop ${p ? gearIcon(p.gear[s as number]) : 'gear'}`; }
  if (a.move === 'pickup') { const s = a.args![0]; const e = typeof s === 'number' ? tile.equipment[s] : undefined;
    return !e || e.kind === 'boat' ? 'Pick up boat' : `Pick up ${gearIcon(e.gear!)}`; }
  if (a.move === 'stash') { const s = a.args![0]; return s === 'boat' ? 'Stash boat → trunk' : `Stash ${p ? gearIcon(p.gear[s as number]) : 'gear'} → trunk`; }
  if (a.move === 'unstash') { const e = car?.trunk[a.args![0] as number]; return e ? `Take ${e.kind === 'boat' ? 'boat' : gearIcon(e.gear!)} ← trunk` : 'Take ← trunk'; }
  if (a.move === 'helilift') return 'Helilift → base (−12$)';
  if (a.move === 'reclaim') { const d = tile.cache[a.args![0] as number]; return d ? `Take ${prettyFind(d)}` : null; }
  if (a.move === 'discard') return null;   // dropping is done by clicking your own hand chip
  if (a.event === 'endTurn') return 'End turn';
  return null;
}

export function describeTile(G: GState, i: number): string {
  const t = G.map[i];
  const bits = [`#${i}`, t.bridge ? `${t.bridge} bridge` : t.terrain];
  if (t.roads) bits.push('road');
  if (t.hotspot) bits.push(t.hotspot);
  if (t.smallRivers) bits.push('brook');
  if (t.blocked) bits.push('cliff edge');
  const research = t.hotspot === 'base' || t.hotspot === 'remote';
  const cars = G.vehicles.filter(v => v.pos === i);
  for (const car of cars) { const tr = car.trunk.length ? ` +trunk[${car.trunk.map(e => e.kind === 'boat' ? '🛶' : gearIcon(e.gear!)).join('')}]` : ''; bits.push((car.driver !== null ? `${car.kind} (P${car.driver})` : `${car.kind} (empty)`) + tr); }
  const items = t.equipment.map(e => e.kind === 'boat' ? '🛶' : gearIcon(e.gear!));
  if (items.length) bits.push('items: ' + items.join(' '));
  if (t.revealed && t.finds.length) bits.push('finds: ' + t.finds.map(prettyFind).join(' '));
  if (t.cache.length) bits.push((research ? 'open pool: ' : 'dropped: ') + t.cache.map(prettyFind).join(' '));
  else if (research) bits.push('open pool: (empty)');
  return bits.join(' · ');
}

export function sampleChips(ds: Discovery[]): string {
  if (!ds.length) return '<span style="opacity:.5">none</span>';
  return ds.map(d => `<span class="chip" style="color:${DTYPE_COLOR[d.type]}">${prettyFind(d)}</span>`).join('');
}
// gear kit icons (public — opponents see your gear). lab-bench symbols by tier; 🧪 + discipline = field kit
export const GEAR_GLYPH: Record<string, string> = { g1: '🔍', g2: '🔬', g3: '⚗️' };   // lens / microscope / lab still (+1 / +2 / +3)
export const gearIcon = (g: GearItem) => g.kind === 'field' ? `🧪${DTYPE_SYMBOL[g.field!]}` : GEAR_GLYPH[g.kind];
export function gearChips(gear: GearItem[]): string {
  return gear.map(g => `<span class="chip gear" title="${g.kind === 'field' ? `${g.field} field kit` : `+${g.kind[1]} to every catalogue`}">${gearIcon(g)}</span>`).join('');
}
export const emptySlots = (n: number) => '<span class="slot empty"></span>'.repeat(Math.max(0, n));
// your own hand, but each chip is clickable to DROP it (leaves it face-up on your tile)
export function handChips(ds: Discovery[]): string {
  if (!ds.length) return '<span style="opacity:.5">none</span>';
  return ds.map((d, i) => `<span class="chip clk" data-discard="${i}" title="drop — leaves it here, face-up for anyone" style="color:${DTYPE_COLOR[d.type]};cursor:pointer">${prettyFind(d)}</span>`).join('');
}
// opponents see only the DISCIPLINE of your specimens, not the colour (a concealed poker hand)
export function maskedChips(ds: Discovery[]): string {
  if (!ds.length) return '<span style="opacity:.5">none</span>';
  return ds.map(d => `<span class="chip" style="color:#8aa0b4">${DTYPE_SYMBOL[d.type]}<span style="opacity:.5">?</span></span>`).join('');
}

// ---- publish planner: the shared pool of open research projects + how close the current player is ----
// Each project pins concrete values; discipline = icon, colour = swatch (both for both-axes projects). evalGoal() (in game.ts) is the single source of truth.
export const DCOLOR = ['#e0563a', '#36a85a', '#e0c23a', '#a86ae0'];   // the 4 discovery colours (swatches in the planner / chips)
export interface PatternCell { state: 'have' | 'cite' | 'need'; icon?: string; swatch?: string; }   // have = carried · cite = fillable from others' published · need = missing
export interface PatternPreview { name: string; label: string; reward: string; cells: PatternCell[]; ready: boolean; threat: 'imminent' | 'building' | 'hidden' | 'none'; }

export function publishPreviews(G: GState, pid: string): PatternPreview[] {
  const owned = G.players[pid].samples;   // your full concealed hand (inventory is unlimited)
  const citable: Discovery[] = [];
  for (const id in G.players) if (id !== pid) citable.push(...G.players[id].published);

  const opps = Object.keys(G.players).filter(id => id !== pid);
  return G.goals.map((goal: Pattern) => {
    const r = evalGoal(goal, owned, citable);
    const cells: PatternCell[] = r.slots.map(s => ({
      state: s.state,
      icon: s.type !== undefined ? DTYPE_SYMBOL[s.type] : undefined,
      swatch: s.color !== undefined ? DCOLOR[s.color] : undefined,
    }));
    // contention read — fair: only uses PUBLIC info. Discipline-only goals are readable from rivals' visible disciplines; any colour pin is unreadable (a blind snipe).
    const need = goal.parts.reduce((s, p) => s + p.count, 0);
    const discOnly = goal.parts.every(p => p.color === undefined);
    let threat: PatternPreview['threat'] = discOnly ? 'none' : 'hidden';
    if (discOnly) for (const oid of opps) {
      const er = evalGoal(goal, G.players[oid].samples, []);   // colour irrelevant here, so this is exact & fair
      if (er.ok) { threat = 'imminent'; break; }
      if (er.slots.filter(s => s.state === 'have').length >= Math.ceil(need * 0.6)) threat = 'building';
    }
    return { name: goal.id, label: goalLabel(goal), reward: `+${goal.prestige}P +${goal.money}$`, cells, ready: r.ok, threat };
  });
}

function edge(cctx: CanvasRenderingContext2D, a: number, b: number, G: GState, color: string, width: number, dash: number[]) {
  const ca = a % G.cols, ra = (a / G.cols) | 0, cb = b % G.cols, rb = (b / G.cols) | 0;
  cctx.strokeStyle = color; cctx.lineWidth = width; cctx.setLineDash(dash);
  cctx.beginPath();
  cctx.moveTo(ca * CELL + CELL / 2, ra * CELL + CELL / 2);
  cctx.lineTo(cb * CELL + CELL / 2, rb * CELL + CELL / 2);
  cctx.stroke(); cctx.setLineDash([]);
}

// bold black bar along the FULL shared border between a & b = impassable cliff edge
// cliff: a band covering ~1/3 of tile `a` on the affected side (toward `b` = a+1 East or a+cols South), with a crisp black edge line
function borderBar(cctx: CanvasRenderingContext2D, a: number, b: number, G: GState) {
  const x = (a % G.cols) * CELL, y = ((a / G.cols) | 0) * CELL, third = CELL * 0.34, east = b === a + 1;
  cctx.fillStyle = CLIFF_FILL;
  if (east) cctx.fillRect(x + CELL - third, y, third, CELL); else cctx.fillRect(x, y + CELL - third, CELL, third);
  cctx.strokeStyle = CLIFF_LINE; cctx.lineWidth = Math.max(3, CELL * 0.1); cctx.setLineDash([]); cctx.lineCap = 'butt';
  cctx.beginPath();
  if (east) { cctx.moveTo(x + CELL, y); cctx.lineTo(x + CELL, y + CELL); } else { cctx.moveTo(x, y + CELL); cctx.lineTo(x + CELL, y + CELL); }
  cctx.stroke();
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
function carGlyph(cctx: CanvasRenderingContext2D, x: number, y: number, driver: string | null, glyph = '🚗') {
  const fs = CELL * 0.36, cy = y + CELL * 0.82;          // hugging the bottom edge of the tile (clear of the centre discovery/pawn)
  cctx.fillStyle = 'rgba(11,15,10,0.32)'; cctx.beginPath(); cctx.arc(x + CELL / 2, cy, fs * 0.62, 0, 7); cctx.fill();   // contrast disc so the boat/car reads on top of water + river links
  cctx.font = `${fs}px ${EMOJI_FONT}`; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  cctx.globalAlpha = driver ? 1 : 0.82;                 // empty vehicle only slightly dimmer (still clearly visible)
  cctx.fillText(glyph, x + CELL / 2, cy);
  cctx.globalAlpha = 1;
  if (driver) { cctx.fillStyle = driver; cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1; cctx.beginPath(); cctx.arc(x + CELL / 2 + fs * 0.5, cy - fs * 0.3, 2.6, 0, 7); cctx.fill(); cctx.stroke(); }
}

export function drawBoard(cctx: CanvasRenderingContext2D, G: GState, ctxState: any, opts: { hover?: number; targets?: Map<number, Action> } = {}) {
  const { hover = -1, targets } = opts;
  const positions = new Map<number, string[]>();
  for (const [id, p] of Object.entries(G.players)) {
    const arr = positions.get(p.pos) ?? []; arr.push(id); positions.set(p.pos, arr);
  }
  cctx.clearRect(0, 0, G.cols * CELL, G.rows * CELL);

  // 1) tiles + fog
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL;
    if (t.terrain === 'void') continue;   // off-board cell → leave as background for a ragged edge
    cctx.fillStyle = TERRAIN_FILL[t.terrain];   // bridges are water tiles — their road/trail link is drawn on top (section 2)
    cctx.fillRect(x, y, CELL, CELL);
    if (!t.bridge && (t.terrain === 'jungle' || t.terrain === 'rocky' || t.terrain === 'ruins')) {   // global move-cost: 2-AP bushwhack tiles read darker than 1-AP grassland/road/water
      cctx.fillStyle = 'rgba(0,0,0,0.17)'; cctx.fillRect(x, y, CELL, CELL);
    }
    cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1; cctx.setLineDash([]);
    cctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  }

  // 2) movement graph: solid roads, dashed footpaths, dashed-blue brooks (boat); red bars = impassable cliffs (E + S edges, once)
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0;
    if (c < G.cols - 1) {
      if (t.rivers & 2) edge(cctx, i, i + 1, G, RIVER_LINE, 3, []);   // river channel (under road/path lines)
      if (t.roads & 2) edge(cctx, i, i + 1, G, '#9a8757', 3, []); else if (t.paths & 2) edge(cctx, i, i + 1, G, '#84a684', 1.5, [3, 3]);
      if (t.smallRivers & 2) edge(cctx, i, i + 1, G, BROOK_LINE, 2, [2, 2]);
      if (t.blocked & 2) borderBar(cctx, i, i + 1, G);
    }
    if (r < G.rows - 1) {
      if (t.rivers & 4) edge(cctx, i, i + G.cols, G, RIVER_LINE, 3, []);
      if (t.roads & 4) edge(cctx, i, i + G.cols, G, '#9a8757', 3, []); else if (t.paths & 4) edge(cctx, i, i + G.cols, G, '#84a684', 1.5, [3, 3]);
      if (t.smallRivers & 4) edge(cctx, i, i + G.cols, G, BROOK_LINE, 2, [2, 2]);
      if (t.blocked & 4) borderBar(cctx, i, i + G.cols, G);
    }
  }

  // 3) hotspots, discovery slots (find dots), dropped equipment
  cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL;
    if (t.hotspot) {
      cctx.fillStyle = 'rgba(11,15,10,0.72)'; cctx.beginPath(); cctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.31, 0, 7); cctx.fill();   // dark token disc frames the icon for contrast on any terrain
      cctx.font = `${CELL * 0.36}px ${EMOJI_FONT}`; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
      cctx.fillText(HOTSPOT_LABEL[t.hotspot], x + CELL / 2, y + CELL / 2 + 1);
    }
    if (t.terrain === 'void') continue;
    const bi = BIOME_ICON[t.terrain];   // 3 biome markers scattered (deterministically jittered) across the tile as texture
    if (bi && CELL >= 16) {
      const water = t.terrain === 'water';
      cctx.textAlign = 'center'; cctx.textBaseline = 'middle'; cctx.globalAlpha = 0.8;
      cctx.font = water ? `bold ${CELL * 0.26}px ui-monospace, monospace` : `${CELL * 0.2}px ${EMOJI_FONT}`;
      if (water) cctx.fillStyle = '#7fc4e8';
      for (let k = 0; k < 3; k++) cctx.fillText(water ? '≈' : bi, x + CELL * (0.22 + hash01(i, k * 2) * 0.56), y + CELL * (0.22 + hash01(i, k * 2 + 1) * 0.56));
      cctx.globalAlpha = 1;
    }
    // 8 perimeter slots (4 corners + 4 edge midpoints): discovery dots first, then cached gear/boat
    const d = Math.max(6, CELL * 0.17), m = CELL / 2, rr = Math.max(2.5, CELL * 0.075);
    const corners = [[x + d, y + d], [x + CELL - d, y + d], [x + d, y + CELL - d], [x + CELL - d, y + CELL - d]];   // dropped discoveries / pool cards
    const edges = [[x + m, y + d], [x + CELL - d, y + m], [x + d, y + m]];   // edge centres (top, right, left) — dropped gear/boat (bottom-centre left for the car)
    const rrBig = Math.max(4, CELL * 0.13);
    const cx0 = x + m, cy0 = y + m;
    if (t.revealed && t.finds.length) {   // FLIPPED face-up on entry: the real discovery — type colour, rimmed in its discovery colour, with the type icon
      const f = t.finds[0];
      cctx.beginPath(); cctx.arc(cx0, cy0, CELL * 0.26, 0, 7);
      cctx.fillStyle = DTYPE_COLOR[f.type]; cctx.fill();
      cctx.lineWidth = Math.max(2, CELL * 0.07); cctx.strokeStyle = DCOLOR[f.color]; cctx.stroke();   // colour-axis rim
      if (CELL >= 20) { cctx.font = `${CELL * 0.3}px ${EMOJI_FONT}`; cctx.fillText(DTYPE_SYMBOL[f.type], cx0, cy0 + 0.5); }
    } else if (!t.revealed && t.richness > 0 && !t.roads && !t.hotspot) {   // BACK-SIDE: an un-entered discovery — only where a find can actually appear (not roads/special locations)
      cctx.beginPath(); cctx.arc(cx0, cy0, CELL * 0.24, 0, 7);
      cctx.fillStyle = BIOME_POOL[t.terrain] ?? GRAY_BIOME[t.terrain]; cctx.fill();
      cctx.lineWidth = 1.25; cctx.strokeStyle = 'rgba(0,0,0,0.5)'; cctx.stroke();
    }
    t.cache.forEach((dc, k) => {   // DROPPED discoveries / research-pool cards: corners, white-ringed
      if (k >= 4) return;
      const sx = corners[k][0], sy = corners[k][1];
      cctx.fillStyle = DTYPE_COLOR[dc.type];
      cctx.beginPath(); cctx.arc(sx, sy, rrBig, 0, 7); cctx.fill();
      cctx.lineWidth = 1.5; cctx.strokeStyle = '#e8f0e2'; cctx.stroke();
      if (CELL >= 22) { cctx.font = `${rrBig * 1.7}px ${EMOJI_FONT}`; cctx.fillText(DTYPE_SYMBOL[dc.type], sx, sy + 0.5); }
    });
    t.equipment.forEach((e, k) => {   // DROPPED gear / boat on the edge centres
      if (k >= edges.length) return;
      const sx = edges[k][0], sy = edges[k][1];
      if (e.kind === 'boat') { cctx.font = `${CELL * 0.34}px ${EMOJI_FONT}`; cctx.fillText('🛶', sx, sy); }
      else { const sq = rr * 1.9; cctx.fillStyle = EQUIP_COLOR; cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1; cctx.fillRect(sx - sq / 2, sy - sq / 2, sq, sq); cctx.strokeRect(sx - sq / 2, sy - sq / 2, sq, sq); }
    });
  }

  // 4) vehicles (drawn UNDER the players, section 7). Boarded → tucked just below the driver's pawn; parked & co-located → side by side along the bottom edge
  const vByPos = new Map<number, typeof G.vehicles>();
  for (const v of G.vehicles) { const a = vByPos.get(v.pos) ?? []; a.push(v); vByPos.set(v.pos, a); }
  for (const [pos, vs] of vByPos) {
    const c = pos % G.cols, r = (pos / G.cols) | 0;
    const parked = vs.filter(v => v.driver === null);
    vs.forEach(v => {
      const glyph = v.kind === 'motorboat' ? '🛥️' : '🚗';
      if (v.driver !== null) {   // ride it just below the driver's pawn
        const dg = PAWN_DIAG[+v.driver % 4];
        const px = c * CELL + CELL / 2 + dg[0] * CELL * 0.24, py = r * CELL + CELL / 2 + dg[1] * CELL * 0.24 + CELL * 0.2;
        carGlyph(cctx, px - CELL / 2, py - CELL * 0.82, PLAYER_COLOR[+v.driver % 4], glyph);
      } else {   // parked & idle → sit on the bottom tile border, side by side
        const k = parked.indexOf(v), ox = parked.length > 1 ? (k - (parked.length - 1) / 2) * CELL * 0.3 : 0;
        carGlyph(cctx, c * CELL + ox, r * CELL + CELL * 0.06, null, glyph);
      }
    });
  }

  // 5) legal-target rings (solid = walk, dashed = drive) + AP cost label (fractional for the car)
  if (targets) {
    cctx.textBaseline = 'top';
    cctx.font = `bold ${Math.max(9, CELL * 0.28)}px ui-monospace, monospace`;
    for (const [t, a] of targets) {
      const c = t % G.cols, r = (t / G.cols) | 0, x = c * CELL, y = r * CELL;
      cctx.strokeStyle = '#ffd24a'; cctx.lineWidth = 1.25;
      cctx.setLineDash(a.move === 'move' ? [] : [4, 3]);   // dashed = vehicle hop (drive / boat-run)
      cctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);   // thin ring hugging the tile edge → leaves the inner markers visible
      cctx.setLineDash([]);
      const ap = targetAP(G, ctxState.currentPlayer, a);
      const label = Number.isInteger(ap) ? String(ap) : ap.toFixed(1);   // car costs are fractional (1 AP ÷ CAR_STEPS/tile)
      cctx.fillStyle = 'rgba(0,0,0,0.8)'; cctx.fillText(label, x + CELL / 2 + 1, y + 4);
      cctx.fillStyle = '#ffe27a'; cctx.fillText(label, x + CELL / 2, y + 3);
    }
    cctx.textBaseline = 'middle';
  }

  // 6) hover
  if (hover >= 0) {
    const c = hover % G.cols, r = (hover / G.cols) | 0;
    cctx.strokeStyle = '#e8f0e2'; cctx.lineWidth = 1.5;
    cctx.strokeRect(c * CELL + 1.5, r * CELL + 1.5, CELL - 3, CELL - 3);
  }

  // 7) players — off-centre on a per-player diagonal (midway corner↔centre), clear of the centre discovery; drawn ON TOP of a boarded vehicle
  for (const [tile, ids] of positions) {
    const c = tile % G.cols, r = (tile / G.cols) | 0;
    ids.forEach((id) => {
      const dg = PAWN_DIAG[+id % 4];
      const cx = c * CELL + CELL / 2 + dg[0] * CELL * 0.24, cy = r * CELL + CELL / 2 + dg[1] * CELL * 0.24;
      cctx.beginPath(); cctx.arc(cx, cy, CELL * 0.15, 0, 7);   // smaller pawn → the biome discovery circle shows around it
      cctx.fillStyle = PLAYER_COLOR[+id % 4]; cctx.fill();
      cctx.lineWidth = id === ctxState.currentPlayer ? 2.5 : 1.25;
      cctx.strokeStyle = id === ctxState.currentPlayer ? '#ffffff' : '#0b0f0a'; cctx.stroke();
      cctx.fillStyle = '#0b0f0a'; cctx.font = `bold ${CELL * 0.17}px ui-monospace, monospace`;
      cctx.fillText(id, cx, cy + 1);
    });
  }
}
