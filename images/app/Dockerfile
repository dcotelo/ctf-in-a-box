# Bridge image: builds the contestant app from source until upstream
# (OWASP-CTF/ctf-owasp-org) publishes an official image.
FROM node:22-alpine AS build
RUN apk add --no-cache git && corepack enable
ARG APP_REPO=https://github.com/OWASP-CTF/ctf-owasp-org.git
ARG APP_REF=main
RUN git clone --depth 1 --branch ${APP_REF} ${APP_REPO} /app
WORKDIR /app
# pnpm 11 blocks postinstall scripts for esbuild/sharp/unrs-resolver by default
# (ERR_PNPM_IGNORED_BUILDS) even with --frozen-lockfile. The first install run
# surfaces the pending packages; approve-builds --all runs them non-interactively;
# the second install just confirms nothing else is needed.
RUN pnpm install --frozen-lockfile || true \
    && pnpm approve-builds --all \
    && pnpm install --frozen-lockfile
# Dummy build-time env; real values come from compose at runtime.
RUN BETTER_AUTH_SECRET=build-time-dummy BETTER_AUTH_URL=http://localhost:3000 pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["pnpm", "start"]
