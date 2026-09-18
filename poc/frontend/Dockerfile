# BE-F1 S2 – production SPA and same-origin /api ingress.
ARG NODE_IMAGE=node:24.20.0-alpine3.23
ARG NGINX_IMAGE=nginx:1.29.5-alpine3.23

FROM ${NODE_IMAGE} AS build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
WORKDIR /build
COPY package.json package-lock.json .npmrc ./
RUN corepack enable && corepack prepare npm@11.19.0 --activate
RUN npm ci --no-audit
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts vitest.config.ts index.html ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
ARG VITE_API_BASE=/api
ARG VITE_OIDC_ISSUER_URL
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_REDIRECT_URI
ARG VITE_OIDC_POST_LOGOUT_REDIRECT_URI
ARG VITE_OIDC_SILENT_REDIRECT_URI
ARG VITE_ALLOW_MANUAL_TOKEN=false
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_OIDC_ISSUER_URL=${VITE_OIDC_ISSUER_URL}
ENV VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID}
ENV VITE_OIDC_REDIRECT_URI=${VITE_OIDC_REDIRECT_URI}
ENV VITE_OIDC_POST_LOGOUT_REDIRECT_URI=${VITE_OIDC_POST_LOGOUT_REDIRECT_URI}
ENV VITE_OIDC_SILENT_REDIRECT_URI=${VITE_OIDC_SILENT_REDIRECT_URI}
ENV VITE_ALLOW_MANUAL_TOKEN=${VITE_ALLOW_MANUAL_TOKEN}
RUN npm run build

FROM ${NGINX_IMAGE} AS runtime
COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=root:root /build/.generated/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build --chown=root:root /build/.generated/silent-callback-security-headers.conf /etc/nginx/silent-callback-security-headers.conf
COPY --from=build --chown=root:root /build/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/ingress-health"]
CMD ["nginx", "-g", "daemon off;"]
