FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /state && chown node:node /state
USER node
CMD ["node", "src/index.js"]
