// Shared board rendering + small UI helpers, used by BOTH frontends (the lean
// Canvas viewer in main.ts and the bgio React board). Drawing the car and
// dropped equipment lives here once so the two stay in visual sync.
import type { GState, Tile, Discovery, Pattern, GearItem, PlayerS, Vehicle, Role } from './game';
import { targetAP, evalGoal, GEAR_PRICE, catDC, ROLE_DISC, gearBonus, ROLE_BONUS } from './game';

export type Action = { move?: string; args?: unknown[]; event?: string };

// ---- toasts: classify fresh G.log lines into transient success/fail/info notices ----
export interface Toast { text: string; kind: 'good' | 'bad' | 'info'; }
// money is shown inflated ×10 and denoted "k$" (flavour — bigger numbers); the underlying economy is unchanged
export const money$ = (n: number) => `${n * 10}k$`;
// concise explanation of each global (whole-round, all-players) event — used for the status line AND the toast
export const EVENT_LABEL: Record<string, string> = {
  tailwind: '🌬️ Tailwind · +1 AP for all', cache: `💰 Cache · +${money$(2)} for all`, grant: `🎓 Grant · +${money$(3)} for all`, calm: '☀️ Calm · nothing stirs',
  rockslide: '⛏ Rockslide · a jungle tile turns rocky', washout: '🌊 Washout · a crossing severed', monsoon: '⛈ Monsoon · field season nearing its end',
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
  if (line.startsWith('publish ')) { const m = line.match(/\+(\d+)P/); return { text: `Published${m ? ` +${m[1]}🎓` : ''} · −1 AP`, kind: 'good' }; }
  if (line.startsWith('buy gear')) return { text: 'Bought gear', kind: 'info' };
  if (line.startsWith('drive')) return { text: 'Drove · −1 AP', kind: 'info' };
  if (line.startsWith('helilift')) return { text: 'Helilift → base · −1 AP', kind: 'info' };
  if (line.startsWith('event:')) { const id = line.slice(6).split(' ')[0]; const bad = id === 'rockslide' || id === 'washout' || id === 'monsoon'; return { text: EVENT_LABEL[id] ?? id, kind: bad ? 'bad' : 'info' }; }
  return null;
}
export function logToasts(fromIdx: number, log: string[]): Toast[] {
  const out: Toast[] = [];
  for (let i = Math.max(0, fromIdx); i < log.length; i++) { const t = classifyLog(log[i]); if (t) out.push(t); }
  return out;
}

