FROM node:22-alpine
WORKDIR /app
COPY mock-scorer.mjs mock-github.mjs ./
USER node
# compose overrides `command` to pick which mock to run
CMD ["node", "mock-scorer.mjs"]
