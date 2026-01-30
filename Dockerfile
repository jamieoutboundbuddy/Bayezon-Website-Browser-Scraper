# Dockerfile for Railway deployment with Browserbase
# No local browser needed - Browserbase runs browsers in the cloud
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY src/ ./src/
COPY public/ ./public/

# Build TypeScript
RUN npx tsc
RUN ls -la dist/ && echo "Build successful!"

# Create artifacts directory
RUN mkdir -p artifacts

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
