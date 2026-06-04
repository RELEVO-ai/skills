# Flow: Procesar un Webhook de Mercado Pago

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`schema-webhook-log.md`](schema-webhook-log.md) | La tabla webhook_log no está creada |
| [`webhook-handlers.md`](webhook-handlers.md) | Necesitás el código TypeScript de handlers + HMAC |
| [`api-endpoints.md`](api-endpoints.md) | Necesitás los endpoints de enrich (payments, preapproval, authorized_payments) |

## Resumen del flujo

```
MP POST → webhook-entry
  |
  ├── Validar HMAC x-signature (x-request-id + data.id de query params)
  |     └── fail → 401
  |
  ├── Idempotency: webhook_log PK = "{type}:{action}:{data.id}:{notification_id}"
  |     └── existe → 200 (skip)
  |
  ├── INSERT webhook_log (status='received')
  |
  ├── Return 200 OK (< 22s)
  |
  └── Async process (switch body.type):
        ├── 'payment'                     → bash scripts/get-payment.sh --id {id}
        ├── 'subscription_preapproval'    → bash scripts/get-preapproval.sh --id {id}
        ├── 'subscription_authorized_payment' → bash scripts/get-authorized-payment.sh --id {id}
        └── 'subscription_preapproval_plan'   → bash scripts/get-preapproval.sh --id {id}
```

## Retry backoff

| Retry | Espera |
|-------|--------|
| 1     | 5 min  |
| 2     | 15 min |
| 3     | 60 min |
| 4+    | 120 min |

Cada 15 min un cron reprocesa `webhook_log` con `status='received'`, `retry_count < max_retries` y `next_retry_at < NOW()`.
