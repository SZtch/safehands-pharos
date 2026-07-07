# SafeHands Guardian API — production image (compiled, read-only by default).
# Optional self-host of the reference backend on any container host (Docker / VPS / Fly / etc.).

# ---- build stage (needs dev deps for tsc) ----
# Pinned to a concrete patch tag for reproducibility. For maximum supply-chain
# integrity, pin by digest in your registry: node:22.13.0-slim@sha256:<digest>.
FROM node:22.13.0-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the `prepare` hook runs `tsc`, but src/tsconfig aren't copied yet.
# The explicit `npm run build` below compiles once sources are present.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.hardhat.json ./
COPY src ./src
COPY contracts ./contracts
RUN npm run build

# ---- runtime stage (production deps only) ----
FROM node:22.13.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: runtime never builds (dist is copied from the build stage); this
# also skips the `prepare`/tsc hook, which would fail with no devDeps and no sources.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/contracts ./contracts
COPY .env.example ./

# Run as the built-in non-root `node` user (defense in depth). Give it ownership
# so any default-path runtime state (audit log / prepared-tx store when no volume
# is mounted) is writable; mount a Volume + SAFEHANDS_STATE_DIR for durability.
RUN chown -R node:node /app
USER node

# PORT is injected by the host; the server binds 0.0.0.0:$PORT (default 4022).
EXPOSE 4022

# Default service = read-only Guardian API. Override the command for the
# worker (node dist/worker.js) or x402 (node dist/x402Server.js) services.
CMD ["node", "dist/api/server.js"]
