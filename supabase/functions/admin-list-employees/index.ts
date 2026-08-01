import { corsHeaders, json } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { adminClient } = auth;

  const { data: profiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id, name, role, created_at')
    .eq('role', 'employee')
    .order('created_at', { ascending: false });

  if (profilesError) {
    return json({ error: profilesError.message }, 500);
  }

  // Email lives on auth.users, not profiles - only the service role can read it.
  const { data: usersPage, error: usersError } = await adminClient.auth.admin.listUsers({
    perPage: 1000
  });
  if (usersError) {
    return json({ error: usersError.message }, 500);
  }
  const emailById = new Map(usersPage.users.map((u) => [u.id, u.email]));

  const employees = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    email: emailById.get(p.id) ?? null,
    createdAt: p.created_at
  }));

  return json({ employees }, 200);
});
