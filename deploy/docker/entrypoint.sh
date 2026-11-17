#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR=/opt/godata
readonly CONFIG_DIR="$APP_DIR/config"
readonly STORAGE_DIR="$APP_DIR/server/storage"
readonly BACKUP_DIR="$APP_DIR/backups"
readonly STATE_DIR="$APP_DIR/state"
readonly MARKER="$STATE_DIR/migration-failed"
readonly SENTINEL="$STATE_DIR/db-command-running"
readonly RUN_LOG="$STATE_DIR/last-run.log"
readonly SCHEDULER_STATE="$STATE_DIR/scheduler.json"
readonly RUNTIME_CONFIG="$APP_DIR/client/dist/assets/runtime-config.json"
readonly MONGO_WAIT_ATTEMPTS=30

log() { printf '%s godata-entrypoint: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

helper() { NODE_NO_WARNINGS=1 node "$APP_DIR/deploy/lib/$1.js" "${@:2}"; }

cd "$APP_DIR"

if [[ "$(id -u)" == 0 ]]; then
  umask 027
  mkdir -p "$STORAGE_DIR/files" "$STORAGE_DIR/icons" "$BACKUP_DIR" "$STATE_DIR"
  for dir in "$STORAGE_DIR" "$BACKUP_DIR" "$STATE_DIR"; do
    find "$dir" \( ! -user node -o ! -group node \) -exec chown -h node:node {} +
    chmod 0750 "$dir"
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
  } > "$MARKER.tmp" && mv -f "$MARKER.tmp" "$MARKER"
}

# Never exits: a database command may have touched the data, so a restart must not run another one. When the
# marker cannot be written, the sentinel stays and blocks the next start instead.
stop_with_marker() {
  set +e
  if write_marker "$2"; then
    rm -f "$SENTINEL"
  else
    log "error: could not write $MARKER; $SENTINEL is kept and blocks the next start"
  fi
  log "$1"
  exec sleep infinity
}

# Sets REPLY to the helper's answer; returns 1, after logging, when the database cannot be read.
db_state() {
  if ! REPLY="$(helper db-state "$@" 2> "$err_file")"; then
    log "error: db-state $1 failed: $(cat "$err_file")"
    return 1
  fi
}

# The sentinel exists for the whole run, so a container stopped midway refuses the next start. The output goes to
# the container log and to $RUN_LOG for the marker. install-guard turns an install script that ends without
# completing into a non-zero exit and prints "install script completed" only after a real completion.
run_db_command() {
  local failure="" message="migration failed, see $MARKER"
  if [[ "$1" == init-database ]]; then
    message="database initialisation failed, see $MARKER"
  fi
  if ! echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1 (image ${GODATA_VERSION:-unknown})" > "$RUN_LOG" ||
    ! cp "$RUN_LOG" "$SENTINEL"; then
    log "error: cannot write to $STATE_DIR, not running $1"
    exit 1
  fi
  log "running $1"
  if ! NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require $APP_DIR/deploy/lib/install-guard.js" \
    npm run "$1" 2>&1 | tee -a "$RUN_LOG"; then
    failure="$1 exited with an error"
  elif ! grep -qxF 'install script completed' "$RUN_LOG"; then
    failure="$1 exited 0 without completing"
  elif ! db_state migration-in-progress; then
    failure="could not read the migration log after $1"
  elif [[ "$REPLY" == yes ]]; then
    failure="$1 left a migration at status Started in migrationLog"
  elif [[ "$1" == init-database ]] && ! db_state has-users; then
    failure="could not read the users after init-database"
  elif [[ "$1" == init-database && "$REPLY" != yes ]]; then
    failure="init-database finished but the database still has no users"
  fi
  if [[ -n "$failure" ]]; then
    stop_with_marker "$message" "$failure"
  fi
  rm -f "$SENTINEL"
  log "$1 finished"
}

# 1. Configuration
if ! out="$(helper merge-config --defaults "$APP_DIR/deploy/defaults" --overrides "$CONFIG_DIR" \
  --server-dir "$APP_DIR/server" --mongo-env --docker --runtime-config "$RUNTIME_CONFIG" 2> "$err_file")"; then
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

# 3. Refuse after a failed or interrupted database command
if [[ -e "$SENTINEL" && ! -e "$MARKER" ]]; then
  interrupted="$(cat "$SENTINEL" 2> /dev/null || true)"
  log "a database command did not finish: $interrupted"
  if write_marker "interrupted: $interrupted did not finish (the container stopped while it ran)"; then
    rm -f "$SENTINEL"
  fi
fi
if [[ -e "$MARKER" || -e "$SENTINEL" ]]; then
  log "refusing to start: a previous database command failed or was interrupted, see $MARKER"
  log "to recover: after an interrupted init-database, drop the database and start again; after a failed update," \
    "restore the dump taken before it; or fix the cause and delete data/state/migration-failed" \
    "(the update manual has the commands)"
  exec sleep infinity
fi

# 4. Init or migrate, decided by the data
db_state migration-in-progress || exit 1
if [[ "$REPLY" == yes ]]; then
  log "a migration was left in progress (status Started in migrationLog), not migrating"
  stop_with_marker "migration failed, see $MARKER" \
    "a migration was left in progress (status Started in migrationLog); the previous run was interrupted"
fi
case "$has_users" in
  yes)
    log "database has users"
    run_db_command migrate-database
    ;;
  no)
    db_state db-empty || exit 1
    if [[ "$REPLY" != yes ]]; then
      stop_with_marker "refusing to run init-database: the database has documents but no users, see $MARKER" \
        "the database has documents but no users (a partial restore or an interrupted init?); init-database drops every collection, so it only runs on an empty database"
    fi
    log "database is empty"
    run_db_command init-database
    ;;
  *)
    log "error: unexpected answer from db-state has-users: $has_users"
    exit 1
    ;;
esac

# 5. Backup location
db_state set-backup-location "$BACKUP_DIR" || exit 1
log "backup location: $REPLY"

# server/boot/scheduler.json links here; the scheduler skips every routine while the file is missing.
if [[ ! -e "$SCHEDULER_STATE" ]]; then
  echo '{}' > "$SCHEDULER_STATE"
  log "scheduler state: created $SCHEDULER_STATE"
fi

# 6. Start the application
log "starting Go.Data ${GODATA_VERSION:-unknown}"
rm -f "$err_file"
trap - EXIT
exec node .
