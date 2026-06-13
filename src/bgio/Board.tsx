import { useEffect, useRef, useState } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import { enumerate, botAction } from '../game';
import type { GState } from '../game';
import {
  PLAYER_COLOR, drawBoard, fitCanvas, tileAt, spatialTargets,
  actionLabel, describeTile, sampleChips, logToasts, type Action, type Toast,
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
  const targets = spatialTargets(legal, G, ctx.currentPlayer);

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

  // re-fit the board to the viewport on resize
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // toasts: surface fresh G.log outcomes (catalogue success/fail/stay/flee/destroyed, publishes, events)
  const [toasts, setToasts] = useState<{ id: number; t: Toast }[]>([]);
  const lastLog = useRef<number>(G.log.length);
  const nextId = useRef(0);
  useEffect(() => {
    if (lastLog.current > G.log.length) lastLog.current = 0;   // new match → log reset
    const fresh = logToasts(lastLog.current, G.log);
    lastLog.current = G.log.length;
    if (!fresh.length) return;
    const items = fresh.map((t) => ({ id: nextId.current++, t }));
    setToasts((prev) => [...prev, ...items].slice(-5));
    const timers = items.map((it) => window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== it.id)), 2400));
    return () => timers.forEach(clearTimeout);
  }, [G.log.length]);

  const cur = G.players[ctx.currentPlayer];
  const tile = G.map[G.players[seat].pos];

  // built once, rendered twice: directly under the board on mobile, in the side panel on desktop
  const actionsContent = ctx.gameover ? <span style={{ opacity: 0.6 }}>match complete</span>
    : !myTurn ? <span style={{ opacity: 0.6 }}>P{ctx.currentPlayer} to move</span>
      : (() => {
        // stable layout: fixed left order so buttons never shuffle; helilift + End turn pinned right
        const labeled = legal.map((a) => ({ a, label: actionLabel(a, tile) })).filter((x): x is { a: Action; label: string } => x.label !== null);
        const order: Record<string, number> = { catalogue: 0, publish: 1, buy: 2, board: 3, leave: 4, pickup: 5, drop: 6 };
        const rank = (a: Action) => a.event === 'endTurn' ? 99 : a.move === 'helilift' ? 90 : (order[a.move ?? ''] ?? 50);
        const key = (a: Action) => `${a.move ?? a.event}:${(a.args ?? []).join(',')}`;
        const isRight = (a: Action) => a.move === 'helilift' || a.event === 'endTurn';
        const sorted = labeled.slice().sort((p, q) => rank(p.a) - rank(q.a));
        const left = sorted.filter((x) => !isRight(x.a)), right = sorted.filter((x) => isRight(x.a));
        const btn = (x: { a: Action; label: string }) => <button key={key(x.a)} onClick={() => dispatch(x.a)}>{x.label}</button>;
        return <>{left.map(btn)}{right.length > 0 && <span className="bar-right">{right.map(btn)}</span>}</>;
      })();

  return (
    <div>
      <div className="toasts">
        {toasts.map(({ id, t }) => <div key={id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
      <div className="controls">
        <button onClick={() => reset()}>New</button>
        <button disabled={!myTurn} onClick={() => dispatch(botAction(G, ctx, Math.random) as Action)}>Suggest</button>
        <span className="turnline">{ctx.gameover ? `game over — winner P${ctx.gameover.winner}` : `${G.epilogue ? 'lab' : `turn ${ctx.turn}`} · P${ctx.currentPlayer}${seat === ctx.currentPlayer ? ' (you)' : ''} · ${cur.ap} AP · 🌧 ${G.monsoon}/4`}</span>
        <span className="built">built {__BUILD_TIME__}</span>
      </div>
      <div className="cols">
        <div className="boardwrap">
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
          <div className="bar actions-board">{actionsContent}</div>
          {hover >= 0 && <div className="inspectline" dangerouslySetInnerHTML={{ __html: describeTile(G, hover) }} />}
        </div>
        <div className="side">
          <div className="panel">
            <h2>Players</h2>
            {Object.entries(G.players).map(([id, p]) => {
              const vp = p.prestige + Math.floor(p.money / 4);
              const driving = G.vehicles.some((v) => v.driver === id);
              return (
                <div key={id} className={id === ctx.currentPlayer ? 'pcard cur' : 'pcard'}>
                  <span className="who" style={{ color: PLAYER_COLOR[+id % 4] }}>P{id}</span>{driving ? ' 🚗' : ''}{p.boat ? ' ⛵' : ''} · {vp}pts · {p.prestige}P · {p.money}$ · g{p.gear} · <span dangerouslySetInnerHTML={{ __html: sampleChips(p.samples) }} /> · pub {p.published.length}
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h2>Log</h2>
            <pre className="log">{G.log.slice(-30).join('\n')}</pre>
          </div>
        </div>
      </div>
      <div style={{ marginTop: '1rem', fontSize: '.72rem' }}><a href="index.html">lean canvas viewer ↗</a></div>
    </div>
  );
}
