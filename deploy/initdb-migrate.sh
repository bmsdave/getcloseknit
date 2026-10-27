#!/usr/bin/env bash
# initdb hook (first boot of an empty volume only; docker-compose.yml mounts it after schema.sql):
# apply every migration and start the journal. No `exec` or `set`: the entrypoint may source this file.
CLOSE_KNIT_PSQL="psql --username $POSTGRES_USER --dbname $POSTGRES_DB --no-password" bash /close-knit/migrate.sh init
