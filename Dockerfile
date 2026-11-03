# syntax=docker/dockerfile:1
FROM node:22.23.2-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm test && npm run build

FROM rust:1.99.1-bookworm AS backend
WORKDIR /build/backend
COPY backend/ ./
RUN cargo test --locked && cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nextleaf \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin nextleaf \
    && install -d -o 10001 -g 10001 -m 0750 /data
COPY LICENSE THIRD_PARTY_NOTICES.txt /usr/share/doc/nextleaf/
WORKDIR /app
COPY --from=backend /build/backend/target/release/nextleaf-server /usr/local/bin/nextleaf-server
COPY --from=frontend /build/frontend/dist /app/web
ENV TASKMANAGER_BIND=0.0.0.0:8787 \
    TASKMANAGER_DATABASE_URL=sqlite:///data/taskmanager.db \
    TASKMANAGER_WEB_DIR=/app/web
USER 10001:10001
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8787/api/health || exit 1
ENTRYPOINT ["nextleaf-server"]
