#!/bin/sh
set -e

# Persistent access log lives on a volume (survives rebuilds, unlike
# Docker's own container log which this project already learned the
# hard way gets wiped every time this container is recreated - see the
# 2 Aug/3 Aug "why was the light on" investigation this was built for).
#
# Simple size-based rotation, checked once at container start rather
# than running a whole cron/logrotate daemon just for this: one
# previous generation kept (access.log.1), current file reset once it
# crosses 5MB. Same reasoning as the DB pruning elsewhere in this
# project - an unbounded log on an SD card is the same class of
# problem as an unbounded table, just a file instead of a row count.
LOG_DIR="/var/log/vanos"
LOG_FILE="$LOG_DIR/access.log"
MAX_BYTES=5242880

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

if [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_BYTES" ]; then
    mv "$LOG_FILE" "$LOG_FILE.1"
    touch "$LOG_FILE"
fi

exec nginx -g "daemon off;"
