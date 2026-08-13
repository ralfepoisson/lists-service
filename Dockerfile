# syntax=docker/dockerfile:1.7
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . ./
RUN npm run build

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG COMPONENT_VERSION=0.2.0
ARG LIFE2_RELEASE_REVISION=development
LABEL org.opencontainers.image.version=$COMPONENT_VERSION \
      org.opencontainers.image.revision=$LIFE2_RELEASE_REVISION
ENV NODE_ENV=production LIFE2_RELEASE_REVISION=$LIFE2_RELEASE_REVISION
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/local-rest.cjs ./local-rest.cjs
USER node
EXPOSE 3000
CMD ["node", "local-rest.cjs"]
