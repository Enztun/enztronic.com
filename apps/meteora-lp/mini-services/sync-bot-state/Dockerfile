# ─── Sync Bot State Sidecar ───────────────────────────────────
# Build context must be the project root so we can access prisma/schema.prisma
# docker-compose: context: .. (project root), dockerfile: mini-services/sync-bot-state/Dockerfile

FROM node:20-slim

WORKDIR /app

# Install sidecar dependencies
COPY mini-services/sync-bot-state/package.json ./
RUN npm install

# Copy Prisma schema and generate client
COPY prisma/ ./prisma/
RUN npx prisma generate

# Copy sidecar source
COPY mini-services/sync-bot-state/index.js ./

ENV NODE_ENV=production

CMD ["node", "index.js"]
