# ============================================================
# CONVOY SERVER — CONTAINER IMAGE
# ============================================================
# Minimal production image for the Socket.io realtime backend.
# ============================================================

FROM node:22-alpine

# App directory
WORKDIR /app

# Install production dependencies first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# The server listens on PORT (default 3001)
ENV PORT=3001
EXPOSE 3001

# Lightweight health check hitting the /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/health" || exit 1

CMD ["node", "index.js"]
