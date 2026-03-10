# ─── Stage 1: install dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json* ./
# Install production deps only
RUN npm install --omit=dev --ignore-scripts

# ─── Stage 2: final image ─────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy installed modules from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server/   ./server/
COPY client/   ./client/
COPY package.json ./

# Create data directory with correct ownership
RUN mkdir -p /data && chown appuser:appgroup /data

# Mount point for persistent SQLite file
VOLUME ["/data"]

ENV DB_PATH=/data/inforganizer.db
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server/server.js"]
