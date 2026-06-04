-- 006_webhook_log.sql — idempotencia + dead letter queue + retry en una tabla. Sin FK.
-- PK = idempotency_key = "{type}:{action}:{data.id}:{notification_id}".
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

create index if not exists idx_webhook_log_retry on public.webhook_log(next_retry_at, retry_count)
  where status = 'received' and retry_count < max_retries and next_retry_at is not null;
create index if not exists idx_webhook_log_status on public.webhook_log(status);
