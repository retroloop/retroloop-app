#!/usr/bin/env bash
#
# The plant harness (`r-plant-revert-second`, `r-ineffective-plant-blind`,
# `r-control-test-signature`; docs/design/testing.md).
#
# Plant-and-catch is a standing rule: representative defects are planted and the
# checks are watched catching them. Several things have gone wrong around that
# rule, and each of them is a mode here rather than a sentence someone has to
# remember at the one moment attention is on the plant table instead of git state.
#
#   Reverting the plant took the fix with it, twice. A tree-wide
#   `git checkout -- .` lost a fix, its scenario and a fixture change; a per-file
#   one lost six uncommitted fixes. Both times the written rule existed and had
#   been quoted.
#
#   A plant the check could not see passed as a finding. An edit changed a tally
#   but not the dependencies that recomputed it: the diff was non-empty, the
#   suite stayed green at 214/214, and the report was about to read "the scenario
#   failed to catch it". A non-empty diff was never evidence.
#
#   A legitimate control was read as sabotage. `git checkout main -- apps/web`, to
#   reproduce a flake on unmodified main and restored one command later, is
#   byte-identical in git signature to the work-destroying revert above — so it
#   cost an emergency interruption. Intent cannot be observed; it has to be
#   declared.
#
#   A cycle's numbers were typed instead of pasted. A comment claimed a control
#   run that never happened — "16 against a menu bottom of 56" where the real
#   cycle read 18 against 57 — wrong on both figures and by too little to look
#   wrong. So a certified cycle and a finished control now END by printing the log
#   block, already formatted to paste (`r-invented-evidence-reads-real`).
#
#   A restore put content back and left the build behind it. `control --from main`
#   restores source and does not rebuild, so `apps/web/dist` kept serving the
#   control's shell, and a stale bundle was nearly shown as the new design. Every
#   path here that restores content now says the build is stale
#   (`r-stale-dist-after-control`).
#
# So the safe order is not asked for here, it is the only order that runs:
#
#   scripts/plant.sh --check <check-cmd> [--expect-green] <file>... -- <apply-cmd> [args...]
#       Refuses while any target carries uncommitted work — the fix goes in a
#       commit first or nothing is planted. Snapshots the pre-plant contents and
#       records the plant's own diff. <check-cmd> is the command whose red
#       certifies the plant, and it is deliberately not the apply command: it runs
#       before the plant (it must be green, or there is no baseline to attribute a
#       catch to) and again with the plant applied (it must be red, or the plant is
#       inert and is rolled back rather than certified). `--expect-green` is the
#       acknowledgement for an absence assertion that legitimately stays green; it
#       is logged as an acknowledgement, never as a catch.
#
#   scripts/plant.sh --revert
#       Reverse-applies exactly that diff, then runs the same check a third time:
#       green closes the cycle and certifies it, red says so and certifies nothing.
#       Anything written into the file after the plant is not the plant and
#       survives it; if the plant's own lines were edited under it, the revert
#       fails loudly and changes nothing rather than guessing which half to keep.
#       A certified cycle prints its log block ready to paste into a report.
#
#   scripts/plant.sh control --why <declaration> [--from <rev>] <file>... -- <cmd> [args...]
#       A declared reproduce-against-another-tree run. Snapshots the worktree's
#       files, writes <rev>'s content into them WITHOUT EVER STAGING IT, runs
#       <cmd>, and restores the worktree unconditionally — on success, on failure,
#       on interrupt. The declaration is logged before <cmd> starts, so an observer
#       holding only the worktree reads intent instead of guessing at a git
#       signature.
#
#   scripts/plant.sh --log
#       Prints that log. It is the record a report's plant table is copied from,
#       and the place a declared control is distinguishable by construction.
#
# The state and the log live under the git directory, so neither is ever a file in
# the tree, neither is ever staged, and neither shows up in `git status`.

set -uo pipefail

