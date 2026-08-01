<script lang="ts">
  import './layout.css';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { supabase } from '$lib/supabase';

  let { children } = $props();

  // Re-runs the root load (and therefore every layout guard) whenever the session
  // changes: sign-in, sign-out, token refresh. Without this SvelteKit keeps serving
  // the cached {session: null} from the first load and every guard bounces to /login.
  onMount(() => {
    const { data } = supabase.auth.onAuthStateChange(() => invalidateAll());
    return () => data.subscription.unsubscribe();
  });
</script>

{@render children()}
