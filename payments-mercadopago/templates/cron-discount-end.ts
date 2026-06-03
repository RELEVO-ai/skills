// cron-discount-end.ts — Supabase Edge Function
// Schedule: Daily at 00:10
// Restaura current_price a original_price cuando un descuento expira.
// Sin proración — solo actualiza el precio al original.
// Lee de subscription_discounts (status = 'active') y actualiza
// tanto MP como el registro local.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const BATCH = 100;

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')!;

  const now = new Date().toISOString();

  let offset = 0;
  let hasMore = true;
  let successCount = 0;
  let failCount = 0;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('subscription_discounts')
      .select(`
        id,
        original_price,
        discounted_price,
        discount_end_date,
        subscription_id,
        subscriptions!inner(
          id,
          status,
          current_price,
          preapproval_id,
          currency
        )
      `)
      .eq('status', 'active')
      .not('discount_end_date', 'is', null)
      .lt('discount_end_date', now)
      .in('subscriptions.status', ['active', 'cancel_pending'])
      .order('discount_end_date', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }

    if (!batch?.length) {
      if (offset === 0) console.log('No expired discounts to restore');
      break;
    }

    // Only process discounts where price hasn't been manually changed
    const expired = batch.filter(
      (d: any) => Number(d.subscriptions?.current_price) === Number(d.discounted_price)
    );

    for (const discount of expired) {
      const sub = discount.subscriptions;
      try {
        if (sub?.preapproval_id) {
          const res = await fetch(
            `https://api.mercadopago.com/preapproval/${sub.preapproval_id}`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${mpToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                auto_recurring: {
                  transaction_amount: Number(discount.original_price),
                  currency_id: sub.currency,
                },
              }),
            },
          );

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`MP API ${res.status}: ${errText}`);
          }
        }

        // Update subscription price
        await supabase.from('subscriptions').update({
          current_price: discount.original_price,
          updated_at: now,
        }).eq('id', discount.subscription_id);

        // Mark discount as expired
        await supabase.from('subscription_discounts').update({
          status: 'expired',
        }).eq('id', discount.id);

        await supabase.from('subscription_events').insert({
          subscription_id: discount.subscription_id,
          event_type: 'discount_expired',
          event_data: {
            discount_id: discount.id,
            previous_price: discount.discounted_price,
            restored_price: discount.original_price,
          },
        });

        successCount++;
      } catch (error) {
        console.error(`Failed to restore discount ${discount.id}:`, error.message);

        await supabase.from('subscription_events').insert({
          subscription_id: discount.subscription_id,
          event_type: 'discount_restore_failed',
          event_data: {
            discount_id: discount.id,
            error: error.message,
          },
        });

        failCount++;
      }
    }

    offset += BATCH;
  }

  console.log(`Discount restore complete: ${successCount} succeeded, ${failCount} failed`);
  return new Response('OK', { status: 200 });
});
