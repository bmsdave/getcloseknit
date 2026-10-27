#!/bin/bash
# Double-click entry point: opens Terminal and starts the real-data stack.
cd "$(dirname "$0")" && ./start-real.sh && open http://127.0.0.1:4180
echo "Review the map in your browser. Close this window to leave the servers running;"
echo "run ./stop-real.sh to stop them."
exec $SHELL -l
