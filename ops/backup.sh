#!/usr/bin/env sh
# Nightly backup: database dump + photos, copied off the server with restic.
# Expects RESTIC_REPOSITORY and RESTIC_PASSWORD (and the storage credentials) in the environment.
# Example cron entry: 30 3 * * * /opt/eaux/ops/backup.sh >> /var/log/eaux-backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
. ./.env

DUMP_DIR=/var/backups/eaux
mkdir -p "$DUMP_DIR"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$DUMP_DIR/eaux.dump"

MEDIA_DIR=$(docker volume inspect --format '{{ .Mountpoint }}' "$(basename "$PWD")_media")

restic backup "$DUMP_DIR" "$MEDIA_DIR" --tag eaux
restic forget --keep-daily 30 --keep-monthly 12 --prune

# Optional: ping a monitoring service so a missed backup raises an alert
if [ -n "${HEALTHCHECK_URL:-}" ]; then
    wget -q -O /dev/null "$HEALTHCHECK_URL"
fi
