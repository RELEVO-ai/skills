---
name: payments-mercadopago
category: payments
description: "Mercado Pago payments & subscriptions integration. Use when the task involves MP payment processing, subscription management, webhook handling, proration, recurring billing, checkout preferences, or payment webhooks."
version: "1.0.0"
agents: ["claude-code", "opencode", "codex", "cursor", "cline", "copilot", "gemini-cli"]
tags: ["payments", "subscriptions", "webhooks", "latam", "recurring-billing"]
---

# Mercado Pago Skill

## Core Architecture

### Named Systems (entry points del sistema)

| System | Type | Responsibility |
|---|---|---|
| `webhook_entry` | Edge Function | Unico endpoint que recibe webhooks. Valida HMAC x-signature, rutea al handler |
| `webhook_retry` | Table + Cron | Tabla `webhook_log`. Cron reintenta status='received' con backoff (5min/15min/60min, max 3) |
| `subscription_cycle_end` | Cron (diario) | Subscriptions donde `billing_cycle_end < now()` y `status = active` (sin cancel). Renueva ciclo o marca grace período |
| `subscription_cycle_cancel` | Cron (diario) | Subscriptions con `status = cancel_pending` y ciclo a menos de 24h → cancel en MP |
| `subscription_payment_failed` | Handler | Pago recurrente falla. Registra intento, max retries → cancela + notifica |
| `subscription_payment_succeeded` | Handler | Pago recurrente exitoso. Actualiza `billing_cycle_end`, registra transaction |
| `subscription_cancelled_externally` | Handler | Usuario cancela desde MP. Detecta via webhook y sincroniza |
| `subscription_upgrade` | Flow | Calcula proracion, genera checkout preference, actualiza precio |
| `subscription_downgrade` | Flow | Sin reembolso. Actualiza precio para proximo ciclo |
| `subscription_discount_end` | Cron (diario) | Lee `subscription_discounts` activos, restaura `current_price` a `original_price` |
| `subscription_unpaid_cleanup` | Cron (c/6h) | Preapproval_plans sin preapproval_id >24h → eliminar |
| `subscription_retry_payment` | Cron (diario) | Reintentar cobro a subscriptions `past_due` con `retry_count < max` |

## Domain Rules (CRITICAL)

### Payment Processing
- **Never use `card_token_id` directly.** Always use Checkout Pro/Bricks to collect payment data. The `/preapproval` endpoint requires `payer_email` + `card_token_id` which forces the user to know their MP email — this causes the error *"Tu e-mail no coincide con el de la suscripción"*.
- **Always create a new `preapproval_plan` per subscription.** A single multi-use plan means you can't match the consumer to the actual payer via `external_reference`. Each plan carries `external_reference` = `sub_${uuid}` (unique per subscription, not per user).
- **Never create `/preapproval` with `status: pending`.** Pending subscriptions require the user to know which email they used in MP, which they often don't.

### Subscription Lifecycle
- **Statuses**: `pending` → `active` → `cancel_pending` → `cancelled`. `cancel_pending` means user requested cancel/downgrade, cron cancels 24h before cycle end.
- **Cancellations are always at period end.** Set `status = cancel_pending` locally with `cancelled_reason = 'user_request'`. Cron `subscription_cycle_cancel` executes the actual `PUT /preapproval/{id} { status: 'canceled' }` **24h BEFORE** `billing_cycle_end`, not after. MP charges at `billing_cycle_end` — if we cancel after, MP already charged the full month.
- **Downgrade to free**: Same mechanism. `status = cancel_pending`, `cancelled_reason = 'downgrade_to_free'`. Cron cancels in MP 24h before cycle end. After cron runs, system can create a `free` tier locally.
- **Detect external cancellations.** If a user cancels from MP directly, webhook `subscription_preapproval` with `action: updated, status: canceled` fires. Detect if `cancel_at_period_end != true` and `status != cancel_pending` → external cancel. Sync to `cancelled` with `cancelled_reason = 'external'`.
- **Use "forever" subscriptions.** Never set `repetitions` in `auto_recurring`. Handle price changes and discounts via `PUT /preapproval/{id}` externally.
- **Only `transaction_amount` is mutable.** You cannot change `frequency`, `repetitions`, or other `auto_recurring` fields after creation. Plan accordingly.

