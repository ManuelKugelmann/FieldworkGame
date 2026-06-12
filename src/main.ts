import { Client } from 'boardgame.io/client';
import { Expedition, botAction, enumerate } from './game';
import type { GState, Tile, Discovery } from './game';

// ---- Canvas viewer + click-to-play. The bgio headless Client is the engine;
// rendering and input are custom. Every legal action — clickable tile targets
// and the action buttons — is read straight from the game's own enumerate(),
// so the UI can never offer a move the rules would reject. ----

type Action = { move?: string; args?: unknown[]; event?: string };

const TERRAIN_FILL: Record<Tile['terrain'], string> = {
  road: '#5b5340', wild: '#37512f', forest: '#21401d', rocky: '#565659', water: '#1d4c79',
};
const ARM_FILL = '#2f6f9a';
const BRIDGE_FILL = '#7a6a44';
const PLAYER_COLOR = ['#ffd24a', '#4ad2ff', '#ff7a4a', '#b07aff'];
const HOTSPOT_LABEL: Record<NonNullable<Tile['hotspot']>, string> = { base: 'H', village: 'M', remote: 'R' };
const DTYPE_COLOR: Record<Discovery['type'], string> = { geo: '#d8b15a', zoo: '#e07a6a', bot: '#7ad07a', arch: '#9a8ad0' };

const CELL = 46;                 // CSS px per tile
const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('board') as HTMLCanvasElement;
const cctx = canvas.getContext('2d')!;

const client = Client<GState>({ game: Expedition, numPlayers: 2 });
client.start();

// which seats a person controls; the rest are auto-played by the heuristic bot
const human = new Set<string>(['0']);
($('human0') as HTMLInputElement).addEventListener('change', e => syncSeat('0', e));
($('human1') as HTMLInputElement).addEventListener('change', e => syncSeat('1', e));
function syncSeat(id: string, e: Event) {
  if ((e.target as HTMLInputElement).checked) human.add(id); else human.delete(id);
  scheduleBot(); draw();
}

let botTimer: number | undefined;
let hover = -1;

