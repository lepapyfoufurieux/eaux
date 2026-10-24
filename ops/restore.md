# Restoring from a backup

Test this once per quarter on a spare machine.

1. Install Docker, clone the repository, copy `.env` from the password manager.
2. `restic restore latest --target /tmp/restore`
3. Start the database only: `docker compose up -d db`
4. Restore the dump:
   `docker compose exec -T db pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --clean < /tmp/restore/var/backups/eaux/eaux.dump`
5. Copy the photos into the `media` volume:
   `docker run --rm -v eaux_media:/dest -v /tmp/restore:/src alpine cp -a /src/var/lib/docker/volumes/eaux_media/_data/. /dest/`
6. `docker compose up -d --build` and check the map shows the latest readings.
