import { corsHeaders, json } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/requireAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { adminClient } = auth;

  const { id, active } = await req.json();
  if (!id || typeof active !== 'boolean') {
    return json({ error: 'id and active (boolean) required' }, 400);
  }

  // Only ever touch employee accounts through this path - never an admin,
  // including the caller's own account.
  const { data: target, error: targetError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', id)
    .single();

  if (targetError || target?.role !== 'employee') {
    return json({ error: 'not an employee account' }, 403);
  }

  const { error: banError } = await adminClient.auth.admin.updateUserById(id, {
    ban_duration: active ? 'none' : '876000h'
  });
  if (banError) {
    return json({ error: banError.message }, 500);
  }

  const { error: updateError } = await adminClient.from('profiles').update({ active }).eq('id', id);
  if (updateError) {
    return json({ error: updateError.message }, 500);
  }

  return json({ id, active }, 200);
});