export let CELL = 46;              // CSS px per tile — recomputed responsively in fitCanvas()
export const MIN_CELL = 16;        // floor so the board stays usable on tiny viewports
export const PLAYER_COLOR = ['#ffd24a', '#4ad2ff', '#ff7a4a', '#5fdf6f'];   // gold · cyan · orange · green (no purple)
const PAWN_DIAG = [[-1, -1], [1, -1], [-1, 1], [1, 1]];   // per-player off-centre diagonal: P0 TL · P1 TR · P2 BL · P3 BR
const hash01 = (i: number, k: number) => { let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(k + 1, 40503)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h >>> 8) & 0xffff) / 0xffff; };   // deterministic per-tile jitter
export const DTYPE_COLOR: Record<Discovery['type'], string> = { geo: '#4ab0ff', zoo: '#ff4444', bot: '#57e466', arch: '#ffd24a' };   // discipline colours (= player colours): geo blue · zoo red · bot green · arch yellow
export const DTYPE_SYMBOL: Record<Discovery['type'], string> = { geo: '💎', zoo: '🐾', bot: '🌿', arch: '🏺' };   // type icon — used everywhere instead of the geo/zoo/bot/arch words
const isDType = (s: string): s is Discovery['type'] => s === 'geo' || s === 'zoo' || s === 'bot' || s === 'arch';
export const prettyFind = (d: Discovery) => `${DTYPE_SYMBOL[d.type]}${d.color}`;                     // e.g. 💎3
const prettyTag = (tag: string) => { const m = tag.match(/^([a-z]+)(\d+)$/); return m && isDType(m[1]) ? DTYPE_SYMBOL[m[1]] + m[2] : tag; };   // "geo3" → "💎3"
export const prettyLog = (line: string) => line.replace(/\b(geo|zoo|bot|arch)(\d)/g, (_m, t, c) => DTYPE_SYMBOL[t as Discovery['type']] + c);   // swap type words for icons in a log line
const COL_SQUARE = ['🟩', '🟦', '🟨'];   // the 3 discovery colours as squares (green blue yellow)
// compact iconic project label: e.g. "3 💎", "2 💎 + 2 🐾", "5 🟥" (no "of a kind" prose)
export const goalLabel = (g: Pattern) => g.parts.map(p => `${p.count} ${p.type ? DTYPE_SYMBOL[p.type] : ''}${p.color !== undefined ? COL_SQUARE[p.color] : ''}`).join(' + ');
// specialist badge: discipline icon + name, tinted by the discipline (= player) colour so the badge matches the player
export const roleBadge = (role: Role) => `<span title="+3 catalogue on ${ROLE_DISC[role]}" style="color:${DTYPE_COLOR[ROLE_DISC[role]]};font-weight:600">${DTYPE_SYMBOL[ROLE_DISC[role]]} ${role[0].toUpperCase()}${role.slice(1)}</span>`;
// a player's colour follows their SPECIALIZATION (discipline), not their seat: geologist blue · zoologist red · botanist green · archaeologist yellow
export const playerColor = (role: Role) => DTYPE_COLOR[ROLE_DISC[role]];
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
const CLIFF_FILL = 'rgba(8,7,6,0.7)';   // cliff band — a dark in-tile marker covering ~1/3 of the affected tile side (no border line)
const EQUIP_COLOR = '#cfd6c8';
const HOTSPOT_LABEL: Record<NonNullable<Tile['hotspot']>, string> = { base: '🏢', remote: '⛺', village: '🏘️', riverVillage: '🏠' };   // research base (building) · frontier · village (market) · little river house
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
  if (a.move === 'catalogue') { const d = tile.finds[a.args![0] as number]; return d ? `Catalogue ${prettyFind(d)} · 🎲≥${catDC(d.color)}` : null; }
  if (a.move === 'publish') { const g = goals?.find(x => x.id === a.args![0]); return g ? `Publish ${goalLabel(g)} (+${g.prestige}🎓)` : 'Publish'; }
  if (a.move === 'buy') { const k = a.args![0] as string, f = a.args![1] as Discovery['type'] | undefined;
    if (k === 'boat') return `Buy boat (−${money$(5)})`; if (k === 'car') return `Buy car (−${money$(8)})`;
    return k === 'field' ? `Buy 🔬${DTYPE_SYMBOL[f!]} (−${money$(GEAR_PRICE.field)})` : `Buy ${GEAR_GLYPH[k]}+${k[1]} (−${money$(GEAR_PRICE[k as GearItem['kind']])})`; }
  if (a.move === 'board') return 'Board';
  if (a.move === 'leave') return 'Leave';
  if (a.move === 'drop') { const s = a.args![0]; return s === 'boat' ? 'Drop boat' : `Drop ${p ? gearIcon(p.gear[s as number]) : 'gear'}`; }
  if (a.move === 'pickup') { const s = a.args![0]; const e = typeof s === 'number' ? tile.equipment[s] : undefined;
    return !e || e.kind === 'boat' ? 'Pick up boat' : `Pick up ${gearIcon(e.gear!)}`; }
  if (a.move === 'stash') { const s = a.args![0]; return s === 'boat' ? 'Stash boat → trunk' : `Stash ${p ? gearIcon(p.gear[s as number]) : 'gear'} → trunk`; }
  if (a.move === 'unstash') { const e = car?.trunk[a.args![0] as number]; return e ? `Take ${e.kind === 'boat' ? 'boat' : gearIcon(e.gear!)} ← trunk` : 'Take ← trunk'; }
  if (a.move === 'helilift') return `Helilift → base (−${money$(12)})`;
  if (a.move === 'reclaim') { const d = tile.cache[a.args![0] as number]; return d ? `Take ${prettyFind(d)}` : null; }
  if (a.move === 'discard') return null;   // dropping is done by clicking your own hand chip
  if (a.event === 'endTurn') return 'End turn';
  return null;
}

