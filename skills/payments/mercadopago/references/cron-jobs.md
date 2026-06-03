# Cron Jobs

All crons run as Supabase Edge Functions on a schedule (via `pg_cron`).
Templates in `templates/` prefixed `cron-*`. Deploy commands in SKILL.md → Deployment.

## 1. subscription_cycle_cancel

**Schedule**: Daily at 00:05
**System**: `subscription_cycle_cancel`

**CRITICAL**: MP cobra exactamente en `billing_cycle_end`. Si cancelamos DESPUES de esa fecha, MP ya cobro el mes completo. Por eso este cron cancela **24h ANTES** de `billing_cycle_end`. Esto le da margen a MP para procesar la cancelacion antes del cobro.

Unica query, misma logica para cancelacion y downgrade a free. La diferencia esta en `cancelled_reason`:
- `'user_request'` → cancelacion normal
- `'downgrade_to_free'` → downgrade a plan gratuito (despues del cron, el sistema crea un subscription `free` local)

```
subscription_cycle_cancel (Daily 00:05)
  │
  ├── Query subscriptions (batch 100, ORDER BY billing_cycle_end ASC):
  │     WHERE status = 'cancel_pending'
  │     AND billing_cycle_end < NOW() + 24h
  │     .range(offset, offset + BATCH - 1)
  │
  │   ── if empty → log + exit
  │
  └── For each sub in batch:
        │
        ├── PUT /preapproval/{preapproval_id} { status: 'canceled' }
        │     └── ¿error? → event 'cancel_failed' + continue
        │
        ├── UPDATE subscriptions (status='cancelled', cancel_at_period_end=false)
        │
        └── INSERT subscription_events:
              ├── cancelled_reason='user_request' → 'cycle_cancelled'
              └── cancelled_reason='downgrade_to_free' → 'downgraded_to_free'
```

```sql
-- Query: cancel_pending cuyo billing_cycle_end esta a menos de 24h
SELECT * FROM subscriptions
WHERE status = 'cancel_pending'
  AND billing_cycle_end < NOW() + INTERVAL '24 hours';
```

```typescript
async function subscription_cycle_cancel(supabase: SupabaseClient, mpToken: string) {
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  const { data: toCancel } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('status', 'cancel_pending')
    .lt('billing_cycle_end', cutoff);
  
  if (!toCancel?.length) return;
  
  for (const sub of toCancel) {
    try {
      await mpApi.put(`/preapproval/${sub.preapproval_id}`, mpToken, {
        status: 'canceled'
      });
      
      await supabase.from('subscriptions').update({
        status: 'cancelled',
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      }).eq('id', sub.id);
      
      const eventType = sub.cancelled_reason === 'downgrade_to_free'
        ? 'downgraded_to_free'
        : 'cycle_cancelled';
      
      await supabase.from('subscription_events').insert({
        subscription_id: sub.id,
        event_type: eventType,
        event_data: {
          reason: sub.cancelled_reason,
          cancelled_at: new Date().toISOString(),
        },
      });
      
    } catch (error) {
      await supabase.from('subscription_events').insert({
        subscription_id: sub.id,
        event_type: 'cancel_failed',
        event_data: { error: error.message },
      });
    }
  }
}
```

**Error handling**: Log failures, do not retry automatically (manual investigation needed). Si la cancelacion falla muy cerca del billing_cycle_end, MP podria cobrar. Es un riesgo aceptable pero debe monitorearse.

---

## 2. subscription_cycle_end

**Schedule**: Daily at 00:00
**System**: `subscription_cycle_end`

```
subscription_cycle_end (Daily 00:00)
  │
  ├── Query subscriptions:
  │     WHERE status = 'active'
  │     AND billing_cycle_end < NOW()
  │
  └── For each sub:
        │
        ├── Check subscription_transactions for payment in this cycle
        │     └── ¿payment already received? → skip (ya procesado por webhook)
        │
        ├── ¿grace period (24h desde billing_cycle_end)?
        │     ├── Sí, dentro de grace → no hacer nada (esperar)
        │     └── Sí, pasado grace → UPDATE status='past_due'
        │
        └── INSERT subscription_events según corresponda
```

