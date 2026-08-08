# theunivers.ai — one process serves the marketing site, the /app shell, and the API.
#
# server/index.mjs already serves dist/ with an SPA fallback for /app/*, so there is no second
# origin, no CORS, and cookies live on one domain. Splitting them would buy nothing here.

FROM node:22-bookworm-slim
WORKDIR /app

# Dependencies first so a source-only change does not reinstall the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8790
ENV DB_PATH=/data/pilot.db

# NOTHING SECRET LIVES HERE. The previous version baked INVITE_CODE=univers-pilot into the image,
# which puts a credential in the repo and in every layer of a distributable artifact. Invite code,
# OAuth secrets and OAUTH_STATE_SECRET are all set with `fly secrets set` — see fly.toml.

# SQLite needs a real disk. Without the volume the database is recreated on every deploy and every
# account, agent and receipt disappears — silently, because the app starts perfectly well.
VOLUME ["/data"]

EXPOSE 8790
CMD ["node", "server/index.mjs"]
