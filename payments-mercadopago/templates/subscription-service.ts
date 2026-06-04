// subscription-service.ts — Shared logic for subscription CRUD and MP sync
// Can be used by webhook handlers, cron jobs, and API endpoints

import { calculateUpgradeProration, type CycleInfo } from './pricing-calculator.ts';

export interface Subscription {
  id: string;
  user_id: string;
  product_id: string;
  plan_id: string;
  preapproval_id: string | null;
  external_reference: string;
  status: 'pending' | 'active' | 'cancel_pending' | 'past_due' | 'cancelled' | 'expired' | 'paused' | 'free';
  current_price: number;
  currency: string;
  billing_cycle_start: string | null;
  billing_cycle_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_externally: boolean;
  cancelled_reason: 'user_request' | 'downgrade_to_free' | 'payment_failure' | 'external' | null;
  payment_retry_count: number;
  max_retries: number;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export class SubscriptionService {
  constructor(
    private supabase: any,
    private mpToken: string,
  ) {}

  // ====================================================
  // Create a new subscription
  // 1. Create preapproval_plan in MP (ya incluye init_point)
  // 2. Save locally as pending (sin billing_cycle, se setea
  //    cuando llega el primer payment webhook)
  // 3. Save discount in subscription_discounts if applicable
  // 4. Return init_point for user redirect
  // ====================================================
  async create(params: {
    userId: string;
    productId: string;
    price: number;
    currency?: string;
    metadata?: Record<string, any>;
    discountAmount?: number;
    discountEndDate?: string;
    freeTrialDays?: number;
  }): Promise<{ checkoutUrl: string; subscription: Subscription }> {
    const externalRef = `sub_${crypto.randomUUID()}`;
    const discountedPrice = params.discountAmount
      ? params.price - params.discountAmount
      : params.price;

    // 1. Create preapproval_plan in MP
    const planPayload: any = {
      reason: params.productId,
      external_reference: externalRef,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: discountedPrice,
        currency_id: params.currency || 'ARS',
        billing_day_proportional: true,
      },
      back_url: `${Deno.env.get('APP_URL')}/account`,
      payment_methods_allowed: {
        payment_types: [{}],
        payment_methods: [{}],
      },
    };

    if (params.freeTrialDays) {
      planPayload.auto_recurring.free_trial = {
        frequency: params.freeTrialDays,
        frequency_type: 'days',
      };
    }

    const plan = await this.mpApiPost('/preapproval_plan', planPayload);

    // 2. Save locally (no billing_cycle — first payment webhook sets it)
    const { data: subscription, error } = await this.supabase
      .from('subscriptions')
      .insert({
        user_id: params.userId,
        product_id: params.productId,
        plan_id: plan.id,
        external_reference: externalRef,
        status: 'pending',
        current_price: discountedPrice,
        currency: params.currency || 'ARS',
        metadata: params.metadata || {},
      })
      .select()
      .single();

    if (error) throw error;

    // 3. Save discount if applicable
    if (params.discountAmount) {
      await this.supabase.from('subscription_discounts').insert({
        subscription_id: subscription.id,
        original_price: params.price,
        discounted_price: discountedPrice,
        discount_amount: params.discountAmount,
        currency: params.currency || 'ARS',
        discount_end_date: params.discountEndDate || null,
        applied_by: 'admin',
      });
    }

    // 4. Event
    await this.supabase.from('subscription_events').insert({
      subscription_id: subscription.id,
      event_type: 'created',
      event_data: {
        plan_id: plan.id,
        init_point: plan.init_point,
        has_discount: !!params.discountAmount,
      },
    });

    return { checkoutUrl: plan.init_point, subscription };
  }

