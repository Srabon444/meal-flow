import { corsHeaders, json } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { adminClient } = auth;

  const { id } = await req.json();
  if (!id) {
    return json({ error: 'id required' }, 400);
  }

  // Only ever delete employee accounts through this path - never let it touch
  // an admin, including the caller's own account.
  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', id)
    .single();

  if (targetError || target?.role !== 'employee') {
    return json({ error: 'not an employee account' }, 403);
  }

  // profiles.id references auth.users(id) on delete cascade, so this removes
  // the profile row too - no separate delete needed.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(id);
  if (deleteError) {
    return json({ error: deleteError.message }, 500);
  }

  return json({ id }, 200);
});