// ---- canvas geometry ----
function fitCanvas(G: GState) {
  canvas.style.width = `${G.cols * CELL}px`;
  canvas.style.height = `${G.rows * CELL}px`;
  canvas.width = G.cols * CELL * dpr;
  canvas.height = G.rows * CELL * dpr;
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const tileAt = (px: number, py: number, G: GState): number => {
  const c = Math.floor(px / CELL), r = Math.floor(py / CELL);
  if (c < 0 || r < 0 || c >= G.cols || r >= G.rows) return -1;
  return r * G.cols + c;
};

// ---- legal-action lookup (the rules' own enumerate) ----
function legalNow(): Action[] {
  const s = client.getState();
  if (!s || s.ctx.gameover) return [];
  return enumerate(s.G, s.ctx) as Action[];
}
// tile index -> the spatial action (move/drive) that lands there; move wins ties (it can be cheaper)
function spatialTargets(actions: Action[]): Map<number, Action> {
  const m = new Map<number, Action>();
  for (const a of actions) if (a.move === 'drive') m.set(a.args![0] as number, a);
  for (const a of actions) if (a.move === 'move') m.set(a.args![0] as number, a);
  return m;
}

function dispatch(a: Action) {
  if (a.move) (client.moves as Record<string, (...x: unknown[]) => void>)[a.move](...(a.args ?? []));
  else (client.events as Record<string, () => void>)[a.event ?? 'endTurn']?.();
  scheduleBot();
  draw();
}

// ---- bot fills non-human seats; one action per tick for watchability ----
function scheduleBot() {
  const s = client.getState();
  if (!s || s.ctx.gameover) { stopBot(); return; }
  if (human.has(s.ctx.currentPlayer)) { stopBot(); return; }   // wait for the person
  if (botTimer === undefined) botTimer = window.setInterval(botTick, 280);
}
function stopBot() { if (botTimer !== undefined) { clearInterval(botTimer); botTimer = undefined; } }
function botTick() {
  const s = client.getState();
  if (!s || s.ctx.gameover || human.has(s.ctx.currentPlayer)) { stopBot(); draw(); return; }
  const before = s._stateID;
  const a = botAction(s.G, s.ctx, Math.random) as Action;
  if (a.move) (client.moves as Record<string, (...x: unknown[]) => void>)[a.move](...(a.args ?? []));
  else (client.events as Record<string, () => void>)[a.event ?? 'endTurn']?.();
  const after = client.getState();
  if (after && after._stateID === before) client.events.endTurn?.();   // guard INVALID_MOVE stall
  draw();
}

// ---- rendering ----
function edgeLine(a: number, b: number, G: GState, color: string, width: number, dash: number[]) {
  const ca = a % G.cols, ra = (a / G.cols) | 0, cb = b % G.cols, rb = (b / G.cols) | 0;
  cctx.strokeStyle = color; cctx.lineWidth = width; cctx.setLineDash(dash);
  cctx.beginPath();
  cctx.moveTo(ca * CELL + CELL / 2, ra * CELL + CELL / 2);
  cctx.lineTo(cb * CELL + CELL / 2, rb * CELL + CELL / 2);
  cctx.stroke(); cctx.setLineDash([]);
}

function draw() {
  const s = client.getState();
  if (!s) return;
  const { G, ctx } = s;
  fitCanvas(G);
  const legal = human.has(ctx.currentPlayer) && !ctx.gameover ? legalNow() : [];
  const targets = spatialTargets(legal);
  const positions = new Map<number, string[]>();
  for (const [id, p] of Object.entries(G.players)) {
    const arr = positions.get(p.pos) ?? []; arr.push(id); positions.set(p.pos, arr);
  }
  const cur = G.players[ctx.currentPlayer];

  cctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1) tiles
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL;
    cctx.fillStyle = t.bridge ? BRIDGE_FILL : (t.terrain === 'water' && t.arm ? ARM_FILL : TERRAIN_FILL[t.terrain]);
    cctx.fillRect(x, y, CELL, CELL);
    if (!t.revealed) { cctx.fillStyle = 'rgba(5,8,5,0.55)'; cctx.fillRect(x, y, CELL, CELL); }  // fog
    cctx.strokeStyle = '#0b0f0a'; cctx.lineWidth = 1; cctx.setLineDash([]);
    cctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  }

  // 2) movement graph: solid roads, dashed footpaths (E + S edges only, to draw each once)
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0;
    if (c < G.cols - 1) { if (t.roads & 2) edgeLine(i, i + 1, G, '#9a8757', 3, []); else if (t.paths & 2) edgeLine(i, i + 1, G, '#84a684', 1.5, [3, 3]); }
    if (r < G.rows - 1) { if (t.roads & 4) edgeLine(i, i + G.cols, G, '#9a8757', 3, []); else if (t.paths & 4) edgeLine(i, i + G.cols, G, '#84a684', 1.5, [3, 3]); }
  }

  // 3) per-tile glyphs: hotspots + find tokens
  cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  for (let i = 0; i < G.map.length; i++) {
    const t = G.map[i], c = i % G.cols, r = (i / G.cols) | 0, x = c * CELL, y = r * CELL;
    if (t.hotspot) {
      cctx.fillStyle = '#0b0f0a'; cctx.beginPath(); cctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.27, 0, 7); cctx.fill();
      cctx.fillStyle = '#e8f0e2'; cctx.font = `bold ${CELL * 0.32}px ui-monospace, monospace`;
      cctx.fillText(HOTSPOT_LABEL[t.hotspot], x + CELL / 2, y + CELL / 2 + 1);
    }
    if (t.revealed && t.finds.length) {
      for (let k = 0; k < t.finds.length; k++) {
        cctx.fillStyle = DTYPE_COLOR[t.finds[k].type];
        cctx.beginPath(); cctx.arc(x + 7 + k * 8, y + CELL - 7, 3, 0, 7); cctx.fill();
      }
    }
  }

  // 4) legal-target rings for the current human player (solid = walk, dashed = drive)
  for (const [t, a] of targets) {
    const c = t % G.cols, r = (t / G.cols) | 0;
    cctx.strokeStyle = '#ffd24a'; cctx.lineWidth = 2.5;
    cctx.setLineDash(a.move === 'drive' ? [4, 3] : []);
    cctx.strokeRect(c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6);
  }
  cctx.setLineDash([]);

  // 5) hover highlight
  if (hover >= 0) {
    const c = hover % G.cols, r = (hover / G.cols) | 0;
    cctx.strokeStyle = '#e8f0e2'; cctx.lineWidth = 1.5;
    cctx.strokeRect(c * CELL + 1.5, r * CELL + 1.5, CELL - 3, CELL - 3);
  }

  // 6) players (offset when sharing a tile)
  for (const [tile, ids] of positions) {
    const c = tile % G.cols, r = (tile / G.cols) | 0;
    ids.forEach((id, k) => {
      const ox = ids.length > 1 ? (k - (ids.length - 1) / 2) * 12 : 0;
      const cx = c * CELL + CELL / 2 + ox, cy = r * CELL + CELL / 2;
      cctx.beginPath(); cctx.arc(cx, cy, CELL * 0.22, 0, 7);
      cctx.fillStyle = PLAYER_COLOR[+id % 4]; cctx.fill();
      cctx.lineWidth = id === ctx.currentPlayer ? 3 : 1.5;
      cctx.strokeStyle = id === ctx.currentPlayer ? '#ffffff' : '#0b0f0a'; cctx.stroke();
      cctx.fillStyle = '#0b0f0a'; cctx.font = `bold ${CELL * 0.24}px ui-monospace, monospace`;
      cctx.fillText(id, cx, cy + 1);
    });
  }

  renderHud(G, ctx, cur, legal);
}

