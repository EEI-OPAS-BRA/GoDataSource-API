# Build context: the package tree (API sources, client/dist and deploy/defaults), not the git checkout.
ARG NODE_IMAGE=node:22.23.5-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /opt/godata
# Compilers for native modules that fall back to a source build when no prebuilt binary can be downloaded
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

FROM ${NODE_IMAGE}
ARG GODATA_VERSION=unknown
ARG GODATA_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/EEI-OPAS-BRA/GoDataSource-API" \
  org.opencontainers.image.version="${GODATA_VERSION}" \
  org.opencontainers.image.revision="${GODATA_REVISION}"
ENV NODE_ENV=production \
  NPM_CONFIG_UPDATE_NOTIFIER=false \
  GODATA_VERSION="${GODATA_VERSION}" \
  GODATA_REVISION="${GODATA_REVISION}"
WORKDIR /opt/godata

COPY . .
COPY --from=deps /opt/godata/node_modules ./node_modules
COPY deploy/docker/entrypoint.sh /usr/local/bin/godata-entrypoint

# Code stays root-owned; node gets only the paths the application and the entrypoint write at runtime.
RUN set -eu; \
  for f in client/dist/index.html client/dist/assets/runtime-config.json \
    deploy/defaults/config.json deploy/defaults/datasources.json \
    deploy/lib/merge-config.js deploy/lib/db-state.js; do \
    test -f "$f" || { echo "missing $f in the build context" >&2; exit 1; }; \
  done; \
  chmod 0755 /usr/local/bin/godata-entrypoint; \
  mkdir -p server/storage/files server/storage/icons backups state config logs; \
  chown node:node server server/config.json server/datasources.json server/boot logs \
    client/dist/assets client/dist/assets/runtime-config.json \
    server/storage server/storage/files server/storage/icons backups state

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10m --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/status',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["godata-entrypoint"]
