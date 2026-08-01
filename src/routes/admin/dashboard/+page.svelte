<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';
  import { localToday } from '$lib/meals';
  import { page } from '$app/state';

  type Row = { id: string; user_id: string; profiles: { name: string } | null };

  const adminId = page.data.profile?.id as string;

  let selectedDate = $state(localToday());
  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let paused = $state(false);
  let pauseLoading = $state(false);
  let pauseError = $state('');

  async function load() {
    loading = true;
    loadError = '';
    const { data, error } = await supabase
      .from('meal_entries')
      .select('id, user_id, profiles(name)')
      .eq('entry_date', selectedDate)
      .eq('status', 'CONFIRMED');
    if (error) {
      loadError = error.message;
      loading = false;
      return;
    }
    rows = (data ?? []) as unknown as Row[];
    loading = false;
  }

  async function loadPauseState() {
    const { data } = await supabase
      .from('ordering_pause')
      .select('paused_date')
      .eq('paused_date', localToday())
      .maybeSingle();
    paused = !!data;
  }

  async function togglePause() {
    if (pauseLoading) return;
    pauseLoading = true;
    pauseError = '';
    const today = localToday();
    const { error } = paused
      ? await supabase.from('ordering_pause').delete().eq('paused_date', today)
      : await supabase.from('ordering_pause').insert({ paused_date: today, paused_by: adminId });
    pauseLoading = false;
    if (error) {
      pauseError = error.message;
      return;
    }
    paused = !paused;
  }

  onMount(() => {
    load();
    loadPauseState();
  });
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Tally</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Who's eating</h1>
</div>

<div class="ticket mb-8 px-6 py-5">
  <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-2">Ordering</p>
  {#if pauseError}<p class="text-sm text-stamp-dark mb-2">{pauseError}</p>{/if}
  <button
    onclick={togglePause}
    disabled={pauseLoading}
    class="font-display text-sm tracking-wide px-5 py-3 rounded-sm w-full transition-colors disabled:opacity-50 {paused
      ? 'bg-ink/10 text-ink hover:bg-ink/20'
      : 'bg-stamp text-paper hover:bg-stamp-dark'}"
  >
    {pauseLoading ? 'Working…' : paused ? 'Reopen ordering for today' : 'Close ordering for today'}
  </button>
  {#if paused}
    <p class="mt-2 text-xs text-ink/50">
      Employees can't mark new meals today. Reopens automatically tomorrow.
    </p>
  {/if}
</div>

<label class="block mb-6 max-w-xs">
  <span class="font-display text-[11px] tracking-widest text-ink/60 uppercase">Date</span>
  <input
    type="date"
    bind:value={selectedDate}
    onchange={load}
    class="mt-1 w-full border-b-2 border-line bg-transparent py-2 outline-none focus:border-stamp transition-colors"
  />
</label>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else}
  <p class="font-display text-lg mb-4">{rows.length} eating on {selectedDate}</p>
  {#if rows.length === 0}
    <p class="text-sm text-ink/50">Nobody marked yet.</p>
  {:else}
    <ul class="divide-y divide-line border-t border-b border-line">
      {#each rows as row (row.id)}
        <li class="py-2 text-sm">{row.profiles?.name ?? 'Unknown'}</li>
      {/each}
    </ul>
  {/if}
{/if}
