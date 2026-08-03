<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    loading = true;
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    loading = false;
    if (signInError) {
      error = signInError.message;
      return;
    }
    await goto('/');
  }
</script>

<div class="min-h-dvh flex items-center justify-center px-4 pb-24">
  <div class="w-full max-w-sm">
    <div class="mb-8 text-center">
      <img src="/logo-mark.png" alt="MealFlow" class="h-16 w-16 rounded-2xl mx-auto mb-3" />
      <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Staff sign-in</p>
    </div>

    <form onsubmit={handleLogin} class="ticket pt-8 pb-6 px-6">
      <div class="space-y-4">
        <label class="block">
          <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Email</span>
          <input
            type="email"
            bind:value={email}
            placeholder="you@company.com"
            class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
            required
          />
        </label>
        <label class="block">
          <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Password</span>
          <input
            type="password"
            bind:value={password}
            placeholder="••••••••"
            class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
            required
          />
        </label>
      </div>

      {#if error}
        <p class="mt-4 text-sm text-stamp-dark">{error}</p>
      {/if}

      <div class="ticket-tear mt-6 pt-4 flex items-center justify-between">
        <span class="font-display text-[11px] tracking-widest text-ink/40 uppercase">No. 001</span>
        <button
          type="submit"
          disabled={loading}
          class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Clock in →'}
        </button>
      </div>
    </form>
  </div>
</div>
