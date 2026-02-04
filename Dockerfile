# Dockerfile for Railway deployment with Browserbase
# No local browser needed - Browserbase runs browsers in the cloud
FROM node:20-slim

# Set working directory
WORKDIR /app

# Install system dependencies required for Prisma and SSL
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy Prisma schema early
COPY prisma/ ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source files
COPY src/ ./src/
COPY public/ ./public/

# Build TypeScript
RUN npm run build

# Create artifacts directory
RUN mkdir -p artifacts

# Expose port
EXPOSE 3000

# Start server with database setup
# Use a startup script for better logging and error handling
CMD ["sh", "-c", "echo '[STARTUP] Running prisma db push...' && npx prisma db push --accept-data-loss 2>&1 && echo '[STARTUP] Database setup complete' && node dist/server.js"]
