# NMOS Routing — Route Desk UI + nmos-crosspoint engine in one container.
#
# Stage 1 installs every workspace dependency (TypeScript included) and compiles
# the vendored engine. Stage 2 is the slim runtime: production dependencies only.
# The audio monitor's native modules (@discordjs/opus, werift) are optional and
# are left out of this image; see README "Audio monitor" to build with them.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/crosspoint-engine/package.json packages/crosspoint-engine/
RUN npm ci --no-audit --no-fund --ignore-scripts --omit=optional
COPY packages/crosspoint-engine/tsconfig.json packages/crosspoint-engine/
COPY packages/crosspoint-engine/src packages/crosspoint-engine/src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8194 DATA_DIR=/app/data ROUTING_MODE=live
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/crosspoint-engine/package.json packages/crosspoint-engine/LICENSE.md packages/crosspoint-engine/
RUN npm ci --no-audit --no-fund --ignore-scripts --omit=dev --omit=optional && npm cache clean --force
COPY --chown=node:node --from=build /app/packages/crosspoint-engine/dist packages/crosspoint-engine/dist
COPY --chown=node:node packages/crosspoint-engine/config.default packages/crosspoint-engine/config.default
COPY --chown=node:node server.mjs route-server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8194
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8194/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
