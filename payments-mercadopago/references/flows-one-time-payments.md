# Flow: Pagos One-Time (Checkout Pro)

## Tables Required

### checkout_preferences
```sql
create table if not exists public.checkout_preferences (
  id uuid primary key default gen_random_uuid(),
  preference_id text not null unique,
  type text not null default 'one_time' check (type in ('one_time')),
  amount decimal(10,2) not null,
  currency text not null default 'ARS',
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired')),
  external_reference text,
  init_point text,
  metadata jsonb not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_checkout_one_time_ref on public.checkout_preferences(external_reference);
create index if not exists idx_checkout_one_time_status on public.checkout_preferences(status);
```

### webhook_log (for receiving payment confirmations)
```sql
create table if not exists public.webhook_log (
  idempotency_key text primary key,
  topic text not null,
  resource_id text not null,
  status text not null default 'received'
    check (status in ('received','processing','completed','failed')),
  success boolean not null default false,
  original_payload jsonb,
  headers jsonb,
  error_message text,
  retry_count int not null default 0,
  max_retries int not null default 3,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
```

## Connections Required

### Mercado Pago credentials
- `MP_ACCESS_TOKEN`: `APP_USR-xxxx`
- Webhook endpoint accessible from internet

### Set secrets
```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
supabase secrets set WEBHOOK_URL=https://project.supabase.co/functions/v1
```

### Deploy webhook function
```bash
supabase functions deploy webhook-entry --no-verify-jwt
```

### Configure webhooks in MP
In [Tus integraciones](https://mercadopago.com.ar/developers/panel/app):
- Webhook URL: `https://project.supabase.co/functions/v1/webhook-entry`
- Topics: `payment`

## Implementation Steps

### 1. Create a checkout preference
```
POST /checkout/preferences
{
  "items": [{
    "id": "product_123",
    "title": "Product Name",
    "description": "Product description",
    "quantity": 1,
    "unit_price": 1000.00,
    "currency_id": "ARS"
  }],
  "external_reference": "order_abc123",
  "notification_url": "https://project.supabase.co/functions/v1/webhook-entry",
  "back_urls": {
    "success": "https://mysite.com/success",
    "failure": "https://mysite.com/failure",
    "pending": "https://mysite.com/pending"
  },
  "auto_return": "approved"
}
```

**Response** returns `init_point` — redirect user there.

### 2. Insert local record
```sql
INSERT INTO checkout_preferences (preference_id, type, amount, external_reference, init_point)
VALUES ('mp_pref_id', 'one_time', 1000.00, 'order_abc123', 'https://www.mercadopago.com.ar/...');
```

### 3. Webhook processing
When user pays, MP sends `payment` webhook to `webhook-entry`:
1. Validate HMAC x-signature
2. Enrich: `GET /v1/payments/{id}`
3. Match by `external_reference` against `checkout_preferences`
4. Update `checkout_preferences.status = 'approved' | 'rejected'`
5. Update your order status accordingly

### 4. Full webhook handler logic
```typescript
// Inside webhook-entry, on payment webhook:
const payment = await mpApi.get(`/v1/payments/${paymentId}`, mpToken);

const { data: pref } = await supabase
  .from('checkout_preferences')
  .select('*')
  .eq('external_reference', payment.external_reference)
  .maybeSingle();

if (pref) {
  await supabase.from('checkout_preferences').update({
    status: payment.status === 'approved' ? 'approved' : 'rejected',
    updated_at: new Date().toISOString(),
  }).eq('id', pref.id);
}

// If payment.approved: fulfill the order
```

## Notes
- `notification_url` on the preference overrides the dashboard webhook for that specific payment
- If you omit `notification_url`, MP falls back to the dashboard-configured webhook (must include `payment` topic)
- `external_reference` is your link between MP and your order — always set it
