FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund --loglevel=error

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Resolve A records before AAAA. Node prefers IPv6, and on a host whose IPv6
# route is advertised but dead, every outbound call to a provider hangs until
# undici's 10 second connect timeout and surfaces as a bare "fetch failed".
# That is indistinguishable from the provider being down. Nothing this app
# talks to is IPv6 only.
ENV NODE_OPTIONS=--dns-result-order=ipv4first

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# The collected liquidation series. Next's standalone tracing only follows
# imports and this is read with fs at runtime, so it has to be copied by hand
# or the percentile bands ship empty. CoinMarketCap publishes no historical
# liquidation endpoint, so this directory is the only history the app has.
COPY --from=builder /app/data ./data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/.next/cache && chown -R nextjs:nodejs /app/.next

# Every secret is read from the runtime environment and none is baked into the
# image. Pass them with `docker run --env-file` or your platform's own
# environment settings. See .env.example for the full list; the app degrades to
# an explained empty state for any key it does not have rather than failing to
# start.
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/ready || exit 1
CMD ["node", "server.js"]
