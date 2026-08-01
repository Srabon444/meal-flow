import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// `/` is a router, not a page: send everyone to the dashboard their role owns.
export const load: PageLoad = async ({ parent }) => {
  const { profile } = await parent();
  if (profile?.role === 'admin') throw redirect(303, '/admin/dashboard');
  if (profile?.role === 'employee') throw redirect(303, '/employee/dashboard');
  throw redirect(303, '/login');
};
