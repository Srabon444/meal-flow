<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/supabase';
  import { pickActiveRate, computeBalance } from '$lib/meals';
  import { onMount } from 'svelte';

  const today = new Date().toISOString().slice(0, 10);
  const userId = page.data.profile?.id as string;

  type TodayEntry = { id: string; entry_date: string; status: string; rate_applied: number };

  let loading = $state(true);
  let activeRate = $state<number | null>(null);
  let todayEntry = $state<TodayEntry | null>(null);
  let balance = $state({ totalEaten: 0, totalCost: 0, totalPaid: 0, due: 0 });
  let marking = $state(false);
  let error = $state('');

  async function load() {
    loading = true;
    const [ratesRes, entriesRes, paymentsRes] = await Promise.all([
      supabase.from('meal_rates').select('rate, effective_from'),
      supabase.from('meal_entries').select('id, entry_date, status, rate_applied').eq('user_id', userId),
      supabase.from('payments').select('amount').eq('user_id', userId)
    ]);

    activeRate = pickActiveRate(ratesRes.data ?? [], today);
    todayEntry = (entriesRes.data ?? []).find((e) => e.entry_date === today) ?? null;
    balance = computeBalance(entriesRes.data ?? [], paymentsRes.data ?? []);
    loading = false;
  }

  onMount(load);

  async function markEating() {
    if (activeRate === null) return;
    marking = true;
    error = '';
    const { error: insertError } = await supabase
      .from('meal_entries')
      .insert({ user_id: userId, entry_date: today, rate_applied: activeRate });
    marking = false;
    if (insertError) {
      error = insertError.message;
      return;
    }
    await load();
  }
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Today</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Welcome, {page.data.profile?.name}</h1>
</div>

{#if loading}
  <p class="text-sm text-ink/50">Loading…</p>
{:else}
  <div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
    <div class="ticket pt-8 pb-6 px-6">
      {#if todayEntry}
        <p class="font-display text-[11px] tracking-widest text-sage uppercase mb-2">Marked</p>
        <p class="text-sm">You're eating today. Charged at {todayEntry.rate_applied}.</p>
      {:else if activeRate === null}
        <p class="font-display text-[11px] tracking-widest text-stamp uppercase mb-2">No rate set</p>
        <p class="text-sm text-ink/60">Ask your admin to set a meal rate first.</p>
      {:else}
        <p class="font-display text-[11px] tracking-widest text-ink/60 uppercase mb-3">Eating today?</p>
        {#if error}<p class="text-sm text-stamp-dark mb-3">{error}</p>{/if}
        <button
          onclick={markEating}
          disabled={marking}
          class="font-display text-sm tracking-wide bg-stamp text-paper px-5 py-2.5 rounded-sm hover:bg-stamp-dark transition-colors disabled:opacity-50 w-full"
        >
          {marking ? 'Marking…' : `Yes, count me in (${activeRate}) →`}
        </button>
      {/if}
    </div>

    <div>
      <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">Balance</p>
      <dl class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt class="text-ink/50">Meals eaten</dt>
          <dd class="font-display text-lg">{balance.totalEaten}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Total cost</dt>
          <dd class="font-display text-lg">{balance.totalCost}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Total paid</dt>
          <dd class="font-display text-lg">{balance.totalPaid}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Due</dt>
          <dd class="font-display text-lg {balance.due > 0 ? 'text-stamp' : 'text-sage'}">{balance.due}</dd>
        </div>
      </dl>
    </div>
  </div>
{/if}
