// Shared board rendering + small UI helpers, used by BOTH frontends (the lean
// Canvas viewer in main.ts and the bgio React board). Drawing the car and
// dropped equipment lives here once so the two stay in visual sync.
import type { GState, Tile, Discovery } from './game';

export type Action = { move?: string; args?: unknown[]; event?: string };

export const CELL = 46;            // CSS px per tile
export const PLAYER_COLOR = ['#ffd24a', '#4ad2ff', '#ff7a4a', '#b07aff'];
export const DTYPE_COLOR: Record<Discovery['type'], string> = { geo: '#d8b15a', zoo: '#e07a6a', bot: '#7ad07a', arch: '#9a8ad0' };

const TERRAIN_FILL: Record<Tile['terrain'], string> = {
  road: '#5b5340', wild: '#37512f', forest: '#21401d', rocky: '#565659', water: '#1d4c79',
};
const BROOK_LINE = '#4aa3d2';      // brook (boat-only) edge
const CLIFF_LINE = '#e2553a';      // impassable cliff edge
const BRIDGE_FILL = '#7a6a44';
const EQUIP_COLOR = '#cfd6c8';
const HOTSPOT_LABEL: Record<NonNullable<Tile['hotspot']>, string> = { base: 'H', village: 'M', remote: 'R' };

export const dpr = () => Math.max(1, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));

export function fitCanvas(canvas: HTMLCanvasElement, G: GState): CanvasRenderingContext2D {
  const d = dpr();
  canvas.style.width = `${G.cols * CELL}px`;
  canvas.style.height = `${G.rows * CELL}px`;
  canvas.width = G.cols * CELL * d;
  canvas.height = G.rows * CELL * d;
  const cctx = canvas.getContext('2d')!;
  cctx.setTransform(d, 0, 0, d, 0, 0);
  return cctx;
}

export const tileAt = (px: number, py: number, G: GState): number => {
  const c = Math.floor(px / CELL), r = Math.floor(py / CELL);
  if (c < 0 || r < 0 || c >= G.cols || r >= G.rows) return -1;
  return r * G.cols + c;
};

// tile index -> the spatial action (move/drive) that lands there; move wins ties
export function spatialTargets(actions: Action[]): Map<number, Action> {
  const m = new Map<number, Action>();
  for (const a of actions) if (a.move === 'drive') m.set(a.args![0] as number, a);
  for (const a of actions) if (a.move === 'move') m.set(a.args![0] as number, a);
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

// red bar drawn on the shared border between a & b = impassable cliff edge
function borderBar(cctx: CanvasRenderingContext2D, a: number, b: number, G: GState) {
  const ca = a % G.cols, ra = (a / G.cols) | 0, cb = b % G.cols, rb = (b / G.cols) | 0;
  cctx.strokeStyle = CLIFF_LINE; cctx.lineWidth = 3; cctx.setLineDash([]);
  cctx.beginPath();
  if (ra === rb) { const x = Math.max(ca, cb) * CELL; cctx.moveTo(x, ra * CELL + 6); cctx.lineTo(x, ra * CELL + CELL - 6); }   // vertical border (E/W)
  else { const y = Math.max(ra, rb) * CELL; cctx.moveTo(ca * CELL + 6, y); cctx.lineTo(ca * CELL + CELL - 6, y); }            // horizontal border (N/S)
  cctx.stroke();
}

function carGlyph(cctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  const w = CELL * 0.34, h = CELL * 0.2, gx = x + CELL - w - 4, gy = y + 4;
  cctx.fillStyle = color; cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1;
  cctx.beginPath(); (cctx as any).roundRect?.(gx, gy, w, h, 3); cctx.fill(); cctx.stroke();
  cctx.fillStyle = '#0b0f0a';
  cctx.beginPath(); cctx.arc(gx + w * 0.28, gy + h, 2, 0, 7); cctx.fill();
  cctx.beginPath(); cctx.arc(gx + w * 0.72, gy + h, 2, 0, 7); cctx.fill();
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
    cctx.fillStyle = t.bridge ? BRIDGE_FILL : TERRAIN_FILL[t.terrain];
    cctx.fillRect(x, y, CELL, CELL);
    if (!t.revealed) { cctx.fillStyle = 'rgba(5,8,5,0.55)'; cctx.fillRect(x, y, CELL, CELL); }
    cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1; cctx.setLineDash([]);
    cctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  }

  // 2) movement graph: solid roads, dashed footpaths, dashed-blue brooks (boat); red bars = impassable cliffs (E + S edges, once)
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0;
    if (c < G.cols - 1) {
      if (t.roads & 2) edge(cctx, i, i + 1, G, '#9a8757', 3, []); else if (t.paths & 2) edge(cctx, i, i + 1, G, '#84a684', 1.5, [3, 3]);
      if (t.smallRivers & 2) edge(cctx, i, i + 1, G, BROOK_LINE, 2, [2, 2]);
      if (t.blocked & 2) borderBar(cctx, i, i + 1, G);
    }
    if (r < G.rows - 1) {
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
    if (t.revealed && t.finds.length) for (let k = 0; k < t.finds.length; k++) {
      cctx.fillStyle = DTYPE_COLOR[t.finds[k].type];
      cctx.beginPath(); cctx.arc(x + 7 + k * 8, y + CELL - 7, 3, 0, 7); cctx.fill();
    }
    for (let k = 0; k < t.equipment.length; k++) {   // item caches, top-left (square = gear, hull = boat)
      const ex = x + 4 + k * 8, ey = y + 5;
      cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1;
      if (t.equipment[k].kind === 'boat') {
        cctx.fillStyle = BROOK_LINE;
        cctx.beginPath(); cctx.moveTo(ex - 1, ey + 1); cctx.lineTo(ex + 7, ey + 1); cctx.lineTo(ex + 5, ey + 6); cctx.lineTo(ex + 1, ey + 6); cctx.closePath();
        cctx.fill(); cctx.stroke();
      } else {
        cctx.fillStyle = EQUIP_COLOR; cctx.fillRect(ex, ey, 5, 5); cctx.strokeRect(ex, ey, 5, 5);
      }
    }
  }

  // 4) vehicles (top-right; driver-coloured when occupied)
  for (const v of G.vehicles) {
    const c = v.pos % G.cols, r = (v.pos / G.cols) | 0;
    carGlyph(cctx, c * CELL, r * CELL, v.driver !== null ? PLAYER_COLOR[+v.driver % 4] : '#8a8f86');
  }

  // 5) legal-target rings (solid = walk, dashed = drive)
  if (targets) {
    for (const [t, a] of targets) {
      const c = t % G.cols, r = (t / G.cols) | 0;
      cctx.strokeStyle = '#ffd24a'; cctx.lineWidth = 2.5;
      cctx.setLineDash(a.move === 'drive' ? [4, 3] : []);
      cctx.strokeRect(c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6);
    }
    cctx.setLineDash([]);
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
