# node:22-slim is multi-arch, so this builds for ARM64 (required by AgentCore)
# via `docker build --platform linux/arm64 .` and for the host arch with no
# changes.
FROM public.ecr.aws/docker/library/node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY *.ts ./
RUN npm run build

# Prune to production dependencies for the runtime image.
RUN npm prune --omit=dev

FROM public.ecr.aws/docker/library/node:22-slim

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Informational: local mode listens on 8000, agentcore on 8080.
EXPOSE 8000 8080

# Run the compiled server. The listen port follows the interface mode / PORT
# env var: local mode -> :8000, agentcore mode -> :8080 (AgentCore).
CMD ["node", "dist/app.js"]
