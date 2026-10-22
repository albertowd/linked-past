#!/bin/sh
# Local SonarQube (docker compose profile "sonar"); only SonarQube itself is started, never the app stack.
#   sh scripts/sonar.sh up     start SonarQube, provision it on first run (password + analysis token)
#   sh scripts/sonar.sh scan   (default) up if needed, regenerate coverage, scan and print open issues
#   sh scripts/sonar.sh down   remove the SonarQube containers, their data and the .sonar/ credentials
# SONAR_PORT picks the host port (default 9000) when another SonarQube already uses it.
set -eu
cd "$(dirname "$0")/.."

PORT=${SONAR_PORT:-9000}
HOST=http://localhost:$PORT
STATE=.sonar
export SONAR_PORT=$PORT

up() {
  mkdir -p "$STATE"
  # Random admin password per machine, kept out of git in .sonar/.
  if [ ! -s "$STATE/admin-password" ]; then
    printf '%sAa1!' "$(openssl rand -hex 12)" >"$STATE/admin-password"
    chmod 600 "$STATE/admin-password"
  fi
  PASS=$(cat "$STATE/admin-password")
  AUTH="admin:$PASS"

  # Another SonarQube (or anything else) may already own the port; say so instead of a raw Docker error.
  if [ -z "$(docker compose --profile sonar ps --status running --quiet sonarqube)" ] &&
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Pick another one, e.g.: SONAR_PORT=9001 npm run sonar:up" >&2
    exit 1
  fi
  docker compose --profile sonar up -d sonarqube
  printf 'waiting for SonarQube'
  until curl -sf "$HOST/api/system/status" | grep -q '"status":"UP"'; do printf .; sleep 3; done
  echo

  # Fresh instances still use admin/admin: switch to our password once.
  if curl -sf -u admin:admin "$HOST/api/authentication/validate" | grep -q '"valid":true'; then
    curl -sf -u admin:admin -X POST "$HOST/api/users/change_password" \
      --data-urlencode login=admin --data-urlencode previousPassword=admin --data-urlencode "password=$PASS"
  fi

  if [ ! -s "$STATE/token" ]; then
    curl -sf -u "$AUTH" -X POST "$HOST/api/user_tokens/generate" \
      --data-urlencode "name=linked-past-$(date +%s)" --data-urlencode type=GLOBAL_ANALYSIS_TOKEN |
      sed -n 's/.*"token":"\([^"]*\)".*/\1/p' >"$STATE/token"
  fi
  echo "SonarQube up: $HOST (login admin, password in $STATE/admin-password)"
}

scan() {
  up
  if ! npm run test:coverage >"$STATE/coverage.log" 2>&1; then
    tail -40 "$STATE/coverage.log" >&2
    echo "test/coverage run failed; fix it before scanning (full log: $STATE/coverage.log)" >&2
    exit 1
  fi
  SONAR_TOKEN=$(cat "$STATE/token") docker compose --profile sonar run --rm sonar-scanner | tee "$STATE/scan.log"

  # Wait for the server to finish processing the report, then summarize.
  TASK=$(sed -n 's/.*api\/ce\/task?id=\([0-9a-f-]*\).*/\1/p' "$STATE/scan.log" | tail -1)
  until curl -sf -u "$AUTH" "$HOST/api/ce/task?id=$TASK" | grep -qE '"status":"(SUCCESS|FAILED)"'; do sleep 2; done
  SONAR_HOST=$HOST SONAR_ADMIN_PASSWORD=$PASS node scripts/sonar-false-positives.mjs
  curl -sf -u "$AUTH" "$HOST/api/qualitygates/project_status?projectKey=linked-past" |
    sed 's/.*"status":"\([A-Z]*\)".*/quality gate: \1\n/' | head -1
  curl -sf -u "$AUTH" "$HOST/api/issues/search?componentKeys=linked-past&resolved=false&ps=500" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(`${r.total} open issues`);for(const i of r.issues)console.log(`${i.severity.padEnd(8)} ${i.rule.padEnd(28)} ${i.component.replace("linked-past:","")}:${i.line??"-"}  ${i.message}`)})'
  echo "dashboard: $HOST/dashboard?id=linked-past"
}

down() {
  # Throwaway instance: drop its volumes, and the credentials that only matched it.
  docker compose --profile sonar rm --stop --force --volumes sonarqube sonar-scanner
  rm -rf "$STATE" .scannerwork
}

case "${1:-scan}" in
  up) up ;;
  scan) scan ;;
  down) down ;;
  *)
    echo "usage: $0 [up|scan|down]" >&2
    exit 2
    ;;
esac
