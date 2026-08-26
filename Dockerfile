# syntax=docker/dockerfile:1.7

FROM node:22.23.1-bookworm-slim AS pnpm-base
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack prepare pnpm@11.12.0 --activate \
    && chmod -R a+rX "$COREPACK_HOME"
WORKDIR /app

FROM pnpm-base AS hub-build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/hub/package.json apps/hub/package.json
COPY packages/canary-core/package.json packages/canary-core/package.json
RUN pnpm install --frozen-lockfile --filter @wrenchless/hub...
COPY apps/hub apps/hub
COPY packages/canary-core packages/canary-core
ARG VITE_SITE_URL
ARG VITE_SPONSOR_URL
ARG VITE_WALLETCONNECT_PROJECT_ID
RUN test -n "$VITE_SITE_URL" \
    && test -n "$VITE_SPONSOR_URL" \
    && test -n "$VITE_WALLETCONNECT_PROJECT_ID"
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_SPONSOR_URL=$VITE_SPONSOR_URL
ENV VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
RUN pnpm --filter @wrenchless/hub build

FROM nginx:1.28.0-alpine AS gateway
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=hub-build /app/apps/hub/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

FROM pnpm-base AS services
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/sponsor/package.json apps/sponsor/package.json
COPY apps/relay-canary/package.json apps/relay-canary/package.json
COPY packages/canary-core/package.json packages/canary-core/package.json
RUN pnpm install --prod --frozen-lockfile \
    --filter @wrenchless/sponsor...
COPY apps/sponsor/src apps/sponsor/src
COPY apps/relay-canary/src apps/relay-canary/src
COPY packages/canary-core/src packages/canary-core/src
RUN mkdir -p /data && chown node:node /data
USER node
