#!/usr/bin/env bash
# Runs the interface test (tests/ui_test.js) inside the desktop app on a virtual display.
#   scripts/ui-test.sh "<path to NXW Studio>" <folder with the built test plugins>
set -euo pipefail
APP="$1"; PLUGINS="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$HOME/.config/NXW Studio/Logs/nxw.log"

# A silent ALSA output, so the audio engine runs without a sound card.
cat > "$HOME/.asoundrc" <<'ALSA'
pcm.!default { type plug slave.pcm "nxwnull" }
pcm.nxwnull { type null }
ALSA
mkdir -p "$HOME/.vst3" /tmp/nxw-ui-test
cp -r "$PLUGINS"/NXWTest*_artefacts/Release/VST3/*.vst3 "$HOME/.vst3/"
rm -f "$LOG"

Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp &
XVFB=$!
sleep 1
cd "$ROOT/tests"
DISPLAY=:99 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  "$APP" --nxw-ui-test ui_test.js > /tmp/nxw-ui-test/app-output.txt 2>&1 &
APPPID=$!

result=1
for _ in $(seq 1 60); do
  sleep 3
  if [ -f "$LOG" ] && grep -q "\[ui test\] DONE" "$LOG"; then
    grep -q "\[ui test\] DONE 0 failed" "$LOG" && result=0
    break
  fi
done
grep "\[ui\|test" "$LOG" || cat /tmp/nxw-ui-test/app-output.txt
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  grep "\[ui test\] FAIL" "$LOG" | sed 's/^/::error title=Interface test::/' || true
  [ $result -ne 0 ] && ! grep -q "\[ui test\] DONE" "$LOG" && echo "::error title=Interface test::did not finish; app output: $(tail -c 1500 /tmp/nxw-ui-test/app-output.txt | tr '\n' ' ')"
fi
kill $APPPID 2>/dev/null || true
kill $XVFB 2>/dev/null || true
exit $result
