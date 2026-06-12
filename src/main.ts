import { Client } from 'boardgame.io/client';
import { Expedition, botAction } from './game';
import type { GState, Tile } from './game';

// ---- minimal ASCII viewer + heuristic self-play. No React: the raw client is
// environment-agnostic, which keeps the static bundle small and CDN-safe. ----

const GLYPH: Record<Tile['terrain'], string> = {
  road: '=', wild: '"', forest: '♣', rocky: '^', water: '~',
};
const HOTSPOT: Record<NonNullable<Tile['hotspot']>, string> = {
  base: 'H', village: 'M', remote: 'R',
};

function glyph(t: Tile): string {
  if (t.bridge) return '#';
  if (t.hotspot) return HOTSPOT[t.hotspot];
  if (t.terrain === 'water' && t.arm) return '≈';
  return GLYPH[t.terrain];
}

function renderMap(G: GState, positions: Set<number>): string {
  const rows: string[] = [];
  for (let r = 0; r < G.rows; r++) {
    let line = '';
    for (let c = 0; c < G.cols; c++) {
      const i = r * G.cols + c;
      line += positions.has(i) ? '@' : glyph(G.map[i]);
    }
    rows.push(line);
  }
  return rows.join('\n');
}

const $ = (id: string) => document.getElementById(id)!;
const client = Client<GState>({ game: Expedition, numPlayers: 2 });
client.start();

let timer: number | undefined;

function draw() {
  const state = client.getState();
  if (!state) return;
  const { G, ctx } = state;
  const positions = new Set(Object.values(G.players).map((p) => p.pos));
  $('map').textContent = renderMap(G, positions);
  $('log').textContent = G.log.slice(-40).join('\n');
  $('legend').textContent =
    '= road  " wild  ♣ forest  ^ rocky  ~ river  ≈ arm  # bridge\n' +
    'H base  M village  R remote  @ player';
  const scores = Object.entries(G.players)
    .map(([id, p]) => `P${id}: ${p.prestige}P ${p.money}$`)
    .join('   ');
  $('status').textContent = ctx.gameover
    ? `game over — winner P${ctx.gameover.winner}  (${scores})`
    : `${G.epilogue ? 'lab' : 'field'} turn ${ctx.turn}  ${scores}`;
}

function step(): boolean {
  const state = client.getState();
  if (!state || state.ctx.gameover) return false;
  const { G, ctx } = state;
  const action = botAction(G, ctx, Math.random);
  if (action.move) (client.moves as Record<string, (...a: unknown[]) => void>)[action.move](...(action.args ?? []));
  else (client.events as Record<string, () => void>)[action.event ?? 'endTurn']?.();
  // guard against a rejected move (INVALID_MOVE leaves stateID unchanged) stalling the loop
  const after = client.getState();
  if (after && after._stateID === state._stateID) client.events.endTurn?.();
  draw();
  return !client.getState()?.ctx.gameover;
}

$('step').addEventListener('click', () => step());
$('auto').addEventListener('click', () => {
  if (timer !== undefined) { clearInterval(timer); timer = undefined; return; }
  timer = window.setInterval(() => { if (!step()) { clearInterval(timer); timer = undefined; } }, 120);
});
$('reset').addEventListener('click', () => { client.reset(); draw(); });

draw();
