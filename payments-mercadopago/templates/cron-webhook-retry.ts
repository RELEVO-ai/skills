// webhook_retry — reprocesa webhooks fallidos desde webhook_log con backoff.
// Schedule: every 15min. Doc: references/crons.md
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
// process_webhook: ver templates/webhook-entry.ts / references/handlers.md

export async function webhook_retry(supabase: SupabaseClient, process_webhook: (payload: unknown, headers: unknown) => Promise<void>) {
  const { data: failures } = await supabase
    .from('webhook_log')
    .select('*')
    .eq('status', 'received')
    .or(`next_retry_at.lt.${new Date().toISOString()},next_retry_at.is.null`)
    .order('next_retry_at', { ascending: true, nullsFirst: true })
    .limit(50)

  for (const failure of failures || []) {
    if (failure.retry_count >= failure.max_retries) continue
    try {
      await process_webhook(failure.original_payload, failure.headers)

      await supabase.from('webhook_log').update({
        status: 'completed',
        success: true,
        processed_at: new Date().toISOString(),
      }).eq('idempotency_key', failure.idempotency_key)
    } catch (error) {
      const newRetryCount = failure.retry_count + 1
      const backoffMinutes = [5, 15, 60][Math.min(newRetryCount - 1, 2)] || 120
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000)

      await supabase.from('webhook_log').update({
        status: 'received',
        retry_count: newRetryCount,
        last_attempt_at: new Date().toISOString(),
        next_retry_at: nextRetryAt.toISOString(),
        error_message: (error as Error).message,
      }).eq('idempotency_key', failure.idempotency_key)
    }
  }
}
