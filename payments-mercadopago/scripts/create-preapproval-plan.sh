#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Create a Mercado Pago preapproval plan (subscription plan).

Usage: $(basename "$0") [options]

Required:
  --reason TEXT          Plan name/description
  --amount NUM          Transaction amount (e.g. 1000.00)
  --external-ref TEXT   Unique reference (e.g. sub_abc123)

Options:
  --currency TEXT       Currency code (default: ARS)
  --frequency NUM       Billing frequency (default: 1)
  --frequency-type TEXT Frequency unit: months|days (default: months)
  --back-url URL        Redirect URL after subscription
  --access-token TEXT   MP access token (default: \$MP_ACCESS_TOKEN)
  --dry-run             Print request without sending
  --help                Show this message

Output: JSON (plan id, init_point, status)
EOF
  exit 0
}

# Parse args
REASON=""
AMOUNT=""
EXTERNAL_REF=""
CURRENCY="ARS"
FREQUENCY=1
FREQUENCY_TYPE="months"
BACK_URL=""
ACCESS_TOKEN="${MP_ACCESS_TOKEN:-}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="$2"; shift 2 ;;
    --amount) AMOUNT="$2"; shift 2 ;;
    --external-ref) EXTERNAL_REF="$2"; shift 2 ;;
    --currency) CURRENCY="$2"; shift 2 ;;
    --frequency) FREQUENCY="$2"; shift 2 ;;
    --frequency-type) FREQUENCY_TYPE="$2"; shift 2 ;;
    --back-url) BACK_URL="$2"; shift 2 ;;
    --access-token) ACCESS_TOKEN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage ;;
    *) echo "Unknown: $1"; usage ;;
  esac
done

# Validate
errors=""
[[ -z "$REASON" ]] && errors+="--reason is required\n"
[[ -z "$AMOUNT" ]] && errors+="--amount is required\n"
[[ -z "$EXTERNAL_REF" ]] && errors+="--external-ref is required\n"
[[ -z "$ACCESS_TOKEN" ]] && errors+="MP_ACCESS_TOKEN not set (--access-token or env)\n"
if [[ -n "$errors" ]]; then echo -e "$errors" >&2; exit 1; fi

BODY=$(cat <<JSON
{
  "reason": "$REASON",
  "external_reference": "$EXTERNAL_REF",
  "auto_recurring": {
    "frequency": $FREQUENCY,
    "frequency_type": "$FREQUENCY_TYPE",
    "transaction_amount": $AMOUNT,
    "currency_id": "$CURRENCY",
    "billing_day_proportional": true
  }
}
JSON
)

# Add back_url if provided
if [[ -n "$BACK_URL" ]]; then
  BODY=$(echo "$BODY" | jq ".back_url = \"$BACK_URL\"")
fi

if $DRY_RUN; then
  echo "DRY RUN - Request:" >&2
  echo "POST https://api.mercadopago.com/preapproval_plan" >&2
  echo "Authorization: Bearer $ACCESS_TOKEN" >&2
  echo "$BODY" | jq .
  exit 0
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "https://api.mercadopago.com/preapproval_plan" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_OUT=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "$BODY_OUT" | jq '{id, init_point, status, external_reference, reason}'
else
  echo "ERROR $HTTP_CODE:" >&2
  echo "$BODY_OUT" | jq . >&2
  exit 1
fi
