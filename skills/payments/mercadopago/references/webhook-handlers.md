# Webhook Handlers

## Architecture

**Always return 200 first**, then process. MP expects response in <22s or it retries.
The `webhook_log` table handles idempotency + dead letter queue + retry tracking in one table.

### Full Flow

```
MP POST → webhook-entry
  │
  ├── 1. ¿Es POST? No → 405
  │
  ├── 2. Parsear body JSON
  │
  ├── 3. Extraer data.id de query params (fallback body)
  │
  ├── 4. Validar HMAC x-signature
  │     ├── split "ts=...,v1=..." del header x-signature
  │     ├── armar manifest: "id:{dataId};request-id:{xRequestId};ts:{ts};"
  │     ├── SHA-256 HMAC con MP_WEBHOOK_SECRET
  │     └── ¿no coincide? → log + 401 (MP no reintenta)
  │
  ├── 5. Init Supabase + MP_ACCESS_TOKEN
  │
  ├── 6. Idempotency: SELECT webhook_log WHERE idempotency_key
  │     └── ¿existe? → return 200 (duplicate, skip)
  │
  ├── 7. INSERT webhook_log (status='received')
  │
  ├── 8. Return 200 OK (MP ya tiene confirmación, <22s)
  │
  └── 9. Async: processWebhook()
        ├── UPDATE webhook_log → status='processing'
        │
        ├── switch(body.type):
        │     │
        │     ├── 'payment'
        │     │     ├── GET /v1/payments/{id} (enriquecer)
        │     │     ├── Buscar checkout_preferences por external_reference
        │     │     │     └── Si es upgrade + approved → actualizar current_price
        │     │     ├── Buscar subscriptions por external_reference
        │     │     ├── INSERT subscription_transactions
        │     │     ├── Si approved + pending → activar:
        │     │     │     status='active',
        │     │     │     billing_cycle_start=paidAt,
        │     │     │     billing_cycle_end=addMonth(paidAt)
        │     │     └── Si rejected/cancelled + no pending → retry o past_due
        │     │
        │     ├── 'subscription_preapproval'
        │     │     ├── GET /preapproval/{id}
        │     │     ├── Buscar subscription por external_reference
        │     │     ├── Sincronizar status:
        │     │     │     authorized→active, canceled→cancelled, paused→paused
        │     │     ├── Si authorized + pending → set billing_cycle_start/end
        │     │     └── Si cancelled externo → event cancelled_externally
        │     │
        │     ├── 'subscription_authorized_payment'
        │     │     ├── GET /authorized_payments/{id}
        │     │     ├── Buscar subscription por preapproval_id
        │     │     ├── INSERT subscription_transactions (type='recurring')
        │     │     ├── Si approved → avanzar ciclo:
        │     │     │     status='active',
        │     │     │     billing_cycle_start=prevEnd,
        │     │     │     billing_cycle_end=addMonth(prevEnd)
        │     │     └── Si rejected → retry o past_due
        │     │
        │     └── 'subscription_preapproval_plan'
        │           ├── GET /preapproval_plan/{id}
        │           ├── Buscar subscription por external_reference
        │           └── Actualizar plan_id y current_price
        │
        ├── Éxito → UPDATE webhook_log status='completed', success=true
        │
        └── Error → calcular retry:
              ├── retry_count < max_retries →
              │     UPDATE webhook_log status='received',
              │     next_retry_at=NOW+15min
              └── retry_count >= max_retries →
                    UPDATE webhook_log status='failed'
```

## HMAC Validation

```
Headers recibidos:
  x-signature: "ts=1704908010,v1=618c85345..."
  x-request-id: "550e8400-e29b-41d4-a716-..."
URL query params:
  ?data.id=123456&type=payment

Flujo:
  │
  1. Split x-signature por ","
     → ts = "1704908010", v1 = "618c85345..."
  │
  2. Armar manifest:
     "id:{dataId};request-id:{xRequestId};ts:{ts};"
  │
  3. HMAC-SHA256 con MP_WEBHOOK_SECRET
     → computedHex
  │
  4. computedHex === v1?
     ├── Sí → OK
     └── No → 401 Unauthorized (MP no reintenta)
```

