#!/usr/bin/env bash
set -Eeuo pipefail
# Installs a pre-commit hook that refuses runtime credentials, machine addresses and exported data.
# Usage: ops/guard-instance-config.sh [repo-dir]   (or: npm run setup-hooks)

REPO_DIR="${1:-$(git rev-parse --show-toplevel)}"

die() { printf '\n[guard] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[guard] %s\n' "$*"; }

git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 || die "'$REPO_DIR' is not a git repository"

MARKER='# go.data guard-instance-config hook'
HOOK="$(git -C "$REPO_DIR" rev-parse --git-path hooks/pre-commit)"
[[ "$HOOK" = /* ]] || HOOK="$REPO_DIR/$HOOK"

if [[ -e "$HOOK" ]] && ! grep -qF "$MARKER" "$HOOK"; then
  die "a different pre-commit hook already exists at $HOOK; add the checks of this script to it by hand"
fi
mkdir -p "$(dirname "$HOOK")"

cat > "$HOOK" <<HOOK_EOF
#!/usr/bin/env bash
$MARKER
HOOK_EOF
cat >> "$HOOK" <<'HOOK_EOF'
set -Eeuo pipefail

BLOCKED=()
while IFS= read -r -d '' file; do
  if [[ "$file" =~ ^(server/datasources\.json|\.env|server/storage/(files|icons)/.+)$ ]] &&
    ! [[ "$file" =~ /(\.gitkeep|README\.md)$ ]]; then
    BLOCKED+=("$file")
  fi
done < <(git -c core.quotePath=false diff --cached --name-only -z --diff-filter=ACMR)

# config.json is rewritten on boot with the machine address, so only its added lines are checked
CONFIG_LEAKS="$(git diff --cached -U0 -- server/config.json \
  | grep -E '^\+[^+]' \
  | grep -E '([0-9]{1,3}\.){3}[0-9]{1,3}|"(secret|password|masterKey)"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | grep -vE '"(0\.0\.0\.0|127\.0\.0\.1)"' || true)"

if (( ${#BLOCKED[@]} )) || [[ -n "$CONFIG_LEAKS" ]]; then
  printf '\nCommit refused: it carries credentials, machine addresses or exported data.\n\n' >&2
  for file in "${BLOCKED[@]}"; do
    printf '  %s\n' "$file" >&2
  done
  if [[ -n "$CONFIG_LEAKS" ]]; then
    printf '  server/config.json:\n%s\n' "$CONFIG_LEAKS" >&2
  fi
  printf '\nUnstage with: git restore --staged <file>\n' >&2
  printf 'For a legitimate change to the template, use: git commit --no-verify\n\n' >&2
  exit 1
fi
HOOK_EOF

chmod +x "$HOOK"
log "pre-commit hook installed at $HOOK"
