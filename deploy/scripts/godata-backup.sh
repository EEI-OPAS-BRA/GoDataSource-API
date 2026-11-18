#!/usr/bin/env bash
# Daily Go.Data database dump, meant to run from cron.
#
# Usage: godata-backup.sh <install-dir> [--keep-days <n>]
#
#   <install-dir>   Docker install: the folder holding docker-compose.yml and .env.
#                   pm2 install: the folder holding atual/, config/ and dumps/.
#   --keep-days n   Delete dumps and config archives older than n days (default 14).
#
# Writes <install-dir>/dumps/<db>-<UTC stamp>.archive.gz (mongodump archive, gzip) and
# config-<same stamp>.tar.gz (config/, plus .env on Docker), both mode 0600. Prints one line:
# "backup ok <file> <size>", or "backup failed: <reason>" with exit status 1.
#
# Cron needs a PATH that has mongodump and node on a pm2 install (nvm is not loaded by cron),
# or docker on a Docker install:
#   pm2:    30 2 * * * <install-dir>/atual/deploy/scripts/godata-backup.sh <install-dir> >> <install-dir>/dumps/backup.log 2>&1
#   Docker: 30 2 * * * <install-dir>/deploy/scripts/godata-backup.sh <install-dir> >> <install-dir>/dumps/backup.log 2>&1
#
# No password appears on any command line. Docker: mongodump runs in the mongo container with a
# 0600 --config file built there from the container's own root password (mongodump reads only
# password and uri from a config file). pm2: the same with the
# URI from atual/server/datasources.json (db-state.js print-uri).

set -Eeuo pipefail
umask 077

STAMP_RE='[0-9]{8}T[0-9]{6}Z'
reported=0
owned=0
keep=0
tmpdir=""
dump_partial=""
cfg_partial=""
dump_final=""
cfg_final=""

fail() {
  if ((!reported)); then
    reported=1
    printf 'backup failed: %s\n' "$*"
  fi
  exit 1
}

cleanup() {
  local rc=$?
  trap - EXIT ERR INT TERM HUP
  [[ -z "$tmpdir" ]] || rm -rf -- "$tmpdir"
  if ((rc != 0)); then
    if ((owned && !keep)); then
      rm -f -- "$dump_partial" "$cfg_partial" "$dump_final" "$cfg_final"
    fi
    if ((!reported)); then
      printf 'backup failed: unexpected error (exit status %s)\n' "$rc"
    fi
    exit 1
  fi
}

trap cleanup EXIT
trap 'fail "command failed at line $LINENO"' ERR
trap 'fail "interrupted"' INT TERM HUP

usage_error() {
  printf 'usage: godata-backup.sh <install-dir> [--keep-days <n>]\n' >&2
  reported=1
  exit 2
}

install_dir=""
keep_days=14
while (($#)); do
  case "$1" in
    --keep-days)
      (($# >= 2)) || usage_error
      keep_days="$2"
      shift 2
      ;;
    -h | --help) usage_error ;;
    -*) usage_error ;;
    *)
      [[ -z "$install_dir" ]] || usage_error
      install_dir="$1"
      shift
      ;;
  esac
done
[[ -n "$install_dir" ]] || usage_error
[[ "$keep_days" =~ ^[0-9]+$ && "$keep_days" -ge 1 ]] || fail "--keep-days must be a positive integer"
[[ -d "$install_dir" ]] || fail "install directory not found: $install_dir"
install_dir="$(cd "$install_dir" && pwd)"

