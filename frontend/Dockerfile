# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Baked into the bundle at build time. Leave empty for same-origin /api (the
# Cloudflare Pages + Tunnel setup); set it when this container serves the
# dashboard directly and the API lives on another origin/port.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---- serve (static) ----
# For local Docker Compose we serve the built SPA with a tiny static server.
# For production hosting, deploy the same `dist/` to Cloudflare Pages instead.
FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
