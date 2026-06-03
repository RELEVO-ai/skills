# Mercado Pago API Endpoints Reference

## Authentication

### OAuth Token
```http
POST https://api.mercadopago.com/oauth/token
Content-Type: application/json

{
  "grant_type": "client_credentials",
  "client_id": "...",
  "client_secret": "..."
}
```

For server-side apps, use `access_token` directly from environment.

## Subscriptions

### Create Preapproval Plan
```http
POST https://api.mercadopago.com/preapproval_plan
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "reason": "Plan name / description",
  "external_reference": "user_abc123",
  "auto_recurring": {
    "frequency": 1,
    "frequency_type": "months",
    "transaction_amount": 1000.00,
    "currency_id": "ARS",
    "billing_day_proportional": true
  },
  "back_url": "https://mysite.com/checkout/success",
  "payment_methods_allowed": {
    "payment_types": [{}],
    "payment_methods": [{}]
  }
}
```

**Response** returns `id` which is the `preapproval_plan_id`.

**Important**: `external_reference` is the ONLY way to match the plan to a subscription. Set it to a unique id like `sub_${uuid}` (never the same reference for two different subscriptions).

### Get Preapproval Plan
```http
GET https://api.mercadopago.com/preapproval_plan/{{plan_id}}
Authorization: Bearer {{access_token}}
```

### Update Preapproval Plan
```http
PUT https://api.mercadopago.com/preapproval_plan/{{plan_id}}
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "auto_recurring": {
    "transaction_amount": 1500.00
  }
}
```

**Note**: Only `transaction_amount` in `auto_recurring` is mutable after creation.

### Search Preapproval Plans
```http
GET https://api.mercadopago.com/preapproval_plan/search
Authorization: Bearer {{access_token}}
?external_reference=user_abc123
&status=active
```

### Create Preapproval (Subscription)
```http
POST https://api.mercadopago.com/preapproval
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "preapproval_plan_id": "{{plan_id}}",
  "reason": "Subscription name",
  "external_reference": "user_abc123",
  "payer_email": "customer@email.com",
  "card_token_id": "abc123",
  "auto_recurring": {
    "frequency": 1,
    "frequency_type": "months",
    "transaction_amount": 1000.00,
    "currency_id": "ARS"
  },
  "back_url": "https://mysite.com/checkout/success",
  "status": "authorized"
}
```

**IMPORTANT**: Never use `status: pending`. It causes the error *"Tu e-mail no coincide con el de la suscripción"* because the user may not know which MP email they used.

**Better approach**: Create plan → redirect user to `init_point` → MP handles authorization → webhook confirms.

### Get Preapproval
```http
GET https://api.mercadopago.com/preapproval/{{id}}
Authorization: Bearer {{access_token}}
```

**Response includes**:
- `status`: authorized / canceled / paused / pending
- `external_reference`: your reference
- `preapproval_plan_id`: linked plan
- `auto_recurring.transaction_amount`: current price
- `next_payment_date`: when next charge happens
- `summarized.charged_quantity`: how many charges so far
- `payer_id`: MP payer ID
- `payment_method_id`: card type (visa/master/etc)
- `card_id`: saved card reference

### Update Preapproval
```http
PUT https://api.mercadopago.com/preapproval/{{id}}
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "auto_recurring": {
    "transaction_amount": 2000.00,
    "currency_id": "ARS"
  },
  "status": "authorized"
}
```

**Mutable fields**: `transaction_amount`, `status` (authorized/paused/canceled), `back_url`

### Search Preapprovals
```http
GET https://api.mercadopago.com/preapproval/search
Authorization: Bearer {{access_token}}
?external_reference=user_abc123
&status=authorized
```

## Authorized Payments (Recurring Charges)

### Get Authorized Payment
```http
GET https://api.mercadopago.com/authorized_payments/{{id}}
Authorization: Bearer {{access_token}}
```

