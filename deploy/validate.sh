#!/bin/bash
set -euo pipefail

app_dir=/home/ubuntu/Crewaskbackend/crewdesk-backend-main
configured_port=''

# CodeDeploy may run the service on either the legacy 5001 port or the
# application default (5000). Prefer the deployed environment when present,
# without sourcing the file or exposing any of its secrets.
if [ -f "$app_dir/.env" ]; then
  configured_port=$(sed -n 's/^PORT=\([0-9][0-9]*\).*$/\1/p' "$app_dir/.env" | tail -n 1)
fi

ports=()
for port in "$configured_port" 5001 5000; do
  if [ -n "$port" ] && [[ ! " ${ports[*]} " =~ " ${port} " ]]; then
    ports+=("$port")
  fi
done

# MongoDB readiness can take longer than a fixed sleep. Retry within a bounded
# window and accept only the application's healthy JSON response.
deadline=$((SECONDS + 120))
while [ "$SECONDS" -lt "$deadline" ]; do
  for port in "${ports[@]}"; do
    if curl --fail --silent --max-time 2 "http://127.0.0.1:${port}/health" | grep -q '"status":"ok"'; then
      exit 0
    fi
  done
  sleep 2
done

systemctl status crewdesk-backend --no-pager -l || true
journalctl -u crewdesk-backend --no-pager -n 80 || true
echo "Crew Ask health check failed on ports: ${ports[*]}" >&2
exit 1
