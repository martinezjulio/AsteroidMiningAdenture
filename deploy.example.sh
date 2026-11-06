#!/usr/bin/env bash
# Template for redeploying the game to Cloud Run.
# Copy to deploy.sh and fill in your own PROJECT / SERVICE / REGION values:
#   cp deploy.example.sh deploy.sh && chmod +x deploy.sh
#
# Flags like --memory, --cpu, --concurrency, --timeout, --min-instances,
# --max-instances, --allow-unauthenticated, and --set-secrets persist from
# the initial deploy, so this only needs --source and --region after that.
# BASE_PATH is passed every time with --update-env-vars, which leaves the
# MONGODB_URI secret binding untouched (--set-env-vars would drop it).
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
#       --allow-unauthenticated --memory 1Gi --cpu 1 --concurrency 80 \
#       --timeout 60 --min-instances 1 --max-instances 4 \
#       --set-secrets MONGODB_URI=MONGODB_URI:latest
#   --concurrency 80 is the Cloud Run default; the Python generator is already capped
#   at 4 processes by server.js. --min-instances 1 keeps one warm instance during a
#   study (a few cents an hour idle); set it back to 0 between studies.

set -euo pipefail

cd "$(dirname "$0")"

PROJECT="your-gcp-project-id"
SERVICE="asteroid-mining-game"
REGION="us-east4"
# URL prefix the game is served under (the server's BASE_PATH env var), so
# several study versions can share one domain; "/" serves at the domain root.
BASE_PATH="/ver2_2026_11_05"

current_project=$(gcloud config get-value project 2>/dev/null || true)
if [[ "$current_project" != "$PROJECT" ]]; then
    echo "Switching gcloud project: $current_project -> $PROJECT"
    gcloud config set project "$PROJECT"
fi

echo "Deploying $SERVICE to $REGION from $(pwd)..."
gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --update-env-vars "BASE_PATH=$BASE_PATH" \
    --quiet \
    "$@"
