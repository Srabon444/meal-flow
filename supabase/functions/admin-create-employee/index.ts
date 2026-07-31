import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'missing authorization' }), { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'invalid session' }), { status: 401 });
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const { email, name } = await req.json();
  if (!email || !name) {
    return new Response(JSON.stringify({ error: 'email and name required' }), { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID()
  });

  if (createError || !created.user) {
    return new Response(JSON.stringify({ error: createError?.message ?? 'user creation failed' }), { status: 500 });
  }

  const { error: insertError } = await adminClient
    .from('profiles')
    .insert({ id: created.user.id, name, role: 'employee' });

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });
  }

  const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email);

  return new Response(
    JSON.stringify({ id: created.user.id, email, resetEmailSent: !resetError }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
});