# KEY=VALUE reader for .env: the file is never sourced
env_value() {
  local key="$1" line value=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*"$key"=(.*)$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
  done < "$install_dir/.env"
  if [[ "$value" =~ ^\'(.*)\'$ || "$value" =~ ^\"(.*)\"$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

# Escapes a value for a YAML single-quoted scalar
yaml_quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

if [[ -f "$install_dir/docker-compose.yml" ]]; then
  mode=docker
  command -v docker > /dev/null || fail "docker not found in PATH"
  [[ -f "$install_dir/.env" ]] || fail "no .env in $install_dir"
  db="$(env_value GODATA_DB)"
  db="${db:-go-data}"
else
  mode=pm2
  datasources="$install_dir/atual/server/datasources.json"
  command -v node > /dev/null || fail "node not found in PATH (cron must provide PATH)"
  command -v mongodump > /dev/null || fail "mongodump not found in PATH"
  [[ -f "$datasources" ]] || fail "no $datasources, is this an install folder?"
  db="$(NODE_NO_WARNINGS=1 node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).mongoDb || {};
    console.log(d.database || d.db || "go-data");' "$datasources")"
fi
[[ "$db" =~ ^[A-Za-z0-9_.-]+$ ]] || fail "unsupported database name: $db"
[[ -d "$install_dir/config" ]] || fail "no config/ in $install_dir"

dumps="$install_dir/dumps"
# shellcheck disable=SC2174 # the parent is the install folder and exists
mkdir -p -m 700 -- "$dumps" || fail "cannot create $dumps"
exec 9>> "$dumps/.backup.lock"
flock -n 9 || fail "another backup is running"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_final="$dumps/$db-$stamp.archive.gz"
cfg_final="$dumps/config-$stamp.tar.gz"
dump_partial="$dump_final.partial"
cfg_partial="$cfg_final.partial"
owned=1
rm -f -- "$dump_partial" "$cfg_partial"

if [[ "$mode" == docker ]]; then
  read -r -d '' remote <<'SH' || true
umask 077
d="$(mktemp -d)" || exit 1
trap 'rm -rf "$d"' EXIT
{
  printf "password: '"
  printf "%s" "$MONGO_INITDB_ROOT_PASSWORD" | sed "s/'/''/g"
  printf "'\n"
} > "$d/mongodump.yml"
mongodump --config "$d/mongodump.yml" --username "$MONGO_INITDB_ROOT_USERNAME" --authenticationDatabase admin \
  --db "$1" --archive --gzip
SH
  docker compose --project-directory "$install_dir" exec -T mongo sh -c "$remote" sh "$db" \
    > "$dump_partial" || fail "mongodump failed in the mongo container (stack down, or no space left in dumps?)"
  tar -czf "$cfg_partial" -C "$install_dir" config .env || fail "cannot archive config/ and .env"
else
  tmpdir="$(mktemp -d)"
  uri="$(NODE_NO_WARNINGS=1 node "$install_dir/atual/deploy/lib/db-state.js" print-uri --datasources "$datasources")" ||
    fail "cannot build the MongoDB URI from $datasources"
  printf 'uri: %s\n' "$(yaml_quote "$uri")" > "$tmpdir/mongodump.yml"
  unset uri
  mongodump --config "$tmpdir/mongodump.yml" --db "$db" --archive --gzip > "$dump_partial" ||
    fail "mongodump failed"
  tar -czf "$cfg_partial" -C "$install_dir" config || fail "cannot archive config/"
fi

[[ -s "$dump_partial" ]] || fail "the dump is empty"
gzip -t -- "$dump_partial" || fail "the dump is not a valid gzip archive"
tar -tzf "$cfg_partial" > /dev/null || fail "the config archive is not readable"
mv -- "$dump_partial" "$dump_final" || fail "cannot rename the dump"
mv -- "$cfg_partial" "$cfg_final" || fail "cannot rename the config archive"
keep=1

db_re="${db//./\\.}"
# find counts whole days and truncates, so -mtime +N matches files at least N+1 days old:
# +14 removes 15 days, keeps 14 and 13
(cd "$dumps" && find . -maxdepth 1 -type f -mtime "+$keep_days" -regextype posix-extended \
  \( -regex "\./$db_re-$STAMP_RE\.archive\.gz" -o -regex "\./config-$STAMP_RE\.tar\.gz" \) \
  -print -delete) | sed 's/^/removed old file: /' >&2 || fail "retention cleanup failed (the new backup is kept)"

size="$(numfmt --to=iec --suffix=B "$(stat -c %s -- "$dump_final")")"
reported=1
printf 'backup ok %s %s\n' "$dump_final" "$size"
