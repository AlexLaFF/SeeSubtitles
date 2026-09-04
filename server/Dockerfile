FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY server/package.json server/
COPY desktop/package.json desktop/
RUN npm ci --omit=dev --workspace=core --workspace=server --ignore-scripts && npm cache clean --force
COPY core core
COPY server server
COPY web web
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/server.js"]
