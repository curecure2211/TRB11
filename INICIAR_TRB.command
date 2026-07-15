#!/bin/bash
cd "$(dirname "$0")"
clear
printf '\nTRB — preparando los 93 recorridos KMZ\n\n'
if command -v python3 >/dev/null 2>&1; then
  python3 serve_trb.py --prepare --open
elif command -v python >/dev/null 2>&1; then
  python serve_trb.py --prepare --open
else
  echo "No se encontró Python 3. Instálalo desde https://www.python.org/downloads/"
  read -r -p "Pulsa Enter para cerrar…"
fi
