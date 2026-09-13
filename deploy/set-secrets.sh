#!/usr/bin/env bash
# Fills the two secrets of .env.production on the server by typing them at a prompt: they never
# appear in a shell history, a chat, or a process list. Run over SSH with a terminal:
#   ssh -t -i <key.pem> ubuntu@<ip> lubumbashi-tax/deploy/set-secrets.sh
set -euo pipefail
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.production"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
read -rsp "Supabase database password (chosen at project creation): " DB_PASSWORD; echo
read -rsp "Supabase secret key (sb_secret_...): " SECRET_KEY; echo
DB_PASSWORD="$DB_PASSWORD" SECRET_KEY="$SECRET_KEY" python3 - "$ENV_FILE" <<'PY'
import os, pathlib, sys, urllib.parse
p = pathlib.Path(sys.argv[1])
s = p.read_text()
# The database password goes inside a connection URL: percent-encode it (/ # % ? @ …).
s = s.replace("__PASTE_DB_PASSWORD__", urllib.parse.quote(os.environ["DB_PASSWORD"].strip(), safe=""))
s = s.replace("__PASTE_SECRET_KEY__", os.environ["SECRET_KEY"].strip())
p.write_text(s)
left = s.count("__PASTE_")
print("placeholders left:", left)
sys.exit(0 if left == 0 else 1)
PY
