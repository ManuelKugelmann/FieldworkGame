import { createRoot } from 'react-dom/client';
import { Client } from 'boardgame.io/react';
import { Expedition } from '../game';
import type { GState } from '../game';
import { Board } from './Board';

// bgio React Client. `debug: true` mounts boardgame.io's Debug panel (browse
// G/ctx, replay the log, force moves) in `npm run dev`; bgio only wires its
// default Debug when NODE_ENV !== 'production', so the static production build
// ships without it (dev build for now — keeps the prod bundle lean). To ship
// the panel on the deploy later, pass `debug: { impl: Debug }` with an explicit
// `import { Debug } from 'boardgame.io/debug'`.
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
  debug: true,
});

createRoot(document.getElementById('root')!).render(<App />);
