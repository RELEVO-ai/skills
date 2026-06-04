-- 003_subscription_transactions.sql — cada pago recibido (initial/recurring/upgrade). FK → subscriptions, discounts. Requiere 001, 002.
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

alter table public.subscription_transactions enable row level security;
create policy "Users can view own transactions"
  on public.subscription_transactions for select using (
    subscription_id in (select id from public.subscriptions where user_id = auth.uid())
  );
