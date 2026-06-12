// Real-engine smoke test: drive N matches through the actual boardgame.io
// Client with the heuristic bot; every match must reach a valid `gameover`.
// This is the CI gate — if the rules can deadlock or never terminate, it fails.
import { Client } from 'boardgame.io/client';
import { Expedition, botAction } from '../src/game';
import type { GState } from '../src/game';

const MATCHES = Number(process.argv[2] ?? 20);
const STEP_CAP = 20000;

function playMatch(i: number): { winner: string; scores: Record<string, number>; steps: number } {
  const client = Client<GState>({ game: Expedition, numPlayers: 2 });
  client.start();
  let steps = 0;
  for (; steps < STEP_CAP; steps++) {
    const state = client.getState();
    if (!state) throw new Error(`match ${i}: null state`);
    if (state.ctx.gameover) {
      const go = state.ctx.gameover as { winner: string; scores: Record<string, number> };
      return { ...go, steps };
    }
    const { G, ctx } = state;
    const action = botAction(G, ctx, Math.random);
    if (action.move) (client.moves as Record<string, (...a: unknown[]) => void>)[action.move](...(action.args ?? []));
    else (client.events as Record<string, () => void>)[action.event ?? 'endTurn']?.();
    const after = client.getState();
    if (after && after._stateID === state._stateID) client.events.endTurn?.();
  }
  throw new Error(`match ${i}: exceeded ${STEP_CAP} steps without gameover`);
}

let ok = 0;
for (let i = 0; i < MATCHES; i++) {
  const { winner, scores, steps } = playMatch(i);
  if (winner === undefined || scores === undefined) throw new Error(`match ${i}: invalid gameover`);
  ok++;
  console.log(`match ${i}: winner P${winner}  scores ${JSON.stringify(scores)}  (${steps} steps)`);
}
console.log(`\n✓ smoke passed: ${ok}/${MATCHES} matches reached a valid gameover`);
