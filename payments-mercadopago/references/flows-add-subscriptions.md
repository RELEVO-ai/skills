# Flow: Agregar Suscripciones a un Producto

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`schema-subscriptions-core.md`](schema-subscriptions-core.md) | La DB de suscripciones no está creada |
| [`schema-checkout-preferences.md`](schema-checkout-preferences.md) | Necesitás la tabla de proración/upgrades |
| [`api-endpoints.md`](api-endpoints.md) | Necesitás los endpoints exactos de MP |
| [`cron-jobs.md`](cron-jobs.md) | Necesitás deployar o debuggear crons |
| [`checkout-flow.md`](checkout-flow.md) | Necesitás el detalle de create/upgrade/downgrade/cancel |
| [`pricing-logic.md`](pricing-logic.md) | Necesitás fórmulas de proración o reglas de descuento |
| [`webhook-handlers.md`](webhook-handlers.md) | Necesitás los handlers de webhook o el código TypeScript |

## Pasos (DB ya creada)

1. Setear secrets:
```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
supabase secrets set MP_WEBHOOK_SECRET=your_webhook_secret
supabase secrets set APP_URL=https://your-app.com
supabase secrets set WEBHOOK_URL=https://project.supabase.co/functions/v1
```

2. Deploy Edge Functions:
```bash
supabase functions deploy webhook-entry --no-verify-jwt
supabase functions deploy cron-cycle-cancel --no-verify-jwt
supabase functions deploy cron-cycle-end --no-verify-jwt
supabase functions deploy cron-discount-end --no-verify-jwt
supabase functions deploy cron-unpaid-cleanup --no-verify-jwt
supabase functions deploy cron-retry-payment --no-verify-jwt
```

3. Configurar crons en pg_cron (SQL en Supabase):
```sql
SELECT cron.schedule('subscription-cycle-cancel',  '5 0 * * *',    $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-cancel',    headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-cycle-end',     '0 0 * * *',    $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-cycle-end',     headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-discount-end',  '10 0 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-discount-end',  headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-unpaid-cleanup','0 */6 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-unpaid-cleanup',headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
SELECT cron.schedule('subscription-retry-payment', '0 12 * * *',   $$SELECT net.http_post(url:='https://project.supabase.co/functions/v1/cron-retry-payment', headers:='{"Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb)$$);
```

4. Configurar webhooks en [Tus integraciones](https://mercadopago.com.ar/developers/panel/app):
- URL: `https://project.supabase.co/functions/v1/webhook-entry`
- Topics: `payment`, `subscription_preapproval`, `subscription_authorized_payment`, `subscription_preapproval_plan`

5. Crear plan:
```bash
bash scripts/create-preapproval-plan.sh \
  --reason "Premium Mensual" \
  --amount 1000 \
  --external-ref "sub_$(uuidgen | tr -d - | head -c 12)"
```
→ redirect a `init_point` → webhook confirma → activar
