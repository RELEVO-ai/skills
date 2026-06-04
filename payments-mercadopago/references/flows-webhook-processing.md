# Flow: Procesar un Webhook de Mercado Pago

## Tables Required

### webhook_log
```sql
create table if not exists public.webhook_log (
  idempotency_key text primary key,  -- "{type}:{action}:{data.id}:{notification_id}"
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

create index if not exists idx_webhook_log_retry on public.webhook_log(next_retry_at, retry_count)
  where status = 'received' and retry_count < max_retries and next_retry_at is not null;
create index if not exists idx_webhook_log_status on public.webhook_log(status);
```

## Connections Required

### Mercado Pago credentials
- `MP_ACCESS_TOKEN`: `APP_USR-xxxx`
- `MP_WEBHOOK_SECRET`: for HMAC validation

### Supabase
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (auto-injected in Edge Functions)

```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
supabase secrets set MP_WEBHOOK_SECRET=your_webhook_secret
```

### Deploy
```bash
supabase functions deploy webhook-entry --no-verify-jwt
```

## HMAC Signature Validation

MP sends webhooks with two headers:
- `x-signature: "ts=1704908010,v1=618c85345..."`
- `x-request-id: "550e8400-e29b-41d4-a716-..."`

The `data.id` comes from URL query params or body.

```typescript
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

If validation fails → return 401 (MP does NOT retry on 401).

## Processing Flow

```
MP POST → webhook-entry Edge Function
  │
  ├── 1. Accept only POST → else 405
  │
  ├── 2. Extract data.id from URL query params (fallback: body)
  │
  ├── 3. Validate HMAC x-signature
  │     └── fail → 401 (no retry)
  │
  ├── 4. Init Supabase + MP_ACCESS_TOKEN
  │
  ├── 5. Build idempotency_key = "{type}:{action}:{data.id}:{notification_id}"
  │     ├── SELECT webhook_log WHERE idempotency_key = ?
  │     └── exists → 200 (duplicate, already processed)
  │
  ├── 6. INSERT webhook_log (status='received')
  │
  ├── 7. Return 200 OK immediately (< 22s)
  │
  └── 8. Async process:
        ├── UPDATE webhook_log → status='processing'
        │
        ├── switch(body.type):
        │     ├── 'payment' → GET /v1/payments/{id}
        │     │     → handle initial/recurring/upgrade payments
        │     ├── 'subscription_preapproval' → GET /preapproval/{id}
        │     │     → sync subscription status, detect external cancel
        │     ├── 'subscription_authorized_payment' → GET /authorized_payments/{id}
        │     │     → handle recurring charge result
        │     └── 'subscription_preapproval_plan' → GET /preapproval_plan/{id}
        │           → sync plan data
        │
        ├── success → UPDATE webhook_log status='completed', success=true
        │
        └── error → calculate retry backoff:
              ├── retry_count < max_retries →
              │     UPDATE webhook_log status='received',
              │     retry_count+=1, next_retry_at=NOW+backoff
              └── retry_count >= max_retries →
                    UPDATE webhook_log status='failed' (dead letter)
```

## Backoff Strategy

| Retry # | Wait before retry |
|---------|------------------|
| 1       | 5 min            |
| 2       | 15 min           |
| 3       | 60 min           |
| 4+      | 120 min          |

## Webhook Retry Cron

Every 15 minutes, pick up webhooks stuck in `received` status:

```sql
SELECT * FROM webhook_log
WHERE status = 'received'
  AND retry_count < max_retries
  AND (next_retry_at IS NULL OR next_retry_at < NOW())
ORDER BY next_retry_at ASC NULLS FIRST
LIMIT 50;
```

```typescript
const { data: toRetry } = await supabase
  .from('webhook_log')
  .select('*')
  .eq('status', 'received')
  .or(`next_retry_at.lt.${now},next_retry_at.is.null`)
  .order('next_retry_at', { ascending: true, nullsFirst: true })
  .limit(50);

// Reprocess each: same logic as async step above
```

## Idempotency Key Format

```
{type}:{action}:{data.id}:{notification_id}

Examples:
  "payment:payment.created:123456789:98765"
  "subscription_preapproval:subscription_preapproval.updated:2c938084...:98766"
```

This is the PK of `webhook_log` — INSERT fails if duplicate exists.

## Webhook Payload Format

```json
{
  "id": 12345,
  "type": "payment",
  "action": "payment.created",
  "data": { "id": "999999999" },
  "notification_id": 98765
}
```

### Topics and Actions

| Type | Common Actions |
|------|---------------|
| `payment` | `payment.created`, `payment.updated` |
| `subscription_preapproval` | `subscription_preapproval.created`, `subscription_preapproval.updated` |
| `subscription_authorized_payment` | `subscription_authorized_payment.created`, `subscription_authorized_payment.updated` |
| `subscription_preapproval_plan` | `subscription_preapproval_plan.created`, `subscription_preapproval_plan.updated` |

## Enrichment (Never Trust Raw Payload)

Webhook payload only has `data.id`. Always fetch from MP API:
- `GET /v1/payments/{id}` for payment data
- `GET /preapproval/{id}` for subscription data
- `GET /authorized_payments/{id}` for recurring charges
- `GET /preapproval_plan/{id}` for plan data