**Response includes**:
- `status`: scheduled / processed / recycling / canceled (authorized_payment status, NOT the payment outcome)
- `payment.status`: approved / rejected / canceled / refunded / charged_back (actual payment outcome)
- `transaction_amount`: charged amount
- `payment.id`: linked MP payment ID
- `date_created`: charge date
- `preapproval_id`: linked subscription
- `reason`: description
- `external_reference`: your reference

### Search Authorized Payments
```http
GET https://api.mercadopago.com/authorized_payments/search
Authorization: Bearer {{access_token}}
?preapproval_id={{id}}
```

## Payments

### Get Payment
```http
GET https://api.mercadopago.com/v1/payments/{{id}}
Authorization: Bearer {{access_token}}
```

**Response includes** (critical for webhook enrichment):
- `status`: approved / rejected / in_process / canceled / refunded / charged_back
- `status_detail`: detailed status
- `transaction_amount`: amount
- `payment_method_id`: visa / master / amex / etc
- `payment_type_id`: credit_card / debit_card / etc
- `installments`: number of installments
- `card`: `{ last_four_digits, cardholder: { name }, expiration_month, expiration_year }`
- `issuer_id`: bank issuer
- `external_reference`: your reference
- `payer`: `{ email, id, identification }`
- `date_approved`: approval date
- `date_created`: creation date
- `fee_details`: MP fees breakdown
- `refunds`: refund history

### Search Payments
```http
GET https://api.mercadopago.com/v1/payments/search
Authorization: Bearer {{access_token}}
?external_reference=order_abc123
&sort=date_created
&criteria=desc
```

## Checkout Pro Preferences

### Create Preference
```http
POST https://api.mercadopago.com/checkout/preferences
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "items": [{
    "id": "product_123",
    "title": "Product Name",
    "description": "Product description",
    "quantity": 1,
    "unit_price": 1000.00,
    "currency_id": "ARS"
  }],
  "external_reference": "order_abc123",
  "notification_url": "https://my-edge-function.com/webhook-entry",
  "back_urls": {
    "success": "https://mysite.com/success",
    "failure": "https://mysite.com/failure",
    "pending": "https://mysite.com/pending"
  },
  "auto_return": "approved"
}
```

**Response returns**:
- `id`: preference ID
- `init_point`: URL to redirect user to MP checkout
- `sandbox_init_point`: test URL

### Get Preference
```http
GET https://api.mercadopago.com/checkout/preferences/{{id}}
Authorization: Bearer {{access_token}}
```

## Payment Methods

### List Payment Methods
```http
GET https://api.mercadopago.com/v1/payment_methods
Authorization: Bearer {{access_token}}
```

Returns available payment methods with their characteristics.

## Refunds

### Create Refund (full)
```http
POST https://api.mercadopago.com/v1/payments/{{id}}/refunds
Authorization: Bearer {{access_token}}
```

### Create Refund (partial)
```http
POST https://api.mercadopago.com/v1/payments/{{id}}/refunds
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "amount": 500.00
}
```

## Cancellations

### Cancel Payment
```http
PUT https://api.mercadopago.com/v1/payments/{{id}}
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "status": "canceled"
}
```

Only works for payments in `pending` or `in_process` status.

## Webhook Management (via MCP)

### Save Webhook
```http
POST/PUT https://api.mercadopago.com/users/{{user_id}}/webhooks
```

Configure via MCP tool `Mercadopago_save_webhook` or through [Tus integraciones](https://mercadopago.com.ar/developers/panel/app).

**Topics to subscribe to**:
| Topic | Events |
|---|---|
| `payment` | Payment creation/update |
| `subscription_preapproval` | Subscription creation/update |
| `subscription_authorized_payment` | Recurring payment charges |
| `subscription_preapproval_plan` | Plan creation/update |
| `topic_claims_integration_wh` | Claims and chargebacks |

## Base URLs

| Environment | URL |
|---|---|
| Production | `https://api.mercadopago.com` |
| Sandbox | `https://api.mercadopago.com` (use test credentials) |
| OAuth | `https://auth.mercadopago.com` |
