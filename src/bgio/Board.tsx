import { useEffect, useRef, useState } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import { enumerate, botAction } from '../game';
import type { GState } from '../game';
import {
  PLAYER_COLOR, drawBoard, fitCanvas, tileAt, spatialTargets,
  actionLabel, describeTile, sampleChips, type Action,
} from '../render';

// bgio React board. Same shared renderer as the Canvas viewer (terrain, paths,
// discovery slots, hotspots, players, vehicles, dropped equipment), plus rich
// per-player panels and click-to-play. Pairs with the bgio Debug panel (raw
// state inspection) and is multiplayer-ready for future remote play.

type Props = BoardProps<GState>;

export function Board({ G, ctx, moves, events, reset, playerID }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(-1);

  // a "seat" the local window controls: the bound playerID, or the current
  // player when unbound (single-window hot-seat / inspection).
  const seat = playerID ?? ctx.currentPlayer;
  const myTurn = !ctx.gameover && seat === ctx.currentPlayer;
  const legal: Action[] = myTurn ? (enumerate(G, ctx) as Action[]) : [];
  const targets = spatialTargets(legal);

  function dispatch(a: Action) {
    if (a.move) (moves as Record<string, (...x: unknown[]) => void>)[a.move](...(a.args ?? []));
    else (events as Record<string, (() => void) | undefined>)[a.event ?? 'endTurn']?.();
  }

  // redraw on any state/hover change
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const cctx = fitCanvas(cv, G);
    drawBoard(cctx, G, ctx, { hover, targets });
  });

  const cur = G.players[ctx.currentPlayer];
  const tile = G.map[G.players[seat].pos];

  return (
    <div>
      <h1>Expedition: Verdant Prime</h1>
      <div className="sub">
        bgio frontend — full state inspection (Debug panel ↘) &amp; click-to-play ·{' '}
        <a href="index.html">lean canvas viewer ↗</a>
      </div>
      <div className="controls">
        <button onClick={() => reset()}>New match</button>
        <button
          disabled={!myTurn}
          onClick={() => dispatch(botAction(G, ctx, Math.random) as Action)}
        >Bot: suggest move</button>
        <span style={{ fontSize: '.78rem', color: '#6f8f70' }}>
          seat P{seat}{playerID == null ? ' (hot-seat: follows current player)' : ''}
        </span>
      </div>
      <div className="cols">
        <div>
          <canvas
            ref={canvasRef}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover(tileAt(e.clientX - r.left, e.clientY - r.top, G));
            }}
            onMouseLeave={() => setHover(-1)}
            onClick={(e) => {
              if (!myTurn) return;
              const r = e.currentTarget.getBoundingClientRect();
              const i = tileAt(e.clientX - r.left, e.clientY - r.top, G);
              const a = targets.get(i);
              if (a) dispatch(a);
            }}
          />
          <div className="legend">
            {'gold ring = walk   dashed ring = drive   solid line = road   dashed line = path\n'}
            {'H base  M village  R remote   ▫ = gear cache   ▭ = car   dots = finds   ● = player'}
          </div>
        </div>
        <div className="side">
          <div className="status">
            {ctx.gameover
              ? `game over — winner P${ctx.gameover.winner}`
              : `${G.epilogue ? 'lab season' : `field turn ${ctx.turn}`} · P${ctx.currentPlayer} · ${cur.ap} AP · 🌧 ${G.monsoon}/4`}
          </div>

          <div className="panel">
            <h2>Players</h2>
            {Object.entries(G.players).map(([id, p]) => {
              const vp = p.prestige + Math.floor(p.money / 4);
              const driving = G.vehicles.some((v) => v.driver === id);
              return (
                <div key={id} className={id === ctx.currentPlayer ? 'pcard cur' : 'pcard'}>
                  <span className="who" style={{ color: PLAYER_COLOR[+id % 4] }}>P{id}</span>
                  {driving ? ' 🚗' : ''} {vp} VP · {p.prestige}P · gear {p.gear}
                  <div className="pool">money pool: {p.money}$</div>
                  <div className="pool">
                    inventory: <span dangerouslySetInnerHTML={{ __html: sampleChips(p.samples) }} />
                  </div>
                  <div className="pool">
                    published: {p.published.length
                      ? <span dangerouslySetInnerHTML={{ __html: sampleChips(p.published) }} />
                      : <span style={{ opacity: 0.5 }}>none</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h2>Your actions</h2>
            <div className="bar">
              {ctx.gameover ? <span style={{ opacity: 0.6 }}>match complete</span>
                : !myTurn ? <span style={{ opacity: 0.6 }}>P{ctx.currentPlayer} to move</span>
                  : legal.map((a, k) => {
                    const label = actionLabel(a, tile);
                    return label === null ? null : <button key={k} onClick={() => dispatch(a)}>{label}</button>;
                  })}
            </div>
          </div>

          <div className="panel">
            <h2>Inspect</h2>
            <div id="inspect" dangerouslySetInnerHTML={{ __html: hover < 0 ? 'hover a tile' : describeTile(G, hover) }} />
          </div>

          <div className="panel">
            <h2>Log</h2>
            <pre className="log">{G.log.slice(-30).join('\n')}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
