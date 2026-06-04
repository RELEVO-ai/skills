# Flow: Agregar Suscripciones a un Producto

## Tables Required

### subscriptions
```sql
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  product_id text not null,
  plan_id text not null,
  preapproval_id text,
  external_reference text not null unique,
  status text not null default 'pending'
    check (status in ('pending','active','cancel_pending','past_due','cancelled','expired','paused','free')),
  current_price decimal(10,2) not null,
  currency text not null default 'ARS',
  billing_cycle_start timestamptz,
  billing_cycle_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_externally boolean not null default false,
  cancelled_reason text,
  payment_retry_count int not null default 0,
  max_retries int not null default 3,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### subscription_discounts
```sql
create table if not exists public.subscription_discounts (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  original_price decimal(10,2) not null,
  discounted_price decimal(10,2) not null,
  discount_amount decimal(10,2) not null,
  currency text not null default 'ARS',
  discount_end_date timestamptz,
  status text not null default 'active'
    check (status in ('active', 'expired', 'cancelled')),
  applied_by text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

### subscription_transactions
```sql
create table if not exists public.subscription_transactions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  payment_id text not null,
  amount decimal(10,2) not null,
  currency text not null default 'ARS',
  status text not null
    check (status in ('approved','pending','rejected','refunded','canceled','charged_back')),
  payment_method text,
  payment_type text,
  card_last_four text,
  card_holder_name text,
  installments int not null default 1,
  type text not null default 'recurring'
    check (type in ('initial','recurring','upgrade','downgrade','one_time')),
  fee_details jsonb,
  discount_id uuid references public.subscription_discounts(id) on delete set null,
  metadata jsonb not null default '{}',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
```

### subscription_events
```sql
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

### checkout_preferences (for upgrade proration)
```sql
create table if not exists public.checkout_preferences (
  id uuid primary key default gen_random_uuid(),
  preference_id text not null unique,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  type text not null check (type in ('upgrade','downgrade','one_time')),
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
```

### Indexes
```sql
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_mp on public.subscriptions(plan_id, preapproval_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_subscriptions_external_ref on public.subscriptions(external_reference);
create index if not exists idx_subscriptions_cancel on public.subscriptions(billing_cycle_end)
  where status = 'cancel_pending';
create index if not exists idx_subscriptions_past_due on public.subscriptions(status, payment_retry_count)
  where status = 'past_due';
create index if not exists idx_subscriptions_unpaid on public.subscriptions(created_at, status)
  where preapproval_id is null and status = 'pending';
create index if not exists idx_subscription_discounts_sub on public.subscription_discounts(subscription_id);
create index if not exists idx_subscription_discounts_active on public.subscription_discounts(discount_end_date)
  where status = 'active' and discount_end_date is not null;
create index if not exists idx_transactions_subscription on public.subscription_transactions(subscription_id);
create index if not exists idx_transactions_payment on public.subscription_transactions(payment_id);
create index if not exists idx_transactions_status on public.subscription_transactions(status);
create index if not exists idx_transactions_date on public.subscription_transactions(paid_at desc);
create unique index if not exists idx_transactions_payment_unique on public.subscription_transactions(payment_id)
  where payment_id is not null;
create index if not exists idx_events_subscription on public.subscription_events(subscription_id);
create index if not exists idx_events_type on public.subscription_events(event_type);
create index if not exists idx_events_created on public.subscription_events(created_at desc);
create index if not exists idx_checkout_subscription on public.checkout_preferences(subscription_id);
create index if not exists idx_checkout_preference on public.checkout_preferences(preference_id);
create index if not exists idx_checkout_status on public.checkout_preferences(status);
```

### Auto-update trigger
```sql
create or replace function public.update_subscriptions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
create trigger trigger_subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function public.update_subscriptions_updated_at();
```

### RLS
```sql
alter table public.subscriptions enable row level security;
alter table public.subscription_transactions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_discounts enable row level security;
-- Policies: users can SELECT own rows; Edge Functions bypass via service_role
```

## Connections Required

### Supabase project
- Supabase URL and service role key (auto-injected in Edge Functions)
- Copy-paste SQL above into Supabase SQL Editor

### Mercado Pago credentials
- `MP_ACCESS_TOKEN`: `APP_USR-xxxx` from [Tus integraciones](https://mercadopago.com.ar/developers/panel/app)
- `MP_WEBHOOK_SECRET`: your webhook secret

### Set secrets
```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
supabase secrets set MP_WEBHOOK_SECRET=your_webhook_secret
supabase secrets set APP_URL=https://your-app.com
supabase secrets set WEBHOOK_URL=https://project.supabase.co/functions/v1
```

### Deploy Edge Functions
```bash
supabase functions deploy webhook-entry --no-verify-jwt
supabase functions deploy cron-cycle-cancel --no-verify-jwt
supabase functions deploy cron-cycle-end --no-verify-jwt
supabase functions deploy cron-discount-end --no-verify-jwt
supabase functions deploy cron-unpaid-cleanup --no-verify-jwt
supabase functions deploy cron-retry-payment --no-verify-jwt
```

### Configure cron schedules (pg_cron)
```sql
SELECT cron.schedule('subscription-cycle-cancel',  '5 0 * * *',    $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-cancel',    headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-cycle-end',     '0 0 * * *',    $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-end',     headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-discount-end',  '10 0 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-discount-end',  headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-unpaid-cleanup','0 */6 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-unpaid-cleanup',headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-retry-payment', '0 12 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-retry-payment', headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
```

### Configure webhooks in MP dashboard
In [Tus integraciones](https://mercadopago.com.ar/developers/panel/app):
- Webhook URL: `https://project.supabase.co/functions/v1/webhook-entry`
- Topics: `payment`, `subscription_preapproval`, `subscription_authorized_payment`, `subscription_preapproval_plan`

## Integration Steps

1. Run all SQL above in Supabase SQL Editor
2. Set secrets
3. Deploy Edge Functions
4. Configure cron schedules
5. Configure webhooks in MP
6. Create `preapproval_plan` with `external_reference = sub_${uuid}` — returns `init_point`
7. Redirect user to `init_point` — they authorize in MP
8. Webhook `subscription_preapproval` confirms → save `preapproval_id`
9. Webhook `payment` (first) → set `billing_cycle_start/end`, status → `active`

## Upgrade/Downgrade/Cancel Flows

See `references/pricing-logic.md` for proration formulas and discount rules.
