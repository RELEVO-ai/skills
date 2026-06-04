# Webhook Handlers

Código en [`../templates/webhook-entry.ts`](../templates/webhook-entry.ts) (entry + routing) y [`../templates/webhook-handlers.ts`](../templates/webhook-handlers.ts) (handlers). Acá: las **reglas del entry, los datos de referencia, y el gotcha por handler**.

## Reglas del entry (no-obvias)

- **Devolver 200 PRIMERO** (<22s) y procesar async, o MP reintenta.
- **Validar HMAC** `x-signature` → si falla, **401** (MP no reintenta). Manifest: `id:{dataId};request-id:{xRequestId};ts:{ts};` → HMAC-SHA256 con `MP_WEBHOOK_SECRET` → comparar con `v1`.
- **Idempotencia**: key `"{type}:{action}:{data.id}:{notification_id}"` en `webhook_log` (ver [`../migrations/006_webhook_log.sql`](../migrations/006_webhook_log.sql)).
- **Enrich, nunca confiar en el payload**: solo trae `data.id` → siempre `GET` a la API.

## Datos de referencia

Payload: `{ id, type, action, data: { id } }`.

| Type | GET para enrich | Handler |
|---|---|---|
| `payment` | `/v1/payments/{id}` | payment |
| `subscription_preapproval` | `/preapproval/{id}` | preapproval |
| `subscription_authorized_payment` | `/authorized_payments/{id}` | authorized_payment |
| `subscription_preapproval_plan` | `/preapproval_plan/{id}` | actualiza plan_id + current_price |

Campos de cada respuesta → [`api/response-fields.md`](api/response-fields.md).

## Gotcha por handler

| Handler | Lo no-obvio |
|---|---|
| payment | Match por `external_reference`. Sin sub → one-time. `approved`→succeeded; `rejected/canceled/charged_back`→failed; `refunded`→refund. |
| preapproval | Detectar **cancelación externa**: `wasActive && status=='canceled' && !weInitiated` → `cancelled_reason='external'`. |
| authorized_payment | **`payment.status` es source of truth**, NO `authPayment.status`. `scheduled/recycling` → MP reintenta solo, no hacer nada. |
| payment_succeeded | Avanza el ciclo: `billing_cycle_start = old end`, `end = old end + duración`. |
| payment_failed | `retry_count+1`; `past_due` hasta `max_retries` → entonces `cancelled`. |
| checkout_payment (upgrade) | Match `checkout_preferences` por `external_reference`. Si `approved` + `type='upgrade'` → `current_price = metadata.new_price`. |
