// webhook-entry.ts — Supabase Edge Function
// Unico entry point para todos los webhooks de Mercado Pago
// Log received → return 200 → process async → update webhook_log
// Deploy: supabase functions deploy webhook-entry --no-verify-jwt

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { addMonth } from '../utils/dates.ts';

interface WebhookPayload {
  id: number;
  live_mode: boolean;
  type: string;
  date_created: string;
  user_id: number;
  api_version: string;
  action: string;
  data: { id: string };
}

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body: WebhookPayload = await req.json();

    // HMAC validation
    const xSignature = req.headers.get('x-signature');
    const xRequestId = req.headers.get('x-request-id');
    const webhookSecret = Deno.env.get('MP_WEBHOOK_SECRET');

    const url = new URL(req.url);
    const dataId = (url.searchParams.get('data.id') || url.searchParams.get('id') || String(body.data.id)).toLowerCase();

    if (!await validateSignature(xSignature, xRequestId, dataId, webhookSecret)) {
      console.error('HMAC validation failed', { notificationId: body.id });
      return new Response('Unauthorized', { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN')!;
    const idempotencyKey = `${body.type}:${body.action}:${body.data.id}:${body.id}`;

    // Idempotency check via webhook_log
    const { data: existing } = await supabase
      .from('webhook_log')
      .select('status')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing) {
      console.log('Duplicate webhook, skipping', { key: idempotencyKey });
      return new Response('OK (duplicate)', { status: 200 });
    }

    // Log received
    await supabase.from('webhook_log').insert({
      idempotency_key: idempotencyKey,
      topic: body.type,
      resource_id: body.data.id,
      status: 'received',
      original_payload: body,
      headers: { 'x-signature': xSignature, 'x-request-id': xRequestId },
    });

    // Return 200 immediately, process async
    console.log('Webhook acknowledged', { type: body.type, id: body.id });

    processWebhook(body, idempotencyKey, supabase, mpToken).catch(err => {
      console.error('Async webhook processing failed', { type: body.type, error: err.message });
    });

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Webhook entry error', { error: error.message });
    return new Response('OK', { status: 200 });
  }
});

// ====================================================
// Async processing (runs after 200 is returned)
// ====================================================
async function processWebhook(
  body: WebhookPayload,
  idempotencyKey: string,
  supabase: any,
  mpToken: string,
): Promise<void> {
  try {
    await supabase.from('webhook_log').update({
      status: 'processing',
    }).eq('idempotency_key', idempotencyKey);

    switch (body.type) {
      case 'payment':
        await handlePayment(body.data.id, supabase, mpToken);
        break;
      case 'subscription_preapproval':
        await handlePreapproval(body.data.id, body.action, supabase, mpToken);
        break;
      case 'subscription_authorized_payment':
        await handleAuthorizedPayment(body.data.id, supabase, mpToken);
        break;
      case 'subscription_preapproval_plan':
        await handlePreapprovalPlan(body.data.id, supabase, mpToken);
        break;
      default:
        console.log('Unknown webhook type', { type: body.type });
    }

    await supabase.from('webhook_log').update({
      status: 'completed',
      success: true,
      processed_at: new Date().toISOString(),
    }).eq('idempotency_key', idempotencyKey);

  } catch (error) {
    console.error('Webhook processing error', { type: body.type, error: error.message });

    const { data: log } = await supabase
      .from('webhook_log')
      .select('retry_count, max_retries')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    const retryCount = (log?.retry_count || 0) + 1;
    const maxRetries = log?.max_retries || 3;
    const shouldRetry = retryCount < maxRetries;

    await supabase.from('webhook_log').update({
      status: shouldRetry ? 'received' : 'failed',
      success: false,
      error_message: error.message,
      retry_count: retryCount,
      next_retry_at: shouldRetry
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null,
      last_attempt_at: new Date().toISOString(),
    }).eq('idempotency_key', idempotencyKey);
  }
}

