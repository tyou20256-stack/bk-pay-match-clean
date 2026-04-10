# Multi-stage build for bk-pay-match
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:20-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
RUN mkdir -p data logs backups \
    && chown -R node:node /app
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:3003/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
