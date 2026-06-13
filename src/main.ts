import { Client } from 'boardgame.io/client';
import { Expedition, botAction, enumerate } from './game';
import type { GState } from './game';
import {
  PLAYER_COLOR, drawBoard, fitCanvas, tileAt, spatialTargets,
  actionLabel, describeTile, sampleChips, logToasts, prettyLog, publishPreviews,
  type Action, type Toast,
} from './render';

// ---- Canvas viewer + click-to-play. The bgio headless Client is the engine;
// rendering (shared with the bgio frontend via render.ts) and input are custom.
// Every legal action — clickable tile targets and the action buttons — is read
// straight from the game's own enumerate(), so the UI can never offer a move
// the rules would reject. ----

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('board') as HTMLCanvasElement;
$('built').textContent = `built ${__BUILD_TIME__}`;

const client = Client<GState>({ game: Expedition, numPlayers: 2 });
client.start();

const human = new Set<string>(['0']);   // seats a person controls; the rest are bot-played
($('human0') as HTMLInputElement).addEventListener('change', e => syncSeat('0', e));
($('human1') as HTMLInputElement).addEventListener('change', e => syncSeat('1', e));
function syncSeat(id: string, e: Event) {
  if ((e.target as HTMLInputElement).checked) human.add(id); else human.delete(id);
  scheduleBot(); draw();
}

let botTimer: number | undefined;
let hover = -1;

function legalNow(): Action[] {
  const s = client.getState();
  if (!s || s.ctx.gameover) return [];
  return enumerate(s.G, s.ctx) as Action[];
}

function dispatch(a: Action) {
  if (a.move) (client.moves as Record<string, (...x: unknown[]) => void>)[a.move](...(a.args ?? []));
  else (client.events as Record<string, () => void>)[a.event ?? 'endTurn']?.();
  scheduleBot();
  draw();
}

