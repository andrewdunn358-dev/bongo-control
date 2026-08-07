# Deploying an update

## The actual, correct sequence

```
cd ~/bongo-control
git pull
docker compose stop backend
docker compose --profile cloudflare-tunnel up -d --build --remove-orphans
```

**The `docker compose stop backend` step matters and isn't optional** —
see below for why. Frontend and cloudflared don't need this; only
backend has been confirmed to need it.

If you're not running the Cloudflare tunnel on this box, drop that
profile flag:

```
docker compose stop backend
docker compose up -d --build
```

## Why the extra step, when it used to just be `up -d --build`

Found via a real investigation (relay state kept resetting in a way
that shouldn't have been possible): a plain `docker compose stop
backend` graceful-shuts-down correctly — the backend's own "Shutting
down" log line appears, right on cue. But `docker compose up -d
--build` recreating the backend as part of the same command does
**not** — the shutdown sequence never runs at all, not even its first
line. Not slow, not timing out - never starts.

Root cause isn't fully pinned down. A plausible contributing factor:
backend runs with `network_mode: host` (needed for the Bluetooth
plugin), so the new container needs the exact same host port the old
one is still holding - which may be pushing Compose toward a faster,
less graceful replacement path specifically during a recreate, as
opposed to a plain stop where there's no new container waiting on that
port at all.

Whatever the exact mechanism, splitting the deploy into two explicit
steps - stop (which is proven to work correctly) followed by build+up
(which now has nothing left to gracefully stop, since it's already
stopped) - reliably works around it. A `stop_grace_period: 30s` was
also added to the backend service in docker-compose.yml as a safety
margin, in case timing under load during a rebuild turns out to be a
contributing factor too.

## Why a clean shutdown actually matters here, not just as tidiness

Relay state (what's actually switched on) is persisted on a clean
shutdown and restored on the next startup - see the module docstring
in `backend/app/services/relay_service.py` for the full design. If
that shutdown never runs, the restore has nothing to work from and
every relay silently defaults to off instead - which, on a two-way
wired circuit (relay in parallel with a physical wall switch), doesn't
reliably mean "the load is off" at all. It means the load's actual
state now depends entirely on wherever its switch happens to be
sitting - which was a genuine, hours-long mystery on this project
before this exact cause was found.

## Frontend build running out of memory ("JavaScript heap out of memory")

Real, observed failure on the Pi 2 (1GB RAM total) - `npm run build`'s
chunk-rendering step can exhaust V8's heap and abort. Two independent
things help:

1. **Build sequentially, not in parallel.** `docker compose up -d
   --build` builds both images at once by default - the backend's own
   apt-get/pip steps competing for memory at the exact moment the
   frontend's build needs it most makes this worse. If it fails,
   retry as:
   ```
   docker compose build backend
   docker compose build frontend
   docker compose up -d
   ```

2. **`NODE_OPTIONS=--max-old-space-size=768`** is now set in
   `docker/frontend.Dockerfile` for the build step, raising V8's
   default (over-conservative on a 1GB device) heap ceiling. This only
   helps if the Pi actually has memory or swap to back it - it can't
   invent RAM that isn't there.

If both of those together still aren't enough, check and increase
swap directly:
```
free -h
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```
(Raspberry Pi OS's default swap manager - adjust if this Pi uses
something else.) A 1GB swapfile on the SD card is slower than real
RAM, but turns "the build crashes" into "the build takes a while
longer," which is the trade worth making here.

## Mobile "stuck on old build" note

Existing phones run the *previously deployed* service worker, which
may lack update polling. The first deploy after such a change can
still need one manual reload (pull-to-refresh / reopen the PWA) on
mobile to swap onto the new SW. After that swap, future deploys
auto-update without touching the phone.

## Useful checks

```
docker compose ps
docker compose logs backend --tail=30
```

To confirm a deploy actually shut down cleanly (and therefore that
relay state will restore correctly on the next one):

```
docker compose logs backend --since 5m | grep -i "shutting down\|restored to\|reset to OFF"
```
