#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Update a Mercado Pago preapproval (subscription) price.

Usage: $(basename "$0") [options]

Required:
  --id TEXT              Preapproval ID
  --amount NUM           New transaction amount (e.g. 1500.00)

Options:
  --currency TEXT        Currency code (default: ARS)
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --dry-run              Print request without sending
  --help                 Show this message

Output: JSON (id, status, updated amount)
EOF
  exit 0
}

PREAPPROVAL_ID=""
AMOUNT=""
CURRENCY="ARS"
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) PREAPPROVAL_ID="$2"; shift 2 ;;
    --amount) AMOUNT="$2"; shift 2 ;;
    --currency) CURRENCY="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

[[ -z "$PREAPPROVAL_ID" ]] && { echo "--id is required" >&2; exit 1; }
[[ -z "$AMOUNT" ]] && { echo "--amount is required" >&2; exit 1; }
[[ -z "$ACCESS_TOKEN" ]] && { echo "MP_ACCESS_TOKEN not set" >&2; exit 1; }

BODY=$(cat <<JSON
{
  "auto_recurring": {
    "transaction_amount": $AMOUNT,
    "currency_id": "$CURRENCY"
  }
}
JSON
)

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
  echo "$BODY_OUT" | jq '{id, status, auto_recurring: {transaction_amount: .auto_recurring?.transaction_amount}}'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
