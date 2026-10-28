FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_BASEMAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
ENV NEXT_PUBLIC_BASEMAP_STYLE_URL=$NEXT_PUBLIC_BASEMAP_STYLE_URL NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: only the standalone server bundle, its static assets and public/,
# run as the unprivileged `node` user.
FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=4180
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# The changelog entries are read at run time (lib/changelog-files.ts).
COPY --from=build --chown=node:node /app/content ./content
# The entry: server.js on a loopback port, one read per page template, then the public port (scripts/warm-start.mjs).
COPY --from=build --chown=node:node /app/scripts/warm-start.mjs /app/scripts/warm-up.mjs ./
USER node
EXPOSE 4180
# Bind the container interface: the published port (local) or Caddy (prod)
# cannot reach 127.0.0.1 inside the container. The port opens once the warm-up is done (at most 20 s).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:4180/privacy || exit 1
CMD ["node", "warm-start.mjs"]