say() { printf 'plant: %s\n' "$1"; }
refuse() {
  printf 'plant: refusing — %s\n' "$1" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
usage: scripts/plant.sh --check <check-cmd> [--expect-green] <file>... -- <apply-cmd> [args...]
       scripts/plant.sh --revert
       scripts/plant.sh control --why <declaration> [--from <rev>] <file>... -- <cmd> [args...]
       scripts/plant.sh --log

  plant    Runs <apply-cmd>, which must change the named files and nothing else,
           and certifies the plant with <check-cmd>: green before it, red with it
           applied, green again after --revert. A plant whose check stays green is
           inert and is rolled back, unless --expect-green acknowledges an absence
           assertion that legitimately stays green. Refuses while any target has
           uncommitted work: commit the real work first, then plant.

  control  Runs <cmd> against <rev>'s content (default main) under a declared
           intent, then puts this worktree's own content back — always, including
           on interrupt. Nothing is ever staged, and anything <cmd> writes into a
           target goes away with the control. Refuses a dirty target set, like a
           plant does.

  Flags come before the targets, and both modes run from the repository root, so
  name paths from there. Every run is appended to the log under the git directory;
  read it with --log (docs/design/testing.md).

  A certified cycle and a finished control end by printing that run's log block
  already formatted to paste — a number quoted anywhere is pasted from there and
  cites the log's path. Both also warn that any standing build is stale relative
  to the content they just put back: rebuild before serving.
USAGE
  exit 2
}

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  refuse "this is not a git worktree; the harness has nothing to restore from."
fi
GIT_DIR="$(git rev-parse --absolute-git-dir)"
STATE="$GIT_DIR/retro-plant"
LOG="$GIT_DIR/retro-plant.log"

# ── the log ───────────────────────────────────────────────────────────────────
# The state is this plant; the log is every plant and every control this worktree
# has run. It outlives the state on purpose: a report's plant table is copied from
# here rather than recollected, and a declared control is a line in here rather
# than a git signature someone has to interpret.
ensure_log() {
  [[ -e "$LOG" ]] && return 0
  {
    printf '# scripts/plant.sh — every plant and every control run in this worktree.\n'
    printf '# Copy a report from here; do not recall it. Read it with: scripts/plant.sh --log\n'
  } >"$LOG"
}
note() {
  ensure_log
  printf '%s\n' "$1" >>"$LOG"
}
field() {
  ensure_log
  printf '   %-9s %s\n' "$1" "$2" >>"$LOG"
}
stamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
verdict() {
  if [[ "$1" -eq 0 ]]; then printf 'green'; else printf 'red'; fi
}

# A logged command has to be the command that ran, or the log is prose. `${cmd[*]}`
# joins on spaces, which turns `sed -i '' <script>` into `sed -i <script>` — the
# empty argument gone and the script's own spaces indistinguishable from the
# separators. Quote each word only where it needs it, so the line stays readable
# and still pastes back into a shell.
quoted() {
  local word out=''
  for word in "$@"; do
    case "$word" in
      '') out+="'' " ;;
      *[!A-Za-z0-9_.:/=@%+-]*) out+="'${word//\'/\'\\\'\'}' " ;;
      *) out+="$word " ;;
    esac
  done
  printf '%s' "${out% }"
}

show_log() {
  if [[ ! -s "$LOG" ]]; then
    say "no plant log yet — nothing has been planted or controlled in this worktree."
    say "it will appear at $LOG"
    exit 0
  fi
  cat "$LOG"
  exit 0
}

# ── the paste-ready excerpt (`r-invented-evidence-reads-real`) ───────────────
# A doc comment once asserted a control run that never happened, with invented
# numbers — "16 against a menu bottom of 56" where the real cycle read 18 against
# 57. Wrong on both figures, and by little enough to survive any reading: invented
# evidence does not look invented, and a number reads as measured BY BEING a
# number. The repair cost three commits and a correction to the written record.
#
# The rule that was already in hand — claims carry their evidence — lived in
# documents, and the keystroke happened in a comment field with nothing checking
# it. So this is not another sentence: it is the honest form arriving already
# formatted at the exact moment the evidence exists, which is where keystroke-level
# rules win and warnings lose (the `card.sh` precedent — the safe form became the
# only form there is to type). Typing a number now costs MORE effort than pasting
# the real one.
excerpt() {
  local start
  [[ -s "$LOG" ]] || return 0
  start="$(grep -n '^── ' "$LOG" | tail -1 | cut -d: -f1)"
  [[ -n "$start" ]] || return 0

  printf '\nplant: the certified excerpt — paste this, do not retype it:\n\n'
  printf '    %s\n' "$LOG"
  sed -n "${start},\$p" "$LOG" | sed 's/^/    /'
  printf '\n'
  say 'a reading quoted anywhere — a report, a test comment, a docstring —'
  say 'is PASTED from that log and cites its path beside it. A reading with no'
  say 'citable log is written as expected, never as observed (testing.md).'
}

