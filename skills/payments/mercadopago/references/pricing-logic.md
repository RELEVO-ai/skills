# Pricing Logic: Proration, Upgrades, Downgrades & Discounts

## Discount Lifecycle

```
subscription_discounts (tabla trazable de descuentos)
  │
  ├── INSERT cuando se crea la sub con descuento
  │     { subscription_id, original_price, discounted_price, discount_amount,
  │       discount_end_date, status='active', applied_by }
  │
  ├── ¿upgrade mantiene descuento? (metadata.upgrade_keeps_discount)
  │     ├── Sí → INSERT nuevo discount con nuevo % sobre new_price, mismo end_date
  │     └── No → INSERT nada, descuento se pierde (el upgrade pagó full price)
  │
  └── Cron subscription_discount_end (diario):
        ├── Query discounts activos donde discount_end_date < NOW()
        ├── PUT /preapproval transaction_amount = original_price
        ├── UPDATE subscriptions current_price = original_price
        └── UPDATE subscription_discounts status = 'expired'
```

## Proration Flow (Upgrade)

```
PUT /preapproval/{id} { auto_recurring: { transaction_amount: newPrice } }
  │  MP ya cobrará newPrice el próximo ciclo
  │
  ├── Calcular proración:
  │     remainingMs = billing_cycle_end - now
  │     totalMs = billing_cycle_end - billing_cycle_start
  │     remainingRatio = remainingMs / totalMs
  │     priceDiff = newPrice - currentPrice
  │     prorated = ceil(remainingRatio * priceDiff)
  │
  ├── prorated > 0?
  │     ├── Sí → POST /checkout/preferences (unit_price = prorated)
  │     │         → Usuario paga la diferencia ahora
  │     └── No → upgrade gratuito (no cobro extra)
  │
  └── UPDATE subscriptions current_price = newPrice
```

## Proration Formula

Cuando un usuario cambia de plan a mitad de ciclo, calculamos el monto proporcional.

### Constants

```
cycle_total_seconds = billing_cycle_end - billing_cycle_start  (en segundos)
seconds_elapsed = now() - billing_cycle_start                   (en segundos)
seconds_remaining = billing_cycle_end - now()                   (en segundos)

daily_rate_old = old_price / cycle_total_days
daily_rate_new = new_price / cycle_total_days
```

### Upgrade: Cobro adicional

```
prorated_charge = ceil(seconds_remaining / cycle_total_seconds * new_price)
```

**Explicacion**: El usuario ya pago el ciclo completo al precio viejo. Le estamos cobrando el valor proporcional de lo que resta del ciclo al nuevo precio. No se descuenta lo ya pagado porque eso seria un reembolso.

Alternativamente (mas justo):

```
prorated_charge = ceil(
  (seconds_remaining / cycle_total_seconds) * (new_price - old_price)
)
```

Esta formula solo cobra la **diferencia** proporcional entre planes. Si el upgrade es de $10 a $20 a mitad de ciclo, solo cobra la mitad de $10 = $5.

**Elegir una formula y ser consistente**. Recomendamos la segunda (solo diferencia).

### Downgrade: Sin reembolso

```
No charge. No refund.
Just update transaction_amount to new_price for next cycle.
```

El usuario ya pago el ciclo completo al precio viejo. No se le reembolsa. El proximo ciclo se cobra al nuevo precio mas bajo.

---

## Discount Management

### Types of Discounts

| Type | Description | DB Fields |
|---|---|---|
| **Temporal** | Discount for N months, then auto-restore | `discount_end_date`, `discount_amount`, `original_price` |
| **First Payment** | Discount only on first charge | No special fields — set initial `transaction_amount` lower, cron restores after first payment |
| **Permanent** | Reduced price indefinitely | `original_price` != `current_price`, no `discount_end_date` |

### Creating a Discounted Subscription

```
1. original_price = 1000 (full price)
2. discount_amount = 200 (20% off)
3. current_price = 800 (what MP charges)
4. discount_end_date = "2025-12-31"

MP: PUT /preapproval/{id} { auto_recurring: { transaction_amount: 800 } }

On discount_end_date:
  Cron restores: PUT /preapproval/{id} { auto_recurring: { transaction_amount: 1000 } }
  Local: current_price = 1000, discount_amount = null, discount_end_date = null
```

### Discount + Upgrade/Downgrade Rules

El comportamiento depende de `subscription.metadata.upgrade_keeps_discount`:

#### upgrade_keeps_discount = true (default: false)

On upgrade:
```
1. Calculate proration based on new_price (full) - old_price (discounted)
2. Generate checkout preference for prorated amount
3. Update transaction_amount to new_price (but keep discount logic active)
4. Create a new discount for the new plan:
   - new_discounted_price = new_price * (1 - discount_percentage)
   - discount_end_date stays the same
5. On discount_end_date: restore from new_discounted_price to new_price
```

**Example**: User on Plan A ($10, at $5 with 50% off) upgrades to Plan B ($20)
```
- Proration: $5 difference * remaining_days_ratio
- New price in MP: $10 (50% of $20)
- discount_end_date: same as before
- At discount_end_date: restore to $20
```

#### upgrade_keeps_discount = false (default)

On upgrade:
```
1. Calculate proration based on new_price - current_price
2. Generate checkout preference for prorated amount
3. Update transaction_amount to new_price (FULL price, no discount)
4. Clear discount fields: discount_amount = null, discount_end_date = null
```

