#!/usr/bin/env bash
# Enforce GitHub branch protection on the dev branch, requiring the PR build check
# ("PR Build / verify" from .github/workflows/pr-build.yml) to pass before merge.
#
#   scripts/enforce-branch-protection.sh            # apply (idempotent PUT)
#   scripts/enforce-branch-protection.sh --check    # verify current protection matches
#   BRANCH=main scripts/enforce-branch-protection.sh # target another branch
#
# Requires: gh (authenticated, scope: repo)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$SCRIPT_DIR/branch-protection.json"
BRANCH="${BRANCH:-dev}"
REQUIRED_CHECK="PR Build / verify"

MODE=apply
if [[ "${1:-}" == "--check" ]]; then
  MODE=check
  shift || true
fi
if [[ $# -gt 0 ]]; then
  BRANCH="$1"
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

case "$MODE" in
  check)
    printf 'Checking branch protection for %s/%s ...\n' "$REPO" "$BRANCH"
    contexts="$(gh api "repos/$REPO/branches/$BRANCH/protection/required_status_checks" \
      --jq '.contexts[]' 2>/dev/null || true)"
    if [[ -z "$contexts" ]]; then
      echo "FAIL: $BRANCH has no required status checks configured" >&2
      exit 1
    fi
    if ! printf '%s\n' "$contexts" | grep -qx "$REQUIRED_CHECK"; then
      echo "FAIL: required status checks missing '$REQUIRED_CHECK'. Current: $(printf '%s' "$contexts" | tr '\n' ',' )" >&2
      exit 1
    fi
    echo "PASS: $BRANCH requires '$REQUIRED_CHECK' (contexts: $(printf '%s' "$contexts" | tr '\n' ',' ))"
    ;;
  apply)
    printf 'Applying branch protection for %s/%s (required check: %s) ...\n' "$REPO" "$BRANCH" "$REQUIRED_CHECK"
    gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" \
      --input "$PAYLOAD" >/dev/null
    echo "Applied. Verifying ..."
    exec "$0" --check "$BRANCH"
    ;;
esac