function chip(label: string, color?: string) {
  return `<span class="chip"${color ? ` style="color:${color}"` : ''}>${label}</span>`;
}
function sampleChips(ds: Discovery[]): string {
  if (!ds.length) return '<span style="opacity:.5">none</span>';
  return ds.map(d => chip(`${d.type}${d.color}`, DTYPE_COLOR[d.type])).join('');
}

function renderHud(G: GState, ctx: any, cur: GState['players'][string], legal: Action[]) {
  // status line
  const phase = G.epilogue ? 'lab season' : `field turn ${ctx.turn}`;
  const seat = human.has(ctx.currentPlayer) ? 'your move' : 'bot thinking…';
  $('status').textContent = ctx.gameover
    ? `game over — winner P${ctx.gameover.winner}`
    : `${phase} · P${ctx.currentPlayer} (${seat}) · ${cur.ap} AP left · 🌧 ${G.monsoon}/4`;

  // player cards
  $('players').innerHTML = Object.entries(G.players).map(([id, p]) => {
    const c = id === ctx.currentPlayer ? 'pcard cur' : 'pcard';
    const vp = p.prestige + Math.floor(p.money / 4);
    return `<div class="${c}"><span class="who" style="color:${PLAYER_COLOR[+id % 4]}">P${id}</span>` +
      ` ${vp} VP · ${p.prestige}P · ${p.money}$ · gear ${p.gear}<br>` +
      `<span style="opacity:.7">carry:</span> ${sampleChips(p.samples)} ` +
      `<span style="opacity:.7">pub:</span> ${p.published.length}</div>`;
  }).join('');

  // action buttons — only the non-spatial legal actions (spatial ones are clicks on the board)
  const bar = $('actions'); bar.innerHTML = '';
  if (ctx.gameover) { bar.innerHTML = '<span style="opacity:.6">match complete</span>'; }
  else if (!human.has(ctx.currentPlayer)) { bar.innerHTML = '<span style="opacity:.6">waiting for bot…</span>'; }
  else {
    const tile = G.map[cur.pos];
    for (const a of legal) {
      let label: string | null = null;
      if (a.move === 'catalogue') { const d = tile.finds[a.args![0] as number]; label = `Catalogue ${d.type}${d.color}`; }
      else if (a.move === 'publish') { label = a.args![0] === 'rainbow' ? 'Publish rainbow (+7P)' : 'Publish triple (+4P)'; }
      else if (a.move === 'buy') label = 'Buy gear (−5$)';
      else if (a.move === 'helilift') label = 'Helilift → base (−12$)';
      else if (a.event === 'endTurn') label = 'End turn';
      if (label === null) continue;   // move/drive are board clicks
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => dispatch(a));
      bar.appendChild(btn);
    }
  }

  // log
  $('log').textContent = G.log.slice(-30).join('\n');
  $('legend').textContent =
    'gold ring = walk   dashed ring = drive   solid line = road   dashed line = path\n' +
    'H base  M village  R remote   dots = uncatalogued finds   ● = player';
}

// ---- input ----
canvas.addEventListener('mousemove', e => {
  const s = client.getState(); if (!s) return;
  const rect = canvas.getBoundingClientRect();
  const i = tileAt(e.clientX - rect.left, e.clientY - rect.top, s.G);
  if (i !== hover) { hover = i; draw(); }
  $('inspect').innerHTML = i < 0 ? 'hover a tile' : describeTile(s.G, i);
});
canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; draw(); } $('inspect').textContent = 'hover a tile'; });
canvas.addEventListener('click', e => {
  const s = client.getState(); if (!s || s.ctx.gameover) return;
  if (!human.has(s.ctx.currentPlayer)) return;        // not your turn
  const rect = canvas.getBoundingClientRect();
  const i = tileAt(e.clientX - rect.left, e.clientY - rect.top, s.G);
  if (i < 0) return;
  const a = spatialTargets(legalNow()).get(i);
  if (a) dispatch(a);
});

function describeTile(G: GState, i: number): string {
  const t = G.map[i];
  const bits = [`#${i}`, t.bridge ? `${t.bridge} bridge` : (t.terrain === 'water' && t.arm ? 'river arm' : t.terrain)];
  if (t.hotspot) bits.push(t.hotspot);
  if (!t.revealed) bits.push('unexplored');
  else if (t.finds.length) bits.push('finds: ' + t.finds.map(d => `${d.type}${d.color}`).join(' '));
  return bits.join(' · ');
}

// ---- controls ----
$('reset').addEventListener('click', () => { stopBot(); client.reset(); hover = -1; scheduleBot(); draw(); });
$('hint').addEventListener('click', () => {           // let the bot play one action for the current human seat
  const s = client.getState(); if (!s || s.ctx.gameover || !human.has(s.ctx.currentPlayer)) return;
  dispatch(botAction(s.G, s.ctx, Math.random) as Action);
});

scheduleBot();
draw();
