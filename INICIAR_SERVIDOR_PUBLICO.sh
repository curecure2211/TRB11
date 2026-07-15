#!/usr/bin/env sh
set -eu
PORT="${PORT:-8080}"
exec python serve_trb.py --host 0.0.0.0 --port "$PORT" --auto-prefetch
