#!/bin/sh
# Starts as root only to make the (often root-owned) data folder writable,
# then runs the app as an unprivileged user (PUID/PGID, default 1000 = node).
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
