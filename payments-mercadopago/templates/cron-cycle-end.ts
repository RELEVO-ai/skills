// cron-cycle-end.ts — Supabase Edge Function
// Schedule: Daily at 00:00
// Detecta subscriptions cuyo billing_cycle_end ya paso y no tienen
// pago registrado. Marca past_due si supera grace period de 24h.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const BATCH = 100;

serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();
  const graceMs = 24 * 60 * 60 * 1000;

  let offset = 0;
  let hasMore = true;
  let markedPastDue = 0;

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('subscriptions')
      .select('*')
      .lt('billing_cycle_end', now.toISOString())
      .eq('status', 'active')
      .eq('cancel_at_period_end', false)
      .order('billing_cycle_end', { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      console.error('Query error:', error.message);
      break;
    }

    if (!batch?.length) {
      if (offset === 0) console.log('No subscriptions at cycle end');
      break;
    }

    for (const sub of batch) {
      // Si ya se recibio el pago via webhook, skip
      const { data: recentTx } = await supabase
        .from('subscription_transactions')
        .select('id')
        .eq('subscription_id', sub.id)
        .eq('type', 'recurring')
        .gte('created_at', sub.billing_cycle_end)
        .maybeSingle();

      if (recentTx) continue;

      // Grace period de 24h desde billing_cycle_end
      const graceEnd = new Date(new Date(sub.billing_cycle_end).getTime() + graceMs);

      if (now > graceEnd) {
        await supabase.from('subscriptions').update({
          status: 'past_due',
          updated_at: now.toISOString(),
        }).eq('id', sub.id);

        await supabase.from('subscription_events').insert({
          subscription_id: sub.id,
          event_type: 'cycle_ended_unpaid',
          event_data: {
            billing_cycle_end: sub.billing_cycle_end,
            grace_end: graceEnd.toISOString(),
          },
        });

        markedPastDue++;
      }
    }

    offset += BATCH;
  }

  console.log(`Cycle end complete: ${markedPastDue} marked past_due`);
  return new Response('OK', { status: 200 });
});
