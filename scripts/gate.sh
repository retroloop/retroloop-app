#!/usr/bin/env bash
#
# The merge gate. Nothing reaches `main` that has not exited 0 here, and no
# worker "done" is relayed to the owner before it has (CLAUDE.md).
#
# Suites 1-6 of docs/design/testing.md, in the order that fails cheapest first:
#
#   install     bun install --frozen-lockfile — heals install-state lag, refuses a real move
#   static      tsc --noEmit per package · biome ci · dependency direction · mock lock + parity
#   scripts     the enforcement scripts' own tests — a gate that cannot fail is no gate
#   unit        bun test in core, api, cli
#   web         Gherkin over headless chromium, including the zero-console-error check
#   e2e         the all-real runner — core loop · real time · stage upgrade
#
# Every check below actually runs. Nothing here echoes PASS on its own.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
RESET=$'\033[0m'

# ── install state ─────────────────────────────────────────────────────────────
# `node_modules` is per-checkout and moves only when something runs an install;
# `bun.lock` travels with git. `worktree add`, `merge` and `rebase` each move the
# lockfile out from under the installed packages, and the drift then surfaces as a
# 0-second `Cannot find module` typecheck that names nothing about install state —
# three faces in one session, patched three times (retro-15 `r-install-state-drift`).
# The gate is the one choke point every git path crosses, so it reconciles here,
# in front of the typecheck phase that would otherwise report the lag as a source
# bug. `--frozen-lockfile` can resolve nothing new and rewrite nothing, so a lag
# heals in place while a genuine dependency change still refuses, loudly: a moved
# lockfile is a decision someone has to make, not a state the gate may repair.

lock_snapshot=''
if [[ -f bun.lock ]]; then
  lock_snapshot="$(mktemp -t retro-gate-bun-lock)"
  cp bun.lock "$lock_snapshot"
fi

if [[ -d node_modules ]]; then
  entry_state='node_modules present'
else
  entry_state='node_modules absent'
fi

printf '\n%s── install    reconcile install state with bun.lock%s\n%sbun install --frozen-lockfile  (%s at entry)%s\n' \
  "$BOLD" "$RESET" "$DIM" "$entry_state" "$RESET"
install_start=$SECONDS

if ! bun install --frozen-lockfile; then
  [[ -n "$lock_snapshot" ]] && rm -f "$lock_snapshot"
  printf '\n%sGATE: REFUSED%s — `bun install --frozen-lockfile` failed.\n' "$RED" "$RESET" >&2
  printf 'The lockfile and the manifests disagree, or a pinned version is unfetchable. That is a\n' >&2
  printf 'real dependency change, not install-state lag: run `bun install`, read what moved, and\n' >&2
  printf 'commit the lockfile deliberately. The gate does not resolve dependencies for you.\n' >&2
  exit 1
fi

if [[ -n "$lock_snapshot" ]]; then
  if ! cmp -s bun.lock "$lock_snapshot"; then
    printf '\n%sGATE: REFUSED%s — bun.lock moved during the install.\n' "$RED" "$RESET" >&2
    cmp bun.lock "$lock_snapshot" >&2
    printf 'A frozen install must never rewrite the lockfile; that it did means this checkout\n' >&2
    printf 'carries a dependency change nobody has committed. Review it and commit it — the gate\n' >&2
    printf 'heals install-state lag and refuses everything else.\n' >&2
    rm -f "$lock_snapshot"
    exit 1
  fi
  rm -f "$lock_snapshot"
elif [[ -f bun.lock ]]; then
  printf '\n%sGATE: REFUSED%s — the install created a bun.lock this checkout did not have.\n' "$RED" "$RESET" >&2
  printf 'A frozen install must never write a lockfile; commit it deliberately instead.\n' >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  printf '\n%sGATE: REFUSED%s — node_modules is still missing after a clean install.\n' "$RED" "$RESET" >&2
  exit 1
fi

printf '%sinstall state reconciled — %s at entry, bun.lock unmoved (%ss)%s\n' \
  "$DIM" "$entry_state" "$((SECONDS - install_start))" "$RESET"

declare -a STEP_NAMES=()
declare -a STEP_STATUS=()
declare -a STEP_SECONDS=()
failures=0

run_step() {
  local name="$1" command="$2" start status
  printf '\n%s── %s%s\n%s%s%s\n' "$BOLD" "$name" "$RESET" "$DIM" "$command" "$RESET"
  start=$SECONDS
  if bash -c "$command"; then
    status=PASS
  else
    status=FAIL
    failures=$((failures + 1))
  fi
  STEP_NAMES+=("$name")
  STEP_STATUS+=("$status")
  STEP_SECONDS+=("$((SECONDS - start))")
}

# ── static ────────────────────────────────────────────────────────────────────
for package in packages/core apps/api apps/cli apps/web; do
  run_step "typecheck  $package" "./node_modules/.bin/tsc --noEmit -p $package/tsconfig.json"
done
run_step 'typecheck  scripts + e2e' './node_modules/.bin/tsc --noEmit -p tsconfig.json'
run_step 'biome ci   lint + format' './node_modules/.bin/biome ci .'
run_step 'check      dependency direction' 'bun run scripts/check-deps.ts'
run_step 'check      mock lock' 'bun run scripts/check-mock-lock.ts'
run_step 'check      mock parity' 'bun run scripts/check-mock-parity.ts'

# ── the gate's own scripts ────────────────────────────────────────────────────
run_step 'suite      gate scripts self-test' 'bun test scripts'

# ── unit suites ───────────────────────────────────────────────────────────────
run_step 'suite      bun test core, api, cli' \
  "bun run --filter '@retro/core' --filter '@retro/api' --filter '@retro/cli' test"

# ── web Gherkin + headless check ──────────────────────────────────────────────
# Builds apps/web, serves the build, drives headless chromium, and asserts zero
# console errors and zero pageerrors on the `/` placeholder.
run_step 'suite      web gherkin (headless chromium)' 'cd apps/web && bun run test'

# ── all-real e2e ──────────────────────────────────────────────────────────────
run_step 'suite      e2e (real cli, real server, real chromium)' \
  './node_modules/.bin/bddgen --config e2e/playwright.config.ts \
     && ./node_modules/.bin/playwright test --config e2e/playwright.config.ts'

# ── summary ───────────────────────────────────────────────────────────────────
printf '\n%s══ gate summary ══%s\n' "$BOLD" "$RESET"
for index in "${!STEP_NAMES[@]}"; do
  if [[ "${STEP_STATUS[$index]}" == PASS ]]; then
    colour="$GREEN"
  else
    colour="$RED"
  fi
  printf '%s%-4s%s %-38s %ss\n' \
    "$colour" "${STEP_STATUS[$index]}" "$RESET" "${STEP_NAMES[$index]}" "${STEP_SECONDS[$index]}"
done

if [[ $failures -gt 0 ]]; then
  printf '\n%sGATE: FAIL%s — %d of %d checks failed (%ss)\n' \
    "$RED" "$RESET" "$failures" "${#STEP_NAMES[@]}" "$SECONDS"
  exit 1
fi

printf '\n%sGATE: PASS%s — %d checks (%ss)\n' \
  "$GREEN" "$RESET" "${#STEP_NAMES[@]}" "$SECONDS"
