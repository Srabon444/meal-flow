import { corsHeaders, json } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { adminClient } = auth;

  const { email, name } = await req.json();
  if (!email || !name) {
    return json({ error: 'email and name required' }, 400);
  }

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
