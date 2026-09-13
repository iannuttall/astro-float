#!/bin/zsh
# Start the demo dev server, run compat-test.mjs against it, stop the server.
# Usage: scripts/compat/run.sh <port> <label>      (COLD=1 wipes demo/node_modules/.vite first; EXTRA passes astro dev flags)
set -u
PORT=$1; LABEL=$2
HERE=${0:a:h}
ROOT=$HERE/../..
OUT=$HERE/out; mkdir -p $OUT
LOG=$OUT/dev-$LABEL.log
cd $ROOT/demo
rm -rf .astro; [ "${COLD:-0}" = 1 ] && rm -rf node_modules/.vite
(node_modules/.bin/astro dev --port $PORT --host 127.0.0.1 ${EXTRA:-} > $LOG 2>&1 &)
for i in {1..60}; do
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/blog/hello-float/ | grep -q 200; then break; fi
  sleep 1
done
echo "server up after ${i}s"; grep -m1 -E "astro +v[0-9.]+" $LOG .astro/dev.log 2>/dev/null
SHOT_DIR=$OUT node $HERE/compat-test.mjs http://127.0.0.1:$PORT $LABEL
if [ "${DOCTOR:-0}" = 1 ]; then echo "--- doctor ---"; node $ROOT/packages/astro-float/src/cli.js doctor --url http://127.0.0.1:$PORT 2>&1 | head -40; fi
echo "--- server log (errors/warnings) ---"
cat $LOG .astro/dev.log 2>/dev/null | grep -inE "error|warn|cannot|failed|unsupported" | grep -v "x-astro-float" | head -20
PID=$(lsof -tiTCP:$PORT -sTCP:LISTEN); [ -n "$PID" ] && kill $PID
