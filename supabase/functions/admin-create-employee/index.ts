import { createClient } from 'npm:@supabase/supabase-js@2';

// Edge functions get no CORS headers for free, and this endpoint is always
// cross-origin (localhost:5173 / tauri:// -> 127.0.0.1:54321) with a custom
// Authorization header, so the browser preflights every call.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'missing authorization' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return json({ error: 'invalid session' }, 401);
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }

  const { email, name } = await req.json();
  if (!email || !name) {
    return json({ error: 'email and name required' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Handed back to the admin to pass on to the employee. Foundation has no
  // set-password route and no working reset-email landing page, so a disclosed
  // temporary password is the only way a new account can actually be logged into.
  const tempPassword = crypto.randomUUID();

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: tempPassword
  });

  if (createError || !created.user) {
    return json({ error: createError?.message ?? 'user creation failed' }, 500);
  }

  const { error: insertError } = await adminClient
    .from('profiles')
    .insert({ id: created.user.id, name, role: 'employee' });

  if (insertError) {
    // Otherwise the auth user is orphaned: no profile row, and the email address is
    // now taken, so the admin can never retry the same address.
    await adminClient.auth.admin.deleteUser(created.user.id);
    return json({ error: insertError.message }, 500);
  }

  return json({ id: created.user.id, email, tempPassword }, 201);
});
