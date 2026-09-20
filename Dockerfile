# Batch Relay Creative is a self-hosted, single-instance Next.js service.
# Keep the build and runtime images separate so source, tests, and the full
# dependency tree do not ship with the production container.
FROM node:24-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    CREATIVE_DATA_DIR=/data/creative \
    LIVEPEER_JOURNAL_PATH=/data/creative/journal.json

WORKDIR /app

# Next's standalone server does not copy these folders automatically. Keep
# public assets and the static client output alongside the traced server.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# The compose file initializes a newly-created named volume too, but keeping
# this directory owned by node also makes a first-run bind mount predictable.
RUN mkdir -p /data/creative \
  && chown -R node:node /app /data/creative

USER node
EXPOSE 3000

CMD ["node", "server.js"]