```sql
-- Subscriptions where cycle ended but no payment webhook was received yet
SELECT * FROM subscriptions
WHERE billing_cycle_end < NOW()
  AND status = 'active'
  AND cancel_at_period_end = false;
```

```typescript
async function subscription_cycle_end(supabase: SupabaseClient) {
  const { data: atCycleEnd } = await supabase
    .from('subscriptions')
    .select('*')
    .lt('billing_cycle_end', new Date().toISOString())
    .eq('status', 'active')
    .eq('cancel_at_period_end', false);
  
  if (!atCycleEnd?.length) return;
  
  for (const sub of atCycleEnd) {
    // Check if payment was already received (via webhook)
    const { data: recentTx } = await supabase
      .from('subscription_transactions')
      .select('*')
      .eq('subscription_id', sub.id)
      .eq('type', 'recurring')
      .gte('created_at', sub.billing_cycle_end)
      .maybeSingle();
    
    if (recentTx) continue; // Payment already processed via webhook
    
    // Cycle ended but no payment yet — mark as grace period
    const graceEnd = new Date(new Date(sub.billing_cycle_end).getTime() + 24 * 60 * 60 * 1000);
    
    if (new Date() > graceEnd) {
      // Past grace period — mark past_due
      await supabase.from('subscriptions').update({
        status: 'past_due',
        updated_at: new Date().toISOString(),
      }).eq('id', sub.id);

      await supabase.from('subscription_events').insert({
        subscription_id: sub.id,
        event_type: 'cycle_ended_unpaid',
        event_data: { billing_cycle_end: sub.billing_cycle_end },
      });
    }
  }
}
```

---

## 3. subscription_discount_end

**Schedule**: Daily at 00:10
**System**: `subscription_discount_end`

```
subscription_discount_end (Daily 00:10)
  │
  ├── Query subscription_discounts JOIN subscriptions (batch 100):
  │     WHERE sd.status = 'active'
  │     AND sd.discount_end_date < NOW()
  │     AND s.status IN ('active', 'cancel_pending')
  │     AND s.current_price = sd.discounted_price
  │     .range(offset, offset + BATCH - 1)
  │
  │   ── if empty → log + exit
  │
  └── For each discount in batch:
        │
        ├── PUT /preapproval/{preapproval_id} { auto_recurring: { transaction_amount: original_price } }
        │     └── ¿error? → event 'discount_restore_failed' + continue
        │
        ├── UPDATE subscriptions (current_price = original_price)
        │
        ├── UPDATE subscription_discounts (status = 'expired')
        │
        └── INSERT subscription_events (event_type='discount_expired')
```

```sql
SELECT sd.*, s.preapproval_id, s.current_price
FROM subscription_discounts sd
JOIN subscriptions s ON s.id = sd.subscription_id
WHERE sd.status = 'active'
  AND sd.discount_end_date < NOW()
  AND sd.discount_end_date IS NOT NULL
  AND s.status IN ('active', 'cancel_pending')
  AND s.current_price = sd.discounted_price;
```

```typescript
async function subscription_discount_end(supabase: SupabaseClient, mpToken: string) {
  const { data: expiredDiscounts } = await supabase
    .from('subscription_discounts')
    .select(`*, subscriptions!inner(id, status, current_price, preapproval_id)`)
    .eq('status', 'active')
    .not('discount_end_date', 'is', null)
    .lt('discount_end_date', new Date().toISOString())
    .in('subscriptions.status', ['active', 'cancel_pending']);
  
  // Only where price hasn't been manually changed
  const toRestore = (expiredDiscounts || []).filter(
    (d: any) => Number(d.subscriptions?.current_price) === Number(d.discounted_price)
  );
  
  for (const discount of toRestore) {
    const sub = discount.subscriptions;
    try {
      await mpApi.put(`/preapproval/${sub.preapproval_id}`, mpToken, {
        auto_recurring: {
          transaction_amount: Number(discount.original_price),
          currency_id: sub.currency,
        }
      });
      
      await supabase.from('subscriptions').update({
        current_price: discount.original_price,
        updated_at: new Date().toISOString(),
      }).eq('id', discount.subscription_id);
      
      await supabase.from('subscription_discounts').update({
        status: 'expired',
      }).eq('id', discount.id);
      
      await supabase.from('subscription_events').insert({
        subscription_id: discount.subscription_id,
        event_type: 'discount_expired',
        event_data: {
          discount_id: discount.id,
          previous_price: discount.discounted_price,
          restored_price: discount.original_price,
        },
      });
      
    } catch (error) {
      console.error(`Failed to restore discount ${discount.id}:`, error);
    }
  }
}
```

