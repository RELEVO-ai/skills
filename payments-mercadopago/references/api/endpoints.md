# MP API — Endpoints sin script

Endpoints que **no** tienen un `scripts/*.sh` dedicado. Acá sí van los curls (no compiten con ningún script). Base URL: `https://api.mercadopago.com`. Auth: `Authorization: Bearer {{access_token}}`.

> Para suscripciones, payments, checkout y cancelaciones de preapproval **usá los scripts** (`scripts/*.sh --help`). No dupliques esos curls acá.

## OAuth Token
```http
POST /oauth/token
{ "grant_type": "client_credentials", "client_id": "...", "client_secret": "..." }
```
Server-side: usá `access_token` directo del entorno.

## Preapproval Plan (get / update / search)
```http
GET  /preapproval_plan/{plan_id}
PUT  /preapproval_plan/{plan_id}   { "auto_recurring": { "transaction_amount": 1500.00 } }
GET  /preapproval_plan/search?external_reference=...&status=active
```
Solo `transaction_amount` es mutable tras crear.

## Checkout Preference (get)
```http
GET /checkout/preferences/{id}
```

## Payment Methods
```http
GET /v1/payment_methods
```

## Refunds
```http
POST /v1/payments/{id}/refunds              # full
POST /v1/payments/{id}/refunds  { "amount": 500.00 }   # partial
```

## Cancel Payment
```http
PUT /v1/payments/{id}   { "status": "canceled" }
```
Solo para payments en `pending` o `in_process`.

## Save Webhook
```http
POST/PUT /users/{user_id}/webhooks
```
Vía dashboard ([Tus integraciones](https://mercadopago.com.ar/developers/panel/app)) o, si está disponible, MCP `Mercadopago_save_webhook` (opcional, no requerido).

Topics: `payment`, `subscription_preapproval`, `subscription_authorized_payment`, `subscription_preapproval_plan`, `topic_claims_integration_wh`.
