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
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
