# Worker container - manages the container pool and processes submissions
FROM node:18-alpine3.17

# Install Docker CLI and other minimal dependencies
RUN apk update && \
    apk add --no-cache \
    docker-cli \
    bash \
    curl

# Verify Node installation
RUN node -v && npm -v

# Create a non-root user for security
RUN addgroup -g 1001 -S judge && \
    adduser -u 1001 -S judge -G judge

# Create temp directory
RUN mkdir -p /tmp/leetcode_judge && \
    chown judge:judge /tmp/leetcode_judge && \
    chmod 755 /tmp/leetcode_judge

WORKDIR /usr/src/app

# Copy application
COPY --chown=judge:judge . .

# Install dependencies
RUN cd app && npm install --production

# Switch to non-root user
USER judge

# Use the optimized worker
WORKDIR /usr/src/app/app

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "console.log('OK')" || exit 1

# Start worker
CMD ["npm", "start"]
