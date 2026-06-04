# Flow: Pagos One-Time (Checkout Pro)

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`schema-checkout-preferences.md`](schema-checkout-preferences.md) | La tabla checkout_preferences no está creada |
| [`api-endpoints.md`](api-endpoints.md) | Necesitás los endpoints de checkout/preferences |
| [`webhook-handlers.md`](webhook-handlers.md) | Necesitás el handler de payment webhook |

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
