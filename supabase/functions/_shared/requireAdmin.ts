import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from './cors.ts';

// Verifies the caller is a logged-in admin, then hands back a service-role
// client for the privileged work the caller actually asked for. Every admin
// edge function needs exactly this check before touching auth.admin.*.
export async function requireAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return { ok: false as const, response: json({ error: 'missing authorization' }, 401) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const {
    data: { user },
    error: userError
  } = await callerClient.auth.getUser();
  if (userError || !user) {
    return { ok: false as const, response: json({ error: 'invalid session' }, 401) };
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin') {
    return { ok: false as const, response: json({ error: 'forbidden' }, 403) };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  return { ok: true as const, adminClient, user };
}
