FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 5187 5188
CMD ["node", "src/server.js"]
