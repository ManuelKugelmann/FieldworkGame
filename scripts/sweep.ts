// Headless balance sweep: run N self-play matches and print aggregate metrics.
// Use to sanity-check tunables after a rules change (winner ~12-15 at current
// knobs; a big jump means a balance knob moved).
import { Client } from 'boardgame.io/client';
import { Expedition, botAction } from '../src/game';
import type { GState } from '../src/game';

const MATCHES = Number(process.argv[2] ?? 50);
const STEP_CAP = 20000;

const tally = { publishes: 0, cited: 0, drives: 0, helilifts: 0, gear: 0 };
const winScores: number[] = [];
const spreads: number[] = [];

for (let i = 0; i < MATCHES; i++) {
  const client = Client<GState>({ game: Expedition, numPlayers: 2 });
  client.start();
  let steps = 0;
  for (; steps < STEP_CAP; steps++) {
    const state = client.getState();
    if (!state || state.ctx.gameover) break;
    const { G, ctx } = state;
    const action = botAction(G, ctx, Math.random);
    if (action.move) (client.moves as Record<string, (...a: unknown[]) => void>)[action.move](...(action.args ?? []));
    else (client.events as Record<string, () => void>)[action.event ?? 'endTurn']?.();
    const after = client.getState();
    if (after && after._stateID === state._stateID) client.events.endTurn?.();
  }
  const final = client.getState();
  if (!final?.ctx.gameover) { console.warn(`match ${i}: no gameover`); continue; }
  for (const line of final.G.log) {
    if (line.startsWith('publish')) { tally.publishes++; if (line.includes('(cited')) tally.cited++; }
    else if (line.startsWith('drive')) tally.drives++;
    else if (line.startsWith('helilift')) tally.helilifts++;
    else if (line.startsWith('buy gear')) tally.gear++;
  }
  const scores = (final.ctx.gameover as { scores: Record<string, number> }).scores;
  const vals = Object.values(scores);
  winScores.push(Math.max(...vals));
  spreads.push(Math.max(...vals) - Math.min(...vals));
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const n = winScores.length;
console.log(`sweep over ${n} matches (per-match averages):`);
console.log(`  publishes : ${(tally.publishes / n).toFixed(2)}`);
console.log(`  cited     : ${(tally.cited / n).toFixed(2)}`);
console.log(`  drives    : ${(tally.drives / n).toFixed(2)}`);
console.log(`  helilifts : ${(tally.helilifts / n).toFixed(2)}`);
console.log(`  gear buys : ${(tally.gear / n).toFixed(2)}`);
console.log(`  winner VP : ${avg(winScores).toFixed(1)}  (spread ${avg(spreads).toFixed(1)})`);
