# MP API — Response Fields

Qué devuelve cada GET (lo que los scripts NO documentan). Para **ejecutar** las llamadas usá `scripts/*.sh` (`--help`), no reconstruyas curls.

## GET /preapproval/{id} → `get-preapproval.sh`
- `status`: authorized / canceled / paused / pending
- `external_reference`, `preapproval_plan_id`
- `auto_recurring.transaction_amount`: precio actual
- `next_payment_date`: próximo cobro
- `summarized.charged_quantity`: cobros hechos
- `payer_id`, `payment_method_id`, `card_id`

## GET /authorized_payments/{id} → `get-authorized-payment.sh`
- `status`: scheduled / processed / recycling / canceled (estado del cobro programado)
- `payment.status`: approved / rejected / canceled / refunded (**resultado real**)
- `transaction_amount`, `payment.id`, `date_created`
- `preapproval_id`, `reason`, `external_reference`

## GET /v1/payments/{id} → `get-payment.sh`
Crítico para enriquecer webhooks:
- `status`: approved / rejected / in_process / canceled / refunded / charged_back
- `status_detail`, `transaction_amount`
- `payment_method_id` (visa/master/amex…), `payment_type_id` (credit_card/debit_card…)
- `installments`, `issuer_id`
- `card`: `{ last_four_digits, cardholder.name, expiration_month, expiration_year }`
- `payer`: `{ email, id, identification }`
- `external_reference`, `date_approved`, `date_created`, `fee_details`, `refunds`

## Respuestas de creación
- `POST /preapproval_plan` (`create-preapproval-plan.sh`) → `id` = `preapproval_plan_id`
- `POST /checkout/preferences` (`create-checkout-preference.sh`) → `id`, `init_point` (redirect), `sandbox_init_point`
