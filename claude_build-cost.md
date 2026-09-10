# Build cost on the Pi — read this before touching dependencies

_Written 10 Sep 2026 after doing the wrong thing twice in one session._

## The rule

**Never change `backend/requirements.txt` or `frontend/package.json` for
tidiness alone.** An unused pure-Python package costs nothing at
runtime. Removing it costs ~16 minutes of Frankie's evening.

If a dependency genuinely must change, **batch it** with other work that
needs a full rebuild anyway, and say so before he runs the command.

## Measured, from a real build on 10 Sep

| Step | Time |
|---|---|
| `pip install` (backend) | **421s** |
| `apt-get install` (backend runtime) | **542s** |
| `npm run build:image` (frontend) | **424s** |
| Total | **~24 minutes** |

All three of those were triggered by removing **one unused line** from
`requirements.txt`. Docker invalidates every layer after one that
changes, and the pip layer is near the top.

`docker/backend.Dockerfile` says this in its own comments, at line 5:

> Layer ordering matters enormously on slow ARM hardware. Docker
> invalidates every layer AFTER one that changes. The pip layer below is
> by far the most expensive thing in this build.

I had read that file the same day and changed requirements anyway.

## Three tiers of deploy — say which one applies

Always tell him which of these a change needs. Handing over the full
command every time wastes a lot of his day.

**1. Agent only — no build at all, seconds**

    cd ~/bongo-control && git pull
    sudo systemctl restart vanos-heater-agent

Anything under `backend/tools/` that the host runs.

**2. Backend only — ~30s if requirements are unchanged**

    docker compose --profile cloudflare-tunnel up -d --build backend

Python under `backend/app/`, routes, services, plugins.

**3. Full — minutes, and up to ~25 if dependencies changed**

    docker compose --profile cloudflare-tunnel up -d --build --remove-orphans

Only for frontend changes, or when a dependency file genuinely had to
change.

## Getting a file onto the Pi without any build

For a diagnostic or one-off script, this is instant and does not
survive a rebuild — which is usually fine:

    docker cp backend/tools/thing.py $(docker compose ps -q backend):/app/tools/

## Also worth knowing

- `backend/tools/` **is** copied into the image now, below the pip
  layer, so adding a diagnostic there is a cheap rebuild rather than an
  expensive one. It was missing once and cost a 30-minute rebuild that
  produced an image without the tool it was rebuilt for.
- The frontend image runs `npm run build:image` (`vite build` with no
  typecheck) deliberately. `tsc` is 43% of the build and contributes
  nothing to the artifact — see `docker/frontend.Dockerfile`.
