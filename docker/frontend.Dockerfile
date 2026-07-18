FROM node:20-slim AS build

WORKDIR /app

COPY frontend/package.json ./
RUN npm install

COPY frontend/ ./

# Baked in at build time (Vite env vars only exist during `npm run
# build`, not at container runtime) - set via docker-compose's build.args,
# sourced from a root .env file (gitignored, not committed). Falls back
# to the existing window.location-derived default when unset, so plain
# LAN-only use (no Cloudflare Tunnel) is completely unaffected.
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
