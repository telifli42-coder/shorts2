FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 \
       python3-pip \
       ffmpeg \
       ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages --upgrade yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

RUN mkdir -p /app/public

ENV NODE_ENV=production \
    PORT=10000 \
    PYTHON=python3 \
    FFMPEG=ffmpeg

EXPOSE 10000

CMD ["node", "server.js"]