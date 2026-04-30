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
