#!/usr/bin/env bash
set -Eeuo pipefail
#
# Usage: ops/deploy-api.sh --instance teste|opas [--skip-migrate] [--skip-backup]

INSTANCE=""
SKIP_MIGRATE=false
SKIP_BACKUP=false

die() { printf '\n[deploy-api] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[deploy-api] %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) INSTANCE="${2:-}"; shift 2 ;;
    --skip-migrate) SKIP_MIGRATE=true; shift ;;
    --skip-backup)  SKIP_BACKUP=true;  shift ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$INSTANCE" in
  teste) EXPECTED_BRANCH="dev" ;;
  opas)  EXPECTED_BRANCH="homologacao" ;;
  *) die "--instance must be 'teste' or 'opas' (got: '${INSTANCE:-empty}')" ;;
esac

# Everything that describes the deploy host lives outside this repository, which
# is public. See ops/deploy.env.example for the expected contents.
DEPLOY_ENV="${GODATA_DEPLOY_ENV:-$HOME/.config/godata/deploy.env}"
[[ -f "$DEPLOY_ENV" ]] || die "deploy settings file not found (see ops/deploy.env.example)"
# shellcheck disable=SC1090
set -a; . "$DEPLOY_ENV"; set +a

service_var="GODATA_SERVICE_${INSTANCE^^}"
PM2_SERVICE="${!service_var:-}"
[[ -n "$PM2_SERVICE" ]] || die "$service_var not set in the deploy settings file"
[[ -n "${GODATA_ROOT:-}" ]] || die "GODATA_ROOT not set in the deploy settings file"
[[ -n "${GODATA_BACKUP_ROOT:-}" ]] || die "GODATA_BACKUP_ROOT not set in the deploy settings file"

API_DIR="$GODATA_ROOT/$INSTANCE/GoDataSource-API"
[[ -d "$API_DIR/.git" ]] || die "directory for instance '$INSTANCE' not found"

# The frontend deploy restarts the same process and lives in another repository,
# which GitHub cannot serialize against this one.
exec 9>"/tmp/godata-deploy-$INSTANCE.lock"
flock -w 900 9 || die "timed out after 15min waiting for another deploy of instance '$INSTANCE'"

# Verbose sub-command output describes the host, and the Actions log is public.
RUN_LOG="/tmp/godata-deploy-api-$INSTANCE.log"
: >"$RUN_LOG"

# nvm keeps node/npm/pm2 out of a non-interactive PATH.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1090
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
for bin in node npm pm2 curl mongodump; do
  command -v "$bin" >/dev/null 2>&1 || die "'$bin' not found in PATH"
done

# Read from the instance instead of hardcoding, so the wrong target cannot be hit.
PORT="$(node -p "require('$API_DIR/server/config.json').port" 2>/dev/null)" || die "could not read the port of instance '$INSTANCE'"
DB="$(node -p "require('$API_DIR/server/datasources.json').mongoDb.database" 2>/dev/null)" || die "could not read the database of instance '$INSTANCE'"
log "instance=$INSTANCE branch=$EXPECTED_BRANCH"

CURRENT_BRANCH="$(git -C "$API_DIR" rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]] || \
  die "instance '$INSTANCE' is on branch '$CURRENT_BRANCH', expected '$EXPECTED_BRANCH'"

PREV="$(git -C "$API_DIR" rev-parse HEAD)"

# Runtime config is intentionally left modified, and which files differ is not the
# same in every instance. Every git operation below is only safe because of this.
SNAP="$(mktemp -d)"
trap 'rm -rf "$SNAP"' EXIT
mapfile -t DIRTY < <(git -C "$API_DIR" diff --name-only)
for f in "${DIRTY[@]}"; do
  mkdir -p "$SNAP/$(dirname "$f")"
  cp "$API_DIR/$f" "$SNAP/$f"
done
log "local config files preserved: ${#DIRTY[@]}"

