import { createClient } from 'npm:@supabase/supabase-js@2';
import { configureVapid, sendToUsers } from '../_shared/webpush.ts';

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

  const body = await req.json().catch(() => ({ kind: null }));
  const kind = body.kind;
  if (kind !== 'employee-reminder' && kind !== 'admin-reminder') {
    return new Response(
      JSON.stringify({ error: 'kind must be employee-reminder or admin-reminder' }),
      { status: 400 }
    );
  }

  configureVapid();

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
    const { data: admins, error: adminsError } = await client
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .eq('active', true);
    if (adminsError) {
      return new Response(JSON.stringify({ error: adminsError.message }), { status: 500 });
    }
    targetUserIds = (admins ?? []).map((a) => a.id);
  }

  const payload =
    kind === 'employee-reminder'
      ? { title: 'MealFlow', body: "You haven't ordered today yet." }
      : { title: 'MealFlow', body: 'Ordering is still open — close it if needed.' };

  try {
    const result = await sendToUsers(client, targetUserIds, payload);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
