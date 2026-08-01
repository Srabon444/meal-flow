<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onMount, onDestroy } from 'svelte';
  import {
    Chart,
    BarController,
    CategoryScale,
    LinearScale,
    BarElement,
    Tooltip,
    Legend
  } from 'chart.js';

  Chart.register(BarController, CategoryScale, LinearScale, BarElement, Tooltip, Legend);

  type BalanceRow = { user_id: string; total_eaten: number; total_cost: number; total_paid: number };

  let mealsCanvas: HTMLCanvasElement;
  let duesCanvas: HTMLCanvasElement;
  let mealsChart: Chart | null = null;
  let duesChart: Chart | null = null;

  let loading = $state(true);
  let loadError = $state('');

  function lastNDays(n: number): string[] {
    const days: string[] = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(d.toLocaleDateString('en-CA'));
    }
    return days;
  }

  async function load() {
    loading = true;
    loadError = '';

    const days = lastNDays(30);
    const since = days[0];

    const [entriesRes, balancesRes] = await Promise.all([
      supabase
        .from('meal_entries')
        .select('entry_date')
        .eq('status', 'CONFIRMED')
        .gte('entry_date', since),
      supabase.rpc('employee_balances')
    ]);

    if (entriesRes.error) {
      loadError = entriesRes.error.message;
      loading = false;
      return;
    }
    if (balancesRes.error) {
      loadError = balancesRes.error.message;
      loading = false;
      return;
    }

    const countByDay: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
    for (const row of entriesRes.data ?? []) {
      if (row.entry_date in countByDay) countByDay[row.entry_date]++;
    }

    const { data: employeesData } = await supabase.functions.invoke<{
      employees: { id: string; name: string }[];
    }>('admin-list-employees', { method: 'GET' });
    const nameById = Object.fromEntries((employeesData?.employees ?? []).map((e) => [e.id, e.name]));

    const balanceRows = (balancesRes.data ?? []) as unknown as BalanceRow[];
    const dueRows = balanceRows
      .map((r) => ({
        name: nameById[r.user_id] ?? 'Unknown',
        due: Number(r.total_cost) - Number(r.total_paid)
      }))
      .filter((r) => r.due > 0)
      .sort((a, b) => b.due - a.due);

    mealsChart?.destroy();
    mealsChart = new Chart(mealsCanvas, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [{ label: 'Meals', data: days.map((d) => countByDay[d]), backgroundColor: '#2b2622' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });

    duesChart?.destroy();
    duesChart = new Chart(duesCanvas, {
      type: 'bar',
      data: {
        labels: dueRows.map((r) => r.name),
        datasets: [{ label: 'Due', data: dueRows.map((r) => r.due), backgroundColor: '#c4432b' }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });

    loading = false;
  }

  onMount(load);
  onDestroy(() => {
    mealsChart?.destroy();
    duesChart?.destroy();
  });
</script>

<div class="mb-8">
  <p class="font-display text-xs tracking-[0.3em] text-stamp uppercase mb-2">Reports</p>
  <h1 class="font-display text-2xl font-bold tracking-tight">Charts</h1>
</div>

{#if loadError}
  <p class="text-sm text-stamp-dark">{loadError}</p>
{/if}

<div class="space-y-10">
  <div>
    <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">
      Meals per day (last 30 days)
    </p>
    <canvas bind:this={mealsCanvas} height="120"></canvas>
  </div>
  <div>
    <p class="font-display text-[11px] tracking-widest text-ink/50 uppercase mb-3">Outstanding dues</p>
    {#if loading}
      <p class="text-sm text-ink/50">Loading…</p>
    {/if}
    <canvas bind:this={duesCanvas} height="120"></canvas>
  </div>
</div>