export function describeTile(G: GState, i: number): string {
  const t = G.map[i];
  const bits = [`#${i}`, t.bridge ? `${t.bridge} bridge` : t.terrain];
  if (t.roads) bits.push('road');
  if (t.hotspot) bits.push({ base: 'research base', remote: 'frontier base', village: 'village', riverVillage: 'river village' }[t.hotspot]);
  if (t.smallRivers) bits.push('brook');
  if (t.blocked) bits.push('cliff edge');
  const research = t.hotspot === 'base' || t.hotspot === 'remote';
  const cars = G.vehicles.filter(v => v.pos === i);
  for (const car of cars) { const tr = car.trunk.length ? ` +trunk[${car.trunk.map(e => e.kind === 'boat' ? '🛶' : gearIcon(e.gear!)).join('')}]` : ''; bits.push((car.driver !== null ? `${car.kind} (Player ${+car.driver + 1})` : `${car.kind} (empty)`) + tr); }
  const items = t.equipment.map(e => e.kind === 'boat' ? '🛶' : gearIcon(e.gear!));
  if (items.length) bits.push('items: ' + items.join(' '));
  if (t.revealed && t.finds.length) bits.push('finds: ' + t.finds.map(prettyFind).join(' '));
  if (t.cache.length) bits.push((research ? 'open pool: ' : 'dropped: ') + t.cache.map(prettyFind).join(' '));
  else if (research) bits.push('open pool: (empty)');
  return bits.join(' · ');
}

export function sampleChips(ds: Discovery[]): string {
  return ds.map(d => `<span class="chip" style="color:${DTYPE_COLOR[d.type]}">${prettyFind(d)}</span>`).join('');
}
// gear kit icons (public — opponents see your gear). lab-bench symbols by tier; 🧪 + discipline = field kit
export const GEAR_GLYPH: Record<string, string> = { g1: '🔬', g2: '🔬', g3: '🔬' };   // all generic gear shares the microscope icon; the coloured +X conveys strength
export const gearIcon = (g: GearItem) => g.kind === 'field' ? `🔬${DTYPE_SYMBOL[g.field!]}` : GEAR_GLYPH[g.kind];   // field kit = microscope + its discipline icon
// gear chip: icon + a coloured "+X" bonus — tinted by discipline for a field kit, WHITE for generic (all-discipline) gear
export function gearChips(gear: GearItem[]): string {
  return gear.map(g => {
    const isField = g.kind === 'field';
    const b = isField ? gearBonus([g], g.field!) : Number(g.kind.slice(1));
    const color = isField ? DTYPE_COLOR[g.field!] : '#ffffff';
    const title = isField ? `${g.field} field kit +${b}` : `+${b} to every catalogue`;
    return `<span class="chip gear" title="${title}">${gearIcon(g)} <b style="color:${color}">+${b}</b></span>`;
  }).join('');
}
// the specialist's innate discipline bonus — shown in the gear row, tinted by discipline
export const roleBonusChip = (role: Role) => `<span class="chip gear" title="specialist +${ROLE_BONUS} on ${ROLE_DISC[role]}">${DTYPE_SYMBOL[ROLE_DISC[role]]} <b style="color:${DTYPE_COLOR[ROLE_DISC[role]]}">+${ROLE_BONUS}</b></span>`;
export const emptySlots = (n: number) => '<span class="slot empty"></span>'.repeat(Math.max(0, n));
// your own hand, but each chip is clickable to DROP it (leaves it face-up on your tile)
export function handChips(ds: Discovery[]): string {
  if (!ds.length) return '<span style="opacity:.5">none</span>';
  return ds.map((d, i) => `<span class="chip clk" data-discard="${i}" title="drop — leaves it here, face-up for anyone" style="color:${DTYPE_COLOR[d.type]};cursor:pointer">${prettyFind(d)}</span>`).join('');
}
// opponents see only the DISCIPLINE of your specimens, not the colour (a concealed poker hand)
export function maskedChips(ds: Discovery[]): string {
  return ds.map(d => `<span class="chip" style="color:#8aa0b4">${DTYPE_SYMBOL[d.type]}<span style="opacity:.5">?</span></span>`).join('');
}

