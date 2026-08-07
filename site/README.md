# Marketing site (vanos.3bty.co.uk)

Static landing page + build guide for the public showcase site, hosted
on 20i. **Not auto-deployed** — no CI touches this; it's manually
uploaded. Before this commit these two files existed only on the 20i
server with no source control, so a lost/overwritten upload had no way
back. Now they live here.

## Files
- `index.html` — marketing landing page (feature cards, links to the
  live demo and build guide)
- `build.html` — hardware/setup build guide

## The third piece: `app.html`
The live demo app itself is **not** in this folder — it's a normal
build of `frontend/` with `VITE_DEMO=true`, which produces the whole
in-browser simulation (see `frontend/src/lib/demo.ts`). It isn't
committed here because it's generated output, not source.

## Deploying an update
1. Edit `index.html` / `build.html` in this folder as needed.
2. Rebuild the demo app:
   ```bash
   cd frontend
   VITE_DEMO=true npm run build
   ```
3. Take everything in `frontend/dist/`, rename `index.html` →
   `app.html`, and combine it with this folder's `index.html` +
   `build.html`.
4. Upload the combined result to the 20i site root (replaces what's
   there).

Keep `index.html`'s feature-card grid and `build.html` in sync with
whatever's shipped recently on `main` — they'll go stale otherwise,
same as this round.
