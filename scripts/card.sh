#!/usr/bin/env bash
#
# The sidebar card, one command per act (retro-10 `r-side-card-needs-asking`).
#
# The card is how the owner watches a session he is not inside, and its update
# model is push-only: nothing on it animates, so a checkpoint that does not
# write it leaves an active session looking exactly like a hung one. The duty
# lives in the process docs' inner loop; this script is what makes the duty
# cheap enough to survive — it resolves the cmux binary, the workspace ref and
# the todo-by-name lookup internally, so a checkpoint costs one line:
#
#   scripts/card.sh lane "layout: building"
#   scripts/card.sh progress 0.7 "5/7 lanes"
#   scripts/card.sh done "s10-docs"
#
# **Todos are addressed by name, never by index** (retro-10
# `r-todo-index-shift-trap`). cmux re-sorts on every check — completed items
# sink and the list renumbers — so an index remembered from one call points at a
# different row by the next. A batch of four check-by-index calls ticked four
# wrong rows in session 9 with that warning already read, which is why this
# script refuses an index argument outright and takes a fresh listing for every
# operation. The safe form is the only form there is to type.
#
# Outside cmux it no-ops with a note on stderr and exits 0, so the duty costs
# nothing in a plain terminal.

set -uo pipefail

readonly BUNDLED_CMUX='/Applications/cmux.app/Contents/Resources/bin/cmux'

# cmux prints deprecation notices for legacy verbs; nothing here uses one, and
# quiet output keeps a checkpoint line readable.
export CMUX_QUIET="${CMUX_QUIET:-1}"

