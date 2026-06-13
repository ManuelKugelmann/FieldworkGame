// Shared board rendering + small UI helpers, used by BOTH frontends (the lean
// Canvas viewer in main.ts and the bgio React board). Drawing the car and
// dropped equipment lives here once so the two stay in visual sync.
import type { GState, Tile, Discovery } from './game';
import { targetAP } from './game';

export type Action = { move?: string; args?: unknown[]; event?: string };

// ---- toasts: classify fresh G.log lines into transient success/fail/info notices ----
export interface Toast { text: string; kind: 'good' | 'bad' | 'info'; }
const EVENT_TEXT: Record<string, string> = {
  tailwind: 'Tailwind · +1 AP', cache: 'Cache · +2$', grant: 'Grant · +3$', calm: 'Calm',
  rockslide: 'Rockslide!', washout: 'Washout · bridge severed', monsoon: 'Monsoon brewing',
};
export function classifyLog(line: string): Toast | null {
  const mv = line.match(/→ \d+ \(-(\d+)ap/);   // foot/boat move: toast the AP it cost
  if (mv) return { text: `${line.includes('⛵') ? 'Boat' : 'Move'} · −${mv[1]} AP`, kind: 'info' };
  if (line.startsWith('catalogue ')) {
    const p = line.split(' '), tag = p[1], res = p[p.length - 1];
    if (res === 'collected') return { text: `Catalogued ${tag} · −1 AP`, kind: 'good' };
    if (res === 'stayed') return { text: `${tag} stayed · −1 AP`, kind: 'info' };
    if (res === 'fled') return { text: `${tag} fled · −1 AP`, kind: 'bad' };
    if (res === 'destroyed') return { text: `${tag} destroyed · −1 AP`, kind: 'bad' };
    return null;
  }
  if (line.startsWith('publish ')) { const m = line.match(/publish (\w+).*?(\+\d+P)/); return { text: (m ? `Published ${m[1]} ${m[2]}` : 'Published') + ' · −1 AP', kind: 'good' }; }
  if (line.startsWith('buy gear')) return { text: 'Bought gear · −1 AP', kind: 'info' };
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
export const DTYPE_COLOR: Record<Discovery['type'], string> = { geo: '#d8b15a', zoo: '#e07a6a', bot: '#7ad07a', arch: '#9a8ad0' };

const TERRAIN_FILL: Record<Tile['terrain'], string> = {
  grassland: '#5d6e3a', jungle: '#2c4a20', rocky: '#565659', water: '#1d4c79', void: '#0b0f0a',
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
const EQUIP_COLOR = '#cfd6c8';
const HOTSPOT_LABEL: Record<NonNullable<Tile['hotspot']>, string> = { base: 'H', village: 'M', remote: 'R', remoteVillage: 'V', commStation: 'C' };

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
  const availH = window.innerHeight - top - 104;           // leave room for the legend + bottom padding so the board doesn't force a vertical scroll
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
export function actionLabel(a: Action, tile: Tile): string | null {
  if (a.move === 'catalogue') { const d = tile.finds[a.args![0] as number]; return d ? `Catalogue ${d.type}${d.color}` : null; }
  if (a.move === 'publish') return a.args![0] === 'rainbow' ? 'Publish rainbow (+7P)' : 'Publish triple (+4P)';
  if (a.move === 'buy') return 'Buy gear (−5$)';
  if (a.move === 'board') return 'Board car';
  if (a.move === 'leave') return 'Leave car';
  if (a.move === 'drop') return a.args?.[0] === 'boat' ? 'Drop boat' : 'Drop gear';
  if (a.move === 'pickup') return a.args?.[0] === 'boat' ? 'Pick up boat' : 'Pick up gear';
  if (a.move === 'helilift') return 'Helilift → base (−12$)';
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
  const car = G.vehicles.find(v => v.pos === i);
  if (car) bits.push(car.driver !== null ? `car (P${car.driver})` : 'car (empty)');
  const gearN = t.equipment.filter(e => e.kind === 'gear').length;
  if (gearN) bits.push(`${gearN} gear cached`);
  if (t.equipment.some(e => e.kind === 'boat')) bits.push('boat here');
  if (!t.revealed) bits.push('unexplored');
  else if (t.finds.length) bits.push('finds: ' + t.finds.map(d => `${d.type}${d.color}`).join(' '));
  return bits.join(' · ');
}

export function sampleChips(ds: Discovery[]): string {
  if (!ds.length) return '<span style="opacity:.5">none</span>';
  return ds.map(d => `<span class="chip" style="color:${DTYPE_COLOR[d.type]}">${d.type}${d.color}</span>`).join('');
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
function borderBar(cctx: CanvasRenderingContext2D, a: number, b: number, G: GState) {
  const ca = a % G.cols, ra = (a / G.cols) | 0, cb = b % G.cols, rb = (b / G.cols) | 0;
  cctx.strokeStyle = CLIFF_LINE; cctx.lineWidth = Math.max(4, CELL * 0.12); cctx.setLineDash([]); cctx.lineCap = 'butt';
  cctx.beginPath();
  if (ra === rb) { const x = Math.max(ca, cb) * CELL; cctx.moveTo(x, ra * CELL); cctx.lineTo(x, ra * CELL + CELL); }   // full vertical border (E/W)
  else { const y = Math.max(ra, rb) * CELL; cctx.moveTo(ca * CELL, y); cctx.lineTo(ca * CELL + CELL, y); }            // full horizontal border (N/S)
  cctx.stroke();
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
function carGlyph(cctx: CanvasRenderingContext2D, x: number, y: number, driver: string | null) {
  const fs = CELL * 0.4, cy = y + CELL * 0.64;           // below centre, nudged toward the tile centre
  cctx.font = `${fs}px ${EMOJI_FONT}`; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  cctx.globalAlpha = driver ? 1 : 0.55;                 // empty car dimmer
  cctx.fillText('🚗', x + CELL / 2, cy);
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
    if (!t.bridge && (t.terrain === 'jungle' || t.terrain === 'rocky')) {   // global move-cost: 2-AP bushwhack tiles read darker than 1-AP grassland/road/water
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
      cctx.fillStyle = '#0b0f0a'; cctx.beginPath(); cctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.27, 0, 7); cctx.fill();
      cctx.fillStyle = '#e8f0e2'; cctx.font = `bold ${CELL * 0.32}px ui-monospace, monospace`;
      cctx.fillText(HOTSPOT_LABEL[t.hotspot], x + CELL / 2, y + CELL / 2 + 1);
    }
    if (t.terrain === 'void') continue;
    // 8 perimeter slots (4 corners + 4 edge midpoints): discovery dots first, then cached gear/boat
    const d = Math.max(6, CELL * 0.17), m = CELL / 2, rr = Math.max(2.5, CELL * 0.075);
    const slots = [[x + d, y + d], [x + CELL - d, y + d], [x + d, y + CELL - d], [x + CELL - d, y + CELL - d], [x + m, y + d], [x + d, y + m], [x + CELL - d, y + m], [x + m, y + CELL - d]];   // corners, then T/L/R, bottom-centre last (kept clear for the car)
    let s = 0;
    const n = t.revealed ? t.finds.length : t.richness;
    for (let k = 0; k < n && s < 8; k++, s++) {   // discovery dots: coloured (explored) / grayish-biome (potential)
      cctx.fillStyle = t.revealed ? DTYPE_COLOR[t.finds[k].type] : GRAY_BIOME[t.terrain];
      cctx.beginPath(); cctx.arc(slots[s][0], slots[s][1], rr, 0, 7); cctx.fill();
    }
    for (const e of t.equipment) {   // cached items take the next free slots
      if (s >= 8) break;
      const sx = slots[s][0], sy = slots[s][1]; s++;
      if (e.kind === 'boat') { cctx.font = `${CELL * 0.34}px ${EMOJI_FONT}`; cctx.fillText('⛵', sx, sy); }
      else { const sq = rr * 1.9; cctx.fillStyle = EQUIP_COLOR; cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1; cctx.fillRect(sx - sq / 2, sy - sq / 2, sq, sq); cctx.strokeRect(sx - sq / 2, sy - sq / 2, sq, sq); }
    }
  }

  // 4) vehicles (top-right; driver-coloured when occupied)
  for (const v of G.vehicles) {
    const c = v.pos % G.cols, r = (v.pos / G.cols) | 0;
    carGlyph(cctx, c * CELL, r * CELL, v.driver !== null ? PLAYER_COLOR[+v.driver % 4] : null);
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

  // 7) players (offset when sharing a tile; current player ringed white)
  for (const [tile, ids] of positions) {
    const c = tile % G.cols, r = (tile / G.cols) | 0;
    ids.forEach((id, k) => {
      const ox = ids.length > 1 ? (k - (ids.length - 1) / 2) * 12 : 0;
      const cx = c * CELL + CELL / 2 + ox, cy = r * CELL + CELL / 2;
      cctx.beginPath(); cctx.arc(cx, cy, CELL * 0.22, 0, 7);
      cctx.fillStyle = PLAYER_COLOR[+id % 4]; cctx.fill();
      cctx.lineWidth = id === ctxState.currentPlayer ? 3 : 1.5;
      cctx.strokeStyle = id === ctxState.currentPlayer ? '#ffffff' : '#0b0f0a'; cctx.stroke();
      cctx.fillStyle = '#0b0f0a'; cctx.font = `bold ${CELL * 0.24}px ui-monospace, monospace`;
      cctx.fillText(id, cx, cy + 1);
    });
  }
}
