# Checkout Preference Flow

## Subscription Lifecycle

```
pending ──first payment webhook──> active ──cancel()──> cancel_pending ──cron 24h before──> cancelled
  │                                  │
  │                                  ├── upgrade() → new price in MP + proration checkout
  │                                  ├── downgrade() → new price in MP (no refund)
  │                                  └── usuario cancela en MP → cancelled_externally
  │
  └───no payment >24h──> expired
```

## Sub Flows

### Subscription.create()

```
POST /preapproval_plan (con external_reference, transaction_amount)
  │
  ├── ¿hay discountAmount?
  │     └── INSERT subscription_discounts (original_price, discounted_price, amount, end_date)
  │
  ├── INSERT subscriptions (status='pending', current_price, plan_id)
  │
  ├── INSERT subscription_events (event_type='created')
  │
  └── Return { checkoutUrl: plan.init_point }
        → User redirects to MP init_point
        → First payment webhook sets billing_cycle_start/end y activa
```

### Subscription.upgrade()

```
1. PUT /preapproval/{id} { auto_recurring: { transaction_amount: newPrice } }
     → MP cobrará el nuevo precio en el próximo ciclo
     │
2. Calcular proración:
     ├── remainingMs = billing_cycle_end - now
     ├── totalMs = billing_cycle_end - billing_cycle_start
     ├── remainingRatio = remainingMs / totalMs
     ├── priceDiff = newPrice - currentPrice
     └── proratedAmount = ceil(remainingRatio * priceDiff)
     │
3. UPDATE subscriptions (current_price = newPrice)
     │
4. INSERT subscription_events (event_type='upgraded')
     │
5. Si proratedAmount > 0:
     ├── POST /checkout/preferences (unit_price = proratedAmount)
     ├── INSERT checkout_preferences (type='upgrade', metadata=newPrice)
     └── Return { checkoutUrl } → User paga la diferencia ahora
```

### Subscription.downgrade()

```
1. PUT /preapproval/{id} { auto_recurring: { transaction_amount: newPrice } }
2. UPDATE subscriptions (current_price = newPrice, cancel_at_period_end=false,
     status = IF cancel_pending THEN active ELSE current)
3. INSERT subscription_events (event_type='downgraded')
   (Sin reembolso, sin proración)
   Reset cancel_at_period_end y status por si el usuario tenia una cancelacion pendiente
```

### Subscription.cancel()

```
1. UPDATE subscriptions (status='cancel_pending', cancel_at_period_end=true, cancelled_reason)
2. INSERT subscription_events (cancel_scheduled / downgrade_to_free_scheduled)
3. Cron subscription_cycle_cancel lo retoma 24h antes de billing_cycle_end
```

## When to use Checkout Preferences

| Scenario | Use Checkout Preference? | Alternative |
|---|---|---|
| New subscription (initial payment) | NO — `preapproval_plan` already returns `init_point` | Redirect user to plan's `init_point` |
| Subscription upgrade (proration) | YES — one-time charge for the prorated difference | N/A |
| One-time product purchase | YES — standard checkout | N/A |
| Recurring subscription charge | NO — MP handles automatically via `/preapproval` | MP engine schedules charges |
| Downgrade | NO — just update price | `PUT /preapproval/{id}` |
| Cancel | NO — just update status | `PUT /preapproval/{id}` |

## Creating a Checkout Preference

### For New Subscription (via preapproval_plan)

No checkout preference needed. The `preapproval_plan` itself returns an `init_point`:

```
POST /preapproval_plan
{
  "reason": "Premium Plan Monthly",
  "external_reference": "sub_abc123",
  "auto_recurring": {
    "frequency": 1,
    "frequency_type": "months",
    "transaction_amount": 1000.00,
    "currency_id": "ARS",
    "billing_day_proportional": true
  },
  "back_url": "https://mysite.com/account"
}
```

