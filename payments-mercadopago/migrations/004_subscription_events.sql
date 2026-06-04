-- 004_subscription_events.sql — audit log de cada cambio de estado. FK → subscriptions. Requiere 001.
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

alter table public.subscription_events enable row level security;
create policy "Users can view own events"
  on public.subscription_events for select using (
    subscription_id in (select id from public.subscriptions where user_id = auth.uid())
  );
