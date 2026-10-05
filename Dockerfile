FROM node:24-bookworm-slim AS app
# Optional build-only trust for controlled network proxies. The secret is never
# copied into the image; ordinary builds do not need it.
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -s /tmp/build-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.pem; fi; \
    corepack enable && NODE_USE_ENV_PROXY=1 corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages
RUN --mount=type=secret,id=build_ca,target=/tmp/build-ca.pem \
    if [ -s /tmp/build-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/build-ca.pem; fi; \
    NODE_USE_ENV_PROXY=1 pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 3000 3001
CMD ["pnpm","start"]

# The maintenance target uses matching PostgreSQL client tools for verified backups.
FROM postgres:17-bookworm AS operations
COPY --from=app /usr/local/bin/node /usr/local/bin/node
COPY --from=app /app /app
WORKDIR /app
ENV NODE_ENV=production
ENTRYPOINT []
CMD ["node", "--import", "tsx", "scripts/ops-worker.ts", "--loop", "--apply"]

# Preserve the application as the default image target.
FROM app AS application
