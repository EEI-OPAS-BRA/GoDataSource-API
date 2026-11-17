#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR=/opt/godata
readonly CONFIG_DIR="$APP_DIR/config"
readonly STORAGE_DIR="$APP_DIR/server/storage"
readonly BACKUP_DIR="$APP_DIR/backups"
readonly STATE_DIR="$APP_DIR/state"
readonly MARKER="$STATE_DIR/migration-failed"
readonly RUN_LOG="$STATE_DIR/last-run.log"
readonly RUNTIME_CONFIG="$APP_DIR/client/dist/assets/runtime-config.json"
readonly MONGO_WAIT_ATTEMPTS=30

log() { printf '%s godata-entrypoint: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

helper() { NODE_NO_WARNINGS=1 node "$APP_DIR/deploy/lib/$1.js" "${@:2}"; }

cd "$APP_DIR"

if [[ "$(id -u)" == 0 ]]; then
  mkdir -p "$STORAGE_DIR/files" "$STORAGE_DIR/icons" "$BACKUP_DIR" "$STATE_DIR"
  for dir in "$STORAGE_DIR" "$BACKUP_DIR" "$STATE_DIR"; do
    find "$dir" \( ! -user node -o ! -group node \) -exec chown -h node:node {} +
  done
  export HOME=/home/node USER=node
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

for dir in "$STORAGE_DIR" "$BACKUP_DIR" "$STATE_DIR"; do
  if [[ ! -w "$dir" ]]; then
    log "error: $dir is not writable by uid $(id -u); start the container as root or chown the folder to uid $(id -u)"
    exit 1
  fi
done
mkdir -p "$STORAGE_DIR/files" "$STORAGE_DIR/icons"

err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT

stop_after_failure() {
  log "$1 failed, see $MARKER"
  exec sleep infinity
}

write_marker() {
  {
    echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "image version: ${GODATA_VERSION:-unknown} (revision ${GODATA_REVISION:-unknown})"
    echo "reason: $1"
    echo "last 50 log lines:"
    if [[ -s "$RUN_LOG" ]]; then
      tail -n 50 "$RUN_LOG"
    else
      echo "(none)"
    fi
  } > "$MARKER.tmp"
  mv -f "$MARKER.tmp" "$MARKER"
}

# Sets REPLY to the helper's answer; exits when the database cannot be read.
db_state() {
  if ! REPLY="$(helper db-state "$@" 2> "$err_file")"; then
    log "error: db-state $1 failed: $(cat "$err_file")"
    exit 1
  fi
}

# Output goes to the container log and to $RUN_LOG, so a run killed midway still leaves its lines for the marker.
# The install script can exit 0 after losing the database, so the outcome is also checked in the data.
run_db_command() {
  local failure=""
  log "running $1"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1 (image ${GODATA_VERSION:-unknown})" > "$RUN_LOG"
  if ! npm run "$1" 2>&1 | tee -a "$RUN_LOG"; then
    failure="$1 exited with an error"
  else
    db_state migration-in-progress
    if [[ "$REPLY" == yes ]]; then
      failure="$1 exited 0 but left a migration at status Started in migrationLog"
    elif [[ "$1" == init-database ]]; then
      db_state has-users
      if [[ "$REPLY" != yes ]]; then
        failure="init-database exited 0 but the database still has no users"
      fi
    fi
  fi
  if [[ -z "$failure" ]]; then
    log "$1 finished"
    return 0
  fi
  write_marker "$failure"
  if [[ "$1" == init-database ]]; then
    stop_after_failure "database initialisation"
  fi
  stop_after_failure migration
}

# 1. Configuration
if ! out="$(helper merge-config --defaults "$APP_DIR/deploy/defaults" --overrides "$CONFIG_DIR" \
  --server-dir "$APP_DIR/server" --mongo-env --runtime-config "$RUNTIME_CONFIG" 2> "$err_file")"; then
  log "error: configuration failed: $(cat "$err_file")"
  exit 1
fi
log "configuration: server/config.json and server/datasources.json built from the image defaults and $CONFIG_DIR"
if [[ -n "$out" ]]; then
  log "$out"
fi

# A command given to the container runs with the merged configuration instead of the startup sequence.
if (($# > 0)); then
  exec "$@"
fi

# 2. Wait for MongoDB
has_users=""
for ((attempt = 1; attempt <= MONGO_WAIT_ATTEMPTS; attempt++)); do
  if has_users="$(helper db-state has-users 2> "$err_file")"; then
    break
  fi
  has_users=""
  if ((attempt == MONGO_WAIT_ATTEMPTS)); then
    log "error: MongoDB not reachable after $MONGO_WAIT_ATTEMPTS attempts: $(cat "$err_file")"
    exit 1
  fi
  log "waiting for MongoDB (attempt $attempt/$MONGO_WAIT_ATTEMPTS): $(cat "$err_file")"
  sleep 5
done
log "MongoDB is reachable"

# 3. Refuse after a failed migration
if [[ -e "$MARKER" ]]; then
  log "refusing to start: a previous migration failed, see $MARKER"
  log "to recover, restore the dump taken before the update, or fix the cause and delete data/state/migration-failed;" \
    "the update manual has both commands"
  exec sleep infinity
fi

# 4. Init or migrate, decided by the data
db_state migration-in-progress
if [[ "$REPLY" == yes ]]; then
  log "a migration was left in progress (status Started in migrationLog), not migrating"
  write_marker "a migration was left in progress (status Started in migrationLog); the previous run was interrupted"
  stop_after_failure migration
fi
case "$has_users" in
  no)
    log "database has no users"
    run_db_command init-database
    ;;
  yes)
    log "database has users"
    run_db_command migrate-database
    ;;
  *)
    log "error: unexpected answer from db-state has-users: $has_users"
    exit 1
    ;;
esac

# 5. Backup location
db_state set-backup-location "$BACKUP_DIR"
log "backup location: $REPLY"

# 6. Start the application
log "starting Go.Data ${GODATA_VERSION:-unknown}"
rm -f "$err_file"
trap - EXIT
exec node .