On downgrade:
```
1. If discount was on old plan → discount is lost
2. transaction_amount = new_price (no discount applied unless the new plan has its own discount)
3. Clear discount fields
```

---

## Full Upgrade Flow (Step by Step)

```
1. User requests upgrade from Plan A ($10/mo) to Plan B ($20/mo)
2. SYSTEM calculates:
   - Cycle: 30 days total, 10 elapsed, 20 remaining
   - proration = 20/30 * ($20 - $10) = $6.67
   - Or if upgrade_keeps_discount=true and Plan A had 50% off:
     - Current paying: $5
     - proration = 20/30 * ($20 - $5) = $10
     - New paying: $10 (50% of $20 with same discount)
3. Create Checkout Preference:
   - items[0].unit_price = proration (e.g., $6.67)
   - items[0].title = "Upgrade to Plan B (prorated)"
   - external_reference = subscription.id
   - notification_url = WEBHOOK_URL
   - metadata.checkout_type = "upgrade"
   - metadata.new_plan_id = "plan_b"
   - metadata.new_price = 20
4. If user pays (webhook payment approved):
   a. Update MP subscription price: PUT /preapproval/{id} {
        auto_recurring: { transaction_amount: 20 }
      }
   b. Update local subscription:
      - current_price = 20
      - status = 'active'
   c. Insert subscription_transactions:
      - type = 'upgrade'
      - amount = 6.67
   d. Insert subscription_events:
      - event_type = 'upgraded'
5. If user does NOT pay → no changes, still on Plan A
```

---

## Full Downgrade Flow (Paid → Paid)

```
1. User requests downgrade from Plan B ($20/mo) to Plan A ($10/mo)
2. NO proration charge, NO refund
3. Update MP subscription price: PUT /preapproval/{id} {
     auto_recurring: { transaction_amount: 10 }
   }
4. Update local:
   - current_price = 10
   - original_price = 10 (if discount was lost)
   - discount_amount = null
   - discount_end_date = null
5. Insert subscription_events:
   - event_type = 'downgraded'
6. Next billing cycle: MP charges $10
```

## Full Downgrade Flow (Paid → Free)

**CRITICAL**: Cuando el usuario baja a un plan gratuito (sin cobro), NO podemos simplemente actualizar el precio a $0. Necesitamos cancelar la subscription en MP **antes del proximo billing_cycle_end**, porque:
- MP no permite `transaction_amount = 0` en auto_recurring
- Si no cancelamos, MP va a cobrar el monto anterior al llegar billing_cycle_end

La solucion es reutilizar el mismo mecanismo de cancelacion, solo cambia la `cancelled_reason`:

```
1. User requests downgrade from Plan B ($20/mo) to Free
2. NO charge, NO refund
3. cancel(subscriptionId, reason='downgrade_to_free')
   → status = 'cancel_pending'
   → cancelled_reason = 'downgrade_to_free'
   → cancel_at_period_end = true
4. Cron subscription_cycle_cancel detecta 24h antes de billing_cycle_end:
   a. PUT /preapproval/{id} { status: 'canceled' }
   b. UPDATE subscriptions SET status = 'cancelled' WHERE id = sub.id
   c. subscription_events.insert(event_type = 'downgraded_to_free')
5. Usuario mantiene acceso hasta billing_cycle_end (la cancelacion en MP
   no revoca acceso inmediato, solo evita el proximo cobro)
6. billing_cycle_end: subscription ya esta cancelada en MP, NO hay cobro
7. Opcional: sistema local puede crear un subscription en plan free tier
   (status = 'free', current_price = 0, sin preapproval_id)
```

**IMPORTANTE**: La cancelacion en MP debe ocurrir **24h antes** de billing_cycle_end para asegurar que MP no procese el cobro. El cron `subscription_cycle_cancel` usa `status = 'cancel_pending'` + `billing_cycle_end < NOW() + INTERVAL '24 hours'` como filtro.

---

## Edge Cases

### User upgrades then immediately downgrades
- First: upgrade flow runs (charge proration)
- Second: downgrade runs (update price, no refund)
- User loses the upgrade proration paid — this is intentional (no refunds on downgrade)

### Discount expires while user is past_due
- Cron discount_end should still run to restore price
- When user pays and recovers, they pay the restored (full) price
- This prevents "locked in" discounted prices during payment failure periods

### Free trial
- Implemented via `free_trial` in `auto_recurring` at plan level
- Or manually: create subscription with `current_price = 0`, cron activates full price after trial period
- Pros/cons:
  - MP native `free_trial`: simpler, MP handles timing
  - Manual: more control, can handle upgrades during trial

### Payment failure during discount period
- Discount period keeps running even if payment fails
- If payment recovers after discount expired → full price
- If payment recovers before discount expires → discounted price (catch-up payment)

### Multiple upgrades in same cycle
- Each upgrade charges proration from the previous upgrade date
- Example: Day 0-10: Plan A ($10). Day 10: Upgrade to Plan B ($20), pay $X. Day 20: Upgrade to Plan C ($30), pay $Y.
- Y = (10 remaining days / 30) * ($30 - $20) = $3.33

### Changing billing frequency (monthly → annual)
- Not supported via `PUT /preapproval` (frequency is immutable)
- Must: cancel current subscription at period end → create new plan with annual frequency → user re-subscribes
- This is a product decision: offer an incentive for annual to offset the friction
