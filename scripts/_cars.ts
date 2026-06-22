import { Client } from 'boardgame.io/client';
import { Expedition, botAction, CARS } from '../src/game';
import type { GState } from '../src/game';
const N=700; const avg=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
function run(label:string, count:'perPlayer'|number){
  CARS.count=count;
  const vp:number[][]=[[],[],[],[]]; const wins=[0,0,0,0]; let drives=0, done=0, winVP:number[]=[];
  for(let m=0;m<N;m++){
    const client=Client<GState>({game:Expedition,numPlayers:4}); client.start();
    for(let s=0;s<20000;s++){
      const st=client.getState(); if(!st||st.ctx.gameover)break; const {G,ctx}=st;
      const a=botAction(G,ctx,Math.random);
      if(a.move==='drive') drives++;
      if(a.move)(client.moves as any)[a.move](...(a.args??[])); else (client.events as any)[a.event??'endTurn']?.();
      const af=client.getState(); if(af&&af._stateID===st._stateID)client.events.endTurn?.();
    }
    const fin=client.getState(); if(!fin?.ctx.gameover)continue; done++;
    const sc=(fin.ctx.gameover as any).scores as Record<string,number>;
    let best=0; for(let i=1;i<4;i++) if(sc[String(i)]>sc[String(best)]) best=i; wins[best]++;
    winVP.push(sc[String(best)]);
    for(let i=0;i<4;i++) vp[i].push(sc[String(i)]);
  }
  console.log(`\n=== ${label} (${done} matches) ===`);
  for(let i=0;i<4;i++) console.log(`  P${i}: VP ${avg(vp[i]).toFixed(2)} · win ${(100*wins[i]/done).toFixed(1)}%`);
  console.log(`  winner VP ${avg(winVP).toFixed(1)} · drives/match ${(drives/done).toFixed(2)} · win spread ${((Math.max(...wins)-Math.min(...wins))*100/done).toFixed(1)}pts`);
}
run('per-player cars (4)','perPlayer');
run('only 2 cars',2);
