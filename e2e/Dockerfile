# The release-test image: the server image's base plus the app's own core and its runtime dependencies (no
# Electron), so e2e/run.js can drive the app exactly as the Mac does, beside a throwaway copy of the server.
# Built and run on the server by desktop/scripts/e2e-on-server.sh; never deployed.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY desktop/package.json desktop/
RUN npm ci --omit=dev --workspace=core --workspace=server --workspace=desktop --ignore-scripts && npm cache clean --force
COPY core core
COPY server server
COPY web web
COPY desktop desktop
COPY e2e e2e
ENV NODE_ENV=production
CMD ["node", "e2e/run.js", "--fixtures", "/fixtures"]
