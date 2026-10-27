# One small server: the built frontend and the whole API on port 8080. See docs/hosting.md.
# Build:  docker build -t dobig-daemon-suite .
# Run:    docker run -p 8080:8080 -v dobig-data:/data -e API_ACCESS_CODE=... -e OPENROUTER_API_KEY=... dobig-daemon-suite

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The container serves its own copy of the site from `/`, with the API on the same origin (no VITE_API_BASE).
ENV VITE_BASE=/
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server runs its TypeScript directly (Node 24) and imports shared types and data from src/, so src/ ships too.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
# Saved daemons, credits, keys and generated images live on the volume. Hosts mount volumes owned by root, so the
# process runs as root to be able to write to it; the container holds nothing else.
ENV DAEMON_DATA_DIR=/data DAEMON_CACHE_DIR=/data/cache
RUN mkdir -p /data/cache
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node","server/standalone.ts"]
