// Webhook handlers — lógica de procesamiento por topic.
// Entry point + routing: templates/webhook-entry.ts
// Docs: references/handlers.md
import crypto from 'node:crypto'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
// mpApi: helper GET/PUT contra MP API. Subscription: tipo de fila.

// --- HMAC x-signature ---
// header: ts=1704908010,v1=618c85345...
export function validateSignature(xSignature: string, xRequestId: string, dataId: string, secret: string): boolean {
  let ts = '', hash = ''
  for (const part of xSignature.split(',')) {
    const [key, value] = part.split('=')
    if (key?.trim() === 'ts') ts = value?.trim()
    if (key?.trim() === 'v1') hash = value?.trim()
  }
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  return computed === hash
}

// --- idempotency ---
export async function check_idempotency(supabase: SupabaseClient, type: string, action: string, dataId: string, notificationId: number): Promise<boolean> {
  const key = `${type}:${action}:${dataId}:${notificationId}`
  const { data: existing } = await supabase.from('webhook_log').select('idempotency_key').eq('idempotency_key', key).maybeSingle()
  if (existing) return true
  await supabase.from('webhook_log').insert({ idempotency_key: key, topic: type, resource_id: dataId, status: 'received' })
  return false
}

// --- handler: payment ---
export async function handle_payment(paymentId: string, supabase: SupabaseClient, mpToken: string) {
  const payment = await mpApi.get(`/v1/payments/${paymentId}`, mpToken)
  const enriched = {
    payment_id: payment.id, status: payment.status, status_detail: payment.status_detail,
    transaction_amount: payment.transaction_amount, payment_method: payment.payment_method_id,
    payment_type: payment.payment_type_id, card_last_four: payment.card?.last_four_digits,
    card_holder_name: payment.card?.cardholder?.name, installments: payment.installments,
    issuer_id: payment.issuer_id, external_reference: payment.external_reference,
    payer_email: payment.payer?.email, payer_id: payment.payer?.id, date_approved: payment.date_approved,
    fee_details: payment.fee_details, metadata: {},
  }
  const { data: subscription } = await supabase.from('subscriptions').select('*').eq('external_reference', enriched.external_reference).maybeSingle()
  if (!subscription) { await handle_one_time_payment(enriched, supabase); return }

  const type = determine_transaction_type(subscription, enriched)
  await supabase.from('subscription_transactions').insert({
    subscription_id: subscription.id, payment_id: enriched.payment_id, amount: enriched.transaction_amount,
    currency: 'ARS', status: enriched.status, payment_method: enriched.payment_method,
    card_last_four: enriched.card_last_four, card_holder_name: enriched.card_holder_name,
    installments: enriched.installments, type, metadata: enriched,
    paid_at: enriched.date_approved || new Date().toISOString(),
  })
  switch (enriched.status) {
    case 'approved': await subscription_payment_succeeded(subscription, enriched, supabase); break
    case 'rejected': case 'canceled': case 'charged_back': await subscription_payment_failed(subscription, enriched, supabase); break
    case 'refunded': await handle_refund(subscription, enriched, supabase); break
  }
}

// --- handler: preapproval (incl. cancelación externa) ---
export async function handle_preapproval(preapprovalId: string, action: string, supabase: SupabaseClient, mpToken: string) {
  const preapproval = await mpApi.get(`/preapproval/${preapprovalId}`, mpToken)
  const { data: subscription } = await supabase.from('subscriptions').select('*').eq('external_reference', preapproval.external_reference).maybeSingle()
  if (!subscription) return

  const wasActive = subscription.status === 'active' || subscription.status === 'cancel_pending'
  const isNowCancelled = preapproval.status === 'canceled'
  const weInitiated = subscription.cancel_at_period_end || subscription.status === 'cancel_pending'
  const statusMap: Record<string, string> = { authorized: 'active', canceled: 'cancelled', paused: 'paused', pending: 'pending' }
  const externalCancel = wasActive && isNowCancelled && !weInitiated

  await supabase.from('subscriptions').update({
    preapproval_id: preapproval.id,
    status: statusMap[preapproval.status] || subscription.status,
    current_price: preapproval.auto_recurring?.transaction_amount || subscription.current_price,
    billing_cycle_end: preapproval.next_payment_date || subscription.billing_cycle_end,
    cancelled_externally: externalCancel,
    cancelled_reason: externalCancel ? 'external' : subscription.cancelled_reason,
    cancel_at_period_end: isNowCancelled ? false : subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }).eq('id', subscription.id)

  if (externalCancel) {
    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id, event_type: 'cancelled_externally', event_data: { preapproval, action },
    })
  }
}

