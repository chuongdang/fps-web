# Game server image: builds the client + the single-file standalone server, then runs it on one port (HTTP + /ws).
# Put a reverse proxy (see docker-compose.yml / docker/nginx.conf) in front for TLS.

# ── Build ──────────────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm run bundle-server

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM node:24-slim
ENV NODE_ENV=production \
    FPS_GAME_DIR=/app/game
WORKDIR /app
COPY --from=build /src/build/server.cjs ./server.cjs
COPY --from=build /src/client/dist ./game
COPY docker/config.json ./config.json
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.cjs"]
