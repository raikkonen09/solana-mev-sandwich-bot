# Multi-stage build for Solana MEV Sandwich Bot
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S mevbot && \
    adduser -S mevbot -u 1001 -G mevbot

# Set working directory
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    dumb-init \
    curl \
    ca-certificates

# Copy built application from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copy configuration templates
COPY config/ ./config/
COPY scripts/ ./scripts/

# Create necessary directories
RUN mkdir -p /app/logs /app/data /app/backups && \
    chown -R mevbot:mevbot /app

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV CONFIG_PATH=/app/config/bot.json
ENV WALLET_PATH=/app/config/wallet.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Switch to non-root user
USER mevbot

# Expose port for monitoring API
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command
CMD ["node", "dist/cli/cli.js", "start", "--config", "/app/config/bot.json"]

# Labels for metadata
LABEL maintainer="Solana MEV Bot Team"
LABEL version="1.0.0"
LABEL description="Solana MEV Sandwich Bot - Automated arbitrage trading"
LABEL org.opencontainers.image.source="https://github.com/raikkonen09/solana-mev-sandwich-bot"

