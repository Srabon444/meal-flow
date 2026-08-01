import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

// Cron-only endpoint: Supabase's scheduled Cron Jobs hit this twice a day
// (see README "Push reminders" setup). Never exposed to end users, so auth
// is a shared secret rather than a user session.
Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client = createClient(supabaseUrl, serviceRoleKey);

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
  );

  const body = await req.json().catch(() => ({ kind: null }));
  const kind = body.kind;
  if (kind !== 'employee-reminder' && kind !== 'admin-reminder') {
    return new Response(
      JSON.stringify({ error: 'kind must be employee-reminder or admin-reminder' }),
      { status: 400 }
    );
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  let targetUserIds: string[] = [];

  if (kind === 'employee-reminder') {
    const [{ data: employees, error: employeesError }, { data: confirmedToday, error: entriesError }] =
      await Promise.all([
        client.from('profiles').select('id').eq('role', 'employee').eq('active', true),
        client.from('meal_entries').select('user_id').eq('entry_date', today).eq('status', 'CONFIRMED')
      ]);
    if (employeesError || entriesError) {
      return new Response(
        JSON.stringify({ error: (employeesError ?? entriesError)?.message }),
        { status: 500 }
      );
    }
    const confirmedIds = new Set((confirmedToday ?? []).map((e) => e.user_id));
    targetUserIds = (employees ?? []).map((e) => e.id).filter((id) => !confirmedIds.has(id));
  } else {
    const { data: pauseRow, error: pauseError } = await client
      .from('ordering_pause')
      .select('paused_date')
      .eq('paused_date', today)
      .maybeSingle();
    if (pauseError) {
      return new Response(JSON.stringify({ error: pauseError.message }), { status: 500 });
    }
    if (pauseRow) {
      return new Response(JSON.stringify({ sent: 0, reason: 'already paused' }), { status: 200 });
    }
    const { data: admins, error: adminsError } = await client.from('profiles').select('id').eq('role', 'admin');
    if (adminsError) {
      return new Response(JSON.stringify({ error: adminsError.message }), { status: 500 });
    }
    targetUserIds = (admins ?? []).map((a) => a.id);
  }

  if (targetUserIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const { data: subscriptions, error: subsError } = await client
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', targetUserIds);
  if (subsError) {
    return new Response(JSON.stringify({ error: subsError.message }), { status: 500 });
  }

  const payload = JSON.stringify(
    kind === 'employee-reminder'
      ? { title: 'OfficeMeal', body: "You haven't ordered today yet." }
      : { title: 'OfficeMeal', body: 'Ordering is still open — close it if needed.' }
  );

  let sent = 0;
  const staleIds: string[] = [];
  for (const sub of subscriptions ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
    }
  }

  if (staleIds.length > 0) {
    await client.from('push_subscriptions').delete().in('id', staleIds);
  }

  return new Response(JSON.stringify({ sent, stale: staleIds.length }), { status: 200 });
});
