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
COPY --from=build /app ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["pnpm", "start"]
