<script lang="ts">
  import { supabase } from '$lib/supabase';

  let newPassword = $state('');
  let confirmPassword = $state('');
  let submitting = $state(false);
  let error = $state('');
  let success = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (submitting) return;
    error = '';
    success = false;

    if (newPassword.length < 6) {
      error = 'Password must be at least 6 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      error = 'Passwords do not match.';
      return;
    }

    submitting = true;
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    submitting = false;
    if (updateError) {
      error = updateError.message;
      return;
    }
    success = true;
    newPassword = '';
    confirmPassword = '';
  }
</script>

<form onsubmit={submit} class="ticket pt-8 pb-6 px-6 max-w-sm">
  <div class="space-y-4">
    <label class="block">
      <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">New password</span>
      <input
        type="password"
        bind:value={newPassword}
        class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
        required
        minlength="6"
      />
    </label>
    <label class="block">
      <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Confirm password</span>
      <input
        type="password"
        bind:value={confirmPassword}
        class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
        required
        minlength="6"
      />
    </label>
  </div>

  {#if error}<p class="mt-4 text-sm text-stamp-dark">{error}</p>{/if}
  {#if success}<p class="mt-4 text-sm text-sage">Password updated.</p>{/if}

  <div class="ticket-tear mt-6 pt-4">
    <button
      type="submit"
      disabled={submitting}
      class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50 w-full"
    >
      {submitting ? 'Saving…' : 'Update password →'}
    </button>
  </div>
</form>
