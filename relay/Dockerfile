FROM node:22.14.0-alpine

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

ENV NODE_ENV=production \
    PORT=3005 \
    HUMHUM_RELAY_DB=/data/humhum-relay.sqlite

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3005
VOLUME ["/data"]
CMD ["node", "src/server.mjs"]
