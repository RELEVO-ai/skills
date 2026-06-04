#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Get a Mercado Pago authorized payment (recurring charge) by ID.

Usage: $(basename "$0") [options]

Required:
  --id TEXT              Authorized payment ID

Options:
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --help                 Show this message

Output: JSON (status, payment status, amount, preapproval_id, etc)
EOF
  exit 0
}

AUTH_PAYMENT_ID=""
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) AUTH_PAYMENT_ID="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

[[ -z "$AUTH_PAYMENT_ID" ]] && { echo "--id is required" >&2; exit 1; }
[[ -z "$ACCESS_TOKEN" ]] && { echo "MP_ACCESS_TOKEN not set" >&2; exit 1; }

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "https://api.mercadopago.com/authorized_payments/$AUTH_PAYMENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '{
    id, status, transaction_amount, preapproval_id,
    reason, external_reference, date_created,
    payment: {id: .payment?.id, status: .payment?.status}
  }'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
