#!/usr/bin/env bash
#
# The finish watch — one exit-on-event wait, and the certification that proves
# the chain before anyone trusts it (`r-monitor-notify-gap`,
# `r-fourth-finish-channel-failure`).
#
# THE CHANNEL HAS FAILED FOUR TIMES, ONE HOP FURTHER ALONG EACH TIME:
#
#   `r-finish-event-unnoticed`
#       — the press went unnoticed; the watcher was built.
#         The hop fixed: nothing was watching.
#   `r-monitor-not-realtime`
#       — the watcher polled and slept 20s, so a press sat in the database for
#         the length of the sleep. `review wait --follow` made it live.
#         The hop fixed: store → wait latency.
#   `r-monitor-notify-gap`
#       — the watcher SAW the press, printed `review finished: revision 1` to a
#         file, and told nobody: this harness re-invokes an agent when a
#         background task EXITS, never when it prints a line.
#         The hop fixed: watcher → agent.
#   `r-fourth-finish-channel-failure`
#       — the harness killed the watcher twice from outside and the watch was
#         STOOD DOWN, asking the human to say "done" in chat.
#         The hop that broke: watcher survival.
#
# Each fix repaired the hop that had just broken. None ever owned the chain
# press → store → wait → watcher → agent as one system, so every hop nobody had
# looked at was still armed. This script is that ownership, and it is two things:
#
#   THE SHAPE, CORRECT BY CONSTRUCTION. Arming runs EXACTLY ONE wait and then
#   `exec`s it, so the process you are watching IS the wait and its EXIT is the
#   notification — the one signal every harness in use delivers. There is no loop
#   here to get wrong: after the exec there is no script left to loop.
#
#   THE PROOF, BEFORE THE TRUST. `certify` drives a throwaway stage through the
#   whole chain — file a retrospective, arm this exact shape, press Finish
#   through the e2e stage-tool, and assert the watcher EXITED with the event —
#   red leg first, so a watcher that fabricates an exit fails the certification
#   rather than passing it. Its third leg is the killed-watcher drill: kill the
#   watcher mid-wait, press while nothing at all is armed, re-arm, and prove the
#   press is still delivered.
#
# NEVER STAND DOWN, RE-ARM ON KILL — it is a standing rule now. While a review is
# open the watch is never voluntarily abandoned. A kill is not a stop gesture —
# it is a notification, which means re-arming costs one command and leaves no
# window. The watch ends at review close, or on the human's explicit word to stop
# watching, and on nothing else.
#
# Usage:
#
#   scripts/watch-review.sh <retroId> [--timeout <seconds>]
#       Arms one wait. Exit 0 = Finish was pressed, and the event JSON is on
#       stdout. Exit 7 = the timeout elapsed and nothing else; re-arm. Any other
#       exit is an error; re-arm and read the message.
#
#   scripts/watch-review.sh certify [--keep]
#       Runs the three legs above against a throwaway stage and prints what was
#       certified and what could not be. Exit 0 = the chain delivers here.
#
#   scripts/watch-review.sh where | help

set -uo pipefail

DEFAULT_TIMEOUT=600
# Long enough that a slow machine is not the reason a leg fails, short enough
# that a broken chain fails the certification rather than hanging it.
CERTIFY_TIMEOUT=60
# The red leg deliberately waits and finds nothing; this is how long that costs.
CERTIFY_RED_TIMEOUT=2

say() { printf 'watch-review: %s\n' "$1" >&2; }
refuse() {
  printf 'watch-review: refusing — %s\n' "$1" >&2
  exit 2
}

