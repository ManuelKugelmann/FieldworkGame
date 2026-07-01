import { Client } from 'boardgame.io/client';
import { Expedition, botAction, enumerate, GEAR_MAX, SPECIMEN_MAX, MONSOON_END } from './game';
import type { GState } from './game';
import {
  playerColor, EVENT_LABEL, money$, drawBoard, fitCanvas, tileAt, spatialTargets,
  actionLabel, sampleChips, maskedChips, gearChips, roleBonusChip, emptySlots, logToasts, prettyLog, publishPreviews, roleBadge,
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

const client = Client<GState>({ game: Expedition, numPlayers: 4 });
client.start();

const human = new Set<string>(['0']);   // seats a person controls; the rest are bot-played
for (let s = 0; s < 4; s++) ($(`human${s}`) as HTMLInputElement | null)?.addEventListener('change', e => syncSeat(String(s), e));
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
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, t.hold ?? 4200);
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
  const phase = G.epilogue ? 'Lab season' : `Turn ${ctx.turn}`;
  const isBot = !human.has(ctx.currentPlayer);
  const left = MONSOON_END - G.monsoon;   // rounds until the field season ends; only telegraphed once the monsoon starts
  const endWarn = !G.epilogue && G.monsoon > 0 ? ` · ⛈ ${left} round${left === 1 ? '' : 's'} to end of field season` : '';
  const roundEv = !G.epilogue && G.roundEvent && EVENT_LABEL[G.roundEvent] ? ` · ${EVENT_LABEL[G.roundEvent]}` : '';   // the one global event affecting everyone this round
  $('status').textContent = ctx.gameover
    ? `game over — winner Player ${+ctx.gameover.winner + 1}`
    : `${phase}${isBot ? ' · 🤖' : ''}${roundEv}${endWarn}`;
  $('research-h').innerHTML = ctx.gameover ? 'Research' : `📜 Research <span class="ap">1/turn</span>`;   // at most one publish per turn (no AP cost)

  $('plan').innerHTML = ctx.gameover ? '' : publishPreviews(G, ctx.currentPlayer).map(pat => {
    const cells = pat.cells.map(c =>   // no progress indicators — just the target tokens; the player reads the pools/inventory themselves
      c.swatch ? `<span class="tok" style="background:${c.swatch}">${c.icon ?? ''}</span>` : `<span class="tok lit">${c.icon ?? '·'}</span>`
    ).join('');
    return `<span class="pat"><span class="cells">${cells}</span><span class="rw">${pat.reward}</span></span>`;
  }).join('');

  const remoteT = G.map.findIndex(t => t.hotspot === 'remote');   // the two shared open pools (community cards): base lab + frontier research site
  const poolRow = (label: string, ds: typeof G.map[number]['cache']) =>
    `<div class="pcard"><span class="who">${label}</span> <span style="opacity:.7">${ds.length}</span> ${ds.length ? sampleChips(ds) : '<span style="opacity:.5">empty</span>'}</div>`;
  $('pools').innerHTML = poolRow('🏢 Research base', G.map[G.base].cache) + (remoteT >= 0 ? poolRow('⛺ Frontier base', G.map[remoteT].cache) : '');

  $('players').innerHTML = Object.entries(G.players).map(([id, p]) => {
    const c = id === ctx.currentPlayer ? 'pcard cur' : 'pcard';
    const mine = human.has(id);   // you only see colours of the seats you control; opponents' are concealed
    const vp = p.prestige + Math.floor(p.money / 4);
    const drove = G.vehicles.find(v => v.driver === id);
    const driving = drove ? ` <span class="chip">${drove.kind === 'motorboat' ? '🛥️ boat' : '🚗 car'}</span>` : '';   // boarded vehicle, shown in the player card
    const specimens = mine ? sampleChips(p.samples) : maskedChips(p.samples);   // your in-transit hand (not droppable; force-stashed at a research site)
    const specEmpties = mine ? emptySlots(SPECIMEN_MAX - p.samples.length) : '';   // free specimen slots (8 max) — your own seat only
    const empties = emptySlots(GEAR_MAX - p.gear.length);   // free gear slots (3 max)
    const isCur = id === ctx.currentPlayer && !ctx.gameover;
    const apBox = isCur ? ` <span class="ap">${p.ap} AP</span>` : '';
    const pubBox = isCur && p.pubTurn !== ctx.turn ? ` 📜<span class="ap">can publish</span>` : '';
    const dot = '<span style="opacity:.35">·</span>';   // placeholder when empty
    return `<div class="${c}"><div class="who" style="color:${playerColor(p.role)}">Player ${+id + 1} ${roleBadge(p.role)}${driving}${p.boat ? ' 🛶' : ''}${p.camp ? ' 🏕️' : ''}${apBox}${pubBox}</div>` +
      `<div class="stat">🎓 ${p.prestige} · ${money$(p.money)} · <b>Σ ${vp}</b></div>` +
      `<div class="inv">${specimens || dot}${specEmpties}</div><div class="inv">${roleBonusChip(p.role)}${gearChips(p.gear)}${empties}</div></div>`;
  }).join('');

  const bar = $('actions'); bar.innerHTML = '';
  if (ctx.gameover) bar.innerHTML = '<span style="opacity:.6">match complete</span>';
  else if (!human.has(ctx.currentPlayer)) bar.innerHTML = '<span style="opacity:.6">waiting for bot…</span>';
  else {
    const tile = G.map[cur.pos];
    // stable layout: fixed left order so buttons never shuffle; helilift + End turn pinned right
    const carHere = G.vehicles.find(v => v.pos === cur.pos);
    const seenBoard = new Set<string>();   // multiple cars/boats on the tile → offer a single "Board car"/"Board boat"
    const dedup = legal.filter(a => {
      if (a.move !== 'board') return true;
      const k = G.vehicles[a.args![0] as number]?.kind ?? 'car';
      if (seenBoard.has(k)) return false; seenBoard.add(k); return true;
    });
    const labeled = dedup.map(a => {
      let label = actionLabel(a, tile, G.goals, cur, carHere);
      if (a.move === 'board' && label) label = G.vehicles[a.args![0] as number]?.kind === 'motorboat' ? 'Board boat' : 'Board car';
      return { a, label };
    }).filter((x): x is { a: Action; label: string } => x.label !== null);
    const order: Record<string, number> = { catalogue: 0, publish: 1, deploy: 1.5, buy: 2, board: 3, leave: 4, pickup: 5, discard: 6, drop: 6, stash: 7, unstash: 8 };
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
});
canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; draw(); } });
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
