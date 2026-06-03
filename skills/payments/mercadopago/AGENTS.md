# Reglas de dominio: Mercado Pago (Payments & Subscriptions)

## Reglas Criticas
- Siempre usar Checkout Pro/Bricks para colectar datos de pago. **NUNCA** usar `card_token_id` directamente.
- Por cada cliente/subscription: crear su propio `preapproval_plan` con `external_reference` unica (ej: `sub_${uuid}`). Sirve para matchear webhooks con la subscription correcta.
- **NUNCA** crear `/preapproval` con `status: pending`. Causa error de email mismatch.
- Siempre validar `x-signature` HMAC en webhooks.
- Siempre enriquecer datos de webhook haciendo fetch a API de MP (nunca confiar solo en el payload).
- Usar los named systems definidos en SKILL.md (webhook_entry, webhook_retry, subscription_cycle_cancel, etc).
- Cancelaciones: SIEMPRE al final del ciclo (`cancel_pending` → cron `subscription_cycle_cancel`), nunca inmediato.
- **Cancelacion en MP ocurre 24h ANTES de billing_cycle_end** (cron busca `status = cancel_pending` y `billing_cycle_end < now + 24h`). MP cobra al llegar la fecha, si cancelamos despues ya cobro.
- Downgrade a free: NO se puede poner `transaction_amount = 0`. Usar `cancel(reason='downgrade_to_free')` que setea `status = cancel_pending` + `cancelled_reason = 'downgrade_to_free'`. Mismo cron se encarga.
- Detectar cancelaciones externas (usuario cancela desde MP): webhook `subscription_preapproval` con `status: canceled`. Si `cancel_at_period_end = false` y `status != cancel_pending` → external. Sincronizar a `cancelled` con `cancelled_reason = 'external'`.
- Todo webhook: log a `webhook_log` → return 200 → process async. Idempotencia + dead letter queue + retry en una sola tabla.
- Loggear todos los cambios de estado en `subscription_events`.

## Flujo Rápido por Contexto

### "Agregar suscripciones a este producto"
1. Ejecutar `migrations/001_create_subscriptions_tables.sql` en SQL Editor de Supabase
2. Configurar webhooks en MP apuntando a `webhook-entry` (ver SKILL.md → Deployment)
3. Setear secrets en Supabase: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL`, `WEBHOOK_URL`
4. Deployar Edge Functions: `webhook-entry`, `cron-cycle-cancel`, `cron-cycle-end`, `cron-discount-end`, `cron-unpaid-cleanup`, `cron-retry-payment` (todos con `--no-verify-jwt`)
5. Configurar schedules de cron en SQL Editor (ver SKILL.md → Deployment)
6. Subscription flow: crear `preapproval_plan` → devolver `init_point` → webhook confirma → guardar
7. Upgrade flow: proracion → checkout preference → update price
8. Downgrade flow: solo update price, no refund
9. Cancel flow: set `cancel_at_period_end=true`, cron se encarga

### "Necesito implementar pagos one-time"
1. Usar Checkout Pro (`/preferencia`)
2. `external_reference` = `order_id`
3. `notification_url` = `webhook_entry`
4. Webhook `payment` → `GET /v1/payments/{id}` → actualizar orden

### "Procesar webhook de MP"
1. Validar HMAC x-signature
2. Identificar `type` y `action`
3. INSERT webhook_log (idempotency check via PK). Si existe → return 200.
4. Return 200 OK
5. Procesar async: UPDATE webhook_log → processing → handler → completed/failed

## Stack
- Backend: Multiples lenguajes (templates en TypeScript para Supabase Edge Functions)
- DB: Supabase (PostgreSQL)
- Webhooks: Edge Functions
- Crons: Supabase pg_cron
- Credenciales: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `APP_URL`, `WEBHOOK_URL`. `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son automáticas en Edge Functions.

## Deploy rapido
Seguir SKILL.md → Deployment para migracion, secrets, deploy y schedules.