---

## 4. subscription_unpaid_cleanup

**Schedule**: Every 6 hours
**System**: `subscription_unpaid_cleanup`

```
subscription_unpaid_cleanup (Every 6h)
  │
  ├── Query subscriptions (batch 100):
  │     WHERE preapproval_id IS NULL
  │     AND created_at < NOW() - 24h
  │     AND status = 'pending'
  │     .range(offset, offset + BATCH - 1)
  │
  │   ── if empty → log + exit
  │
  └── For each sub in batch:
        │
        ├── PUT /preapproval_plan/{plan_id} { status: 'canceled' } (best effort)

        ├── UPDATE subscriptions (status='expired')
        │
        └── INSERT subscription_events (event_type='expired_unpaid')
```

```sql
SELECT * FROM subscriptions
WHERE preapproval_id IS NULL
  AND created_at < NOW() - INTERVAL '24 hours'
  AND status = 'pending';
```

```typescript
async function subscription_unpaid_cleanup(supabase: SupabaseClient, mpToken: string) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data: unpaid } = await supabase
    .from('subscriptions')
    .select('*')
    .is('preapproval_id', null)
    .lt('created_at', cutoff)
    .eq('status', 'pending');
  
  for (const sub of unpaid || []) {
    try {
      // Cancel the plan in MP
      await mpApi.put(`/preapproval_plan/${sub.plan_id}`, mpToken, {
        status: 'canceled',
      });
      
      // Mark locally
      await supabase.from('subscriptions').update({
        status: 'expired',
        updated_at: new Date().toISOString(),
      }).eq('id', sub.id);
      
      await supabase.from('subscription_events').insert({
        subscription_id: sub.id,
        event_type: 'expired_unpaid',
        event_data: { created_at: sub.created_at, cleaned_at: new Date().toISOString() },
      });
      
    } catch (error) {
      console.error(`Failed to cleanup unpaid subscription ${sub.id}:`, error);
    }
  }
}
```

---

## 5. subscription_retry_payment

**Schedule**: Daily at 12:00
**System**: `subscription_retry_payment`

```
subscription_retry_payment (Daily 12:00)
  │
  ├── Query subscriptions:
  │     WHERE status = 'past_due'
  │     AND payment_retry_count < 3
  │
  └── For each sub:
        │
        ├── PUT /preapproval/{preapproval_id} { status: 'authorized' }
        │     → MP reintenta el cobro automáticamente
        │     └── ¿error? → log + continue
        │
        └── UPDATE subscriptions (payment_retry_count += 1)
```

```sql
SELECT * FROM subscriptions
WHERE status = 'past_due'
  AND payment_retry_count < 3;
```

```typescript
async function subscription_retry_payment(supabase: SupabaseClient, mpToken: string) {
  const { data: toRetry } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('status', 'past_due')
    .lt('payment_retry_count', 3);
  
  for (const sub of toRetry || []) {
    try {
      // Re-authorize the subscription to trigger MP retry
      await mpApi.put(`/preapproval/${sub.preapproval_id}`, mpToken, {
        status: 'authorized',
      });
      
      await supabase.from('subscriptions').update({
        payment_retry_count: (sub.payment_retry_count || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('id', sub.id);
      
    } catch (error) {
      console.error(`Failed to retry payment for subscription ${sub.id}:`, error);
    }
  }
}
```

