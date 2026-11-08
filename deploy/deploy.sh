#!/usr/bin/env bash
# Deploy or update Final Buzzer on the OVH box: pull the public repo there, ship the local .env with
# the deployment's extra settings, and rebuild the stack. Touches nothing outside its own folder.
#
#   bash deploy/deploy.sh
set -euo pipefail
HOST="${DEPLOY_HOST:-jonathan@51.161.82.166}"
DIR="experimental-projects/final-buzzer"
REPO="https://github.com/JonathanSolvesProblems/final-buzzer.git"

ssh "$HOST" "mkdir -p ~/$DIR && cd ~/$DIR && if [ -d app/.git ]; then git -C app pull --ff-only; else git clone $REPO app; fi"
scp deploy/docker-compose.yml "$HOST:~/$DIR/docker-compose.yml"

# the deployment's env: the local secrets plus the public settings, written with mode 600
{ grep -E '^(ANTHROPIC_API_KEY|AGENT_MODEL|PAYPAL_ENV|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_BUSINESS_EMAIL|PAYPAL_WEBHOOK_ID|PAYOUT_CURRENCY|OFFICIAL_[A-X]_EMAIL|SAM_PIN)=' .env
  echo "MODEL_RUNS_PER_DAY=${MODEL_RUNS_PER_DAY:-40}"
  echo "RUN_ID=public"
} | ssh "$HOST" "umask 077 && cat > ~/$DIR/.env"

ssh "$HOST" "cd ~/$DIR && docker compose up -d --build && docker compose ps"
