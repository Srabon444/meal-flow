<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount } from 'svelte';

  type Row = { id: string; user_id: string; profiles: { name: string } | null };

  let selectedDate = $state(new Date().toLocaleDateString('en-CA'));
  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let loadError = $state('');

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

  onMount(load);
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Tally</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Who's eating</h1>
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
