# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src

ARG VITE_MANIFEST_URL=
ENV VITE_MANIFEST_URL=$VITE_MANIFEST_URL

RUN npm run build

FROM nginx:1.27-alpine AS runtime

ENV PORT=8080

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

RUN mkdir -p /usr/share/nginx/html/models

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD sh -c 'wget -q -O /dev/null "http://127.0.0.1:${PORT}/"' || exit 1
