#!/bin/bash
# @artifact dev
# Headless-Chrome smoke test: loads the folder build (online) and the dist build
# (DNS blocked, i.e. offline) and fails on real console errors.
# Usage: tools/smoke.sh [outdir]   -> writes shot-folder.png / shot-dist.png / logs
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/.smoke}"; mkdir -p "$OUT"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
NOISE='Expected (length|number|moveto)|CORS policy|dns_config|address_sorter|FromSockAddr|DevTools|fontconfig|gpu|GPU|dbus|resource failed to load'
fail=0
run() { # name url extra-flag
  local n="$1" url="$2" x="${3:-}"
  rm -rf "$OUT/profile-$n"
  LOG="$OUT/log-$n.txt" sh -c 'perl -e "alarm 45; exec @ARGV" -- "$@" > "$LOG" 2>&1; exit 0' sh \
    "$CH" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$OUT/profile-$n" ${x:+"$x"} --enable-logging=stderr --v=0 --timeout=15000 \
    --window-size=1400,900 --screenshot="$OUT/shot-$n.png" "$url" 2>/dev/null
  pkill -f "user-data-dir=$OUT/profile-$n" 2>/dev/null
  local errs
  errs=$(grep -i 'CONSOLE' "$OUT/log-$n.txt" | grep -vE "$NOISE" | grep -iE 'error|uncaught|\[bundle\]|\[dc-runtime\].*(never resolved|not an array)|TypeError|ReferenceError|SyntaxError' | sed 's/.*CONSOLE:[0-9]*\] //' | cut -c1-240)
  if [ ! -s "$OUT/shot-$n.png" ]; then echo "SMOKE $n: FAIL (no screenshot)"; fail=1; fi
  if [ -n "$errs" ]; then echo "SMOKE $n: FAIL (console errors)"; echo "$errs" | head -20; fail=1; else echo "SMOKE $n: ok ($(wc -c < "$OUT/shot-$n.png") byte screenshot)"; fi
}
run folder "file://$ROOT/Experion%20Station%20Simulator.dc.html"
run dist "file://$ROOT/dist/experion-station-sim-standalone.html" "--host-resolver-rules=MAP * ~NOTFOUND"
exit $fail
