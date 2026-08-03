import { corsHeaders, json } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { configureVapid, sendToUsers } from '../_shared/webpush.ts';
import { sendFcmToUsers } from '../_shared/fcm.ts';

// Admin-triggered "time to order" broadcast - on demand, not the 9am/10:30am
// cron reminders. Web/desktop get a real push via push_subscriptions; Android
// gets a real push via fcm_tokens, delivered even if the app is closed. The
// order_broadcasts row inserted below is a foreground-only Android fallback,
// kept alongside FCM for now (see plan doc's cleanup note).
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
  const employeeIds = (employees ?? []).map((e) => e.id);
  const payload = { title: 'MealFlow', body: 'Time to order your meal!' };
  try {
    const [webResult, fcmResult] = await Promise.all([
      sendToUsers(adminClient, employeeIds, payload),
      sendFcmToUsers(adminClient, employeeIds, payload)
    ]);
    return json({ web: webResult, fcm: fcmResult }, 200);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