---

## 6. webhook_retry

**Schedule**: Every 15 minutes
**System**: `webhook_retry`

```
webhook_retry (Every 15min)
  │
  ├── Query webhook_log:
  │     WHERE status = 'received'
  │     AND retry_count < max_retries
  │     AND (next_retry_at IS NULL OR next_retry_at < NOW())
  │     ORDER BY next_retry_at ASC NULLS FIRST
  │     LIMIT 50
  │
  └── For each log:
        │
        ├── Reprocess: processWebhook(original_payload, headers)
        │     │
        │     ├── ¿éxito?
        │     │     └── UPDATE webhook_log (status='completed', success=true)
        │     │
        │     └── ¿error?
        │           ├── Calcular backoff: [5, 15, 60, 120...] min según retry_count
        │           └── UPDATE webhook_log (retry_count+=1, next_retry_at, error_message)
        │
```

```sql
SELECT * FROM webhook_log
WHERE status = 'received'
  AND retry_count < max_retries
  AND (next_retry_at IS NULL OR next_retry_at < NOW())
ORDER BY next_retry_at ASC NULLS FIRST
LIMIT 50;
```

```typescript
async function webhook_retry(supabase: SupabaseClient) {
  const { data: failures } = await supabase
    .from('webhook_log')
    .select('*')
    .eq('status', 'received')
    .or(`next_retry_at.lt.${new Date().toISOString()},next_retry_at.is.null`)
    .order('next_retry_at', { ascending: true, nullsFirst: true })
    .limit(50);
  
  for (const failure of failures || []) {
    if (failure.retry_count >= failure.max_retries) continue;
    try {
      await process_webhook(failure.original_payload, failure.headers);
      
      await supabase.from('webhook_log').update({
        status: 'completed',
        success: true,
        processed_at: new Date().toISOString(),
      }).eq('idempotency_key', failure.idempotency_key);
      
    } catch (error) {
      const newRetryCount = failure.retry_count + 1;
      const backoffMinutes = [5, 15, 60][Math.min(newRetryCount - 1, 2)] || 120;
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      
      await supabase.from('webhook_log').update({
        status: 'received',
        retry_count: newRetryCount,
        last_attempt_at: new Date().toISOString(),
        next_retry_at: nextRetryAt.toISOString(),
        error_message: error.message,
      }).eq('idempotency_key', failure.idempotency_key);
    }
  }
}
```

---

## Deployment (Supabase)

### Option A: pg_cron (simpler, SQL-based)

```sql
SELECT cron.schedule(
  'subscription-cycle-cancel',
  '5 0 * * *',  -- daily at 00:05
  $$SELECT net.http_post(
    url:='https://project.supabase.co/functions/v1/cron-cycle-cancel',
    headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

SELECT cron.schedule(
  'subscription-cycle-end',
  '0 0 * * *',  -- daily at 00:00
  $$SELECT net.http_post(
    url:='https://project.supabase.co/functions/v1/cron-cycle-end',
    headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

SELECT cron.schedule(
  'subscription-discount-end',
  '10 0 * * *',  -- daily at 00:10
  $$SELECT net.http_post(...)$$
);

SELECT cron.schedule(
  'subscription-unpaid-cleanup',
  '0 */6 * * *',  -- every 6 hours
  $$SELECT net.http_post(...)$$
);

SELECT cron.schedule(
  'subscription-retry-payment',
  '0 12 * * *',  -- daily at 12:00
  $$SELECT net.http_post(...)$$
);

SELECT cron.schedule(
  'webhook-retry',
  '*/15 * * * *',  -- every 15 minutes
  $$SELECT net.http_post(...)$$
);
```

### Option B: Edge Function Schedules (Supabase management API)

Configure via `supabase functions deploy` with a `cron:` schedule in `config.toml`.

```toml
[functions.cron-cycle-cancel]
enabled = true
verify_jwt = false
import_map = "./import_map.json"

[functions.cron-cycle-cancel.cron]
schedule = "5 0 * * *"  # daily at 00:05
```
