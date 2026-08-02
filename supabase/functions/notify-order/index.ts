import { corsHeaders, json } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { configureVapid, sendToUsers } from '../_shared/webpush.ts';

// Admin-triggered "time to order" broadcast - on demand, not the 9am/10:30am
// cron reminders. Web/desktop get a real push via push_subscriptions.
// Android has no background push (no FCM, see design doc), so a closed
// Android app won't receive this; an open one picks it up via the
// order_broadcasts row inserted below (see initOrderBroadcastListener in
// androidReminders.ts).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { adminClient, user } = auth;

  const { data: employees, error: employeesError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('role', 'employee')
    .eq('active', true);
  if (employeesError) return json({ error: employeesError.message }, 500);

  const { error: broadcastError } = await adminClient
    .from('order_broadcasts')
    .insert({ created_by: user.id });
  if (broadcastError) return json({ error: broadcastError.message }, 500);

  configureVapid();
  try {
    const result = await sendToUsers(
      adminClient,
      (employees ?? []).map((e) => e.id),
      { title: 'MealFlow', body: 'Time to order your meal!' }
    );
    return json(result, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
