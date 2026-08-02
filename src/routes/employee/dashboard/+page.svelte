<script lang="ts">
  import { page } from '$app/state';
  import { supabase } from '$lib/supabase';
  import { pickActiveRate, computeBalance, localToday } from '$lib/meals';
  import { onMount, onDestroy, tick } from 'svelte';
  import { Chart, DoughnutController, ArcElement, Tooltip, Legend } from 'chart.js';

  Chart.register(DoughnutController, ArcElement, Tooltip, Legend);

  const userId = page.data.profile?.id as string;

  type TodayEntry = { id: string; entry_date: string; status: string; rate_applied: number };

  let loading = $state(true);
  let activeRate = $state<number | null>(null);
  let todayEntry = $state<TodayEntry | null>(null);
  let balance = $state({ totalEaten: 0, totalCost: 0, totalPaid: 0, due: 0 });
  let marking = $state(false);
  let error = $state('');
  let loadError = $state('');
  let paused = $state(false);
  let donutCanvas: HTMLCanvasElement | undefined;
  let donutChart: Chart | null = null;

  async function load() {
    loading = true;
    loadError = '';
    // Read the date fresh each load — a tab left open past midnight must not
    // keep reporting yesterday as "today".
    const today = localToday();
    const [ratesRes, entriesRes, paymentsRes, pauseRes] = await Promise.all([
      supabase.from('meal_rates').select('rate, effective_from, created_at'),
      supabase.from('meal_entries').select('id, entry_date, status, rate_applied').eq('user_id', userId),
      supabase.from('payments').select('amount').eq('user_id', userId),
      supabase.from('ordering_pause').select('paused_date').eq('paused_date', today).maybeSingle()
    ]);

    const failed = [ratesRes.error, entriesRes.error, paymentsRes.error, pauseRes.error].find(Boolean);
    if (failed) {
      loadError = failed.message;
      loading = false;
      donutChart?.destroy();
      donutChart = null;
      return;
    }

    activeRate = pickActiveRate(ratesRes.data ?? [], today);
    todayEntry = (entriesRes.data ?? []).find((e) => e.entry_date === today) ?? null;
    balance = computeBalance(entriesRes.data ?? [], paymentsRes.data ?? []);
    paused = !!pauseRes.data;
    loading = false;
    await tick();
    donutChart?.destroy();
    donutChart = null;
    if (balance.due > 0 && donutCanvas) {
      donutChart = new Chart(donutCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Paid', 'Due'],
          datasets: [{ data: [balance.totalPaid, balance.due], backgroundColor: ['#5b7553', '#c4432b'] }]
        },
        options: { responsive: true }
      });
    }
  }

  onMount(load);
  onDestroy(() => donutChart?.destroy());

  async function markEating() {
    if (marking) return;
    if (activeRate === null) return;
    marking = true;
    error = '';
    // rate_applied is recomputed server-side by a trigger; this value is only a hint.
    const { error: insertError } = await supabase
      .from('meal_entries')
      .insert({ user_id: userId, entry_date: localToday(), rate_applied: activeRate });
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
{:else if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{:else}
  <div class="grid gap-10 md:grid-cols-[320px_1fr] items-start">
    <div class="ticket pt-8 pb-6 px-6">
      {#if todayEntry?.status === 'CONFIRMED'}
        <p class="font-display text-[11px] tracking-widest text-sage uppercase mb-2">Marked</p>
        <p class="text-sm">You're eating today. Charged at {todayEntry.rate_applied.toFixed(2)}.</p>
      {:else if todayEntry}
        <!-- unique(user_id, entry_date) means a cancelled day can't be re-marked. -->
        <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-2">Cancelled</p>
        <p class="text-sm text-ink/60">Today's entry was cancelled.</p>
      {:else if paused}
        <p class="font-display text-[11px] tracking-widest text-stamp uppercase mb-2">Closed</p>
        <p class="text-sm text-ink/60">Ordering is closed for today. Check back tomorrow.</p>
      {:else if activeRate === null}
        <p class="font-display text-[11px] tracking-widest text-stamp uppercase mb-2">No rate set</p>
        <p class="text-sm text-ink/60">Ask your admin to set a meal rate first.</p>
      {:else}
        <p class="font-display text-[11px] tracking-widest text-ink/60 uppercase mb-3">Eating today?</p>
        {#if error}<p class="text-sm text-stamp-dark mb-3">{error}</p>{/if}
        <button
          onclick={markEating}
          disabled={marking}
          class="flex flex-col items-center gap-2 mx-auto disabled:opacity-50 hover:brightness-105 transition-[filter]"
        >
          <img src="/order-button.png" alt="Order now" class="w-full max-w-70" />
          <span class="font-display text-xs tracking-wide text-ink/50">
            {marking ? 'Marking…' : `Charged at ${activeRate.toFixed(2)}`}
          </span>
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
          <dd class="font-display text-lg">{balance.totalCost.toFixed(2)}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Total paid</dt>
          <dd class="font-display text-lg">{balance.totalPaid.toFixed(2)}</dd>
        </div>
        <div>
          <dt class="text-ink/50">Due</dt>
          <dd class="font-display text-lg {balance.due > 0 ? 'text-stamp' : 'text-sage'}">{balance.due.toFixed(2)}</dd>
        </div>
      </dl>
      {#if balance.due > 0}
        <div class="mt-6 max-w-xs">
          <canvas bind:this={donutCanvas} height="160"></canvas>
        </div>
      {:else}
        <p class="mt-6 text-sm text-sage">
          {balance.due < 0 ? `Credit of ${(-balance.due).toFixed(2)}` : 'Paid in full'}
        </p>
      {/if}
    </div>
  </div>
{/if}
