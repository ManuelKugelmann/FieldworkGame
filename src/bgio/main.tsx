import { createRoot } from 'react-dom/client';
import { Client } from 'boardgame.io/react';
import { Debug } from 'boardgame.io/debug';
import { Expedition } from '../game';
import type { GState } from '../game';
import { Board } from './Board';

// bgio React Client. The Debug panel (browse G/ctx, replay the log, force
// moves) is the inspector's whole point, so we ship it on the static deploy:
// boardgame.io only wires its default Debug when NODE_ENV !== 'production', so
// we pass { impl: Debug } explicitly to keep it in the production build too.
// TEMP — debug build is fine until the game is stable; once stable, drop the
// `boardgame.io/debug` import and use `debug: true` (dev-only) to slim the
// deployed bundle (~101kB → ~71kB gzip).
//
// No multiplayer transport is set, so this runs fully client-side/static
// (serverless) — the local master controls whichever player's turn it is
// (single-window hot-seat).
//
// FUTURE REMOTE PLAY: boardgame.io is transport-pluggable. For networked play,
// stand up a bgio server and pass a transport here, e.g.
//   import { SocketIO } from 'boardgame.io/multiplayer';
//   multiplayer: SocketIO({ server: 'https://your-bgio-server' }),
// then mount one <App playerID="0" /> per seat. (A server is out of scope for
// the static deploy — see CLAUDE.md serverless guardrail — hence not enabled.)
const App = Client<GState>({
  game: Expedition,
  board: Board,
  numPlayers: 2,
  debug: { impl: Debug },
});

createRoot(document.getElementById('root')!).render(<App />);
