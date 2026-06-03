// cron-unpaid-cleanup.ts — Supabase Edge Function
// Schedule: Every 6 hours
// Cancela preapproval_plans sin pago dentro de 24h

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const BATCH = 100;

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const mpToken = Deno.env.get('MP_ACCESS_TOKEN')!;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let offset = 0;
  let hasMore = true;
  let successCount = 0;
  let failCount = 0;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('subscriptions')
      .select('*')
      .is('preapproval_id', null)
      .lt('created_at', cutoff)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }

    if (!batch?.length) {
      if (offset === 0) console.log('No unpaid subscriptions to cleanup');
      break;
    }

    for (const sub of batch) {
      try {
        // Try to cancel the plan in MP (best effort)
        try {
          await fetch(
            `https://api.mercadopago.com/preapproval_plan/${sub.plan_id}`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${mpToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ status: 'canceled' }),
            },
          );
        } catch {
          console.warn(`Could not cancel plan ${sub.plan_id} in MP`);
        }

        // Mark locally as expired (was pending, never paid)
        await supabase.from('subscriptions').update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        }).eq('id', sub.id);

        await supabase.from('subscription_events').insert({
          subscription_id: sub.id,
          event_type: 'expired_unpaid',
          event_data: {
            created_at: sub.created_at,
            cleaned_at: new Date().toISOString(),
            plan_id: sub.plan_id,
          },
        });

        successCount++;
      } catch (error) {
        console.error(`Failed to cleanup subscription ${sub.id}:`, error.message);
        failCount++;
      }
    }

    offset += BATCH;
  }

  console.log(`Cleanup complete: ${successCount} expired, ${failCount} failed`);
  return new Response('OK', { status: 200 });
});
