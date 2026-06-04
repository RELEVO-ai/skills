#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Cancel a Mercado Pago preapproval (subscription).

Usage: $(basename "$0") [options]

Required:
  --id TEXT              Preapproval ID

Options:
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --dry-run              Print request without sending
  --help                 Show this message

Output: JSON (id, status, canceled response)
EOF
  exit 0
}

PREAPPROVAL_ID=""
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) PREAPPROVAL_ID="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

[[ -z "$PREAPPROVAL_ID" ]] && { echo "--id is required" >&2; exit 1; }
[[ -z "$ACCESS_TOKEN" ]] && { echo "MP_ACCESS_TOKEN not set" >&2; exit 1; }

BODY='{"status": "canceled"}'

if $DRY_RUN; then
  echo "DRY RUN - Request:" >&2
  echo "PUT https://api.mercadopago.com/preapproval/$PREAPPROVAL_ID" >&2
  echo "Authorization: Bearer $ACCESS_TOKEN" >&2
  echo "$BODY" | jq .
  exit 0
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X PUT "https://api.mercadopago.com/preapproval/$PREAPPROVAL_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '{id, status, external_reference}'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
