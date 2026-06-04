#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Get a Mercado Pago preapproval (subscription) by ID.

Usage: $(basename "$0") [options]

Required:
  --id TEXT              Preapproval ID

Options:
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --help                 Show this message

Output: JSON (status, payer, plan, payment method, next payment date, etc)
EOF
  exit 0
}

PREAPPROVAL_ID=""
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) PREAPPROVAL_ID="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

[[ -z "$PREAPPROVAL_ID" ]] && { echo "--id is required" >&2; exit 1; }
[[ -z "$ACCESS_TOKEN" ]] && { echo "MP_ACCESS_TOKEN not set" >&2; exit 1; }

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "https://api.mercadopago.com/preapproval/$PREAPPROVAL_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '{
    id, status, external_reference, preapproval_plan_id,
    reason, payer_id, payment_method_id, card_id,
    next_payment_date, date_created,
    auto_recurring: {transaction_amount: .auto_recurring?.transaction_amount},
    summarized: {charged_quantity: .summarized?.charged_quantity}
  }'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
