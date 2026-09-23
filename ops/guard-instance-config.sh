#!/usr/bin/env bash
set -Eeuo pipefail
#
# Keeps an instance checkout from ever committing its runtime credentials.
#
# server/datasources.json is tracked but holds the live database and mail
# passwords on every instance, and server.js rewrites it on boot, so it is
# permanently modified. This applies two independent guards:
#
#   1. skip-worktree, so `git add -A` cannot stage it
#   2. a pre-commit hook, in case skip-worktree is ever cleared
#
# Run once per instance checkout. Safe to re-run.
#
# Usage: ops/guard-instance-config.sh [repo-dir]

REPO_DIR="${1:-$(git rev-parse --show-toplevel)}"

die() { printf '\n[guard] ERRO: %s\n' "$*" >&2; exit 1; }
log() { printf '[guard] %s\n' "$*"; }

[[ -d "$REPO_DIR/.git" ]] || die "'$REPO_DIR' nao e um repositorio git"

PROTECTED="server/datasources.json"

if git -C "$REPO_DIR" ls-files --error-unmatch "$PROTECTED" >/dev/null 2>&1; then
  git -C "$REPO_DIR" update-index --skip-worktree "$PROTECTED"
  log "skip-worktree aplicado em $PROTECTED"
else
  log "AVISO: $PROTECTED nao e rastreado aqui, pulando skip-worktree"
fi

HOOK="$(git -C "$REPO_DIR" rev-parse --git-path hooks/pre-commit)"
[[ "$HOOK" = /* ]] || HOOK="$REPO_DIR/$HOOK"
mkdir -p "$(dirname "$HOOK")"

cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
#
# Refuses to commit runtime credentials or exported data.

BLOCKED="$(git diff --cached --name-only --diff-filter=ACMR \
  | grep -E '^(server/datasources\.json|\.env|server/storage/(files|icons)/.+)$' \
  | grep -vE '/(\.gitkeep|README\.md)$' || true)"

if [[ -n "$BLOCKED" ]]; then
  printf '\nCommit bloqueado. Estes arquivos carregam credenciais ou dados exportados:\n\n' >&2
  printf '  %s\n' $BLOCKED >&2
  printf '\nRemova do indice com: git restore --staged <arquivo>\n' >&2
  printf 'Para uma alteracao legitima do template, use: git commit --no-verify\n\n' >&2
  exit 1
fi
HOOK_EOF

chmod +x "$HOOK"
log "hook pre-commit instalado em $HOOK"
log "instancia protegida"
