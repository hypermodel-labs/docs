# Build stage
FROM node:20-alpine AS builder

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@8.9.0 --activate

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

# Copy source and build
COPY . .
RUN pnpm build

# Runtime stage
FROM node:20-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

# Copy built output and minimal files needed for runtime deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

# Install production dependencies only
RUN corepack enable && \
    corepack prepare pnpm@8.9.0 --activate && \
    pnpm install --prod --ignore-scripts

# The worker does not expose an HTTP port

# Start the Temporal worker via package script
CMD ["pnpm", "start:worker"]