```typescript
// x-signature header format:
// ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839

function validateSignature(
  xSignature: string,
  xRequestId: string,
  dataId: string,
  secret: string
): boolean {
  const parts = xSignature.split(',');
  let ts = '';
  let hash = '';
  
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key?.trim() === 'ts') ts = value?.trim();
    if (key?.trim() === 'v1') hash = value?.trim();
  }
  
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');
    
  return computed === hash;
}
```

## Webhook Payload Format

All webhooks arrive as POST with JSON body:
```json
{
  "id": 12345,
  "live_mode": true,
  "type": "payment",
  "date_created": "2025-03-25T10:04:58.396-04:00",
  "user_id": 44444,
  "api_version": "v1",
  "action": "payment.created",
  "data": { "id": "999999999" }
}
```

Actions per type:
| Type | Common Actions |
|---|---|
| `payment` | `payment.created`, `payment.updated` |
| `subscription_preapproval` | `subscription_preapproval.created`, `subscription_preapproval.updated` |
| `subscription_authorized_payment` | `subscription_authorized_payment.created`, `subscription_authorized_payment.updated` |
| `subscription_preapproval_plan` | `subscription_preapproval_plan.created`, `subscription_preapproval_plan.updated` |
| `topic_claims_integration_wh` | Various claim events |

## Handler: handle_payment

**Trigger**: Any payment created or updated (one-time, recurring charge, upgrade charge)

```typescript
async function handle_payment(paymentId: string, supabase: SupabaseClient, mpToken: string) {
  // 1. Fetch payment from MP API
  const payment = await mpApi.get(`/v1/payments/${paymentId}`, mpToken);
  
  // 2. Extract enriched data
  const enriched = {
    payment_id: payment.id,
    status: payment.status,                    // approved, rejected, in_process, refunded
    status_detail: payment.status_detail,
    transaction_amount: payment.transaction_amount,
    payment_method: payment.payment_method_id, // visa, master, etc
    payment_type: payment.payment_type_id,     // credit_card, debit_card, etc
    card_last_four: payment.card?.last_four_digits,
    card_holder_name: payment.card?.cardholder?.name,
    installments: payment.installments,
    issuer_id: payment.issuer_id,
    external_reference: payment.external_reference,
    payer_email: payment.payer?.email,
    payer_id: payment.payer?.id,
    date_approved: payment.date_approved,
    fee_details: payment.fee_details,
    metadata: {}
  };
  
  // 3. Find subscription by external_reference
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('external_reference', enriched.external_reference)
    .maybeSingle();
  
  if (!subscription) {
    // Payment not associated with any subscription (one-time purchase)
    await handle_one_time_payment(enriched, supabase);
    return;
  }
  
  // 4. Insert transaction record
  const type = enriched.external_reference === subscription.external_reference
    ? determine_transaction_type(subscription, enriched)
    : 'unknown';
  
  await supabase.from('subscription_transactions').insert({
    subscription_id: subscription.id,
    payment_id: enriched.payment_id,
    amount: enriched.transaction_amount,
    currency: 'ARS',
    status: enriched.status,
    payment_method: enriched.payment_method,
    card_last_four: enriched.card_last_four,
    card_holder_name: enriched.card_holder_name,
    installments: enriched.installments,
    type,  // 'initial', 'recurring', 'upgrade', 'downgrade'
    metadata: enriched,
    paid_at: enriched.date_approved || new Date().toISOString(),
  });
  
  // 5. Act on payment status
  switch (enriched.status) {
    case 'approved':
      await subscription_payment_succeeded(subscription, enriched, supabase);
      break;
    case 'rejected':
    case 'canceled':
    case 'charged_back':
      await subscription_payment_failed(subscription, enriched, supabase);
      break;
    case 'refunded':
      await handle_refund(subscription, enriched, supabase);
      break;
  }
}
```