usage() {
  cat >&2 <<'USAGE'
scripts/watch-review.sh — the finish watch, and the proof that it delivers.

Usage:
  scripts/watch-review.sh <retroId> [--timeout <seconds>]   arm one wait
  scripts/watch-review.sh certify [--keep]                  prove the chain
  scripts/watch-review.sh where                             what this resolves to
  scripts/watch-review.sh help                              this text

Arming runs exactly one `review wait --follow` and execs it: the process IS the
wait, and its EXIT is the notification. Exit 0 with the event JSON on stdout ·
exit 7 for the timeout, which means re-arm · anything else is an error, which
also means re-arm.

A killed or exited watcher is RE-ARMED, never abandoned, for as long as the
review is open. A kill is a notification, not a stop gesture.

Environment:
  WATCH_REVIEW_CLI         the retroloop CLI to run (default: this repo's, then PATH)
  WATCH_REVIEW_STAGE_TOOL  the e2e stage tool certify presses Finish through
USAGE
  exit 2
}

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  ROOT=''
fi

# ── what this runs ────────────────────────────────────────────────────────────
# The repo's own CLI first and PATH second, which is the opposite of what an
# agent reads in the skill — deliberately. A script that lives in `scripts/` is
# being run against this checkout, and a `retro` on PATH may be an older
# installed build; certify would then prove a chain that is not the one under
# test.
declare -a CLI=()
resolve_cli() {
  if [[ -n "${WATCH_REVIEW_CLI:-}" ]]; then
    read -r -a CLI <<<"$WATCH_REVIEW_CLI"
    # An override that is all whitespace resolves to no command at all, and
    # running "${CLI[@]}" empty would arm nothing quietly — which is the failure
    # mode this whole script exists to remove.
    [[ ${#CLI[@]} -gt 0 ]] || return 1
    return 0
  fi
  if [[ -n "$ROOT" && -f "$ROOT/apps/cli/src/bin.ts" ]]; then
    CLI=(bun "$ROOT/apps/cli/src/bin.ts")
    return 0
  fi
  local found
  if found="$(command -v retroloop 2>/dev/null)"; then
    CLI=("$found")
    return 0
  fi
  return 1
}

declare -a STAGE_TOOL=()
resolve_stage_tool() {
  if [[ -n "${WATCH_REVIEW_STAGE_TOOL:-}" ]]; then
    read -r -a STAGE_TOOL <<<"$WATCH_REVIEW_STAGE_TOOL"
    [[ ${#STAGE_TOOL[@]} -gt 0 ]] || return 1
    return 0
  fi
  if [[ -n "$ROOT" && -f "$ROOT/e2e/support/stage-tool.ts" ]]; then
    STAGE_TOOL=(bun "$ROOT/e2e/support/stage-tool.ts")
    return 0
  fi
  return 1
}

require_cli() {
  resolve_cli ||
    refuse "no retroloop CLI — not in the repo and none on PATH. Set WATCH_REVIEW_CLI."
}

# One flat key out of one flat JSON object. Every shape read here — the wait's
# event, `revision create`'s answer — is one level deep with unique keys, which
# is why this is a sed and not a dependency on jq being installed.
json_field() {
  printf '%s' "$2" | sed -n "s/.*\"$1\":\\([^,}]*\\).*/\\1/p" | tr -d '"'
}

# ── arm ───────────────────────────────────────────────────────────────────────
arm() {
  local retro="$1" timeout="$2"

  require_cli

  # Everything the reader of the exit notification needs is printed BEFORE the
  # wait starts, because by the time the exit arrives this script is gone. The
  # guidance has to already be in the output the notification carries.
  say "armed on retro $retro — one wait, ${timeout}s, and its EXIT is the notification."
  say 'hops: press → store → wait → watcher(this) → agent(the exit notification).'
  say 'exit 0 = the human pressed Finish; the event JSON is on stdout.'
  say "exit 7 = the timeout elapsed and NOTHING else. Re-arm; do not read it as a decline."
  say 'any other exit = an error. Re-arm, and read the message.'
  say 'RE-ARM ON KILL: a killed watcher is re-armed immediately, never stood down.'
  say "relaunch:  scripts/watch-review.sh $retro --timeout $timeout"

  # `exec`, and that is the whole design. The record this fixes is a monitor that
  # looped forever printing lines into a file nobody read; there is no loop that
  # can be written after this line, because there is no shell after this line.
  exec "${CLI[@]}" review wait --follow --retro "$retro" --timeout "$timeout" --json
}

# ── certify ───────────────────────────────────────────────────────────────────
# The root the CLI is pointed at with `--home`, and the stage under it — the
# same `<root>/data` layout the product uses, so certify proves the real one.
CERTIFY_HOME=''
CERTIFY_STAGE=''
CERTIFY_KEEP=0
LEGS_FAILED=0

cleanup_stage() {
  [[ -n "$CERTIFY_HOME" ]] || return 0
  if [[ $CERTIFY_KEEP -eq 1 ]]; then
    say "the stage is kept at $CERTIFY_HOME"
    return 0
  fi
  rm -rf "$CERTIFY_HOME"
}

leg() { printf '\nwatch-review: ── leg %s\n' "$1" >&2; }
pass() { printf 'watch-review:    PASS  %s\n' "$1" >&2; }
fail() {
  printf 'watch-review:    FAIL  %s\n' "$1" >&2
  LEGS_FAILED=$((LEGS_FAILED + 1))
}

stage_cli() { "${CLI[@]}" "$@" --home "$CERTIFY_HOME" --json; }

# The draft is the smallest thing `revision create` accepts that still has a
# record in it, because the finish gate will not open over an empty round.
write_draft() {
  cat >"$CERTIFY_STAGE/draft.json" <<'DRAFT'
{
  "records": [
    {
      "rid": "r-certify-the-finish-channel",
      "num": 1,
      "title": "The finish channel is certified before it is trusted",
      "type": "issue",
      "problem": "A bridge nobody has proven is a bridge that fails in anger.",
      "humanWords": [],
      "rootCause": {
        "whatHappened": "The chain was patched hop by hop and never certified end to end.",
        "whys": ["Each fix was scoped to the hop that had just broken"],
        "root": "Delivery was assumed rather than measured."
      },
      "diagnosticData": "- **The hops:** four, patched one at a time; none of the four has a test that crosses two of them.",
      "workaround": "The human relays the finish in chat.",
      "solutions": [
        {
          "bullets": "- **Certify the chain** against a throwaway stage before trusting it.",
          "footprint": "scripts/watch-review.sh",
          "level": 2,
          "recommended": true
        }
      ],
      "requester": "ai",
      "impacts": "human",
      "defaults": { "severity": 3, "involvement": "autonomous" }
    }
  ]
}
DRAFT
}

# Arms the real shape in the background and answers with its pid. Output goes to
# a file because the point of the exercise is that the EXIT carries the answer;
# nothing here reads a line while it runs.
WATCHER_PID=''
arm_background() {
  local retro="$1" timeout="$2" out="$3"
  "${CLI[@]}" review wait --follow --retro "$retro" --timeout "$timeout" \
    --home "$CERTIFY_HOME" --json >"$out" 2>&1 &
  # Through a global rather than stdout: `pid=$(arm_background …)` would start
  # the job inside a command substitution's subshell, and the parent shell can
  # never `wait` on a process that is not its own child.
  WATCHER_PID=$!
}

press_finish() {
  "${STAGE_TOOL[@]}" finish-round "$1" "$CERTIFY_STAGE"
}

certify() {
  local retro session sessionId answer event watcher status pressed started elapsed

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keep)
        CERTIFY_KEEP=1
        shift
        ;;
      *) usage ;;
    esac
  done

  require_cli
  resolve_stage_tool ||
    refuse "no stage tool — certify presses Finish through e2e/support/stage-tool.ts,
  which has no CLI surface because finishing is the human's. Run this from the
  repo, or set WATCH_REVIEW_STAGE_TOOL."

  CERTIFY_HOME="$(mktemp -d "${TMPDIR:-/tmp}/retro-watch-certify-XXXXXX")"
  CERTIFY_STAGE="$CERTIFY_HOME/data"
  mkdir -p "$CERTIFY_STAGE"
  trap cleanup_stage EXIT
  trap 'cleanup_stage; exit 130' INT
  trap 'cleanup_stage; exit 143' TERM

  say "certifying against a throwaway stage: $CERTIFY_STAGE"
  say "cli: ${CLI[*]}"
  say "stage tool: ${STAGE_TOOL[*]}"

  # ── the stage ──────────────────────────────────────────────────────────────
  session="$(stage_cli session create --claude-session "certify-$$" --cwd "$CERTIFY_STAGE")" || {
    fail "the stage would not take a session: $session"
    return 1
  }
  sessionId="$(json_field sessionId "$session")"
  write_draft
  answer="$(stage_cli revision create --session "$sessionId" \
    --file "$CERTIFY_STAGE/draft.json" --expect-revision 1)" || {
    fail "the stage would not take a revision: $answer"
    return 1
  }
  retro="$(json_field retroId "$answer")"
  say "stage ready — session $sessionId, retro $retro, revision 1"

  # ── leg 1 · the red leg ────────────────────────────────────────────────────
  # First, because a green leg on its own certifies nothing: a watcher that
  # exited on its own would satisfy leg 2 while delivering a press that never
  # happened. This is the same green-baseline discipline `plant.sh` enforces.
  leg "1 · the red leg — nothing pressed, so nothing may be delivered"
  event="$(stage_cli review wait --follow --retro "$retro" --timeout "$CERTIFY_RED_TIMEOUT")"
  status=$?
  if [[ $status -eq 7 ]]; then
    pass "the wait timed out at exit 7 with no press: exit 7 means the seconds elapsed"
  else
    fail "the wait exited $status with nothing pressed — this watcher cannot certify anything"
    printf 'watch-review:          %s\n' "$event" >&2
  fi

  # ── leg 2 · the chain ──────────────────────────────────────────────────────
  leg "2 · press → store → wait → watcher: the whole chain, once"
  arm_background "$retro" "$CERTIFY_TIMEOUT" "$CERTIFY_STAGE/leg2.out"
  watcher="$WATCHER_PID"
  # The wait resolves its start point from the store, so a press landing before
  # this line is still delivered — but a watcher that has not yet opened its own
  # process has not been exercised, and the leg is about the watcher.
  settle_watcher "$watcher"
  if ! pressed="$(press_finish "$retro")"; then
    fail "the stage-tool could not press Finish: $pressed"
    # Nothing is coming, so do not spend the whole timeout finding that out: a
    # failing certification should fail fast enough that someone re-runs it.
    kill -9 "$watcher" 2>/dev/null
  fi
  wait "$watcher"
  status=$?
  event="$(cat "$CERTIFY_STAGE/leg2.out")"

  if [[ $status -eq 0 && "$(json_field kind "$event")" == 'ReviewFinished' &&
    "$(json_field revision "$event")" == '1' ]]; then
    pass "the watcher EXITED 0 carrying the press: $event"
    pass "delivered over: $(json_field via "$event")"
  else
    fail "the watcher exited $status and delivered: ${event:-<nothing>}"
  fi

  # ── leg 3 · the killed-watcher drill ───────────────────────────────────────
  # The fourth hop, and the one the approved fix would NOT have survived on its
  # own: this script's wait is the same task shape the harness killed twice. The
  # drill presses while NOTHING is armed, which is the harder claim — not "a
  # re-arm works" but "the gap costs nothing", because the wait listens from the
  # retrospective's latest revision as the store has it, never from "now".
  leg "3 · the killed-watcher drill — kill it, press unwatched, re-arm"
  answer="$(stage_cli revision create --session "$sessionId" \
    --file "$CERTIFY_STAGE/draft.json" --expect-revision 2)" || {
    fail "the stage would not take a second revision: $answer"
    return 1
  }

  arm_background "$retro" "$CERTIFY_TIMEOUT" "$CERTIFY_STAGE/leg3-killed.out"
  watcher="$WATCHER_PID"
  settle_watcher "$watcher"
  kill -9 "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  status=$?
  if [[ $status -ne 0 && ! -s "$CERTIFY_STAGE/leg3-killed.out" ]]; then
    pass "the killed watcher died at exit $status having delivered nothing — the window is real"
  else
    fail "the kill did not leave an unwatched window; this leg proves nothing"
  fi

  pressed="$(press_finish "$retro")" ||
    fail "the stage-tool could not press Finish while unwatched: $pressed"
  say "pressed with NOTHING armed — this is the window a press was once lost in"

  started=$SECONDS
  event="$(stage_cli review wait --follow --retro "$retro" --timeout "$CERTIFY_TIMEOUT")"
  status=$?
  elapsed=$((SECONDS - started))
  if [[ $status -eq 0 && "$(json_field kind "$event")" == 'ReviewFinished' &&
    "$(json_field revision "$event")" == '2' ]]; then
    pass "the RE-ARMED watcher delivered the press it was not there for, in ${elapsed}s: $event"
    pass 're-arming after a kill costs one command and loses nothing'
  else
    fail "the re-armed watcher exited $status and delivered: ${event:-<nothing>}"
  fi

  verdict
}

# A background wait that has not reached its own process yet has not been armed,
# and a press racing that would be a leg about the store rather than the watcher.
#
# `review wait` prints nothing until it answers, so there is no readiness line to
# poll for and liveness is the only observable. Half a second is enough for bun to
# start and for the wait to take its start point; if the process has already gone,
# that is itself the answer and the leg's own assertions report it.
settle_watcher() {
  local pid="$1" tick=0
  while [[ $tick -lt 5 ]]; do
    sleep 0.1
    tick=$((tick + 1))
    kill -0 "$pid" 2>/dev/null || return 0
  done
}

verdict() {
  printf '\n' >&2
  if [[ $LEGS_FAILED -gt 0 ]]; then
    say "CERTIFICATION FAILED — $LEGS_FAILED leg(s) did not hold."
    say 'Do NOT trust this bridge with a real press. Say so in the handoff.'
    return 1
  fi

  say 'CERTIFIED — press → store → wait → watcher delivers here, and a killed'
  say 'watcher loses nothing when it is re-armed.'
  printf '\n' >&2
  say 'What this could NOT certify, and what to do about it:'
  say '  watcher → AGENT. No script can assert that a task exit reaches the'
  say '  agent, because the agent is the thing being told. Probe it once, in'
  say '  every new environment, before trusting any watcher:'
  say '     run `sleep 1; echo probe` as a background task and observe whether'
  say '     its EXIT notification actually arrives. If it does not, this harness'
  say '     carries no watcher at all and the handoff must say so.'
  say '  The stream hop. A throwaway stage runs no server, so the wait answered'
  say '  from the store (`via`, above). `--follow` degrades to exactly that path'
  say '  by construction when no server is up, which is why the store leg is the'
  say '  one worth certifying: it is the floor, not the fast path.'
  return 0
}

# ── where ─────────────────────────────────────────────────────────────────────
where() {
  if resolve_cli; then
    printf 'cli:         %s\n' "${CLI[*]}"
  else
    printf 'cli:         <none — set WATCH_REVIEW_CLI>\n'
  fi
  if resolve_stage_tool; then
    printf 'stage tool:  %s\n' "${STAGE_TOOL[*]}"
  else
    printf 'stage tool:  <none — certify needs the repo, or WATCH_REVIEW_STAGE_TOOL>\n'
  fi
  printf 'repo root:   %s\n' "${ROOT:-<not a git worktree>}"
  exit 0
}

# ── dispatch ──────────────────────────────────────────────────────────────────
[[ $# -eq 0 ]] && usage
case "$1" in
  help | --help | -h) usage ;;
  where)
    [[ $# -eq 1 ]] || usage
    where
    ;;
  certify)
    shift
    certify "$@"
    exit $?
    ;;
esac

RETRO_ID="$1"
shift
[[ "$RETRO_ID" =~ ^[0-9]+$ ]] ||
  refuse "$RETRO_ID is not a retro id. The id is the number 'revision create' answered
  with — not the retrospective's ordinal, and not the session's. Or did you mean:
  scripts/watch-review.sh certify"

TIMEOUT="$DEFAULT_TIMEOUT"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      [[ $# -ge 2 ]] || usage
      TIMEOUT="$2"
      [[ "$TIMEOUT" =~ ^[0-9]+$ ]] || refuse "--timeout takes whole seconds, not \"$TIMEOUT\"."
      shift 2
      ;;
    *) usage ;;
  esac
done

arm "$RETRO_ID" "$TIMEOUT"
