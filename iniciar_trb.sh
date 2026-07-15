#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python3 serve_trb.py --prepare --open
