-- 002_subscription_discounts.sql — descuentos trazables (FK → subscriptions). Requiere 001.
-- Cada descuento aplicado tiene su registro: precio original, con descuento, monto, expiración, quién.
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

alter table public.subscription_discounts enable row level security;
create policy "Users can view own discounts"
  on public.subscription_discounts for select using (
    subscription_id in (select id from public.subscriptions where user_id = auth.uid())
  );
