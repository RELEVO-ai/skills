#!/usr/bin/env bash
set -euo pipefail

# <Una línea: qué hace este script.>

usage() {
  cat <<EOF
<Qué hace>.

Usage: $(basename "$0") [options]

Required:
  --foo TEXT            <descripción>

Options:
  --bar NUM             <descripción> (default: 1)
  --access-token TEXT   API token (default: \$API_TOKEN)
  --dry-run             Print request without sending
  --help                Show this message

Output: JSON
EOF
  exit 0
}

# --- args ---
FOO=""
BAR=1
ACCESS_TOKEN="${API_TOKEN:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --foo) FOO="$2"; shift 2 ;;
    --bar) BAR="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage ;;
    *) echo "Unknown: $1" >&2; usage ;;
  esac
done

# --- validate ---
errors=""
[[ -z "$FOO" ]] && errors+="--foo is required\n"
[[ -z "$ACCESS_TOKEN" ]] && errors+="API_TOKEN not set (--access-token or env)\n"
if [[ -n "$errors" ]]; then echo -e "$errors" >&2; exit 1; fi

# --- build request ---
URL="https://api.example.com/resource"
BODY=$(cat <<JSON
{ "foo": "$FOO", "bar": $BAR }
JSON
)

if $DRY_RUN; then
  echo "DRY RUN" >&2
  echo "POST $URL" >&2
  echo "$BODY" | jq .
  exit 0
fi

# --- execute ---
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq .
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
