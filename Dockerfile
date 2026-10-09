FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./

# Dev dependencies (vite) are needed for the build and pruned afterwards.
RUN npm ci

COPY . .

RUN npx prisma generate && npm run build && npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
EXPOSE 3000

# Runs prisma generate + migrate deploy, then starts the server on $PORT.
CMD ["npm", "run", "docker-start"]
