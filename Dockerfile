FROM node:20-alpine

WORKDIR /app

# Install deps first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

# Ensure persistent dirs exist (will be mounted as volumes in prod)
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000
ENV NODE_ENV=production PORT=3000

CMD ["node", "server.js"]