function scheduleBot() {
  const s = client.getState();
  if (!s || s.ctx.gameover || human.has(s.ctx.currentPlayer)) { stopBot(); return; }
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

const toastBox = $('toasts');
let lastLog = 0, toastInit = false;
function syncToasts(G: GState) {
  if (!toastInit) { lastLog = G.log.length; toastInit = true; return; }   // skip the setup backlog
  if (lastLog > G.log.length) lastLog = 0;                                 // new match → log reset
  for (const t of logToasts(lastLog, G.log)) showToast(t);
  lastLog = G.log.length;
}
function showToast(t: Toast) {
  const el = document.createElement('div');
  el.className = `toast ${t.kind}`; el.textContent = t.text;
  toastBox.appendChild(el);
  while (toastBox.childElementCount > 5) toastBox.firstElementChild?.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
}

function draw() {
  const s = client.getState();
  if (!s) return;
  const { G, ctx } = s;
  syncToasts(G);
  const cctx = fitCanvas(canvas, G);
  const legal = human.has(ctx.currentPlayer) && !ctx.gameover ? legalNow() : [];
  drawBoard(cctx, G, ctx, { hover, targets: spatialTargets(legal, G, ctx.currentPlayer) });
  renderHud(G, ctx, legal);
}

function renderHud(G: GState, ctx: any, legal: Action[]) {
  const cur = G.players[ctx.currentPlayer];
  const phase = G.epilogue ? 'lab' : `T${ctx.turn}`;
  const seat = human.has(ctx.currentPlayer) ? 'you' : 'bot…';
  $('status').textContent = ctx.gameover
    ? `game over — winner P${ctx.gameover.winner}`
    : `${phase} · P${ctx.currentPlayer} (${seat}) · ${cur.ap}AP · 🌧${G.monsoon}/4`;

  $('plan').innerHTML = ctx.gameover ? '' : publishPreviews(G, ctx.currentPlayer).map(pat => {
    const cells = pat.cells.map(c => {
      const inner = c.swatch && c.icon ? `<span class="sw" style="background:${c.swatch}">${c.icon}</span>`
        : c.swatch ? `<span class="sw" style="background:${c.swatch}"></span>`
        : (c.icon ?? '·');
      return `<span class="cell ${c.state}">${inner}</span>`;
    }).join('');
    return `<span class="pat${pat.ready ? ' ready' : ''}"><span class="nm">${pat.label}</span>` +
      `<span class="cells">${cells}</span><span class="rw">${pat.reward}</span>${pat.ready ? ' ✓' : ''}</span>`;
  }).join('');

  $('players').innerHTML = Object.entries(G.players).map(([id, p]) => {
    const c = id === ctx.currentPlayer ? 'pcard cur' : 'pcard';
    const vp = p.prestige + Math.floor(p.money / 4);
    const driving = G.vehicles.some(v => v.driver === id) ? ' 🚗' : '';
    return `<div class="${c}"><span class="who" style="color:${PLAYER_COLOR[+id % 4]}">P${id}</span>${driving}${p.boat ? ' ⛵' : ''}` +
      ` ${vp} pts · ${p.prestige} prestige · ${p.money}$ · gear ${p.gear}<br>` +
      `<span style="opacity:.7">carry:</span> ${sampleChips(p.samples)} ` +
      `${p.stash.length ? `<span style="opacity:.7">stash:</span> ${sampleChips(p.stash)} ` : ''}` +
      `<span style="opacity:.7">pub:</span> ${p.published.length}</div>`;
  }).join('');

  const bar = $('actions'); bar.innerHTML = '';
  if (ctx.gameover) bar.innerHTML = '<span style="opacity:.6">match complete</span>';
  else if (!human.has(ctx.currentPlayer)) bar.innerHTML = '<span style="opacity:.6">waiting for bot…</span>';
  else {
    const tile = G.map[cur.pos];
    // stable layout: fixed left order so buttons never shuffle; helilift + End turn pinned right
    const labeled = legal.map(a => ({ a, label: actionLabel(a, tile, G.goals) })).filter((x): x is { a: Action; label: string } => x.label !== null);
    const order: Record<string, number> = { catalogue: 0, publish: 1, buy: 2, board: 3, leave: 4, pickup: 5, drop: 6 };
    const rank = (a: Action) => a.event === 'endTurn' ? 99 : a.move === 'helilift' ? 90 : (order[a.move ?? ''] ?? 50);
    const isRight = (a: Action) => a.move === 'helilift' || a.event === 'endTurn';
    labeled.sort((p, q) => rank(p.a) - rank(q.a));
    const right = document.createElement('span'); right.className = 'bar-right';
    for (const x of labeled) {
      const btn = document.createElement('button');
      btn.textContent = x.label;
      btn.addEventListener('click', () => dispatch(x.a));
      (isRight(x.a) ? right : bar).appendChild(btn);
    }
    if (right.childElementCount) bar.appendChild(right);
  }

  $('log').textContent = G.log.slice(-30).map(prettyLog).join('\n');
}

canvas.addEventListener('mousemove', e => {
  const s = client.getState(); if (!s) return;
  const rect = canvas.getBoundingClientRect();
  const i = tileAt(e.clientX - rect.left, e.clientY - rect.top, s.G);
  if (i !== hover) { hover = i; draw(); }
  $('inspect').innerHTML = i < 0 ? 'hover a tile' : describeTile(s.G, i);
});
canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; draw(); } $('inspect').textContent = 'hover a tile'; });
canvas.addEventListener('click', e => {
  const s = client.getState(); if (!s || s.ctx.gameover || !human.has(s.ctx.currentPlayer)) return;
  const rect = canvas.getBoundingClientRect();
  const i = tileAt(e.clientX - rect.left, e.clientY - rect.top, s.G);
  if (i < 0) return;
  const a = spatialTargets(legalNow(), s.G, s.ctx.currentPlayer).get(i);
  if (a) dispatch(a);
});

$('reset').addEventListener('click', () => { stopBot(); client.reset(); hover = -1; scheduleBot(); draw(); });
$('hint').addEventListener('click', () => {
  const s = client.getState(); if (!s || s.ctx.gameover || !human.has(s.ctx.currentPlayer)) return;
  dispatch(botAction(s.G, s.ctx, Math.random) as Action);
});

window.addEventListener('resize', draw);   // re-fit the board to the viewport
scheduleBot();
draw();
