#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Get a Mercado Pago payment by ID (enrichment).

Usage: $(basename "$0") [options]

Required:
  --id TEXT              Payment ID

Options:
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --help                 Show this message

Output: JSON (payment status, amount, method, card, payer, etc)
EOF
  exit 0
}

PAYMENT_ID=""
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) PAYMENT_ID="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

[[ -z "$PAYMENT_ID" ]] && { echo "--id is required" >&2; exit 1; }
[[ -z "$ACCESS_TOKEN" ]] && { echo "MP_ACCESS_TOKEN not set" >&2; exit 1; }

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "https://api.mercadopago.com/v1/payments/$PAYMENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '{
    id, status, status_detail, transaction_amount,
    payment_method_id, payment_type_id, installments,
    external_reference, date_approved,
    card: {last_four_digits: .card?.last_four_digits, holder: .card?.cardholder?.name},
    payer: {email: .payer?.email, id: .payer?.id},
    fee_details
  }'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
