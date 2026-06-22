import { Client } from 'boardgame.io/client';
import { Expedition, botAction, ROLES } from '../src/game';
import type { GState } from '../src/game';
const N = 4, M = 1000;
type Rec = { vp: number; cat: number; fpub: number; fpts: number; lpub: number; lpts: number; n: number };
const blank = (): Rec => ({ vp: 0, cat: 0, fpub: 0, fpts: 0, lpub: 0, lpts: 0, n: 0 });
const seat: Rec[] = Array.from({ length: N }, blank);
const role: Record<string, Rec> = {}; for (const r of ROLES) role[r] = blank();
for (let m = 0; m < M; m++) {
  const client = Client<GState>({ game: Expedition, numPlayers: N }); client.start();
  const roleOf: string[] = []; { const st: any = client.getState(); for (let i = 0; i < N; i++) roleOf[i] = st.G.players[i].role; }
  const ms = Array.from({ length: N }, blank);
  for (let s = 0; s < 30000; s++) {
    const st: any = client.getState(); if (!st || st.ctx.gameover) break;
    const pid = +st.ctx.currentPlayer, G = st.G;
    const a = botAction(G, st.ctx, Math.random);
    if (a.move === 'catalogue') ms[pid].cat++;
    if (a.move === 'publish') { const g: any = G.goals.find((x: any) => x.id === a.args![0]); const pts = g ? g.prestige : 0;
      if (G.epilogue) { ms[pid].lpub++; ms[pid].lpts += pts; } else { ms[pid].fpub++; ms[pid].fpts += pts; } }
    if (a.move) (client.moves as any)[a.move](...(a.args ?? [])); else (client.events as any)[a.event ?? 'endTurn']?.();
    const af: any = client.getState(); if (af && af._stateID === st._stateID) client.events.endTurn?.();
  }
  const f: any = client.getState(); if (!f?.ctx.gameover) continue;
  for (let i = 0; i < N; i++) {
    ms[i].vp = f.ctx.gameover.scores[i];
    for (const k of ['vp','cat','fpub','fpts','lpub','lpts'] as const) { seat[i][k] += ms[i][k]; role[roleOf[i]][k] += ms[i][k]; }
    seat[i].n++; role[roleOf[i]].n++;
  }
}
const row = (label: string, r: Rec) => `  ${label.padEnd(13)} VP ${(r.vp/r.n).toFixed(1).padStart(5)} · cat ${(r.cat/r.n).toFixed(1).padStart(4)} · field pub ${(r.fpub/r.n).toFixed(2)} (${(r.fpts/r.n).toFixed(1)}p) · lab pub ${(r.lpub/r.n).toFixed(2)} (${(r.lpts/r.n).toFixed(1)}p)`;
console.log(`\n=== ${M} 4-player matches — by SEAT (play order) ===`);
for (let i = 0; i < N; i++) console.log(row(`P${i}`, seat[i]));
console.log(`\n=== by SPECIALIZATION (role) ===`);
for (const r of ROLES) console.log(row(r, role[r]));
