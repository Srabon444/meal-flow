import { writable } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import type { Role } from '$lib/guards';

export type Profile = { id: string; name: string; role: Role };

export const authStore = writable<{ session: Session | null; profile: Profile | null }>({
  session: null,
  profile: null
});
