# Database Schema (Supabase)

> **Standalone file**: `migrations/001_create_subscriptions_tables.sql` — copy-paste into Supabase SQL Editor.
> Este archivo es la referencia detallada; el archivo standalone es el que se ejecuta.

## Migration SQL

```sql
-- 001_create_subscriptions_tables.sql

-- ============================================================
-- SUBSCRIPTIONS
-- Core table tracking each subscription's lifecycle
-- billing_cycle_start/end se setean cuando llega el primer payment
-- webhook (fuente de verdad), no al crear la subscription
-- ============================================================
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  product_id text not null,
  plan_id text not null,                    -- MP preapproval_plan_id
  preapproval_id text,                      -- MP preapproval_id (null until first payment)
  external_reference text not null unique,  -- our reference (e.g., "sub_abc123")
  status text not null default 'pending'
    check (status in ('pending','active','cancel_pending','past_due','cancelled','expired','paused','free')),
  current_price decimal(10,2) not null,
  currency text not null default 'ARS',
  billing_cycle_start timestamptz,          -- set by first payment webhook
  billing_cycle_end timestamptz,            -- set by first payment webhook
  cancel_at_period_end boolean not null default false,
  cancelled_externally boolean not null default false,
  cancelled_reason text,                    -- 'user_request' | 'downgrade_to_free' | 'payment_failure' | 'external'
  payment_retry_count int not null default 0,
  max_retries int not null default 3,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
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

-- Auto-update updated_at
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


-- ============================================================
-- SUBSCRIPTION DISCOUNTS
-- Cada descuento aplicado a una subscription tiene su propio registro.
-- Todo queda trazable: precio original, precio con descuento, monto,
-- fecha de expiracion, quien lo aplico.
-- ============================================================
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
  applied_by text,   -- 'admin', 'promotion', 'upgrade'
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_subscription_discounts_sub on public.subscription_discounts(subscription_id);
create index if not exists idx_subscription_discounts_active on public.subscription_discounts(discount_end_date)
  where status = 'active' and discount_end_date is not null;


-- ============================================================
-- SUBSCRIPTION TRANSACTIONS
-- Every payment received: initial, recurring, upgrades
-- ============================================================
create table if not exists public.subscription_transactions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  payment_id text not null,                 -- MP payment id
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

create index if not exists idx_transactions_subscription on public.subscription_transactions(subscription_id);
create index if not exists idx_transactions_payment on public.subscription_transactions(payment_id);
create index if not exists idx_transactions_status on public.subscription_transactions(status);
create index if not exists idx_transactions_date on public.subscription_transactions(paid_at desc);
create unique index if not exists idx_transactions_payment_unique on public.subscription_transactions(payment_id)
  where payment_id is not null;


-- ============================================================
-- SUBSCRIPTION EVENTS (Audit Log)
-- Every state change in a subscription's lifecycle
-- ============================================================
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  event_type text not null,
    -- 'created', 'activated', 'cancelled', 'cycle_cancelled',
    -- 'cancelled_externally', 'cancelled_due_to_payment_failure',
    -- 'upgraded', 'downgraded',
    -- 'payment_received', 'payment_failed', 'payment_recovered',
    -- 'discount_applied', 'discount_expired',
    -- 'discount_restore_failed',
    -- 'price_changed', 'paused', 'resumed',
    -- 'expired_unpaid', 'cancel_failed',
    -- 'cycle_ended_unpaid', 'payment_retry', 'retry_failed',
    -- 'downgrade_to_free_scheduled', 'cancel_scheduled',
    -- 'cancelled_immediate', 'downgraded_to_free'
  event_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_events_subscription on public.subscription_events(subscription_id);
create index if not exists idx_events_type on public.subscription_events(event_type);
create index if not exists idx_events_created on public.subscription_events(created_at desc);


-- ============================================================
-- WEBHOOK LOG (idempotencia + dead letter queue + retry)
-- Unica tabla para tracking de webhooks. Reemplaza webhook_failures
-- y webhook_idempotency. PK = idempotency_key.
-- Serverside: log received → return 200 → process async →
-- update to completed/failed. Si falla, un cron retry lo repite.
-- ============================================================
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
-- Cleanup completed/failed after 30 days
-- SELECT cron.schedule('cleanup-webhook-log', '0 3 * * 0',
--   $$DELETE FROM public.webhook_log WHERE status IN ('completed','failed') AND created_at < NOW() - INTERVAL '30 days'$$
-- );


-- ============================================================
-- CHECKOUT PREFERENCES (for tracking one-time upgrade charges)
-- ============================================================
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

create index if not exists idx_checkout_subscription on public.checkout_preferences(subscription_id);
create index if not exists idx_checkout_preference on public.checkout_preferences(preference_id);
create index if not exists idx_checkout_status on public.checkout_preferences(status);


-- ============================================================
-- RLS POLICIES
-- ============================================================
alter table public.subscriptions enable row level security;
alter table public.subscription_transactions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_discounts enable row level security;

create policy "Users can view own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can view own transactions"
  on public.subscription_transactions for select
  using (
    subscription_id in (
      select id from public.subscriptions where user_id = auth.uid()
    )
  );

create policy "Users can view own events"
  on public.subscription_events for select
  using (
    subscription_id in (
      select id from public.subscriptions where user_id = auth.uid()
    )
  );

create policy "Users can view own discounts"
  on public.subscription_discounts for select
  using (
    subscription_id in (
      select id from public.subscriptions where user_id = auth.uid()
    )
  );

-- Service role (Edge Functions) bypasses RLS
```