## Handler: handle_preapproval

**Trigger**: Subscription created or updated (including external cancellations)

```typescript
async function handle_preapproval(preapprovalId: string, action: string, supabase: SupabaseClient, mpToken: string) {
  // 1. Fetch subscription from MP API
  const preapproval = await mpApi.get(`/preapproval/${preapprovalId}`, mpToken);
  
  // 2. Find our subscription by external_reference
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('external_reference', preapproval.external_reference)
    .maybeSingle();
  
  if (!subscription) {
    log.warn(`No subscription found for external_reference: ${preapproval.external_reference}`);
    return;
  }
  
  // 3. Detect external cancellation
  const wasActive = subscription.status === 'active' || subscription.status === 'cancel_pending';
  const isNowCancelled = preapproval.status === 'canceled';
  const weInitiated = subscription.cancel_at_period_end || subscription.status === 'cancel_pending';
  
  const statusMap = {
    'authorized': 'active',
    'canceled': 'cancelled',
    'paused': 'paused',
    'pending': 'pending',
  };
  
  const newStatus = statusMap[preapproval.status] || subscription.status;
  
  await supabase.from('subscriptions').update({
    preapproval_id: preapproval.id,
    status: newStatus,
    current_price: preapproval.auto_recurring?.transaction_amount || subscription.current_price,
    billing_cycle_end: preapproval.next_payment_date || subscription.billing_cycle_end,
    cancelled_externally: wasActive && isNowCancelled && !weInitiated,
    cancelled_reason: (wasActive && isNowCancelled && !weInitiated) ? 'external' : subscription.cancelled_reason,
    cancel_at_period_end: preapproval.status === 'canceled' ? false : subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }).eq('id', subscription.id);
  
  if (wasActive && isNowCancelled && !weInitiated) {
    // User cancelled directly from MP!
    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: 'cancelled_externally',
      event_data: { preapproval: preapproval, action },
    });
  }
}
```

## Handler: handle_authorized_payment

**Trigger**: Recurring payment charged (monthly/periodic charge)

```typescript
async function handle_authorized_payment(authorizedPaymentId: string, supabase: SupabaseClient, mpToken: string) {
  // 1. Fetch from MP API
  const authPayment = await mpApi.get(`/authorized_payments/${authorizedPaymentId}`, mpToken);
  
  // 2. Find subscription by preapproval_id
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('preapproval_id', authPayment.preapproval_id)
    .maybeSingle();
  
  if (!subscription) {
    log.warn(`No subscription for preapproval_id: ${authPayment.preapproval_id}`);
    return;
  }
  
  // 3. Determine payment outcome
  // authPayment.status: scheduled, processed, recycling, canceled
  // authPayment.payment.status: approved, rejected, canceled, refunded (source of truth)
  const paymentStatus = authPayment.payment?.status;
  const isApproved = paymentStatus === 'approved';
  const isExplicitFailure = paymentStatus === 'rejected' || paymentStatus === 'canceled' || authPayment.status === 'canceled';
  
  // 4. Find linked payment for enrichment (only if not already embedded)
  let payment = null;
  if (authPayment.payment?.id && !paymentStatus) {
    payment = await mpApi.get(`/v1/payments/${authPayment.payment.id}`, mpToken);
  }
  
  // 5. Insert transaction (only when there's a definitive payment result)
  if (paymentStatus) {
    await supabase.from('subscription_transactions').insert({
      subscription_id: subscription.id,
      payment_id: authPayment.payment?.id ?? payment?.id,
      amount: authPayment.transaction_amount,
      currency: 'ARS',
      status: isApproved ? 'approved' : 'rejected',
      payment_method: payment?.payment_method_id,
      card_last_four: payment?.card?.last_four_digits,
      type: 'recurring',
      metadata: { authorized_payment: authPayment, payment },
      paid_at: authPayment.date_created,
    });
  }
  
  // 6. Act
  if (isApproved) {
    await subscription_payment_succeeded(subscription, {
      transaction_amount: authPayment.transaction_amount,
      payment_id: authPayment.payment?.id,
    }, supabase);
  } else if (isExplicitFailure) {
    await subscription_payment_failed(subscription, {
      status: paymentStatus,
      payment_id: authPayment.payment?.id,
      authorized_payment_id: authPayment.id,
    }, supabase);
  }
  // scheduled/recycling: MP will auto-retry, no action needed
}
```