### Pricing & Discounts
- **Upgrades**: Update `transaction_amount` in MP first (next cycle), then calculate prorated difference → create one-time Checkout Preference for the proration charge.
- **Downgrades (paid → paid)**: No refund. Update `transaction_amount` to new (lower) price. Next cycle charges the lower amount.
- **Downgrades (paid → free)**: Cannot set `transaction_amount = 0`. Use `cancel(reason='downgrade_to_free')`. Cron cancels MP 24h BEFORE `billing_cycle_end`. User keeps access until cycle end. After cancellation, create `free` tier locally.
- **Cancel at period end**: Cron cancels 24h BEFORE `billing_cycle_end`, not after. MP charges at `billing_cycle_end` — if we cancel after, MP already charged.
- **Discounts**: Stored in `subscription_discounts` table (trazable: original_price, discounted_price, amount, end_date, applied_by). Cron `subscription_discount_end` reads active discounts and restores price without proration.
- **Discount decision on upgrade**: Configurable per product (`metadata.upgrade_keeps_discount`). If `true`, discount % carries to new plan. If `false`, discount is lost on upgrade.

### Webhooks
- **Validate every webhook** using `x-signature` HMAC (SHA-256). Extract `ts` and `v1` from header, build manifest string, compare with HMAC of secret key.
- **Enrich, never trust raw payload.** Webhook payload only has `data.id`. Always fetch from MP API:
  - `GET /v1/payments/{id}` for payment data (card, digits, issuer, status)
  - `GET /preapproval/{id}` for subscription data
  - `GET /authorized_payments/{id}` for recurring payment charges
- **Idempotency + DLQ.** Single `webhook_log` table. Key: `"{type}:{action}:{data.id}:{notification_id}"`. Status: received → processing → completed/failed. Failed webhooks have retry backoff.

### Error States
- **Payment failure**: `subscription_payment_failed` → status `past_due` → retry up to 3 times → if all fail, cancel subscription + notify user.
- **Webhook delivery failure**: `webhook_retry` cron with exponential backoff. Each webhook has a `max_retries` (default 3) and `retry_count` with `next_retry_at`.
- **HMAC validation failure**: Log and return 401. Do not process.

## Migration

| File | Content |
|---|---|
| `migrations/001_create_subscriptions_tables.sql` | Create all required tables in Supabase. Copy-paste into Supabase SQL Editor. |

## Reference Documents

| File | Content |
|---|---|
| `references/api-endpoints.md` | MP API endpoints used by the skill |
| `references/webhook-handlers.md` | Detailed webhook handler logic per topic |
| `references/cron-jobs.md` | Complete cron job specifications |
| `references/pricing-logic.md` | Proration formulas and discount rules |
| `references/database-schema.md` | Supabase schema: tables, indexes, RLS |
| `references/checkout-flow.md` | Checkout preference creation flow |

## Templates

| File | Content |
|---|---|
| `templates/webhook-entry.ts` | Entry point Edge Function with HMAC validation + routing |
| `templates/subscription-service.ts` | Shareable subscription CRUD + MP sync |
| `templates/pricing-calculator.ts` | Proration, discount, upgrade/downgrade calculator |
| `templates/cron-cycle-cancel.ts` | subscription_cycle_cancel implementation |
| `templates/cron-cycle-end.ts` | subscription_cycle_end implementation |
| `templates/cron-discount-end.ts` | subscription_discount_end implementation |
| `templates/cron-unpaid-cleanup.ts` | subscription_unpaid_cleanup implementation |
| `templates/cron-retry-payment.ts` | subscription_retry_payment implementation |

## Deployment

### 1. Run migration

Copy `migrations/001_create_subscriptions_tables.sql` into Supabase SQL Editor and execute.

### 2. Set environment variables

```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
supabase secrets set MP_WEBHOOK_SECRET=your_webhook_secret
supabase secrets set APP_URL=https://your-app.com
supabase secrets set WEBHOOK_URL=https://project.supabase.co/functions/v1
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set automatically by Supabase Edge Functions runtime.

### 3. Deploy Edge Functions

```bash
supabase functions deploy webhook-entry --no-verify-jwt
supabase functions deploy cron-cycle-cancel --no-verify-jwt
supabase functions deploy cron-cycle-end --no-verify-jwt
supabase functions deploy cron-discount-end --no-verify-jwt
supabase functions deploy cron-unpaid-cleanup --no-verify-jwt
supabase functions deploy cron-retry-payment --no-verify-jwt
```

### 4. Configure cron schedules

```sql
SELECT cron.schedule('subscription-cycle-cancel',  '5 0 * * *',    $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-cancel',    headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-cycle-end',     '0 0 * * *',    $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-end',     headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-discount-end',  '10 0 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-discount-end',  headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-unpaid-cleanup','0 */6 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-unpaid-cleanup',headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-retry-payment', '0 12 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-retry-payment', headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
```

### 5. Configure webhooks in MP

In [Tus integraciones](https://mercadopago.com.ar/developers/panel/app):
- Webhook URL: `https://project.supabase.co/functions/v1/webhook-entry`
- Topics: `payment`, `subscription_preapproval`, `subscription_authorized_payment`, `subscription_preapproval_plan`
