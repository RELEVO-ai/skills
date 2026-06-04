# Flow: Pagos One-Time (Checkout Pro)

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`../../migrations/005_checkout_preferences.sql`](../../migrations/005_checkout_preferences.sql) | La tabla checkout_preferences no está creada (requiere `001`) |
| [`../api/response-fields.md`](../api/response-fields.md) | Necesitás qué devuelve payment/preference |
| [`../handlers.md`](../handlers.md) | Necesitás el handler de payment webhook |

## Pasos

1. Setear secret:
```bash
supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
```

2. Deploy webhook function:
```bash
supabase functions deploy webhook-entry --no-verify-jwt
```

3. Configurar webhook en MP (topic: `payment`) apuntando a `webhook-entry`

4. Crear preferencia:
```bash
bash scripts/create-checkout-preference.sh \
  --title "Producto" \
  --amount 1000 \
  --external-ref "order_abc123" \
  --notification-url "https://project.supabase.co/functions/v1/webhook-entry" \
  --success-url "https://mysite.com/success" \
  --failure-url "https://mysite.com/failure"
```

5. Insertar `checkout_preferences` local con `preference_id` e `init_point`
6. Redirigir usuario a `init_point`
7. Webhook `payment` → enrich con `GET /v1/payments/{id}` → match por `external_reference` → update status
