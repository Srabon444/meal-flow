import webpush from 'npm:web-push@3';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function configureVapid(): void {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
  );
}

// Sends a web-push notification to every subscription owned by userIds, and
// prunes subscriptions the push service reports as gone (404/410) - standard
// web-push hygiene, otherwise dead rows accumulate and fail every send.
export async function sendToUsers(
  client: SupabaseClient,
  userIds: string[],
  payload: { title: string; body: string }
): Promise<{ sent: number; stale: number; failed: number }> {
  if (userIds.length === 0) return { sent: 0, stale: 0, failed: 0 };

  const { data: subscriptions, error } = await client
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds);
  if (error) throw error;

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  for (const sub of subscriptions ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        staleIds.push(sub.id);
      } else {
        failed++;
        console.error('push send failed', sub.id, err);
      }
    }
  }

  if (staleIds.length > 0) {
    await client.from('push_subscriptions').delete().in('id', staleIds);
  }

  return { sent, stale: staleIds.length, failed };
}
