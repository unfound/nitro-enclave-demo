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
# Stage 2: Node runtime (for COPY binary)
# ============================================
ARG REGISTRY2=docker.1ms.run/
FROM ${REGISTRY2}library/node:20-slim AS node-src

# ============================================
# Stage 3: Build llama-cpp-python (需要编译器)
# ============================================
ARG REGISTRY3=docker.1ms.run/
FROM ${REGISTRY3}library/python:3.12-slim AS llama-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/llama-venv \
    && /opt/llama-venv/bin/pip install --no-cache-dir \
       -i https://pypi.tuna.tsinghua.edu.cn/simple \
       llama-cpp-python[server]

# ============================================
# Stage 4: Production image (无 apt-get)
# ============================================
ARG REGISTRY4=docker.1ms.run/
FROM ${REGISTRY4}library/python:3.12-slim

# -- Node.js (从 node 镜像 COPY，不依赖 apt) --
COPY --from=node-src /usr/local/bin/node /usr/local/bin/node
COPY --from=node-src /usr/local/bin/corepack /usr/local/bin/corepack
COPY --from=node-src /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version && npm --version

# -- Supervisor (pip 装，不依赖 apt) --
RUN pip install --no-cache-dir \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    supervisor

# -- llama-cpp-python (从 builder 阶段 COPY，不依赖 apt) --
COPY --from=llama-builder /opt/llama-venv /opt/llama-venv

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

CMD ["supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
