# Translate: one container, Fastify serves the built client and Socket.IO on one port.
# The image holds only the code: .env and the database (data/) never go into it (.dockerignore).

# ---- build (and the tests: a failing check stops the deploy, the running container stays) ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run check && npm run build

# ---- run ----
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3300
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# only the server's runtime packages: the client is already built
RUN npm ci --omit=dev --ignore-scripts -w @translate/server && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3300/health || exit 1
CMD ["node", "apps/server/dist/index.js"]
