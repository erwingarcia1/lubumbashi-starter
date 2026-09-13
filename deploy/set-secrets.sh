#!/usr/bin/env bash
# Sets (or re-sets) the two secrets of .env.production on the server by typing them at a prompt:
# they never appear in a shell history, a chat, or a process list. Leave a prompt empty to keep the
# current value. Run over SSH with a terminal:
#   ssh -t -i <key.pem> ubuntu@<ip> lubumbashi-tax/deploy/set-secrets.sh
set -euo pipefail
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.production"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
read -rsp "Supabase database password (empty = keep current): " DB_PASSWORD; echo
read -rsp "Supabase secret key sb_secret_... (empty = keep current): " SECRET_KEY; echo
DB_PASSWORD="$DB_PASSWORD" SECRET_KEY="$SECRET_KEY" python3 - "$ENV_FILE" <<'PY'
import os, pathlib, re, sys, urllib.parse
p = pathlib.Path(sys.argv[1])
lines = p.read_text().splitlines()
pw = os.environ["DB_PASSWORD"].strip()
key = os.environ["SECRET_KEY"].strip()
out = []
for line in lines:
    if key and line.startswith("SUPABASE_SECRET_KEY="):
        line = f"SUPABASE_SECRET_KEY={key}"
    if pw and line.startswith("DATABASE_URL_MIGRATIONS="):
        m = re.match(r"DATABASE_URL_MIGRATIONS=(postgresql://[^:]+):[^@]*@(.*)$", line)
        if not m:
            sys.exit("DATABASE_URL_MIGRATIONS has an unexpected shape")
        # The password goes inside a URL: percent-encode it (/ # % ? @ …).
        line = f"DATABASE_URL_MIGRATIONS={m.group(1)}:{urllib.parse.quote(pw, safe='')}@{m.group(2)}"
    out.append(line)
text = "\n".join(out) + "\n"
p.write_text(text)
left = text.count("__PASTE_")
secret = next((l.split("=", 1)[1] for l in out if l.startswith("SUPABASE_SECRET_KEY=")), "")
# A real secret key is sb_secret_ + about 30 characters; the dashboard's masked display is only 15.
shape = "ok" if secret.startswith("sb_secret_") and len(secret) >= 30 else "NOT a complete sb_secret_ key (use the copy icon, not the displayed text)"
print("placeholders left:", left, "| secret key shape:", shape)
sys.exit(0 if left == 0 and shape == "ok" else 1)
PY
