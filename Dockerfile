FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Europe/Warsaw \
    NODE_NO_WARNINGS=1
RUN apk add --no-cache tzdata
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY locales ./locales
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "dist/server/index.js"]
