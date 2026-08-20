FROM node:24.18.0-alpine3.23 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.18.0-alpine3.23

ARG BUILD_ARCH
ARG BUILD_VERSION
LABEL \
  io.hass.name="Handleliste" \
  io.hass.description="A shared, recipe-aware shopping list for Home Assistant" \
  io.hass.type="app" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.arch="${BUILD_ARCH}"

ENV NODE_ENV=production \
  HANDLELISTE_DATA_DIR=/data \
  HANDLELISTE_HOST=0.0.0.0 \
  HANDLELISTE_PORT=8099
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8099/health || exit 1

CMD ["node", "dist/server/index.js"]
