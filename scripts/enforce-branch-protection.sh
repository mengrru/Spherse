#!/usr/bin/env bash
# Enforce GitHub branch protection on the dev branch, requiring the PR build check
# ("PR Build / verify" from .github/workflows/pr-build.yml) to pass before merge.
#
#   scripts/enforce-branch-protection.sh             # apply (idempotent PUT)
#   scripts/enforce-branch-protection.sh --check     # verify current protection matches branch-protection.json
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

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  || fail "unable to resolve repository (is gh installed and authenticated?)"
PROTECTION_URL="repos/$REPO/branches/$BRANCH/protection"

check_setting() {
  local jq_expr="$1" expected="$2" label="$3" actual
  actual="$(gh api "$PROTECTION_URL" --jq "$jq_expr")" \
    || fail "unable to read '$label' from branch protection of $REPO/$BRANCH"
  [[ "$actual" == "$expected" ]] || fail "$label is '$actual', expected '$expected'"
}

case "$MODE" in
  check)
    printf 'Checking branch protection for %s/%s ...\n' "$REPO" "$BRANCH"
    err_file="$(mktemp)"
    if ! contexts="$(gh api "$PROTECTION_URL/required_status_checks" --jq '.contexts[]' 2>"$err_file")"; then
      if grep -q 'HTTP 404' "$err_file"; then
        rm -f "$err_file"
        fail "$BRANCH is not protected or has no required status checks"
      fi
      echo "FAIL: unable to read required status checks for $REPO/$BRANCH:" >&2
      cat "$err_file" >&2
      rm -f "$err_file"
      exit 1
    fi
    rm -f "$err_file"
    if [[ -z "$contexts" ]]; then
      fail "required status checks exist for $BRANCH but the contexts list is empty"
    fi
    if ! printf '%s\n' "$contexts" | grep -qxF "$REQUIRED_CHECK"; then
      fail "required status checks missing '$REQUIRED_CHECK'. Current: $(printf '%s' "$contexts" | paste -sd ',' -)"
    fi
    echo "PASS: $BRANCH requires '$REQUIRED_CHECK' (contexts: $(printf '%s' "$contexts" | paste -sd ',' -))"
    check_setting '.required_status_checks.strict' false 'required_status_checks.strict'
    check_setting '.enforce_admins.enabled' true 'enforce_admins'
    check_setting '.allow_force_pushes.enabled' false 'allow_force_pushes'
    check_setting '.allow_deletions.enabled' false 'allow_deletions'
    check_setting '.required_linear_history.enabled' false 'required_linear_history'
    check_setting '.required_conversation_resolution.enabled' false 'required_conversation_resolution'
    echo "PASS: $BRANCH branch protection matches $PAYLOAD"
    ;;
  apply)
    printf 'Applying branch protection for %s/%s (required check: %s) ...\n' "$REPO" "$BRANCH" "$REQUIRED_CHECK"
    gh api --method PUT "$PROTECTION_URL" --input "$PAYLOAD" >/dev/null
    echo "Applied. Verifying ..."
    exec "$0" --check "$BRANCH"
    ;;
esac