usage() {
  cat <<'EOF'
card.sh — write the cmux sidebar card at a checkpoint.

Usage: scripts/card.sh <command> [args]

Chips (each key is its own pill; a value replaces that key's pill):
  lane <value>                     the "lane" pill — card.sh lane "layout: building"
  chip <key> <value> [flags]       any other pill; flags: --icon <name>
                                   --color '#RRGGBB' --priority <n>
  clear <key>                      remove that pill

Progress bar:
  progress <0.0-1.0> [label]       card.sh progress 0.7 "5/7 lanes"
  clear-progress                   remove the bar

Todos — BY NAME, never by index:
  todos                            print the current list (names and states)
  add <text>                       append an item
  start <name>                     mark the named item in-progress
  done <name>                      mark the named item completed

  <name> is matched against a listing taken for this one operation: an exact
  text match first, then a unique case-insensitive substring. An argument that
  is only digits is REFUSED — cmux renumbers the list on every check, so a
  remembered index addresses a different row than the one you read.

  The checklist belongs to the owner (cmux's own caution). Add and tick what he
  asked to see there; keep your own planning elsewhere.

Diagnostics:
  where                            the binary and workspace ref this would write
  help                             this text

Environment:
  CARD_WORKSPACE   workspace id/ref to target (default: this cmux terminal's)
  CARD_CMUX        path to the cmux binary (default: PATH, then the app bundle)
  CARD_DRY_RUN=1   print each cmux invocation instead of running it

Exit codes: 0 ok (including the outside-cmux no-op) · 2 usage or a refused
index · 3 no such todo, or a name matching more than one · 4 cmux failed.
EOF
}

note() { printf 'card.sh: %s\n' "$1" >&2; }

# The binary, or empty. It is on PATH only inside cmux terminals, so the app
# bundle is the fallback a plain shell needs.
resolve_cmux() {
  if [[ -n "${CARD_CMUX:-}" ]]; then
    [[ -x "$CARD_CMUX" ]] && printf '%s' "$CARD_CMUX"
    return
  fi
  local found
  found="$(command -v cmux 2>/dev/null)" && { printf '%s' "$found"; return; }
  [[ -x "$BUNDLED_CMUX" ]] && printf '%s' "$BUNDLED_CMUX"
}

# The workspace to write, or empty.
#
# CMUX_WORKSPACE_ID is exported into every cmux terminal, which makes it both
# the answer and the test for "am I inside cmux". `identify` is asked only for
# its **caller** block, never its `focused` one: from outside cmux there is no
# caller and cmux falls back to whatever window the owner happens to be looking
# at, so reading `focused` would write a lane's status onto a stranger's card.
resolve_workspace() {
  if [[ -n "${CARD_WORKSPACE:-}" ]]; then printf '%s' "$CARD_WORKSPACE"; return; fi
  if [[ -n "${CMUX_WORKSPACE_ID:-}" ]]; then printf '%s' "$CMUX_WORKSPACE_ID"; return; fi
  local bin
  bin="$(resolve_cmux)"
  [[ -n "$bin" ]] || return
  "$bin" identify 2>/dev/null | awk '
    # Only an OPEN BRACE counts as a caller. Outside cmux the key is still there
    # and reads `"caller" : null`, with a populated `focused` block right beneath
    # it — matching the key alone would walk straight into whatever window the
    # owner is looking at. Leave when the block closes rather than reading past.
    /"caller"[[:space:]]*:[[:space:]]*\{/ { inside = 1; next }
    inside && /^[[:space:]]*\}/ { exit }
    inside && /^[[:space:]]*"workspace_ref"[[:space:]]*:/ {
      line = $0
      sub(/^[^:]*:[[:space:]]*"/, "", line)
      sub(/",?[[:space:]]*$/, "", line)
      print line
      exit
    }
  '
}

CMUX=''
WORKSPACE=''

# Fills CMUX and WORKSPACE, or returns 1 for the caller to no-op on.
require_card() {
  CMUX="$(resolve_cmux)"
  if [[ -z "$CMUX" ]]; then
    note 'no cmux binary — nothing to write, carrying on.'
    return 1
  fi
  WORKSPACE="$(resolve_workspace)"
  if [[ -z "$WORKSPACE" ]]; then
    note 'not inside cmux and no CARD_WORKSPACE — nothing to write, carrying on.'
    return 1
  fi
  return 0
}

# Every cmux write goes through here, so --workspace is never forgotten and
# --dry-run has exactly one place to intercept.
card() {
  if [[ -n "${CARD_DRY_RUN:-}" ]]; then
    printf 'would run: %s' "$CMUX"
    printf ' %q' "$@" --workspace "$WORKSPACE"
    printf '\n'
    return 0
  fi
  "$CMUX" "$@" --workspace "$WORKSPACE" || return 4
}

# id<TAB>text for every todo, from a listing taken right now.
todo_rows() {
  local json
  json="$("$CMUX" todo list --json --workspace "$WORKSPACE" 2>/dev/null)" || return 4
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -r '.items[] | "\(.id)\t\(.text)"'
    return
  fi
  # No jq: cmux pretty-prints one key per line and orders keys alphabetically,
  # so "id" always precedes its object's "text". A value containing an escaped
  # quote would defeat this; jq is the path that does not care.
  printf '%s' "$json" | awk '
    function value(line) {
      sub(/^[^:]*:[[:space:]]*"/, "", line)
      sub(/",?[[:space:]]*$/, "", line)
      return line
    }
    /^[[:space:]]*"id"[[:space:]]*:/   { id = value($0); next }
    /^[[:space:]]*"text"[[:space:]]*:/ {
      if (id != "") { printf "%s\t%s\n", id, value($0); id = "" }
    }
  '
}

# Resolves a name to one todo id on stdout, or explains itself and fails.
todo_id_for() {
  local name="$1" rows exact loose count
  rows="$(todo_rows)" || return 4
  if [[ -z "$rows" ]]; then
    note "the checklist is empty, so there is no \"$name\" to mark."
    return 3
  fi

  exact="$(printf '%s\n' "$rows" | awk -F'\t' -v n="$name" '$2 == n { print $1 }')"
  count="$(printf '%s' "$exact" | grep -c . || true)"
  if [[ "$count" == 1 ]]; then printf '%s' "$exact"; return 0; fi

  loose="$(printf '%s\n' "$rows" | awk -F'\t' -v n="$name" '
    BEGIN { needle = tolower(n) }
    index(tolower($2), needle) { print $1 "\t" $2 }
  ')"
  count="$(printf '%s' "$loose" | grep -c . || true)"
  if [[ "$count" == 1 ]]; then printf '%s' "${loose%%$'\t'*}"; return 0; fi

  if [[ "$count" == 0 ]]; then
    note "no todo matches \"$name\". The list right now:"
    printf '%s\n' "$rows" | cut -f2- | sed 's/^/  · /' >&2
  else
    note "\"$name\" matches $count todos; name one of them exactly:"
    printf '%s\n' "$loose" | cut -f2- | sed 's/^/  · /' >&2
  fi
  return 3
}

# The whole point of the name lookup: an index read from an earlier listing is
# not the row it was read from.
refuse_index() {
  if [[ "$1" =~ ^[0-9]+$ ]]; then
    note "\"$1\" is an index, and this script only takes names."
    note 'cmux renumbers the list on every check — completed items sink — so an'
    note 'index addresses a different row than the one you read. Pass the todo'"'"'s'
    note 'text instead; `card.sh todos` prints it.'
    return 2
  fi
  return 0
}

need_args() {
  local have="$1" want="$2" what="$3"
  if (( have < want )); then
    note "$what"
    return 2
  fi
  return 0
}

main() {
  local command="${1:-help}"
  shift || true

  case "$command" in
    help | --help | -h)
      usage
      return 0
      ;;
    where)
      local bin ws
      bin="$(resolve_cmux)"
      ws="$(resolve_workspace)"
      printf 'binary:    %s\n' "${bin:-<none found>}"
      printf 'workspace: %s\n' "${ws:-<not inside cmux>}"
      return 0
      ;;
  esac

  case "$command" in
    lane | chip | clear | progress | clear-progress | todos | add | start | done) ;;
    *)
      note "unknown command \"$command\"."
      usage >&2
      return 2
      ;;
  esac

  require_card || return 0

  case "$command" in
    lane)
      need_args $# 1 'lane needs a value: card.sh lane "layout: building"' || return 2
      card set-status lane "$1"
      ;;
    chip)
      need_args $# 2 'chip needs a key and a value: card.sh chip queue "3/22 closed"' || return 2
      local key="$1" value="$2"
      shift 2
      card set-status "$key" "$value" "$@"
      ;;
    clear)
      need_args $# 1 'clear needs the key to remove: card.sh clear lane' || return 2
      card clear-status "$1"
      ;;
    progress)
      need_args $# 1 'progress needs a fraction: card.sh progress 0.7 "5/7 lanes"' || return 2
      local fraction="$1"
      if [[ ! "$fraction" =~ ^(0|1)(\.[0-9]+)?$ ]]; then
        note "\"$fraction\" is not a fraction between 0.0 and 1.0."
        return 2
      fi
      if [[ $# -ge 2 && -n "$2" ]]; then
        card set-progress "$fraction" --label "$2"
      else
        card set-progress "$fraction"
      fi
      ;;
    clear-progress)
      card clear-progress
      ;;
    todos)
      local rows
      rows="$(todo_rows)" || return 4
      if [[ -z "$rows" ]]; then
        printf 'the checklist is empty\n'
        return 0
      fi
      printf '%s\n' "$rows" | cut -f2- | sed 's/^/· /'
      ;;
    add)
      need_args $# 1 'add needs the item text: card.sh add "merge the docs lane"' || return 2
      card todo add "$1"
      ;;
    start | done)
      need_args $# 1 "$command needs a todo name: card.sh $command \"s10-docs\"" || return 2
      refuse_index "$1" || return 2
      local id
      id="$(todo_id_for "$1")" || return $?
      if [[ "$command" == done ]]; then
        card todo check "$id"
      else
        card todo start "$id"
      fi
      ;;
  esac
}

main "$@"
