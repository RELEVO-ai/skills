#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Search Mercado Pago preapprovals (subscriptions).

Usage: $(basename "$0") [options]

Options:
  --external-ref TEXT    Filter by external reference
  --status TEXT          Filter by status (authorized|canceled|paused|pending)
  --preapproval-id TEXT  Filter by preapproval plan ID
  --limit NUM           Results per page (default: 10)
  --offset NUM          Pagination offset (default: 0)
  --sort TEXT            Sort field (default: date_created)
  --criteria TEXT        Sort direction: desc|asc (default: desc)
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --help                 Show this message

Output: JSON array of results
EOF
  exit 0
}

EXTERNAL_REF=""
STATUS=""
PLAN_ID=""
LIMIT=10
OFFSET=0
SORT="date_created"
CRITERIA="desc"
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --external-ref) EXTERNAL_REF="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --preapproval-plan-id) PLAN_ID="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --offset) OFFSET="$2"; shift 2 ;;
    --sort) SORT="$2"; shift 2 ;;
    --criteria) CRITERIA="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

[[ -z "$ACCESS_TOKEN" ]] && { echo "MP_ACCESS_TOKEN not set" >&2; exit 1; }

# Build query string
QUERY="?limit=$LIMIT&offset=$OFFSET&sort=$SORT&criteria=$CRITERIA"
[[ -n "$EXTERNAL_REF" ]] && QUERY+="&external_reference=$EXTERNAL_REF"
[[ -n "$STATUS" ]] && QUERY+="&status=$STATUS"
[[ -n "$PLAN_ID" ]] && QUERY+="&preapproval_plan_id=$PLAN_ID"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "https://api.mercadopago.com/preapproval/search$QUERY" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '.results | .[] | {id, status, external_reference, reason, next_payment_date, auto_recurring: {transaction_amount}}'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
