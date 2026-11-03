# Final Buzzer: the board, the scorer's page and the PayPal webhook receiver (service "app"), and
# the agent on duty (service "agent", same image). Node 24 runs the TypeScript directly; there is
# no build step. Secrets come from the host's env file, never from the image.
FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production \
    PORT=4173 \
    TOURNAMENT_FILE=/data/tournament-2026.json \
    LEDGER=/data/ledger.json \
    BUDGET_FILE=/data/budget.json

# The tournament document and the ledger live on a volume, so scores saved on the scorer's page and
# payouts the agent makes survive a restart. First start seeds them from the published results.
CMD ["sh", "-c", "mkdir -p /data && [ -f /data/tournament-2026.json ] || cp data/tournament-2026.json /data/; [ -f /data/ledger.json ] || cp results/ledger.json /data/ledger.json; exec node src/server.ts"]
