# Build both services from a small deployment bundle. Runtime stages contain no
# source tree, toolchain, test suite, or development dependencies.
FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/contracts/src/index.ts ./packages/contracts/src/index.ts
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/src/ ./apps/api/src/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/index.html ./apps/web/
COPY apps/web/src/ ./apps/web/src/
COPY db/migrations/ ./db/migrations/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @orium/contracts build && pnpm --filter @orium/api build && pnpm --filter @orium/web build
RUN pnpm --filter @orium/api deploy --prod /api-runtime

FROM node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /api-runtime/ ./
COPY --from=build --chown=node:node /workspace/db/migrations/ ./db/migrations/
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]

FROM nginx:1.28-alpine AS web
COPY deploy/production/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist/ /usr/share/nginx/html/
EXPOSE 8080
