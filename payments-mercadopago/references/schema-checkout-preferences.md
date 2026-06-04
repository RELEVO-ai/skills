# Schema: Checkout Preferences

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

create index if not exists idx_checkout_subscription on public.checkout_preferences(subscription_id);
create index if not exists idx_checkout_preference on public.checkout_preferences(preference_id);
create index if not exists idx_checkout_status on public.checkout_preferences(status);
```