**Response:**
```json
{
  "id": "2c938084726fca480172750000000000",
  "init_point": "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=2c938084726fca480172750000000000",
  ...
}
```

Redirect user to `init_point`. They complete subscription authorization in MP.
When the first payment is made, a `payment` webhook arrives.
`billing_cycle_start`/`billing_cycle_end` are set from the payment webhook, not at plan creation.

### For Upgrade Proration

```
POST /checkout/preferences
{
  "items": [{
    "id": "upgrade_plan_b",
    "title": "Upgrade to Plan B (prorated)",
    "description": "Prorated amount for plan upgrade - remaining 20 days",
    "quantity": 1,
    "unit_price": 6.67,                      // prorated amount
    "currency_id": "ARS"
  }],
  "external_reference": "sub_abc123",
  "notification_url": "https://.../webhook-entry",
  "back_urls": {
    "success": "https://mysite.com/account",
    "failure": "https://mysite.com/account",
    "pending": "https://mysite.com/account"
  },
  "auto_return": "approved",
  "metadata": {
    "checkout_type": "upgrade",
    "subscription_id": "sub_abc123",
    "new_plan_id": "plan_b",
    "old_price": 10.00,
    "new_price": 20.00,
    "proration_days": 20
  }
}
```

**Important**: The `metadata` field carries the context we need in the webhook handler to complete the upgrade.

## After Payment (Webhook Processing)

The `webhook_entry` returns 200 immediately after logging to `webhook_log`, then processes async.
When it receives a `payment` webhook for a checkout preference (upgrade proration):

```typescript
async function handle_checkout_payment(paymentId: string, supabase: SupabaseClient, mpToken: string) {
  const payment = await mpApi.get(`/v1/payments/${paymentId}`, mpToken);
  
  // Find the checkout preference by external_reference
  const { data: checkoutPref } = await supabase
    .from('checkout_preferences')
    .select('*')
    .eq('external_reference', payment.external_reference)
    .maybeSingle();
  
  if (!checkoutPref) {
    // Possibly a standard one-time purchase
    return;
  }
  
  // Mark preference as paid
  await supabase.from('checkout_preferences').update({
    status: payment.status === 'approved' ? 'approved' : 'rejected',
    updated_at: new Date().toISOString(),
  }).eq('id', checkoutPref.id);
  
  if (payment.status !== 'approved') return;
  
  // Handle based on type
  switch (checkoutPref.type) {
    case 'upgrade':
      const metadata = checkoutPref.metadata;
      
      // Update local subscription price (MP was already updated during upgrade())
      await supabase.from('subscriptions').update({
        current_price: metadata.new_price,
        updated_at: new Date().toISOString(),
      }).eq('id', checkoutPref.subscription_id);
      
      // Log event
      await supabase.from('subscription_events').insert({
        subscription_id: checkoutPref.subscription_id,
        event_type: 'upgrade_payment_received',
        event_data: metadata,
      });
      break;
      
    case 'one_time':
      // Standard purchase — update order status
      // await handle_one_time_purchase(payment, supabase);
      break;
  }
}
```

## Webhook Flow

Ver `references/webhook-handlers.md` para el diagrama completo de webhook entry y handlers.

## Common Pitfalls

### `notification_url` configuration
- **Can be set per-preference** (recommended for upgrade charges)
- **Must be set in Tus integraciones** for subscription webhooks (`subscription_preapproval`, `subscription_authorized_payment`)
- For subscriptions: webhooks are NOT configured via `notification_url` on preferences — they must be configured in the MP dashboard or via the webhook config API

### Subscription webhooks requirement
When creating subscriptions with Checkout Pro, subscription-related webhooks (`subscription_preapproval`, `subscription_authorized_payment`) will only fire if:
1. The webhook is configured in **Tus integraciones** (dashboard)
2. The topics `Planes y suscripciones` are selected

They do NOT come from `notification_url` on the preference.
