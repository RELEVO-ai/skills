# Flow: Agregar Suscripciones a un Producto

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`../../migrations/`](../../migrations/) (`001`–`004`) | La DB de suscripciones no está creada (subscriptions + discounts + transactions + events) |
| [`../../migrations/005_checkout_preferences.sql`](../../migrations/005_checkout_preferences.sql) | Necesitás la tabla de proración/upgrades |
| [`../api/response-fields.md`](../api/response-fields.md) | Necesitás qué devuelve un GET de MP |
| [`../api/endpoints.md`](../api/endpoints.md) | Necesitás un endpoint sin script (plan get/update, etc.) |
| [`../crons.md`](../crons.md) | Necesitás deployar o debuggear crons |
| [`../../templates/subscription-service.ts`](../../templates/subscription-service.ts) | Necesitás el código de create/upgrade/downgrade/cancel |
| [`../pricing.md`](../pricing.md) | Necesitás fórmulas de proración o reglas de descuento |
| [`../handlers.md`](../handlers.md) | Necesitás los handlers de webhook o su código |

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

3. Configurar crons (pg_cron) → ver [`../crons.md`](../crons.md).

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
