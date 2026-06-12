# Expedition: Verdant Prime

A **serverless** (static, GitHub Pages) digital implementation of the board game
*Expedition: Verdant Prime*, built on [boardgame.io](https://boardgame.io). One
rules codebase (`src/game.ts`) drives the UI, a real-engine smoke test, and
headless balance sweeps. See [`game_design.md`](./game_design.md) for the design
intent and [`CLAUDE.md`](./CLAUDE.md) for the build/verify workflow.

## ▶ Play

Two frontends ship from the same rules engine (`src/game.ts`):

- **Play — canvas viewer:** https://manuelkugelmann.github.io/FieldworkGame/
  — lean, React-free click-to-play board with bot opponents.
- **Inspect — bgio frontend:** https://manuelkugelmann.github.io/FieldworkGame/bgio.html
  — boardgame.io React frontend: rich per-player panels (inventory, published
  pool, money), click-to-play, and the boardgame.io Debug panel for full state
  inspection / force-moves.

Every branch is also deployed to its own preview, so you can try any version
before it merges:

- **Branch previews:** `https://manuelkugelmann.github.io/FieldworkGame/<branch-slug>/`
  and `…/<branch-slug>/bgio.html` (the branch name with every non-alphanumeric
  character replaced by `-`, e.g. `claude/inspect-pqjwn5` →
  `.../claude-inspect-pqjwn5/`).

On a pull request, both deployed previews are attached to the head commit as
**`github-pages-preview`** (canvas) and **`github-pages-preview-bgio`**
(inspector) status checks — open the PR's checks and follow *Details* to the
live build.

## Develop

```bash
npm install
npm run dev        # local UI with hot reload
npm run typecheck  # strict tsc --noEmit
npm run smoke      # 20 matches through the real engine — must reach gameover (CI gate)
npm run sweep [n]  # n self-play matches; prints balance metrics
npm run build      # production build -> dist/
npm run preview    # serve the production build locally
```

## Deployment

Pushes are published by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)
to the **`gh-pages`** branch, each branch into its own subfolder. Deploys use
`keep_files: true`, so a push only ever rewrites *its own* subfolder and leaves
all other branches' deploys untouched. `main` publishes to the site root; every
other branch publishes to `/<branch-slug>/`. The correct Vite `base` is injected
per deploy so assets resolve inside the subfolder.

When a branch is **deleted**, [`.github/workflows/cleanup.yml`](./.github/workflows/cleanup.yml)
removes its subfolder from `gh-pages`.

### One-time setup (repo settings)

1. **Settings → Actions → General → Workflow permissions:** select
   *Read and write permissions* (lets the workflow push to `gh-pages` and set
   commit statuses).
2. Push any branch once to let the workflow create the `gh-pages` branch.
3. **Settings → Pages → Build and deployment:** set *Source* to *Deploy from a
   branch*, branch **`gh-pages`**, folder **`/ (root)`**.
4. The **cleanup-on-delete** workflow only runs from the repository's **default
   branch** (a GitHub constraint on `delete` events), so it takes effect once
   `cleanup.yml` is merged to the default branch.
