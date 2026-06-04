# Flow: Procesar un Webhook de Mercado Pago

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`../../migrations/006_webhook_log.sql`](../../migrations/006_webhook_log.sql) | La tabla webhook_log no está creada |
| [`../handlers.md`](../handlers.md) | Necesitás la lógica de handlers + HMAC |
| [`../api/response-fields.md`](../api/response-fields.md) | Necesitás los campos de enrich (payments, preapproval, authorized_payments) |

## Resumen del flujo

```
MP POST → webhook-entry
  ├── Validar HMAC x-signature (x-request-id + data.id de query params) → fail → 401
  ├── Idempotency: webhook_log PK = "{type}:{action}:{data.id}:{notification_id}" → existe → 200 (skip)
  ├── INSERT webhook_log (status='received')
  ├── Return 200 OK (< 22s)
  └── Async process (switch body.type):
        ├── 'payment'                         → bash scripts/get-payment.sh --id {id}
        ├── 'subscription_preapproval'        → bash scripts/get-preapproval.sh --id {id}
        ├── 'subscription_authorized_payment' → bash scripts/get-authorized-payment.sh --id {id}
        └── 'subscription_preapproval_plan'   → bash scripts/get-preapproval.sh --id {id}
```

## Retry backoff

`[5, 15, 60]` min según `retry_count`, luego 120. Cada 15 min un cron reprocesa `webhook_log` con `status='received'`, `retry_count < max_retries` y `next_retry_at < NOW()`. Ver [`../crons.md`](../crons.md).