# ── the dist-is-stale warning (`r-stale-dist-after-control`) ─────────────────
# A restore puts CONTENT back and does not rebuild, so `apps/web/dist` goes on
# serving a bundle built from whatever was there before. A comparison run reached
# its verification step with dist still holding main's shell and would have shown
# the wrong design as the variation; every branch in that comparison hit the trap
# and one caught it only by grepping the built bundle for a class string its own
# design emits — a verification no recipe asked for.
#
# The inverse rule was already written down for merges ("a web-only merge needs
# only the rebuild, since the build is served from disk per request",
# `r-stale-server-verify`). The two are one fact read from opposite sides, and only
# the merge side had ever been stated. This is the other side, printed at the
# moment the trap arms rather than in a document read before it.
CONTENT_RESTORED=0
STALE_WARNED=0
warn_stale_dist() {
  [[ $CONTENT_RESTORED -eq 1 ]] || return 0
  [[ $STALE_WARNED -eq 1 ]] && return 0
  STALE_WARNED=1
  printf '\n'
  say 'content restored — any standing build is now STALE relative to it.'
  say 'The build is served from disk per request, so nothing rebuilds on its own:'
  say 'rebuild before serving, and verify the bundle carries your change (grep the'
  say 'built assets for a marker only your change emits).'
  say '`r-stale-dist-after-control` — docs/design/testing.md.'
}

# Every path out of this script that put content back goes through here, rather
# than through each exit site remembering to say so — which is the shape of rule
# this record exists because prose could not hold.
trap warn_stale_dist EXIT

# ── shared guards ─────────────────────────────────────────────────────────────
declare -a TARGETS=()
declare -a COMMAND=()
declare -a PATHS=()
CHECK=''

