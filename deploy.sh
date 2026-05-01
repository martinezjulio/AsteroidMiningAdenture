#!/usr/bin/env bash
# Redeploy the game to Cloud Run from the local working tree.
# Flags like --memory, --cpu, --concurrency, --timeout, --min-instances,
# --max-instances, --allow-unauthenticated, and --set-secrets persist from
# the initial deploy, so this only needs --source and --region.
#
# Override on the fly with extra args, e.g.:
#   ./deploy.sh --memory 2Gi
#   ./deploy.sh --no-traffic   # deploy a new revision without routing traffic

set -euo pipefail

cd "$(dirname "$0")"

# Regenerate config.json from the YAML named by .env's ACTIVE_CONFIG.
# This makes .env canonical for production: whoever runs ./deploy.sh ships
# the config their local .env points to, not whatever happens to be committed.
if [[ ! -f .env ]]; then
    echo "Error: .env not found. Copy .env.example to .env and set ACTIVE_CONFIG before deploying." >&2
    exit 1
fi
echo "Regenerating config.json from configs/\$ACTIVE_CONFIG (per .env)..."
npm run build-config

PROJECT="julios-personal-compute"
SERVICE="asteroid-mining-game"
REGION="us-east4"

current_project=$(gcloud config get-value project 2>/dev/null || true)
if [[ "$current_project" != "$PROJECT" ]]; then
    echo "Switching gcloud project: $current_project -> $PROJECT"
    gcloud config set project "$PROJECT"
fi

echo "Deploying $SERVICE to $REGION from $(pwd)..."
gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --quiet \
    "$@"
