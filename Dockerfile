FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN mkdir -p data uploads

EXPOSE 3000

CMD ["npm", "start"]
