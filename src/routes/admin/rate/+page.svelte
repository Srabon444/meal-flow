<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type RateRow = { id: string; rate: number; effective_from: string; created_at: string };

  let rate = $state('');
  let effectiveFrom = $state(new Date().toLocaleDateString('en-CA'));
  let history = $state<RateRow[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let submitting = $state(false);
  let error = $state('');

  async function load() {
    loading = true;
    loadError = '';
    const { data, error: selectError } = await supabase
      .from('meal_rates')
      .select('id, rate, effective_from, created_at')
      .order('effective_from', { ascending: false });
    if (selectError) {
      loadError = selectError.message;
      loading = false;
      return;
    }
    history = data ?? [];
    loading = false;
  }

  onMount(load);

  async function submitRate(e: SubmitEvent) {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    error = '';
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { error: insertError } = await supabase
      .from('meal_rates')
      .insert({ rate: Number(rate), effective_from: effectiveFrom, created_by: user!.id });
    submitting = false;
    if (insertError) {
      error = insertError.message;
      return;
    }
    rate = '';
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Rate</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Meal rate</h1>
</div>

<div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
  <form onsubmit={submitRate} class="ticket pt-8 pb-6 px-6">
    <div class="space-y-4">
      <label class="block">
        <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Rate</span>
        <input
          type="number"
          step="0.01"
          min="0"
          bind:value={rate}
          placeholder="150.00"
          class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
          required
        />
      </label>
      <label class="block">
        <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Effective from</span>
        <input
          type="date"
          bind:value={effectiveFrom}
          class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
          required
        />
      </label>
    </div>
    {#if error}<p class="mt-4 text-sm text-stamp-dark">{error}</p>{/if}
    <div class="ticket-tear mt-6 pt-4">
      <button
        type="submit"
        disabled={submitting}
        class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50 w-full"
      >
        {submitting ? 'Saving…' : 'Set rate →'}
      </button>
    </div>
  </form>

  <div>
    <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">History</p>
    {#if loading}
      <p class="text-sm text-ink/50">Loading…</p>
    {:else if loadError}
      <p class="text-sm text-stamp-dark">{loadError}</p>
    {:else if history.length === 0}
      <p class="text-sm text-ink/50">No rates set yet.</p>
    {:else}
      <ul class="divide-y divide-line border-t border-b border-line">
        {#each history as row (row.id)}
          <li class="py-3 flex items-center justify-between text-sm">
            <span>Effective {row.effective_from}</span>
            <span class="font-display">{row.rate.toFixed(2)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
