export const prerender = true;
export const ssr = false;

import { supabase } from '$lib/supabase';
import { authStore } from '$lib/stores/auth';
import type { Profile } from '$lib/stores/auth';

export async function load() {
  const { data: { session } } = await supabase.auth.getSession();
  let profile: Profile | null = null;

  if (session) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', session.user.id)
      .single();
    profile = data as Profile | null;
  }

  authStore.set({ session, profile });
  return { session, profile };
}
