# ============================================
# Stage 1: Build Next.js app
# ============================================
ARG REGISTRY=docker.1ms.run/
FROM ${REGISTRY}library/node:20-slim AS next-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ============================================
# Stage 2: Production image
# ============================================
ARG REGISTRY2=docker.1ms.run/
FROM ${REGISTRY2}library/ubuntu:24.04

# Install runtime deps
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv nodejs npm supervisor curl \
    && rm -rf /var/lib/apt/lists/*

# Install llama-cpp-python with server (OpenAI-compatible API)
RUN python3 -m venv /opt/llama-venv \
    && /opt/llama-venv/bin/pip install --no-cache-dir \
       -i https://pypi.tuna.tsinghua.edu.cn/simple \
       llama-cpp-python[server] \
    && /opt/llama-venv/bin/pip install --no-cache-dir \
       -i https://pypi.tuna.tsinghua.edu.cn/simple \
       uvicorn

WORKDIR /app

# -- Next.js production --
COPY --from=next-builder /app/.next/standalone ./
COPY --from=next-builder /app/.next/static ./.next/static
COPY --from=next-builder /app/public ./public

# -- Model --
COPY models/Qwen3.5-0.8B-Q4_K_M.gguf /models/Qwen3.5-0.8B-Q4_K_M.gguf

# -- Supervisord config --
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# -- Environment --
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV LLM_BASE_URL=http://127.0.0.1:8080/v1
ENV LLM_MODEL=qwen3.5-0.8b
ENV USE_MOCK_LLM=false
ENV ENCLAVE_MODE=false
ENV LLM_THREADS=4

EXPOSE 3000

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
