FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-pip make g++ \
	&& ln -sf /usr/bin/python3 /usr/bin/python \
	&& rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --foreground-scripts
COPY src ./src
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/server.js"]
