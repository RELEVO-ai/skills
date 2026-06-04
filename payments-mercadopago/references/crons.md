# Crons

Código de cada cron en `../templates/cron-*.ts` (columna Template, links). Las operaciones que disparan (cancel, etc.) son código en [`../templates/subscription-service.ts`](../templates/subscription-service.ts).

| Cron | Schedule | Gotcha (lo no-obvio) | Template |
|---|---|---|---|
| cycle_cancel | `5 0 * * *` | Cancela **24h ANTES** de `billing_cycle_end` (MP cobra en cycle_end; cancelar después = ya cobró). Misma query para cancel y downgrade_to_free; difiere en `cancelled_reason`. | [`cron-cycle-cancel.ts`](../templates/cron-cycle-cancel.ts) |
| cycle_end | `0 0 * * *` | Detecta ciclo vencido sin webhook de pago. Skip si ya hay transaction del ciclo. Grace 24h antes de marcar `past_due`. | [`cron-cycle-end.ts`](../templates/cron-cycle-end.ts) |
| discount_end | `10 0 * * *` | Restaura `original_price`. **Guard**: solo si `current_price = discounted_price` (no pisar cambios manuales). | [`cron-discount-end.ts`](../templates/cron-discount-end.ts) |
| unpaid_cleanup | `0 */6 * * *` | `pending` sin `preapproval_id` >24h → cancela plan (best effort) + `expired`. | [`cron-unpaid-cleanup.ts`](../templates/cron-unpaid-cleanup.ts) |
| retry_payment | `0 12 * * *` | `past_due` con `retry_count<3` → `PUT /preapproval {status:'authorized'}` dispara el reintento de MP. | [`cron-retry-payment.ts`](../templates/cron-retry-payment.ts) |
| webhook_retry | `*/15 * * * *` | Reprocesa `webhook_log` status `received`. Backoff `[5,15,60]→120` min, hasta `max_retries`. | [`cron-webhook-retry.ts`](../templates/cron-webhook-retry.ts) |

## Deployment (Supabase)

**pg_cron** (un `cron.schedule` por cron, apuntando a la Edge Function):
```sql
SELECT cron.schedule('subscription-cycle-cancel', '5 0 * * *',
  $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-cancel',
    headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
-- idem para: cycle-end (0 0 * * *), discount-end (10 0 * * *),
-- unpaid-cleanup (0 */6 * * *), retry-payment (0 12 * * *), webhook-retry (*/15 * * * *)
```

**config.toml** (alternativa):
```toml
[functions.cron-cycle-cancel.cron]
schedule = "5 0 * * *"
```