// ---- publish planner: the shared pool of open research projects + how close the current player is ----
// Each project pins concrete values; discipline = icon, colour = swatch (both for both-axes projects). evalGoal() (in game.ts) is the single source of truth.
export const DCOLOR = ['#36a85a', '#3f86d8', '#e0c23a'];   // the 3 discovery colours: green · blue · yellow
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
    return { name: goal.id, label: goalLabel(goal), reward: `+${goal.prestige}🎓 +${money$(goal.money)}`, cells, ready: r.ok, threat };
  });
}

// draw a link network as CURVED paths: per tile, connect its linked edge-midpoints through the centre
// (2 edges → a quadratic that's straight for opposite edges, a rounded bend for adjacent; 1 or 3–4 → radial stubs)
function linkLayer(cctx: CanvasRenderingContext2D, G: GState, mask: (t: Tile) => number, color: string, width: number, dash: number[]) {
  cctx.strokeStyle = color; cctx.lineWidth = width; cctx.setLineDash(dash); cctx.lineCap = 'round'; cctx.lineJoin = 'round';
  for (let i = 0; i < G.map.length; i++) {
    const m = mask(G.map[i]); if (!m) continue;
    const c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL, cx = x + CELL / 2, cy = y + CELL / 2;
    const pts: [number, number][] = [];
    if (m & 1) pts.push([cx, y]); if (m & 2) pts.push([x + CELL, cy]); if (m & 4) pts.push([cx, y + CELL]); if (m & 8) pts.push([x, cy]);
    if (pts.length === 2) { cctx.beginPath(); cctx.moveTo(pts[0][0], pts[0][1]); cctx.quadraticCurveTo(cx, cy, pts[1][0], pts[1][1]); cctx.stroke(); }
    else for (const p of pts) { cctx.beginPath(); cctx.moveTo(cx, cy); cctx.lineTo(p[0], p[1]); cctx.stroke(); }
  }
  cctx.setLineDash([]);
}

