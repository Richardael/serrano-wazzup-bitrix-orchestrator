FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm install -g @nestjs/cli
COPY . .
RUN nest build

FROM node:24-alpine AS production
WORKDIR /app
RUN apk add --no-cache tini curl
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/infrastructure/database/migrations ./src/infrastructure/database/migrations
USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
