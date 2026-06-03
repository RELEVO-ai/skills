// cron-retry-payment.ts — Supabase Edge Function
// Schedule: Daily at 12:00
// Re-authoriza subscriptions past_due para que MP reintente el cobro.
// MP automaticamente volvera a intentar el cobro al re-authorizar.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const BATCH = 50;

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')!;

  let offset = 0;
  let hasMore = true;
  let successCount = 0;
  let failCount = 0;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'past_due')
      .lt('payment_retry_count', 3)
      .order('payment_retry_count', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }

    if (!batch?.length) {
      if (offset === 0) console.log('No subscriptions to retry');
      break;
    }

    for (const sub of batch) {
      try {
        if (sub.preapproval_id) {
          const res = await fetch(
            `https://api.mercadopago.com/preapproval/${sub.preapproval_id}`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${mpToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ status: 'authorized' }),
            },
          );

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`MP API ${res.status}: ${errText}`);
          }
        }

        await supabase.from('subscriptions').update({
          updated_at: new Date().toISOString(),
        }).eq('id', sub.id);

        await supabase.from('subscription_events').insert({
          subscription_id: sub.id,
          event_type: 'payment_retry',
          event_data: {
            current_retry_count: sub.payment_retry_count || 0,
            max_retries: sub.max_retries || 3,
            preapproval_id: sub.preapproval_id,
          },
        });

        successCount++;
      } catch (error) {
        console.error(`Failed to retry subscription ${sub.id}:`, error.message);

        await supabase.from('subscription_events').insert({
          subscription_id: sub.id,
          event_type: 'retry_failed',
          event_data: { error: error.message, preapproval_id: sub.preapproval_id },
        });

        failCount++;
      }
    }

    offset += BATCH;
  }

  console.log(`Retry complete: ${successCount} retried, ${failCount} failed`);
  return new Response('OK', { status: 200 });
});
