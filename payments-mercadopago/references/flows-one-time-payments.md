# Flow: Pagos One-Time (Checkout Pro)

## Prerequisitos

| Recurso | Cargar si... |
|---------|-------------|
| [`database-schema.md`](database-schema.md) | Necesitás la tabla checkout_preferences |
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
```
POST /checkout/preferences
{
  "items": [{
    "title": "Producto",
    "quantity": 1,
    "unit_price": 1000.00,
    "currency_id": "ARS"
  }],
  "external_reference": "order_abc123",
  "notification_url": "https://project.supabase.co/functions/v1/webhook-entry",
  "back_urls": { "success": "...", "failure": "...", "pending": "..." },
  "auto_return": "approved"
}
```

5. Insertar `checkout_preferences` local con `preference_id` e `init_point`
6. Redirigir usuario a `init_point`
7. Webhook `payment` → enrich con `GET /v1/payments/{id}` → match por `external_reference` → update status