// --- handler: authorized_payment (cobro recurrente) ---
export async function handle_authorized_payment(authorizedPaymentId: string, supabase: SupabaseClient, mpToken: string) {
  const authPayment = await mpApi.get(`/authorized_payments/${authorizedPaymentId}`, mpToken)
  const { data: subscription } = await supabase.from('subscriptions').select('*').eq('preapproval_id', authPayment.preapproval_id).maybeSingle()
  if (!subscription) return

  // payment.status es source of truth (approved/rejected/canceled/refunded); authPayment.status es scheduled/processed/recycling/canceled
  const paymentStatus = authPayment.payment?.status
  const isApproved = paymentStatus === 'approved'
  const isExplicitFailure = paymentStatus === 'rejected' || paymentStatus === 'canceled' || authPayment.status === 'canceled'

  let payment = null
  if (authPayment.payment?.id && !paymentStatus) payment = await mpApi.get(`/v1/payments/${authPayment.payment.id}`, mpToken)

  if (paymentStatus) {
    await supabase.from('subscription_transactions').insert({
      subscription_id: subscription.id, payment_id: authPayment.payment?.id ?? payment?.id,
      amount: authPayment.transaction_amount, currency: 'ARS', status: isApproved ? 'approved' : 'rejected',
      payment_method: payment?.payment_method_id, card_last_four: payment?.card?.last_four_digits,
      type: 'recurring', metadata: { authorized_payment: authPayment, payment }, paid_at: authPayment.date_created,
    })
  }
  if (isApproved) {
    await subscription_payment_succeeded(subscription, { transaction_amount: authPayment.transaction_amount, payment_id: authPayment.payment?.id }, supabase)
  } else if (isExplicitFailure) {
    await subscription_payment_failed(subscription, { status: paymentStatus, payment_id: authPayment.payment?.id, authorized_payment_id: authPayment.id }, supabase)
  }
  // scheduled/recycling: MP auto-retry, no action
}

// --- outcome: succeeded ---
export async function subscription_payment_succeeded(subscription: any, data: any, supabase: SupabaseClient) {
  const isInitialPayment = subscription.status === 'pending'
  const cycleLengthMs = new Date(subscription.billing_cycle_end).getTime() - new Date(subscription.billing_cycle_start).getTime()
  const nextCycleEnd = new Date(new Date(subscription.billing_cycle_end).getTime() + cycleLengthMs)
  const updates: any = {
    status: 'active', updated_at: new Date().toISOString(),
    billing_cycle_end: nextCycleEnd.toISOString(), billing_cycle_start: subscription.billing_cycle_end,
  }
  if (isInitialPayment) updates.preapproval_id = data.preapproval_id
  await supabase.from('subscriptions').update(updates).eq('id', subscription.id)
  await supabase.from('subscription_events').insert({
    subscription_id: subscription.id, event_type: isInitialPayment ? 'activated' : 'payment_received', event_data: data,
  })
}

// --- outcome: failed (retry → past_due → cancel) ---
export async function subscription_payment_failed(subscription: any, data: any, supabase: SupabaseClient) {
  const retryCount = (subscription.payment_retry_count || 0) + 1
  const maxRetries = subscription.max_retries || 3
  const reachedMax = retryCount >= maxRetries
  await supabase.from('subscriptions').update({
    status: reachedMax ? 'cancelled' : 'past_due', payment_retry_count: retryCount, updated_at: new Date().toISOString(),
  }).eq('id', subscription.id)
  await supabase.from('subscription_events').insert({
    subscription_id: subscription.id,
    event_type: reachedMax ? 'cancelled_due_to_payment_failure' : 'payment_failed',
    event_data: { ...data, retry_count: retryCount, max_retries: maxRetries },
  })
  // notify_user(subscription.user_id, reachedMax ? 'subscription_cancelled' : 'payment_failed', { retry_count: retryCount })
}

// --- helper ---
export function determine_transaction_type(subscription: any, payment: any): string {
  if (subscription.status === 'pending') return 'initial'
  if (payment.metadata?.checkout_type === 'upgrade') return 'upgrade'
  if (payment.metadata?.checkout_type === 'downgrade') return 'downgrade'
  return 'recurring'
}

// --- handler: checkout preference payment (upgrade proration) ---
// Doc: references/handlers.md (checkout_payment)
export async function handle_checkout_payment(paymentId: string, supabase: SupabaseClient, mpToken: string) {
  const payment = await mpApi.get(`/v1/payments/${paymentId}`, mpToken)
  const { data: checkoutPref } = await supabase
    .from('checkout_preferences').select('*').eq('external_reference', payment.external_reference).maybeSingle()
  if (!checkoutPref) return // posible compra one-time estándar

  await supabase.from('checkout_preferences').update({
    status: payment.status === 'approved' ? 'approved' : 'rejected', updated_at: new Date().toISOString(),
  }).eq('id', checkoutPref.id)
  if (payment.status !== 'approved') return

  switch (checkoutPref.type) {
    case 'upgrade': {
      const metadata = checkoutPref.metadata
      await supabase.from('subscriptions').update({ current_price: metadata.new_price, updated_at: new Date().toISOString() }).eq('id', checkoutPref.subscription_id)
      await supabase.from('subscription_events').insert({ subscription_id: checkoutPref.subscription_id, event_type: 'upgrade_payment_received', event_data: metadata })
      break
    }
    case 'one_time':
      // await handle_one_time_purchase(payment, supabase)
      break
  }
}
