FROM node:20-slim AS build

WORKDIR /app

# Copy the lockfile too, and use `npm ci` rather than `npm install`:
# ci installs exactly what the lockfile pins, skipping full dependency
# resolution entirely - meaningfully faster (especially on slow ARM
# hardware) and reproducible. Kept as its own layer above the source
# copy so it only re-runs when dependencies actually change, not on
# every code edit.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# No build-time API URL configuration needed: the frontend uses
# same-origin relative paths and nginx proxies /api and /ws to the
# backend. Same build works on the LAN offline and behind a tunnel.
#
# NODE_OPTIONS raises V8's heap ceiling explicitly. Real, observed
# failure on the actual Pi 2 (1GB RAM total, shared with the OS,
# Docker, and the database) - `vite build`'s chunk-rendering step was
# hitting "JavaScript heap out of memory" and aborting, reproducibly,
# three times in a row. V8 auto-detects a heap limit from apparent
# system memory, and on a 1GB device that default is too conservative
# for a bundle this size (maplibre + recharts + framer-motion). This
# doesn't invent memory that isn't there - it only helps if the Pi
# actually has swap to back it; see docs/deploy.md for checking/adding
# swap if this alone isn't enough.
ENV NODE_OPTIONS=--max-old-space-size=768

# `build:image` is `vite build` WITHOUT the `tsc -b` typecheck that
# `npm run build` runs first. Deliberate, and worth the explanation:
#
# vite transpiles TypeScript with esbuild, which strips types without
# checking them - so the typecheck contributes nothing to the artifact.
# It is pure verification, and it is verification that has already
# happened by the time anything reaches this Pi: the workflow is
# verify-then-push-then-pull, and `tsc --noEmit` is part of that.
# Measured on a fast x86 machine it was 12s of a 28s build, ~43%; on a
# Pi 2B it is far worse than proportional, because it competes for the
# same scarce RAM that already made vite's chunk-rendering step run out
# of heap (see NODE_OPTIONS above).
#
# The trade is real and small: a type error would no longer fail the
# build here. It would also not be *caused* here - it would have been
# pushed - and it would break at runtime identically whether or not the
# Pi had rechecked it. Discovering it on the van, after a multi-minute
# rebuild, is the worst place to find out. `npm run build` still
# typechecks for humans and CI.
RUN npm run build:image

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx-entrypoint.sh /nginx-entrypoint.sh
RUN chmod +x /nginx-entrypoint.sh

EXPOSE 80
CMD ["/nginx-entrypoint.sh"]
