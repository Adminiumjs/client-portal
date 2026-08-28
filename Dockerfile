# Multi-stage build: compile the static site with Node, serve it with Caddy.
# Works on any container host ("host anywhere").

# --- build ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Connected mode, decided at BUILD time because that is when Vite inlines it.
# Both default to empty, and empty is the demo-mode branch — an image built with
# neither behaves exactly as it did before connected mode existed, which is what
# the marketplace demos rely on.
#
# The publishable key ends up in the bundle a browser downloads. That is what
# `adm_pub_` is FOR (28 D3): it is a scope selector, not a credential, it can
# only read what its scope lists, and it is refused everywhere outside
# /api/v1/public. A secret `adm_sk_` key here would be a real leak.
ARG VITE_ADMINIUM_API_BASE_URL=""
ARG VITE_ADMINIUM_PUBLISHABLE_KEY=""
ENV VITE_ADMINIUM_API_BASE_URL=$VITE_ADMINIUM_API_BASE_URL
ENV VITE_ADMINIUM_PUBLISHABLE_KEY=$VITE_ADMINIUM_PUBLISHABLE_KEY

RUN npm run build

# --- serve ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