// bold black bar along the FULL shared border between a & b = impassable cliff edge
// cliff: a dark band covering ~1/3 of tile `a` on the affected side (toward `b` = a+1 East or a+cols South) — no border line
function borderBar(cctx: CanvasRenderingContext2D, a: number, b: number, G: GState) {
  const x = (a % G.cols) * CELL, y = ((a / G.cols) | 0) * CELL, third = CELL * 0.34, east = b === a + 1;
  const jag = CELL * 0.08, segs = 7, inner = east ? x + CELL - third : y + CELL - third;
  cctx.fillStyle = CLIFF_FILL; cctx.beginPath();   // band jagged on BOTH long edges — toward the tile centre AND toward the tile edge (border)
  if (east) {
    cctx.moveTo(x + CELL, y);
    for (let k = 1; k <= segs; k++) cctx.lineTo(x + CELL - (k % 2 ? jag : 0), y + (k / segs) * CELL);    // jagged outer (border) edge ↓
    for (let k = 0; k <= segs; k++) cctx.lineTo(inner + (k % 2 ? jag : 0), y + CELL - (k / segs) * CELL); // jagged inner edge ↑
  } else {
    cctx.moveTo(x, y + CELL);
    for (let k = 1; k <= segs; k++) cctx.lineTo(x + (k / segs) * CELL, y + CELL - (k % 2 ? jag : 0));    // jagged outer (border) edge →
    for (let k = 0; k <= segs; k++) cctx.lineTo(x + CELL - (k / segs) * CELL, inner + (k % 2 ? jag : 0)); // jagged inner edge ←
  }
  cctx.closePath(); cctx.fill();
  const bx = east ? inner : x, by = east ? y : inner, bw = east ? third : CELL, bh = east ? CELL : third;
  cctx.fillStyle = 'rgba(168,168,176,0.6)';   // rock-grey scree dots on the cliff side
  const seed = a * 13 + (east ? 3 : 7);
  for (let k = 0; k < 6; k++) { cctx.beginPath(); cctx.arc(bx + hash01(seed, k * 2) * bw, by + hash01(seed, k * 2 + 1) * bh, Math.max(0.7, CELL * 0.026), 0, 7); cctx.fill(); }
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
function carGlyph(cctx: CanvasRenderingContext2D, x: number, y: number, driver: string | null, glyph = '🚗') {
  const fs = CELL * 0.36, cy = y + CELL * 0.82;          // hugging the bottom edge of the tile (clear of the centre discovery/pawn)
  cctx.font = `${fs}px ${EMOJI_FONT}`; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  cctx.fillText(glyph, x + CELL / 2, cy);
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

  // 2) movement graph as CURVED links (bends round off): river channel under roads, then footpaths + brooks; cliffs as dark in-tile bands
  linkLayer(cctx, G, t => t.rivers, RIVER_LINE, 3, []);
  linkLayer(cctx, G, t => t.roads, '#9a8757', 3, []);
  linkLayer(cctx, G, t => t.paths, '#84a684', 1.5, [3, 3]);
  linkLayer(cctx, G, t => t.smallRivers, BROOK_LINE, 2, [2, 2]);
  cctx.setLineDash([]);
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0;
    if (c < G.cols - 1 && (t.blocked & 2)) borderBar(cctx, i, i + 1, G);
    if (r < G.rows - 1 && (t.blocked & 4)) borderBar(cctx, i, i + G.cols, G);
  }
  // biome fringe dots on EVERY tile, hugging edges that carry NO link (never overlaying roads/rivers/paths/brooks)
  const FRINGE: Partial<Record<Tile['terrain'], [string, string]>> = { grassland: ['#9ec24e', '#6fa83a'], jungle: ['#5a9e4a', '#2f6f2f'], rocky: ['#9a9aa2', '#74747c'], ruins: ['#c9b27a', '#a89058'], water: ['#9ec24e', '#3a7a3a'] };
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i]; const pal = FRINGE[t.terrain]; if (!pal) continue;
    const c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL, cx = x + CELL / 2, cy = y + CELL / 2;
    const link = t.roads | t.paths | t.smallRivers | t.rivers, real = (j: number) => G.map[j] && G.map[j].terrain !== 'void';
    const edges: [number, number, number][] = [];   // [x, y, axis] axis 0 = horizontal edge (spread along x), 1 = vertical
    if (!(link & 1) && r > 0 && real(i - G.cols)) edges.push([cx, y + CELL * 0.08, 0]);
    if (!(link & 2) && c < G.cols - 1 && real(i + 1)) edges.push([x + CELL * 0.92, cy, 1]);
    if (!(link & 4) && r < G.rows - 1 && real(i + G.cols)) edges.push([cx, y + CELL * 0.92, 0]);
    if (!(link & 8) && c > 0 && real(i - 1)) edges.push([x + CELL * 0.08, cy, 1]);
    let s = 0;
    for (const [bx, by, axis] of edges) for (let k = 0; k < 5; k++, s++) {
      cctx.fillStyle = pal[s % 2];
      const along = (hash01(i, s * 2) - 0.5) * CELL * 0.74, perp = (hash01(i, s * 2 + 1) - 0.5) * CELL * 0.12;
      cctx.beginPath(); cctx.arc(bx + (axis ? perp : along), by + (axis ? along : perp), Math.max(0.6, CELL * 0.02), 0, 7); cctx.fill();
    }
  }

  // green lichen/moss specks scattered across rocky tiles
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i]; if (t.terrain !== 'rocky' || t.bridge) continue;
    const c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL;
    cctx.fillStyle = 'rgba(90,158,74,0.72)';
    for (let k = 0; k < 4; k++) { cctx.beginPath(); cctx.arc(x + (0.18 + 0.64 * hash01(i, k * 2 + 11)) * CELL, y + (0.18 + 0.64 * hash01(i, k * 2 + 12)) * CELL, Math.max(0.7, CELL * 0.03), 0, 7); cctx.fill(); }
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
      cctx.textAlign = 'center'; cctx.textBaseline = 'middle'; cctx.globalAlpha = t.terrain === 'rocky' ? 0.34 : 0.8;   // rocks much more transparent
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
    const shadow = () => { cctx.shadowColor = 'rgba(0,0,0,0.5)'; cctx.shadowBlur = CELL * 0.09; cctx.shadowOffsetY = CELL * 0.03; };
    if (t.revealed && t.finds.length) {   // FLIPPED face-up on entry: the real discovery — type colour, rimmed in its discovery colour, with the type icon
      const f = t.finds[0];
      cctx.save(); shadow(); cctx.beginPath(); cctx.arc(cx0, cy0, CELL * 0.22, 0, 7); cctx.fillStyle = DTYPE_COLOR[f.type]; cctx.fill(); cctx.restore();
      cctx.lineWidth = Math.max(2, CELL * 0.06); cctx.strokeStyle = DCOLOR[f.color]; cctx.beginPath(); cctx.arc(cx0, cy0, CELL * 0.22, 0, 7); cctx.stroke();   // colour-axis rim
      if (CELL >= 20) { cctx.font = `${CELL * 0.26}px ${EMOJI_FONT}`; cctx.fillText(DTYPE_SYMBOL[f.type], cx0, cy0 + 0.5); }
    } else if (!t.revealed && t.richness > 0 && !t.roads && !t.hotspot) {   // BACK-SIDE: an un-entered discovery — only where a find can actually appear (not roads/special locations)
      cctx.save(); shadow(); cctx.beginPath(); cctx.arc(cx0, cy0, CELL * 0.2, 0, 7); cctx.fillStyle = BIOME_POOL[t.terrain] ?? GRAY_BIOME[t.terrain]; cctx.fill(); cctx.restore();
      cctx.lineWidth = 1; cctx.strokeStyle = 'rgba(0,0,0,0.45)'; cctx.beginPath(); cctx.arc(cx0, cy0, CELL * 0.2, 0, 7); cctx.stroke();
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
        carGlyph(cctx, px - CELL / 2, py - CELL * 0.82, playerColor(G.players[v.driver].role), glyph);
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
      cctx.fillStyle = playerColor(G.players[id].role); cctx.fill();
      cctx.lineWidth = id === ctxState.currentPlayer ? 2.5 : 1.25;
      cctx.strokeStyle = id === ctxState.currentPlayer ? '#ffffff' : '#0b0f0a'; cctx.stroke();
      cctx.fillStyle = '#0b0f0a'; cctx.font = `bold ${CELL * 0.17}px ui-monospace, monospace`;
      cctx.fillText(String(+id + 1), cx, cy + 1);
    });
  }
}