## Handler: subscription_payment_succeeded

```typescript
async function subscription_payment_succeeded(subscription: Subscription, data: any, supabase: SupabaseClient) {
  const isInitialPayment = subscription.status === 'pending';
  
  const updates: any = {
    status: 'active',
    updated_at: new Date().toISOString(),
  };
  
  // Recalculate billing_cycle_end
  const cycleLengthMs = new Date(subscription.billing_cycle_end).getTime()
    - new Date(subscription.billing_cycle_start).getTime();
  const nextCycleEnd = new Date(new Date(subscription.billing_cycle_end).getTime() + cycleLengthMs);
  updates.billing_cycle_end = nextCycleEnd.toISOString();
  updates.billing_cycle_start = subscription.billing_cycle_end; // old end = new start
  
  if (isInitialPayment) {
    updates.preapproval_id = data.preapproval_id;
  }
  
  await supabase.from('subscriptions').update(updates).eq('id', subscription.id);
  
  await supabase.from('subscription_events').insert({
    subscription_id: subscription.id,
    event_type: isInitialPayment ? 'activated' : 'payment_received',
    event_data: data,
  });
}
```

## Handler: subscription_payment_failed

```typescript
async function subscription_payment_failed(subscription: Subscription, data: any, supabase: SupabaseClient) {
  const retryCount = (subscription.payment_retry_count || 0) + 1;
  const maxRetries = subscription.max_retries || 3;
  const reachedMax = retryCount >= maxRetries;
  
  await supabase.from('subscriptions').update({
    status: reachedMax ? 'cancelled' : 'past_due',
    payment_retry_count: retryCount,
    updated_at: new Date().toISOString(),
  }).eq('id', subscription.id);
  
  await supabase.from('subscription_events').insert({
    subscription_id: subscription.id,
    event_type: reachedMax ? 'cancelled_due_to_payment_failure' : 'payment_failed',
    event_data: { ...data, retry_count: retryCount, max_retries: maxRetries },
  });
  
  // Notify user
  // notify_user(subscription.user_id, reachedMax ? 'subscription_cancelled' : 'payment_failed', { retry_count: retryCount });
}
```

## Helper: determine_transaction_type

```typescript
function determine_transaction_type(subscription: Subscription, payment: any): string {
  if (subscription.status === 'pending') return 'initial';
  
  // Check if this payment has an external_reference that matches
  // an upgrade/downgrade checkout preference
  if (payment.metadata?.checkout_type === 'upgrade') return 'upgrade';
  if (payment.metadata?.checkout_type === 'downgrade') return 'downgrade';
  
  // Default for recurring charges from the subscription engine
  return 'recurring';
}
```

## Idempotency Check

```typescript
async function check_idempotency(supabase: SupabaseClient, type: string, action: string, dataId: string, notificationId: number): Promise<boolean> {
  const key = `${type}:${action}:${dataId}:${notificationId}`;
  
  const { data: existing } = await supabase
    .from('webhook_log')
    .select('idempotency_key')
    .eq('idempotency_key', key)
    .maybeSingle();
  
  if (existing) return true; // Already processed
  
  await supabase.from('webhook_log').insert({
    idempotency_key: key,
    topic: type,
    resource_id: dataId,
    status: 'received',
  });
  
  return false;
}
```
