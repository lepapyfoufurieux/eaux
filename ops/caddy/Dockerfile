# Builds the frontend, then serves it with Caddy.
FROM node:22-alpine AS build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY ops/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /frontend/dist /srv/frontend