// ====================================================
// HMAC Validation
// ====================================================
async function validateSignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!xSignature || !xRequestId || !secret) return false;

  const parts = xSignature.split(',');
  let ts = '';
  let hash = '';

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key?.trim() === 'ts') ts = value?.trim() ?? '';
    if (key?.trim() === 'v1') hash = value?.trim() ?? '';
  }

  if (!ts || !hash) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const keyBytes = new TextEncoder().encode(secret);
  const manifestBytes = new TextEncoder().encode(manifest);

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const computed = await crypto.subtle.sign({ name: 'HMAC', hash: 'SHA-256' }, key, manifestBytes);

  const computedHex = Array.from(new Uint8Array(computed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computedHex === hash;
}

// ====================================================
// MP API Helpers
// ====================================================
async function mpApiGet(path: string, token: string): Promise<any> {
  const res = await fetch(`https://api.mercadopago.com${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`MP API ${res.status}: ${error}`);
  }
  return res.json();
}

// ====================================================
// Handlers
// ====================================================

async function handlePayment(paymentId: string, supabase: any, mpToken: string) {
  const payment = await mpApiGet(`/v1/payments/${paymentId}`, mpToken);

  const enriched = {
    payment_id: payment.id,
    status: payment.status,
    status_detail: payment.status_detail,
    transaction_amount: payment.transaction_amount,
    payment_method: payment.payment_method_id,
    payment_type: payment.payment_type_id,
    card_last_four: payment.card?.last_four_digits,
    card_holder_name: payment.card?.cardholder?.name,
    installments: payment.installments,
    external_reference: payment.external_reference,
    payer_email: payment.payer?.email,
    payer_id: payment.payer?.id,
    date_approved: payment.date_approved,
    fee_details: payment.fee_details,
  };

  // Find checkout preference by external_reference (upgrade payments)
  const { data: checkoutPref } = await supabase
    .from('checkout_preferences')
    .select('*')
    .eq('external_reference', enriched.external_reference)
    .maybeSingle();

  if (checkoutPref) {
    await supabase.from('checkout_preferences').update({
      status: enriched.status === 'approved' ? 'approved' : 'rejected',
      updated_at: new Date().toISOString(),
    }).eq('id', checkoutPref.id);

    if (checkoutPref.type === 'upgrade' && enriched.status === 'approved') {
      await supabase.from('subscriptions').update({
        current_price: checkoutPref.metadata.new_price,
        updated_at: new Date().toISOString(),
      }).eq('id', checkoutPref.subscription_id);
    }
  }

  // Find subscription by external_reference for transaction logging
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('external_reference', enriched.external_reference)
    .maybeSingle();

  if (!subscription) return;

  const paidAt = enriched.date_approved || new Date().toISOString();

  await supabase.from('subscription_transactions').insert({
    subscription_id: subscription.id,
    payment_id: enriched.payment_id,
    amount: enriched.transaction_amount,
    currency: 'ARS',
    status: enriched.status,
    payment_method: enriched.payment_method,
    card_last_four: enriched.card_last_four,
    card_holder_name: enriched.card_holder_name,
    installments: enriched.installments,
    type: subscription.status === 'pending' ? 'initial' : 'recurring',
    fee_details: enriched.fee_details,
    metadata: enriched,
    paid_at: paidAt,
  });

  if (enriched.status === 'approved' && subscription.status === 'pending') {
    await supabase.from('subscriptions').update({
      status: 'active',
      billing_cycle_start: paidAt,
      billing_cycle_end: addMonth(new Date(paidAt)).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', subscription.id);

    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: 'activated',
      event_data: { payment_id: enriched.payment_id, paid_at: paidAt },
    });
  }

  const isFailedStatus = ['rejected', 'canceled', 'charged_back'].includes(enriched.status);
  if (isFailedStatus) {
    if (subscription.status !== 'pending') {
      const retryCount = (subscription.payment_retry_count || 0) + 1;
      await supabase.from('subscriptions').update({
        status: retryCount >= (subscription.max_retries || 3) ? 'cancelled' : 'past_due',
        payment_retry_count: retryCount,
        updated_at: new Date().toISOString(),
      }).eq('id', subscription.id);
    }
  }
}

async function handlePreapproval(preapprovalId: string, action: string, supabase: any, mpToken: string) {
  const preapproval = await mpApiGet(`/preapproval/${preapprovalId}`, mpToken);

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('external_reference', preapproval.external_reference)
    .maybeSingle();

  if (!subscription) {
    console.warn('No subscription for external_reference', {
      externalReference: preapproval.external_reference,
    });
    return;
  }

  const wasActive = subscription.status === 'active' || subscription.status === 'cancel_pending';
  const isNowCancelled = preapproval.status === 'canceled';
  const weInitiated = subscription.cancel_at_period_end || subscription.status === 'cancel_pending';

  const statusMap: Record<string, string> = {
    authorized: 'active',
    canceled: 'cancelled',
    paused: 'paused',
    pending: 'pending',
  };

  const newStatus = statusMap[preapproval.status] || subscription.status;

  const updateFields: any = {
    preapproval_id: preapproval.id,
    status: newStatus,
    current_price: preapproval.auto_recurring?.transaction_amount ?? subscription.current_price,
    cancelled_externally: wasActive && isNowCancelled && !weInitiated,
    cancelled_reason: (wasActive && isNowCancelled && !weInitiated) ? 'external' : subscription.cancelled_reason,
    cancel_at_period_end: preapproval.status === 'canceled' ? false : subscription.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };

  if (preapproval.status === 'authorized' && subscription.status === 'pending') {
    updateFields.billing_cycle_start = preapproval.start_date || new Date().toISOString();
    updateFields.billing_cycle_end = preapproval.next_payment_date
      ? new Date(preapproval.next_payment_date).toISOString()
      : addMonth(new Date()).toISOString();
  } else if (preapproval.next_payment_date) {
    updateFields.billing_cycle_end = preapproval.next_payment_date;
  }

  await supabase.from('subscriptions').update(updateFields).eq('id', subscription.id);

  if (wasActive && isNowCancelled && !weInitiated) {
    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: 'cancelled_externally',
      event_data: { preapproval_id: preapprovalId, action },
    });
  }

  if (preapproval.status === 'authorized' && subscription.status === 'pending') {
    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: 'activated',
      event_data: { preapproval_id: preapprovalId },
    });
  }
}

async function handleAuthorizedPayment(authorizedPaymentId: string, supabase: any, mpToken: string) {
  const authPayment = await mpApiGet(`/authorized_payments/${authorizedPaymentId}`, mpToken);

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('preapproval_id', authPayment.preapproval_id)
    .maybeSingle();

  if (!subscription) {
    console.warn('No subscription for preapproval_id', {
      preapprovalId: authPayment.preapproval_id,
    });
    return;
  }

  // authPayment.status: scheduled, processed, recycling, canceled
  // authPayment.payment.status: approved, rejected, canceled, refunded (source of truth)
  const paymentStatus = authPayment.payment?.status;
  const isApproved = paymentStatus === 'approved';
  const isExplicitFailure = paymentStatus === 'rejected' || paymentStatus === 'canceled' || authPayment.status === 'canceled';

  let payment = null;
  if (authPayment.payment?.id && !paymentStatus) {
    try {
      payment = await mpApiGet(`/v1/payments/${authPayment.payment.id}`, mpToken);
    } catch {
      // best-effort
    }
  }

  // Only record transaction when there's a definitive payment result
  if (paymentStatus) {
    await supabase.from('subscription_transactions').insert({
      subscription_id: subscription.id,
      payment_id: authPayment.payment?.id ?? payment?.id,
      amount: authPayment.transaction_amount,
      currency: 'ARS',
      status: isApproved ? 'approved' : 'rejected',
      payment_method: payment?.payment_method_id,
      card_last_four: payment?.card?.last_four_digits,
      type: 'recurring',
      metadata: { authorized_payment_id: authorizedPaymentId },
      paid_at: authPayment.date_created,
    });
  }

  if (isApproved) {
    const nextBillingEnd = subscription.billing_cycle_end
      ? addMonth(new Date(subscription.billing_cycle_end)).toISOString()
      : addMonth(new Date()).toISOString();

    const prevEnd = subscription.billing_cycle_end;

    await supabase.from('subscriptions').update({
      status: 'active',
      billing_cycle_start: prevEnd,
      billing_cycle_end: nextBillingEnd,
      payment_retry_count: 0,
      updated_at: new Date().toISOString(),
    }).eq('id', subscription.id);

    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: 'payment_received',
      event_data: { amount: authPayment.transaction_amount },
    });
  } else if (isExplicitFailure) {
    const retryCount = (subscription.payment_retry_count || 0) + 1;
    await supabase.from('subscriptions').update({
      status: retryCount >= (subscription.max_retries || 3) ? 'cancelled' : 'past_due',
      payment_retry_count: retryCount,
      updated_at: new Date().toISOString(),
    }).eq('id', subscription.id);

    await supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: retryCount >= (subscription.max_retries || 3)
        ? 'cancelled_due_to_payment_failure'
        : 'payment_failed',
      event_data: { retry_count: retryCount, max_retries: subscription.max_retries || 3 },
    });
  }
  // scheduled/recycling: no action needed, MP auto-retries or processes
}

async function handlePreapprovalPlan(planId: string, supabase: any, mpToken: string) {
  const plan = await mpApiGet(`/preapproval_plan/${planId}`, mpToken);

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('external_reference', plan.external_reference)
    .maybeSingle();

  if (!subscription) {
    console.warn('No subscription for external_reference', {
      externalReference: plan.external_reference,
    });
    return;
  }

  await supabase.from('subscriptions').update({
    plan_id: plan.id,
    current_price: plan.auto_recurring?.transaction_amount ?? subscription.current_price,
    updated_at: new Date().toISOString(),
  }).eq('id', subscription.id);
}


