# Schema: Suscripciones (core)

## subscriptions
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
```

## subscription_discounts
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
create index if not exists idx_subscription_discounts_sub on public.subscription_discounts(subscription_id);
create index if not exists idx_subscription_discounts_active on public.subscription_discounts(discount_end_date)
  where status = 'active' and discount_end_date is not null;
```

## subscription_transactions
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
create index if not exists idx_transactions_subscription on public.subscription_transactions(subscription_id);
create index if not exists idx_transactions_payment on public.subscription_transactions(payment_id);
create index if not exists idx_transactions_status on public.subscription_transactions(status);
create index if not exists idx_transactions_date on public.subscription_transactions(paid_at desc);
create unique index if not exists idx_transactions_payment_unique on public.subscription_transactions(payment_id)
  where payment_id is not null;
```

## subscription_events
```sql
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_events_subscription on public.subscription_events(subscription_id);
create index if not exists idx_events_type on public.subscription_events(event_type);
create index if not exists idx_events_created on public.subscription_events(created_at desc);
```

## auto-update trigger
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

## RLS
```sql
alter table public.subscriptions enable row level security;
alter table public.subscription_transactions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.subscription_discounts enable row level security;
```
