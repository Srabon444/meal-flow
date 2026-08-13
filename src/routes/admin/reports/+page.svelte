<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { FunctionsHttpError } from '@supabase/supabase-js';
  import { onMount, onDestroy, tick } from 'svelte';
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

  // $state so `bind:this` clearing them on unmount is visible to load()'s guards.
  let mealsCanvas = $state<HTMLCanvasElement | undefined>();
  let duesCanvas = $state<HTMLCanvasElement | undefined>();
  let mealsChart: Chart | null = null;
  let duesChart: Chart | null = null;

  let loading = $state(true);
  let loadError = $state('');
  let dueRows = $state<{ name: string; isAdmin: boolean; due: number }[]>([]);

  function destroyCharts() {
    mealsChart?.destroy();
    mealsChart = null;
    duesChart?.destroy();
    duesChart = null;
  }

  async function messageFor(err: Error): Promise<string> {
    if (err instanceof FunctionsHttpError) {
      const body = await err.context.json().catch(() => null);
      if (body?.error) return body.error;
    }
    return err.message;
  }

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

    // Counted in Postgres, not here: selecting one row per meal entry silently
    // truncated at PostgREST's max_rows (1000) and undercounted arbitrary days.
    const [entriesRes, balancesRes, employeesRes] = await Promise.all([
      supabase.rpc('meals_per_day', { since }),
      supabase.rpc('employee_balances'),
      supabase.functions.invoke<{ employees: { id: string; name: string; role: 'employee' | 'admin' }[] }>(
        'admin-list-employees',
        { method: 'GET' }
      )
    ]);

    if (entriesRes.error) {
      loadError = entriesRes.error.message;
      loading = false;
      destroyCharts();
      return;
    }
    if (balancesRes.error) {
      loadError = balancesRes.error.message;
      loading = false;
      destroyCharts();
      return;
    }
    if (employeesRes.error) {
      loadError = await messageFor(employeesRes.error);
      loading = false;
      destroyCharts();
      return;
    }

    // One row per day (at most 30), so no cap can bite.
    const countByDay: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
    for (const row of entriesRes.data ?? []) {
      if (row.entry_date in countByDay) countByDay[row.entry_date] = Number(row.meal_count);
    }

    // Admin's own self-ordered meals count toward the "Meals per day" chart
    // automatically (meals_per_day() has no role filter) - only the per-person
    // dues chart needed the name/role lookup below to also show admin.
    const nameById = Object.fromEntries(
      (employeesRes.data?.employees ?? []).map((e) => [e.id, e.name])
    );
    const roleById = Object.fromEntries(
      (employeesRes.data?.employees ?? []).map((e) => [e.id, e.role])
    );

    const balanceRows = (balancesRes.data ?? []) as unknown as BalanceRow[];
    dueRows = balanceRows
      .map((r) => ({
        name: nameById[r.user_id] ?? 'Unknown',
        isAdmin: roleById[r.user_id] === 'admin',
        due: Number(r.total_cost) - Number(r.total_paid)
      }))
      .filter((r) => r.due > 0)
      .sort((a, b) => b.due - a.due);

    loading = false;
    // The dues canvas only exists when dueRows is non-empty — let it render first.
    await tick();
    destroyCharts();
    // Canvases are undefined if the component unmounted mid-load.
    if (mealsCanvas) {
      mealsChart = new Chart(mealsCanvas, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [
            { label: 'Meals', data: days.map((d) => countByDay[d]), backgroundColor: '#2b2622' }
          ]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }

    if (duesCanvas) {
      duesChart = new Chart(duesCanvas, {
        type: 'bar',
        data: {
          labels: dueRows.map((r) => (r.isAdmin ? `${r.name} (Admin)` : r.name)),
          datasets: [{ label: 'Due', data: dueRows.map((r) => r.due), backgroundColor: '#c4432b' }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          // Highlights the "(Admin)" label the same stamp color used for the
          // badge on the employees page, so admin's bar is easy to spot now
          // that admins are mixed into what was an employees-only chart.
          scales: {
            x: {
              ticks: {
                color: (ctx) => (dueRows[ctx.index]?.isAdmin ? '#c4432b' : '#2b2622'),
                font: (ctx) => ({ weight: dueRows[ctx.index]?.isAdmin ? 'bold' : 'normal' })
              }
            }
          }
        }
      });
    }
  }

  onMount(load);
  onDestroy(destroyCharts);
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
    {:else if dueRows.length === 0}
      <p class="text-sm text-ink/50">Nobody owes anything.</p>
    {:else}
      <canvas bind:this={duesCanvas} height="120"></canvas>
    {/if}
  </div>
</div>
