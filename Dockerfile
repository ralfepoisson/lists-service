# syntax=docker/dockerfile:1.7
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
RUN npm install --global npm@11.16.0 && npm cache clean --force
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . ./
RUN npm run build

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
RUN apt-get -o Acquire::Retries=0 update \
    && apt-get -o Acquire::Retries=0 install --yes --no-install-recommends --only-upgrade apt=2.6.2 libapt-pkg6.0=2.6.2 \
    && rm -rf /var/lib/apt/lists/*
ARG COMPONENT_VERSION=0.12.1
ARG LIFE2_RELEASE_REVISION=development
LABEL org.opencontainers.image.version=$COMPONENT_VERSION \
      org.opencontainers.image.revision=$LIFE2_RELEASE_REVISION
ENV NODE_ENV=production LIFE2_RELEASE_REVISION=$LIFE2_RELEASE_REVISION
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/local-rest.cjs ./local-rest.cjs
COPY --from=build --chown=node:node /app/dist/migrate.cjs ./migrate.cjs
COPY --from=build --chown=node:node /app/dist/migrations ./migrations
COPY --from=build --chown=node:node /app/dist/data ./data
USER node
EXPOSE 3000
CMD ["node", "local-rest.cjs"]

FROM runtime AS local-development
COPY --from=build --chown=node:node /app/dist/seed-approved-open-loops.cjs ./dist/seed-approved-open-loops.cjs

FROM runtime AS production
