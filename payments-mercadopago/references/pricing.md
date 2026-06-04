# Pricing: proración, descuentos, edge cases

Matemática y reglas de precios. Las operaciones que las usan (upgrade/downgrade) son código: `upgrade()`/`downgrade()` en [`../templates/subscription-service.ts`](../templates/subscription-service.ts). Calculadora: [`../templates/pricing-calculator.ts`](../templates/pricing-calculator.ts).

## Proración (upgrade)

Cuando un usuario sube de plan a mitad de ciclo, cobramos el monto proporcional de lo que resta.

```
cycle_total_seconds = billing_cycle_end - billing_cycle_start
seconds_remaining   = billing_cycle_end - now()
```

Dos fórmulas posibles — **elegí una y sé consistente**:
```
# A) Proporcional al precio nuevo completo
prorated = ceil( seconds_remaining / cycle_total_seconds * new_price )

# B) Solo la DIFERENCIA proporcional  ← RECOMENDADA
prorated = ceil( seconds_remaining / cycle_total_seconds * (new_price - old_price) )
```
B solo cobra la diferencia: upgrade de $10→$20 a mitad de ciclo = mitad de $10 = $5. No se descuenta lo ya pagado (sería un reembolso).

**Downgrade: sin reembolso.** Solo actualizar `transaction_amount` al `new_price` para el próximo ciclo. El usuario ya pagó el ciclo al precio viejo.

## Descuentos

Trazables en `subscription_discounts` (ver [`../migrations/002_subscription_discounts.sql`](../migrations/002_subscription_discounts.sql)). Se insertan al crear la sub con descuento y los restaura el cron `discount_end` al vencer `discount_end_date` (ver [`crons.md`](crons.md)).

| Tipo | Descripción | Campos |
|---|---|---|
| Temporal | descuento N meses, luego auto-restaura | `discount_end_date`, `discount_amount`, `original_price` |
| First Payment | solo el primer cobro | `transaction_amount` inicial menor, cron restaura tras el 1er pago |
| Permanente | precio reducido indefinido | `original_price != current_price`, sin `discount_end_date` |

Crear con descuento: `original_price=1000, discount_amount=200 (20%), current_price=800` → MP cobra 800; en `discount_end_date` el cron restaura a 1000.

**Descuento + upgrade/downgrade** — depende de `metadata.upgrade_keeps_discount` (default `false`):
- **`true`**: proración sobre `new_price(full) - old_price(discounted)`; `transaction_amount = new_price * (1 - discount%)`, mismo `discount_end_date`; INSERT nuevo discount. Ej: Plan A ($10, a $5 con 50% off) → B ($20): MP $10, al expirar → $20.
- **`false`**: se **pierde** el descuento; `transaction_amount = new_price` full y se limpian los campos.

## Edge cases

- **Upgrade y luego downgrade inmediato**: corre upgrade (cobra proración), después downgrade (sin reembolso). Se pierde la proración pagada — intencional.
- **Descuento expira durante `past_due`**: el cron `discount_end` igual restaura. Al recuperar el pago, paga el precio full.
- **Free trial**: vía `free_trial` en `auto_recurring` (MP maneja timing) o manual (`current_price=0`, cron activa full tras el trial).
- **Pago falla en período de descuento**: el descuento sigue corriendo. Recupera después de expirado → full; antes → con descuento (catch-up).
- **Múltiples upgrades en el mismo ciclo**: cada uno cobra proración desde el upgrade anterior. Ej: día 20 B→C → `(10/30)*($30-$20)=$3.33`.
- **Cambiar frecuencia (mensual → anual)**: NO vía `PUT /preapproval` (`frequency` inmutable). Cancelar a fin de ciclo → crear plan anual → re-suscribir.
