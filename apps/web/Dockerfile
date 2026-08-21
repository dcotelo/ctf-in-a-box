# Builds the vendored contestant app from local source (context = repo root).
# EVENT_CONFIG_B64: optional base64-encoded event.yaml baked into the build;
# empty means the generator falls back to EVENT_* env vars / neutral defaults.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY apps/web/ ./
ARG EVENT_CONFIG_B64=
RUN if [ -n "$EVENT_CONFIG_B64" ]; then \
      echo "$EVENT_CONFIG_B64" | base64 -d > /app/event.yaml && \
      export EVENT_CONFIG=/app/event.yaml; \
    fi && \
    CI=true pnpm install --frozen-lockfile && \
    BETTER_AUTH_SECRET=build-time-dummy BETTER_AUTH_URL=http://localhost:3000 \
    EVENT_CONFIG=${EVENT_CONFIG_B64:+/app/event.yaml} pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
# --chown, because the next line drops to `node`. Without it /app is
# root-owned and the unprivileged runtime user cannot create
# `.next/cache/fetch-cache`, which Next.js makes on its FIRST cached fetch —
# so the container booted fine, served fine, and logged
# `EACCES: permission denied, mkdir '/app/.next/cache/fetch-cache'` while
# silently caching nothing. Every `next: { revalidate: N }` fetch then re-hit
# upstream on every request, and the only evidence read like a Next.js
# internal rather than a permissions problem.
COPY --from=build --chown=node:node /app ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["pnpm", "start"]
