import { redirect } from '@sveltejs/kit';
import { resolveGuard } from '$lib/guards';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent }) => {
  const { profile } = await parent();
  const redirectTo = resolveGuard(profile?.role ?? null, 'admin');
  if (redirectTo) throw redirect(303, redirectTo);
  return { profile };
};