# `<file>... -- <cmd>...`. A flag among the targets is a flag written after them,
# which is a flag this script never saw: paths do not start with a dash.
split_arguments() {
  local seen=0 argument
  for argument in "$@"; do
    if [[ $seen -eq 0 && "$argument" == "--" ]]; then
      seen=1
      continue
    fi
    if [[ $seen -eq 0 ]]; then
      [[ "$argument" == -* ]] && usage
      TARGETS+=("$argument")
    else
      COMMAND+=("$argument")
    fi
  done
  [[ $seen -eq 1 && ${#TARGETS[@]} -gt 0 && ${#COMMAND[@]} -gt 0 ]] || usage
}

# Repo-relative and provably tracked: an untracked file has no committed state to
# restore, so it can be neither planted in nor controlled against.
resolve_targets() {
  local target path
  for target in "${TARGETS[@]}"; do
    if ! path="$(git ls-files --error-unmatch --full-name -- "$target" 2>/dev/null)"; then
      refuse "$target is not tracked by git; there is nothing to restore it to."
    fi
    [[ "$(printf '%s' "$path" | wc -l)" -eq 0 ]] ||
      refuse "$target names more than one file; name each target on its own."
    PATHS+=("$path")
  done
}

refuse_if_active() {
  [[ -e "$STATE" ]] || return 0
  local mode='plant' targets=''
  [[ -f "$STATE/mode" ]] && mode="$(cat "$STATE/mode")"
  [[ -f "$STATE/targets" ]] && targets="$(tr '\n' ' ' <"$STATE/targets")"
  if [[ "$mode" == control ]]; then
    refuse "a control is already active in: $targets
  a control restores itself when its command ends; if one was killed outright,
  put this worktree's content back from $STATE/snapshot and delete $STATE."
  fi
  refuse "a plant is already active in: $targets
  revert it first — scripts/plant.sh --revert"
}

# The guard `r-plant-revert-second` exists for: `git status --porcelain` on the
# targets alone, because dirt elsewhere in the tree is not this run's business —
# and is never touched by the revert or the restore either.
guard_clean() {
  local kind="$1" dirty
  dirty="$(git status --porcelain -- "${PATHS[@]}")"
  [[ -z "$dirty" ]] && return 0
  printf 'plant: refusing — the %s targets carry uncommitted work:\n%s\n' "$kind" "$dirty" >&2
  if [[ "$kind" == control ]]; then
    printf "plant: commit it first — a control borrows another tree's content and gives yours\n" >&2
    printf 'plant: back, and it will not gamble with work that lives only in the tree.\n' >&2
  else
    printf 'plant: commit the real work first, then plant (docs/design/testing.md).\n' >&2
  fi
  exit 1
}

# Streams the check's own output rather than capturing it: a verdict cropped out
# of a runner's summary is how a red gets reported as a green
# (`r-shell-filtered-verdicts`). The report still quotes those lines untruncated.
run_check() {
  printf '\nplant: the check, %s:\nplant:   %s\n' "$1" "$CHECK" >&2
  (
    cd "$ROOT" && bash -c "$CHECK"
  )
}

snapshot_targets() {
  local path
  mkdir -p "$STATE/snapshot"
  for path in "${PATHS[@]}"; do
    mkdir -p "$STATE/snapshot/$(dirname "$path")"
    cp "$ROOT/$path" "$STATE/snapshot/$path"
  done
}

# The snapshot is file CONTENTS; the baseline is the check's RESULT. Two different
# things that both used to be called "baseline", which is exactly how a report
# ends up claiming one while holding the other.
restore_snapshot() {
  local path
  for path in "${PATHS[@]}"; do
    cp "$STATE/snapshot/$path" "$ROOT/$path"
  done
  rm -rf "$STATE"
  CONTENT_RESTORED=1
}

# ── revert ────────────────────────────────────────────────────────────────────
revert() {
  if [[ ! -f "$STATE/plant.patch" ]]; then
    refuse "nothing to revert — no plant is active."
  fi

  local targets status
  targets="$(tr '\n' ' ' <"$STATE/targets")"

  # The plant's own diff, reversed, and nothing else: work written into the file
  # after the plant only moves the plant's hunks, and `-C0` lets git match them
  # where they now sit instead of insisting they sit where they were. Without
  # `--reject` this is all-or-nothing — a plant whose own lines were edited under
  # it leaves the tree exactly as it stands, which is the whole point.
  local output
  if ! output="$(cd "$ROOT" && git apply --reverse --binary -C0 "$STATE/plant.patch" 2>&1)"; then
    printf 'plant: could not unwind the plant — nothing was changed.\n%s\n' "$output" >&2
    printf 'plant: the plant is still active in:%s\n' " $targets" >&2
    printf 'plant: its diff is %s — undo it by hand, then delete %s.\n' \
      "$STATE/plant.patch" "$STATE" >&2
    exit 1
  fi
  CONTENT_RESTORED=1

  [[ -f "$STATE/check" ]] && CHECK="$(cat "$STATE/check")"
  if [[ -z "$CHECK" ]]; then
    rm -rf "$STATE"
    field 'reverted' 'unchecked — this plant was made without a check command'
    say "reverted the plant in:$targets"
    say "no check was recorded with it, so this cycle certifies nothing."
    exit 0
  fi

  # The third result. The plant is already gone, so this is not a veto over the
  # revert — it is the difference between a cycle that certifies and one that only
  # looks like it did.
  run_check 'after the revert'
  status=$?
  rm -rf "$STATE"

  if [[ $status -ne 0 ]]; then
    field 'reverted' "$(verdict "$status") — NOT a certified cycle"
    printf 'plant: reverted the plant in:%s\n' " $targets" >&2
    printf 'plant: but the check is red without the plant, so this is NOT a certified cycle:\n' >&2
    printf 'plant: the tree is failing for some other reason. Fix that, then plant again.\n' >&2
    exit 1
  fi

  field 'reverted' 'green — CERTIFIED'
  say "reverted the plant in:$targets"
  say "green baseline → red with the plant → green again: CERTIFIED"
  say "the three results are in the log — scripts/plant.sh --log"
  excerpt
  exit 0
}

# ── control ───────────────────────────────────────────────────────────────────
CONTROL_RESTORED=0
control_restore() {
  [[ ${CONTROL_RESTORED} -eq 1 ]] && return 0
  CONTROL_RESTORED=1
  local listed
  listed="$(printf '%s ' "${PATHS[@]}")"
  restore_snapshot
  field 'restored' "this worktree's own content is back in: $listed"
  say "restored this worktree's own content in: $listed"
  excerpt
}

control() {
  local declaration='' rev='main' rev_sha status path listed

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --why)
        [[ $# -ge 2 ]] || usage
        declaration="$2"
        shift 2
        ;;
      --from)
        [[ $# -ge 2 ]] || usage
        rev="$2"
        shift 2
        ;;
      *) break ;;
    esac
  done
  # A control without a declaration is the thing the record is about: a run whose
  # intent nobody can read. It is not a control, and it does not start.
  [[ -n "$declaration" ]] || usage

  split_arguments "$@"
  refuse_if_active
  resolve_targets

  if ! rev_sha="$(git rev-parse --verify --quiet "$rev")"; then
    refuse "$rev does not name anything here; a control borrows from a rev that exists."
  fi

  cd "$ROOT" || exit 1
  guard_clean control

  for path in "${PATHS[@]}"; do
    git cat-file -e "$rev:$path" 2>/dev/null ||
      refuse "$path does not exist in $rev; there is no content there to run against."
  done

  mkdir -p "$STATE"
  printf 'control\n' >"$STATE/mode"
  printf '%s\n' "${PATHS[@]}" >"$STATE/targets"
  printf '%s\n' "$declaration" >"$STATE/declaration"
  snapshot_targets

  listed="$(tr '\n' ' ' <"$STATE/targets")"

  # Logged before a single byte moves. A declaration an observer can only read
  # afterwards is not a declaration, it is an explanation — and the interrupt this
  # record is named for happened while the control was still running.
  note ''
  note "── $(stamp)  control"
  field 'declared' "$declaration"
  field 'content' "$rev ($rev_sha)"
  field 'targets' "$listed"
  field 'command' "$(quoted "${COMMAND[@]}")"

  # The stale-dist warning rides on each of these rather than on the script-wide
  # EXIT trap alone: setting an EXIT trap here REPLACES that one, and a control is
  # the very path the record was filed about.
  trap 'control_restore; warn_stale_dist' EXIT
  trap 'control_restore; warn_stale_dist; exit 130' INT
  trap 'control_restore; warn_stale_dist; exit 143' TERM

  # `git show` writes content and nothing else. `git checkout <rev> -- <paths>`
  # would also STAGE it, and that staged wholesale revert is the signature this
  # record is about: the control never touches the index, so it cannot produce it.
  for path in "${PATHS[@]}"; do
    if ! git show "$rev:$path" >"$ROOT/$path"; then
      control_restore
      refuse "could not read $path from $rev; this worktree's own content is back."
    fi
  done

  say "control declared: $declaration"
  say "running against $rev ($rev_sha) in: $listed"
  say "the declaration is already logged — any observer can read it: scripts/plant.sh --log"

  "${COMMAND[@]}"
  status=$?

  field 'result' "the command exited $status"
  control_restore
  exit $status
}

# ── dispatch ──────────────────────────────────────────────────────────────────
[[ $# -eq 0 ]] && usage
case "$1" in
  --revert)
    [[ $# -eq 1 ]] || usage
    revert
    ;;
  --log)
    [[ $# -eq 1 ]] || usage
    show_log
    ;;
  control)
    shift
    control "$@"
    ;;
esac

# ── plant ─────────────────────────────────────────────────────────────────────
EXPECT_GREEN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      [[ $# -ge 2 ]] || usage
      CHECK="$2"
      shift 2
      ;;
    --expect-green)
      EXPECT_GREEN=1
      shift
      ;;
    *) break ;;
  esac
done
# No check, no plant. A plant is only ever evidence about the command that was
# supposed to catch it, and without that command there is nothing to be evidence of.
[[ -n "$CHECK" ]] || usage

split_arguments "$@"
refuse_if_active
resolve_targets

cd "$ROOT" || exit 1
guard_clean plant

# The green baseline. A check that is already red certifies nothing: the red it
# shows with the plant applied would not be attributable to the plant.
run_check 'before the plant (the baseline)'
baseline=$?
if [[ $baseline -ne 0 ]]; then
  note ''
  note "── $(stamp)  plant REFUSED (no green baseline)"
  field 'check' "$CHECK"
  field 'baseline' 'red'
  printf 'plant: refusing — the check is red before the plant, so there is no green baseline.\n' >&2
  printf 'plant: a red the plant did not cause certifies nothing. Get the check green first.\n' >&2
  exit 1
fi

before="$(git status --porcelain)"

mkdir -p "$STATE"
printf 'plant\n' >"$STATE/mode"
printf '%s\n' "${PATHS[@]}" >"$STATE/targets"
printf '%s' "$CHECK" >"$STATE/check"
snapshot_targets

if ! "${COMMAND[@]}"; then
  restore_snapshot
  refuse "the apply command failed; the targets are back as they were."
fi

# A command that dirtied something it did not declare leaves a plant the revert
# cannot reach — the same failure one file over. Compared against the tree as it
# was, so work that was already dirty elsewhere is not blamed on the plant.
stray=''
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  grep -qxF "$line" <<<"$before" && continue
  entry="${line:3}"
  in_targets=0
  for path in "${PATHS[@]}"; do
    [[ "$entry" == "$path" ]] && in_targets=1
  done
  [[ $in_targets -eq 0 ]] && stray+="  $entry"$'\n'
done <<<"$(git status --porcelain)"

if [[ -n "$stray" ]]; then
  restore_snapshot
  printf 'plant: refusing — the apply command changed files it did not name:\n%s' "$stray" >&2
  printf 'plant: the targets are back as they were; those files are not.\n' >&2
  exit 1
fi

git diff --binary -- "${PATHS[@]}" >"$STATE/plant.patch"
if [[ ! -s "$STATE/plant.patch" ]]; then
  restore_snapshot
  refuse "the apply command changed nothing; there is no plant to catch."
fi

# The second result, and the one the whole record turns on. A non-empty diff says
# the file changed; only this says the behaviour did.
run_check 'with the plant applied'
planted=$?

if [[ $planted -eq 0 && $EXPECT_GREEN -eq 0 ]]; then
  targets="$(tr '\n' ' ' <"$STATE/targets")"
  restore_snapshot
  note ''
  note "── $(stamp)  plant REFUSED (inert)"
  field 'targets' "$targets"
  field 'check' "$CHECK"
  field 'apply' "$(quoted "${COMMAND[@]}")"
  field 'baseline' 'green'
  field 'planted' 'green — inert, rolled back and not certified'
  printf 'plant: refusing — the check stayed green with the plant applied.\n' >&2
  printf 'plant: the diff was real and the behaviour was not, so this plant is inert: reporting\n' >&2
  printf 'plant: it would read as "the check failed to catch it", which is the opposite of true.\n' >&2
  printf 'plant: plant something the check can see, or pass --expect-green if this is an absence\n' >&2
  printf 'plant: assertion that legitimately stays green. The targets are back as they were.\n' >&2
  exit 1
fi

note ''
note "── $(stamp)  plant"
field 'targets' "$(tr '\n' ' ' <"$STATE/targets")"
field 'check' "$CHECK"
field 'apply' "$(quoted "${COMMAND[@]}")"
field 'baseline' 'green'
if [[ $planted -ne 0 ]]; then
  if [[ $EXPECT_GREEN -eq 1 ]]; then
    field 'planted' 'red (the check caught the plant; --expect-green was not needed)'
  else
    field 'planted' 'red (the check caught the plant)'
  fi
else
  field 'planted' 'green (acknowledged: --expect-green)'
fi

say "planted in: $(tr '\n' ' ' <"$STATE/targets")"
if [[ $planted -ne 0 ]]; then
  say "the check went red with it: the plant is caught."
else
  say "the check stayed green, acknowledged by --expect-green — this certifies an absence."
fi
say "close the cycle — scripts/plant.sh --revert (its green is the third result)"
