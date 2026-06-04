-- 001_subscriptions.sql — tabla core del ciclo de vida.
-- Correr en orden 001→006 (hay FKs). Copiar al SQL Editor de Supabase o psql -f.
-- billing_cycle_start/end se setean con el primer payment webhook, no al crear.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  product_id text not null,
  plan_id text not null,                    -- MP preapproval_plan_id
  preapproval_id text,                      -- MP preapproval_id (null hasta el primer pago)
  external_reference text not null unique,  -- nuestra referencia (e.g., "sub_abc123")
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
  for each row execute function public.update_subscriptions_updated_at();

-- RLS
alter table public.subscriptions enable row level security;
create policy "Users can view own subscriptions"
  on public.subscriptions for select using (auth.uid() = user_id);
-- Service role (Edge Functions) bypasses RLS.
