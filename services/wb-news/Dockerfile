FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production DISPLAY=:99 DATA_DIR=/var/lib/ed-pvz NODE_OPTIONS=--max-old-space-size=96 WB_BROWSER_HEADFUL=false
USER root
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox supervisor tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /var/lib/ed-pvz && chown -R pwuser:pwuser /app /var/lib/ed-pvz
COPY --chown=pwuser:pwuser . .
RUN node --test --test-concurrency=1 test/disputes-inspector.test.mjs test/disputes-model.test.mjs test/collector.test.mjs test/server.test.mjs test/session.test.mjs
RUN node scripts/browser-memory-smoke.mjs
COPY supervisord.conf /etc/supervisor/conf.d/ed-pvz.conf
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/bin/sh", "/app/entrypoint.sh"]

