#!/usr/bin/env bash
# Template for redeploying the game to Cloud Run.
# Copy to deploy.sh and fill in your own PROJECT / SERVICE / REGION values:
#   cp deploy.example.sh deploy.sh && chmod +x deploy.sh
#
# Flags like --memory, --cpu, --concurrency, --timeout, --min-instances,
# --max-instances, --allow-unauthenticated, and --set-secrets persist from
# the initial deploy, so this only needs --source and --region after that.
#
# Override on the fly with extra args, e.g.:
#   ./deploy.sh --memory 2Gi
#   ./deploy.sh --no-traffic   # deploy a new revision without routing traffic
#
# First-time setup (one-off; not done by this script):
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
#       artifactregistry.googleapis.com secretmanager.googleapis.com
#   printf '%s' 'mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/AMGDB?...' \
#       | gcloud secrets create MONGODB_URI --data-file=- --replication-policy=automatic
#   gcloud run deploy <SERVICE> --source . --region <REGION> \
#       --allow-unauthenticated --memory 1Gi --cpu 1 --concurrency 8 \
#       --timeout 60 --min-instances 0 --max-instances 4 \
#       --set-secrets MONGODB_URI=MONGODB_URI:latest

set -euo pipefail

cd "$(dirname "$0")"

PROJECT="your-gcp-project-id"
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
