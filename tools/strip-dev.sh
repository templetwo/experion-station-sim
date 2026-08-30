#!/bin/bash
# @artifact dev
# Produce a production-only tree: dev-class files are removed, production-class
# files are kept. Classes and markers: docs/dev/ARTIFACT-CLASSES.md.
#
# Usage:
#   tools/strip-dev.sh                 list what would be removed (dry run, default)
#   tools/strip-dev.sh --out DIR       copy the production tree to DIR, repo untouched
#   tools/strip-dev.sh --apply         remove dev files from the working tree IN PLACE
#
# --apply is destructive and refuses to run on a dirty tree; use git to recover.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE=list; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) MODE=apply; shift ;;
    --out)   MODE=copy; OUT="${2:?--out needs a directory}"; shift 2 ;;
    -h|--help) sed -n '3,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Files that carry no in-file marker; kept in step with tests/artifact-classes.test.js.
unmarkable_class() {
  case "$1" in
    support.js|dist/experion-station-sim-standalone.html|LICENSE) echo production ;;
    .thumbnail) echo dev ;;
    *) echo "" ;;
  esac
}

classify() {
  local f="$1" c
  c="$(unmarkable_class "$f")"
  if [ -n "$c" ]; then echo "$c"; return; fi
  c="$(head -3 "$f" 2>/dev/null | grep -oE '@artifact +(production|dev)' | head -1 | awk '{print $2}')"
  echo "${c:-UNCLASSIFIED}"
}

prod=(); dev=(); bad=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$(classify "$f")" in
    production) prod+=("$f") ;;
    dev)        dev+=("$f") ;;
    *)          bad+=("$f") ;;
  esac
done < <(git ls-files)

if [ ${#bad[@]} -gt 0 ]; then
  echo "REFUSING: ${#bad[@]} file(s) carry no artifact class:" >&2
  printf '  %s\n' "${bad[@]}" >&2
  echo "Add an '@artifact production' or '@artifact dev' marker, then re-run." >&2
  exit 1
fi

echo "production: ${#prod[@]} file(s)   dev: ${#dev[@]} file(s)"

case "$MODE" in
  list)
    echo; echo "would REMOVE (dev):"; printf '  %s\n' "${dev[@]}"
    echo; echo "would KEEP (production):"; printf '  %s\n' "${prod[@]}"
    echo; echo "dry run only. Re-run with --out DIR or --apply."
    ;;
  copy)
    mkdir -p "$OUT"
    for f in "${prod[@]}"; do mkdir -p "$OUT/$(dirname "$f")"; cp "$f" "$OUT/$f"; done
    echo "wrote ${#prod[@]} production file(s) to $OUT"
    ;;
  apply)
    if [ -n "$(git status --porcelain)" ]; then
      echo "REFUSING --apply on a dirty tree; commit or stash first." >&2; exit 1
    fi
    for f in "${dev[@]}"; do rm -f "$f"; done
    find . -type d -empty -not -path './.git/*' -delete 2>/dev/null || true
    echo "removed ${#dev[@]} dev file(s) from the working tree. 'git checkout .' restores them."
    ;;
esac
