# The Alentour API (Stages 2–6). One small container: Fly.io, Render, Railway or a $5 VPS.
# The app and the catalog are NOT served from here — they are static files on R2.
#
#   docker build -t alentour-api .
#   docker run -p 8787:8787 --env-file .env alentour-api
FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY taxonomy ./taxonomy
COPY db ./db
COPY scripts ./scripts
COPY src ./src
USER node
EXPOSE 8787
# Migrations are idempotent; running them on boot keeps a one-person deploy to one step.
CMD ["sh", "-c", "node --experimental-strip-types scripts/db.ts migrate && node --experimental-strip-types src/api/server.ts"]
