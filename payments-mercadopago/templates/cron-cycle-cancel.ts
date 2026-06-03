// cron-cycle-cancel.ts — Supabase Edge Function
// Schedule: Daily at 00:05
// Cancela subscriptions en MP 24h ANTES de que billing_cycle_end venza.
// MP cobra al llegar billing_cycle_end, si cancelamos despues ya cobro.
// Consulta status = 'cancel_pending' y billing_cycle_end < now() + 24h.
// La razon de cancelacion vive en cancelled_reason (user_request | downgrade_to_free).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const BATCH = 100;

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')!;

  const cancelBeforeMs = 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() + cancelBeforeMs).toISOString();

  let offset = 0;
  let hasMore = true;
  let successCount = 0;
  let failCount = 0;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'cancel_pending')
      .lt('billing_cycle_end', cutoff)
      .order('billing_cycle_end', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }

    if (!batch?.length) {
      if (offset === 0) console.log('No subscriptions to cancel');
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
              body: JSON.stringify({ status: 'canceled' }),
            },
          );

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`MP API ${res.status}: ${errText}`);
          }
        }

        const cancelledReason = sub.cancelled_reason || 'user_request';

        await supabase.from('subscriptions').update({
          status: 'cancelled',
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        }).eq('id', sub.id);

        await supabase.from('subscription_events').insert({
          subscription_id: sub.id,
          event_type: cancelledReason === 'downgrade_to_free'
            ? 'downgraded_to_free'
            : 'cycle_cancelled',
          event_data: {
            reason: cancelledReason,
            cancelled_at: new Date().toISOString(),
            preapproval_id: sub.preapproval_id,
          },
        });

        successCount++;
      } catch (error) {
        console.error(`Failed to cancel subscription ${sub.id}:`, error.message);

        await supabase.from('subscription_events').insert({
          subscription_id: sub.id,
          event_type: 'cancel_failed',
          event_data: { error: error.message, preapproval_id: sub.preapproval_id },
        });

        failCount++;
      }
    }

    offset += BATCH;
  }

  console.log(`Cycle cancel complete: ${successCount} succeeded, ${failCount} failed`);
  return new Response('OK', { status: 200 });
});
