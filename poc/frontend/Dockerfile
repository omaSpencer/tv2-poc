# BE-F1 S2 – production SPA and same-origin /api ingress.
ARG NODE_IMAGE=node:24.20.0-alpine3.23
ARG NGINX_IMAGE=nginx:1.29.5-alpine3.23

FROM ${NODE_IMAGE} AS build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=root:root /build/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/ingress-health"]
CMD ["nginx", "-g", "daemon off;"]
