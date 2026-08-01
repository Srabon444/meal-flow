<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let error = $state('');

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      error = signInError.message;
      return;
    }
    await goto('/');
  }
</script>

<form onsubmit={handleLogin} class="max-w-sm mx-auto mt-20 space-y-4">
  <h1 class="text-xl font-semibold">OfficeMeal login</h1>
  <input type="email" bind:value={email} placeholder="Email" class="border p-2 w-full" required />
  <input type="password" bind:value={password} placeholder="Password" class="border p-2 w-full" required />
  {#if error}<p class="text-red-600 text-sm">{error}</p>{/if}
  <button type="submit" class="bg-blue-600 text-white px-4 py-2 w-full">Log in</button>
</form>
