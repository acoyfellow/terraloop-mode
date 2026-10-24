set -euo pipefail
project="$1"
file="$2"
host="${GITLAB_HOST:?set GITLAB_HOST}"
encoded=$(printf '%s' "$project" | sed 's|/|%2F|g')
token=$(glab config get token --host "$host" 2>/dev/null || true)
if [ -z "$token" ]; then
  token=$(glab auth status -t 2>&1 | sed -nE 's/.*Token found: ([^ ]+).*/\1/p' | head -1)
fi
[ -n "$token" ] || { echo "no gitlab token" >&2; exit 1; }
curl -sS --fail -H "PRIVATE-TOKEN: $token" -F "file=@$file" "https://$host/api/v4/projects/$encoded/uploads" | jq -r .markdown