  // ====================================================
  // Upgrade subscription (mid-cycle)
  // 1. Update price in MP for NEXT recurring charge
  // 2. Calculate proration
  // 3. Create checkout preference for prorated amount
  // ====================================================
  async upgrade(params: {
    subscriptionId: string;
    newPrice: number;
    productId?: string;
  }): Promise<{ checkoutUrl?: string; proratedAmount?: number }> {
    const { data: sub } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('id', params.subscriptionId)
      .maybeSingle();

    if (!sub) throw new Error('Subscription not found');
    if (sub.status !== 'active') throw new Error('Subscription not active');

    // 1. Update price in MP for next recurring charge
    if (sub.preapproval_id) {
      await this.mpApiPut(`/preapproval/${sub.preapproval_id}`, {
        auto_recurring: {
          transaction_amount: params.newPrice,
          currency_id: sub.currency,
        },
      });
    }

    // 2. Calculate proration
    const cycleInfo: CycleInfo = {
      billingCycleStart: new Date(sub.billing_cycle_start),
      billingCycleEnd: new Date(sub.billing_cycle_end),
      currentPrice: sub.current_price,
    };
    const proratedAmount = calculateUpgradeProration({ cycle: cycleInfo, newPrice: params.newPrice });
    const remainingMs = Math.max(0, cycleInfo.billingCycleEnd.getTime() - Date.now());

    // 3. Update local current_price
    await this.supabase.from('subscriptions').update({
      current_price: params.newPrice,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);

    await this.supabase.from('subscription_events').insert({
      subscription_id: sub.id,
      event_type: 'upgraded',
      event_data: {
        old_price: sub.current_price,
        new_price: params.newPrice,
        prorated_amount: proratedAmount,
      },
    });

    // 4. Create checkout preference for prorated amount
    if (proratedAmount > 0) {
      const prefPayload = {
        items: [{
          id: `upgrade_${sub.id}`,
          title: `Upgrade to ${params.productId || params.newPrice}`,
          description: `Prorated upgrade - remaining ${Math.round(remainingMs / (24*60*60*1000))} days`,
          quantity: 1,
          unit_price: proratedAmount,
          currency_id: sub.currency,
        }],
        external_reference: sub.external_reference,
        notification_url: `${Deno.env.get('WEBHOOK_URL')}/webhook-entry`,
        back_urls: {
          success: `${Deno.env.get('APP_URL')}/account`,
          failure: `${Deno.env.get('APP_URL')}/account`,
        },
        auto_return: 'approved',
        metadata: {
          checkout_type: 'upgrade',
          subscription_id: sub.id,
          new_price: params.newPrice,
        },
      };

      const preference = await this.mpApiPost('/checkout/preferences', prefPayload);

      await this.supabase.from('checkout_preferences').insert({
        preference_id: preference.id,
        subscription_id: sub.id,
        type: 'upgrade',
        amount: proratedAmount,
        currency: sub.currency,
        status: 'pending',
        external_reference: sub.external_reference,
        init_point: preference.init_point,
        metadata: { new_price: params.newPrice, prorated_amount: proratedAmount },
      });

      return { checkoutUrl: preference.init_point, proratedAmount };
    }

    return {};
  }

  // ====================================================
  // Downgrade subscription (no refund, update price)
  // ====================================================
  async downgrade(params: {
    subscriptionId: string;
    newPrice: number;
  }): Promise<void> {
    const { data: sub } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('id', params.subscriptionId)
      .maybeSingle();

    if (!sub) throw new Error('Subscription not found');
    if (!sub.preapproval_id) throw new Error('No preapproval_id');

    await this.mpApiPut(`/preapproval/${sub.preapproval_id}`, {
      auto_recurring: { transaction_amount: params.newPrice, currency_id: sub.currency },
    });

    await this.supabase.from('subscriptions').update({
      current_price: params.newPrice,
      cancel_at_period_end: false,
      status: sub.status === 'cancel_pending' ? 'active' : sub.status,
      updated_at: new Date().toISOString(),
    }).eq('id', params.subscriptionId);

    await this.supabase.from('subscription_events').insert({
      subscription_id: params.subscriptionId,
      event_type: 'downgraded',
      event_data: { old_price: sub.current_price, new_price: params.newPrice },
    });
  }

  // ====================================================
  // Cancel subscription (at period end)
  // Setea cancel_pending. El cron subscription_cycle_cancel
  // ejecuta la cancelacion real en MP 24h ANTES de billing_cycle_end.
  // cancelled_reason: 'user_request' | 'downgrade_to_free'
  // ====================================================
  async cancel(subscriptionId: string, reason: 'user_request' | 'downgrade_to_free' = 'user_request'): Promise<void> {
    const { data: sub } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .maybeSingle();

    if (!sub) throw new Error('Subscription not found');
    if (sub.status !== 'active') throw new Error('Subscription must be active to cancel');

    await this.supabase.from('subscriptions').update({
      status: 'cancel_pending',
      cancel_at_period_end: true,
      cancelled_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq('id', subscriptionId);

    await this.supabase.from('subscription_events').insert({
      subscription_id: subscriptionId,
      event_type: reason === 'downgrade_to_free'
        ? 'downgrade_to_free_scheduled'
        : 'cancel_scheduled',
      event_data: {
        reason,
        billing_cycle_end: sub.billing_cycle_end,
        will_cancel_before: new Date(
          new Date(sub.billing_cycle_end).getTime() - 24 * 60 * 60 * 1000
        ).toISOString(),
      },
    });
  }

  // ====================================================
  // Immediate cancel (force)
  // Cancela en MP y local inmediatamente.
  // ====================================================
  async cancelImmediate(subscriptionId: string): Promise<void> {
    const { data: sub } = await this.supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .maybeSingle();

    if (!sub) throw new Error('Subscription not found');

    if (sub.preapproval_id) {
      await this.mpApiPut(`/preapproval/${sub.preapproval_id}`, {
        status: 'canceled',
      });
    }

    await this.supabase.from('subscriptions').update({
      status: 'cancelled',
      cancel_at_period_end: false,
      cancelled_reason: 'user_request',
      updated_at: new Date().toISOString(),
    }).eq('id', subscriptionId);

    await this.supabase.from('subscription_events').insert({
      subscription_id: subscriptionId,
      event_type: 'cancelled_immediate',
      event_data: { preapproval_id: sub.preapproval_id },
    });
  }

  // ====================================================
  // MP API helpers
  // ====================================================
  private async mpApiPost(path: string, body: any): Promise<any> {
    const res = await fetch(`https://api.mercadopago.com${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`MP API POST ${path} ${res.status}: ${error}`);
    }
    return res.json();
  }

  private async mpApiPut(path: string, body: any): Promise<any> {
    const res = await fetch(`https://api.mercadopago.com${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`MP API PUT ${path} ${res.status}: ${error}`);
    }
    return res.json();
  }
}


