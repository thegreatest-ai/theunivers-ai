FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=8790
ENV NODE_ENV=production
ENV INVITE_CODE=univers-pilot
ENV DB_PATH=/data/pilot.db
VOLUME ["/data"]
EXPOSE 8790
CMD ["node", "server/index.mjs"]
