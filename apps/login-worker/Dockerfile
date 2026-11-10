FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @agentlogin/login-worker... build

ENV NODE_ENV=production
ENV PORT=4180
EXPOSE 4180

CMD ["pnpm", "--filter", "@agentlogin/login-worker", "start"]
