# BE-F1 O1 – backend application image.
#
# Reproducible: the base image is a build argument so an exact tag or digest is
# pinned from the environment (VERSIONS.md, external prerequisite E01) without
# editing this file, and both dependency layers install from the committed
# package-lock.json with `npm ci`.
#
# Non-root: the runtime stage runs as the image's unprivileged `node` user
# (uid 1000) and owns none of the files it executes, so the process cannot
# rewrite its own code.
#
# Secret-free: no build argument, env instruction or copied file carries a
# credential. Configuration arrives as process environment at run time; the
# .dockerignore keeps `.env*` out of the build context entirely.
#
# Migrations are deliberately not part of this image: drizzle-kit is a dev
# dependency and schema change stays an explicit, separately run step.
ARG NODE_IMAGE=node:24.20.0-alpine3.23

# --- build: dev dependencies, TypeScript compile ---------------------------
FROM ${NODE_IMAGE} AS build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- deps: production dependency tree only ---------------------------------
FROM ${NODE_IMAGE} AS deps
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
WORKDIR /deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit && npm cache clean --force

# --- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LOG_LEVEL=info \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# Root owns the application tree; the `node` user only reads it.
COPY --from=deps --chown=root:root /deps/node_modules ./node_modules
COPY --from=build --chown=root:root /build/dist ./dist
COPY --chown=root:root package.json ./
COPY --chown=root:root --chmod=0555 scripts/container-healthcheck.mjs ./scripts/container-healthcheck.mjs

USER node
EXPOSE 3000

# Liveness only: readiness depends on PostgreSQL, which is a dependency
# decision for the orchestrator, not a reason to restart this process.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "scripts/container-healthcheck.mjs", "/health/live"]

CMD ["node", "dist/main.js"]
