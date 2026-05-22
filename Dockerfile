FROM oven/bun:1.3

WORKDIR /app

# Install dependencies (includes the Prisma CLI — needed at container start).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Generate the Prisma client for this image's platform.
COPY prisma ./prisma
RUN bunx prisma generate

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8080

# Sync the schema to the attached Postgres, then start the server.
CMD ["sh", "-c", "bunx prisma db push --skip-generate --accept-data-loss && bun run src/index.ts"]
