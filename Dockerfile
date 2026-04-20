# Dockerfile - Next.js App（纯前端，模型由 ollama sidecar 提供）
#
# 构建: docker build -t nitro-enclave-app .
# 配合 docker-compose.yml 使用

ARG REGISTRY=docker.1ms.run/
FROM ${REGISTRY}library/node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ============================================
# Production image
# ============================================
FROM ${REGISTRY}library/node:20-slim

WORKDIR /app

# Next.js standalone
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 环境变量（可通过 docker-compose 覆盖）
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV USE_MOCK_LLM=false
ENV ENCLAVE_MODE=false
# LLM_BASE_URL 和 LLM_MODEL 由 docker-compose.yml 注入

EXPOSE 3000

CMD ["node", "server.js"]
