# sync, built from the REPO ROOT so `event.yaml` can be baked in.
#
# WHY THIS FILE EXISTS. On the compose path, sync reads the organizer's config
# from a bind mount (`./event.yaml:/config/event.yaml:ro`). Fly has no bind
# mounts, so the config has to arrive some other way, and sync's `EVENT_CONFIG`
# knob takes a PATH rather than content — there is nothing to point it at
# unless a file is already there.
#
# So the config is baked at build time, exactly as the app already bakes it
# (`EVENT_CONFIG_B64`). Same consequence, and it is the one every organizer
# trips over: EDITING event.yaml DOES NOTHING UNTIL YOU REDEPLOY.
#
# DRIFT WARNING — this duplicates `sync/Dockerfile` with `sync/`-prefixed COPY
# sources, because a build context of the repo root cannot use that file's
# bare paths. `test/fly.bats` derives one from the other and fails when they
# diverge, so this stays a copy that cannot silently rot. If you change
# sync/Dockerfile, that test tells you to change this too.
FROM node:22-alpine
WORKDIR /app
COPY sync/package.json sync/package-lock.json ./
RUN npm ci --omit=dev
COPY sync/src ./src
COPY event.yaml /config/event.yaml
RUN mkdir -p /state && chown node:node /state
USER node
CMD ["node", "src/index.js"]