restore_local_config() {
  for f in "${DIRTY[@]}"; do cp "$SNAP/$f" "$API_DIR/$f"; done
}

health_check() {
  local tries=15 code=""
  for ((i = 1; i <= tries; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/" || true)"
    if [[ "$code" == "200" || "$code" =~ ^3[0-9][0-9]$ ]]; then
      log "health check OK (HTTP $code, attempt $i)"
      return 0
    fi
    sleep 4
  done
  log "health check FAILED after $tries attempts (last code: ${code:-none})"
  return 1
}

git -C "$API_DIR" fetch origin "$EXPECTED_BRANCH"
TARGET="$(git -C "$API_DIR" rev-parse "origin/$EXPECTED_BRANCH")"

if [[ "$TARGET" == "$PREV" ]]; then
  log "already at target commit, nothing to pull"
else
  # Keeping the local version is correct, but the shadowed change must be visible.
  CLASH="$(git -C "$API_DIR" diff --name-only "$PREV..$TARGET" | grep -Fx -f <(printf '%s\n' "${DIRTY[@]}") || true)"
  if [[ -n "$CLASH" ]]; then
    log "WARNING: incoming commits change locally preserved config: $CLASH"
  fi

  git -C "$API_DIR" checkout -- .
  git -C "$API_DIR" merge --ff-only "$TARGET"
  restore_local_config
  log "updated to $(git -C "$API_DIR" rev-parse --short HEAD)"
fi

# An existing node_modules is not evidence that a new dependency is present.
if [[ "$TARGET" != "$PREV" ]] && \
   git -C "$API_DIR" diff --name-only "$PREV..$TARGET" | grep -qx 'package-lock.json'; then
  log "lockfile changed, running npm ci"
  (cd "$API_DIR" && npm ci --no-audit --no-fund) >>"$RUN_LOG" 2>&1 || die "npm ci failed, see $RUN_LOG on the host"
fi

if [[ "$SKIP_MIGRATE" != true ]]; then
  if [[ "$SKIP_BACKUP" != true ]]; then
    BACKUP_DIR="$GODATA_BACKUP_ROOT/$DB-$(date +%Y%m%d-%H%M%S)"
    mongodump --db="$DB" --out="$BACKUP_DIR" >>"$RUN_LOG" 2>&1 || die "backup failed, see $RUN_LOG on the host"
    # Bound the retained dumps so the disk does not fill up silently.
    find "$GODATA_BACKUP_ROOT" -maxdepth 1 -type d -name "$DB-*" | sort | head -n -10 | \
      xargs -r rm -rf
    log "backup created"
  fi
  log "running migrate-database"
  (cd "$API_DIR" && npm run migrate-database) >>"$RUN_LOG" 2>&1 || die "migration failed, see $RUN_LOG on the host"
fi

log "restarting service"
pm2 restart "$PM2_SERVICE" --update-env >>"$RUN_LOG" 2>&1 || die "restart failed, see $RUN_LOG on the host"

if health_check; then
  log "deploy finished: $(git -C "$API_DIR" rev-parse --short HEAD)"
  exit 0
fi

# The migration is deliberately not undone: migrations are additive, and reverting
# one is more dangerous than running the previous code against a newer schema.
log "starting rollback"
git -C "$API_DIR" reset --hard "$PREV"
restore_local_config
if git -C "$API_DIR" diff --name-only "$PREV..$TARGET" | grep -qx 'package-lock.json'; then
  (cd "$API_DIR" && npm ci --no-audit --no-fund) >>"$RUN_LOG" 2>&1 || die "npm ci failed, see $RUN_LOG on the host"
fi
pm2 restart "$PM2_SERVICE" --update-env >>"$RUN_LOG" 2>&1 || die "restart failed, see $RUN_LOG on the host"

if health_check; then
  die "deploy failed and was rolled back. The instance is up with the previous code."
fi
die "deploy failed AND the rollback did not come up. Instance '$INSTANCE' is DOWN."
