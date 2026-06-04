#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Create a Mercado Pago checkout preference (one-time payment).

Usage: $(basename "$0") [options]

Required:
  --title TEXT           Item title
  --amount NUM           Unit price
  --external-ref TEXT    Your order reference

Options:
  --quantity NUM         Quantity (default: 1)
  --currency TEXT        Currency code (default: ARS)
  --notification-url URL Webhook URL for payment updates
  --success-url URL      Back URL on success
  --failure-url URL      Back URL on failure
  --pending-url URL      Back URL on pending
  --auto-return          Auto return on approval (default: approved)
  --access-token TEXT    MP access token (default: \$MP_ACCESS_TOKEN)
  --dry-run              Print request without sending
  --help                 Show this message

Output: JSON (id, init_point, sandbox_init_point, status)
EOF
  exit 0
}

TITLE=""
AMOUNT=""
EXTERNAL_REF=""
QUANTITY=1
CURRENCY="ARS"
NOTIFICATION_URL=""
SUCCESS_URL=""
FAILURE_URL=""
PENDING_URL=""
AUTO_RETURN="approved"
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2 ;;
    --amount) AMOUNT="$2"; shift 2 ;;
    --external-ref) EXTERNAL_REF="$2"; shift 2 ;;
    --quantity) QUANTITY="$2"; shift 2 ;;
    --currency) CURRENCY="$2"; shift 2 ;;
    --notification-url) NOTIFICATION_URL="$2"; shift 2 ;;
    --success-url) SUCCESS_URL="$2"; shift 2 ;;
    --failure-url) FAILURE_URL="$2"; shift 2 ;;
    --pending-url) PENDING_URL="$2"; shift 2 ;;
    --auto-return) AUTO_RETURN="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

errors=""
[[ -z "$TITLE" ]] && errors+="--title is required\n"
[[ -z "$AMOUNT" ]] && errors+="--amount is required\n"
[[ -z "$EXTERNAL_REF" ]] && errors+="--external-ref is required\n"
[[ -z "$ACCESS_TOKEN" ]] && errors+="MP_ACCESS_TOKEN not set (--access-token or env)\n"
if [[ -n "$errors" ]]; then echo -e "$errors" >&2; exit 1; fi

BODY=$(cat <<JSON
{
  "items": [{
    "title": "$TITLE",
    "quantity": $QUANTITY,
    "unit_price": $AMOUNT,
    "currency_id": "$CURRENCY"
  }],
  "external_reference": "$EXTERNAL_REF"
}
JSON
)

# Add optional fields
[[ -n "$NOTIFICATION_URL" ]] && BODY=$(echo "$BODY" | jq ".notification_url = \"$NOTIFICATION_URL\"")
[[ -n "$AUTO_RETURN" ]] && BODY=$(echo "$BODY" | jq ".auto_return = \"$AUTO_RETURN\"")

if [[ -n "$SUCCESS_URL" || -n "$FAILURE_URL" || -n "$PENDING_URL" ]]; then
  BACK_URLS=$(jq -n "{}")
  [[ -n "$SUCCESS_URL" ]] && BACK_URLS=$(echo "$BACK_URLS" | jq ".success = \"$SUCCESS_URL\"")
  [[ -n "$FAILURE_URL" ]] && BACK_URLS=$(echo "$BACK_URLS" | jq ".failure = \"$FAILURE_URL\"")
  [[ -n "$PENDING_URL" ]] && BACK_URLS=$(echo "$BACK_URLS" | jq ".pending = \"$PENDING_URL\"")
  BODY=$(echo "$BODY" | jq ".back_urls = $BACK_URLS")
fi

if $DRY_RUN; then
  echo "DRY RUN - Request:" >&2
  echo "POST https://api.mercadopago.com/checkout/preferences" >&2
  echo "Authorization: Bearer $ACCESS_TOKEN" >&2
  echo "$BODY" | jq .
  exit 0
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "https://api.mercadopago.com/checkout/preferences" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '{id, init_point, sandbox_init_point, external_reference}'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
