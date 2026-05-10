FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --foreground-scripts
COPY src ./src
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/server.js"]
