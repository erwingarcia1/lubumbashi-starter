#!/usr/bin/env bash
# Nightly logical backup of the platform database (schemas app, util, auth) to S3.
# Usage: DATABASE_URL_MIGRATIONS=postgres://... BACKUP_BUCKET=s3://bucket/prefix ./deploy/backup.sh
# Keep: docs/OPERATIONS.md "Sauvegarde et restauration" for the restore drill.
set -euo pipefail
: "${DATABASE_URL_MIGRATIONS:?owner connection string}"
: "${BACKUP_BUCKET:?s3://bucket/prefix}"
STAMP=$(TZ=Africa/Lubumbashi date +%Y-%m-%d_%H%M)
FILE="/tmp/lubumbashi-${STAMP}.dump"
pg_dump --format=custom --no-owner --no-privileges \
  --schema=app --schema=util --schema=pgboss \
  --dbname="${DATABASE_URL_MIGRATIONS}" --file="${FILE}"
aws s3 cp "${FILE}" "${BACKUP_BUCKET}/lubumbashi-${STAMP}.dump" --only-show-errors
rm -f "${FILE}"
echo "backup ${STAMP} uploaded to ${BACKUP_BUCKET}"
