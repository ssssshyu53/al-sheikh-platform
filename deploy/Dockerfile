FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY lib ./lib
COPY db ./db
COPY middleware ./middleware
COPY services ./services
COPY routes ./routes
COPY scripts ./scripts
COPY public ./public
COPY server.js database.js ./

RUN mkdir -p /app/uploads/videos /app/uploads/pdfs /app/backups /app/data \
    && chown -R node:node /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV SQLITE_DB_PATH=/app/data/matn_platform.db
ENV UV_THREADPOOL_SIZE=16

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
